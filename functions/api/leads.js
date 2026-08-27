import { neon } from "@neondatabase/serverless";
import { assertSameOrigin, handleError, readJson, requireOwner, secureJson } from "../_lib/security.js";
import {
  ACTIVITY_TYPES,
  LEAD_STAGES,
  normalizeBusinessName,
  normalizeDomain,
  serializeLead,
  validateLeadInput,
} from "../_lib/leads.js";

const json = (body, status = 200) => secureJson(body, status);
const database = (env) => env.__TEST_SQL || neon(env.DATABASE_URL);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pipelineStages = ["new", "contacted", "discovery_scheduled", "qualified", "scope_sent", "approved", "paid_active"];
const stageActivities = new Map([
  ["new", "internal_note"],
  ["contacted", "internal_note"],
  ["discovery_scheduled", "discovery_scheduled"],
  ["qualified", "internal_note"],
  ["scope_sent", "scope_sent"],
  ["approved", "sow_accepted"],
  ["paid_active", "payment_received"],
  ["lost", "lost"],
  ["not_a_fit", "not_a_fit"],
  ["archived", "internal_note"],
]);

const rowMatch = (lead, params) => {
  const search = String(params.get("search") || "").toLowerCase();
  if (search && ![
    lead.businessName,
    lead.city,
    lead.serviceArea,
    lead.websiteUrl,
    lead.normalizedDomain,
    lead.industry,
    lead.internalNotes,
  ].some((value) => String(value || "").toLowerCase().includes(search))) return false;

  for (const [param, key] of [
    ["stage", "stage"], ["source", "source"], ["fit", "fitLevel"],
    ["conflict", "tidalConflictReviewStatus"], ["contact", "contactStatus"],
  ]) {
    if (params.get(param) && lead[key] !== params.get(param)) return false;
  }
  if (params.get("industry") && !String(lead.industry || "").toLowerCase().includes(params.get("industry").toLowerCase())) return false;
  if (params.get("city") && !`${lead.city || ""} ${lead.serviceArea || ""}`.toLowerCase().includes(params.get("city").toLowerCase())) return false;
  if (params.get("services") && !lead.servicesInterest.some((value) => value.toLowerCase().includes(params.get("services").toLowerCase()))) return false;
  if (params.get("overdue") === "true" && (!lead.nextActionDue || lead.nextActionCompleted || lead.nextActionDue >= new Date().toISOString().slice(0, 10))) return false;
  return true;
};

const sortLeads = (items, sort) => {
  const key = { due: "nextActionDue", activity: "lastActivityDate", created: "createdAt", verified: "lastVerifiedDate" }[sort] || "createdAt";
  const descending = key !== "nextActionDue";
  return [...items].sort((a, b) => {
    const av = String(a[key] || (descending ? "" : "9999-12-31"));
    const bv = String(b[key] || (descending ? "" : "9999-12-31"));
    const comparison = av.localeCompare(bv);
    return (descending ? -comparison : comparison) || String(a.businessName).localeCompare(String(b.businessName));
  });
};

const applyView = (items, view, params) => {
  if (view === "queue") return items.filter((lead) => !lead.archived && !lead.nextActionCompleted && (lead.nextAction || lead.nextActionDue));
  if (view === "pipeline") return items.filter((lead) => !lead.archived);
  if (view === "radar") {
    const serviceAreaPattern = /charleston|mount pleasant|summerville|north charleston|goose creek|myrtle beach|grand strand|pawleys|georgetown/i;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    return items.filter((lead) => {
      const launchDate = lead.openedDate || lead.formationDate || lead.discoveredDate;
      return !lead.archived && ["high", "medium"].includes(lead.fitLevel)
        && lead.contactStatus === "not_contacted"
        && lead.tidalConflictReviewStatus !== "pending"
        && serviceAreaPattern.test(`${lead.city || ""} ${lead.serviceArea || ""}`)
        && launchDate && new Date(`${launchDate}T12:00:00`) >= cutoff;
    });
  }
  if (view === "all") {
    if (params.get("archived") === "all") return items;
    if (params.get("archived") === "only") return items.filter((lead) => lead.archived);
    return items.filter((lead) => !lead.archived);
  }
  throw Object.assign(new Error("Lead view is invalid."), { status: 422 });
};

const leadInput = (lead, changes = {}) => ({
  businessName: lead.businessName,
  websiteUrl: lead.websiteUrl || "",
  city: lead.city || "",
  serviceArea: lead.serviceArea || "",
  industry: lead.industry || "",
  source: lead.source || "researched",
  sourceUrls: lead.sourceUrls || [],
  publicPhone: lead.publicPhone || "",
  publicEmail: lead.publicEmail || "",
  publicContactFormUrl: lead.publicContactFormUrl || "",
  publicSocialLinks: lead.publicSocialLinks || [],
  stage: lead.stage || "new",
  fitLevel: lead.fitLevel || "medium",
  fitReasons: lead.fitReasons || [],
  servicesInterest: lead.servicesInterest || [],
  formationDate: lead.formationDate || "",
  openedDate: lead.openedDate || "",
  dateConfidence: lead.dateConfidence || "unknown",
  discoveredDate: lead.discoveredDate || "",
  launchSignals: lead.launchSignals || [],
  nextAction: lead.nextAction || "",
  nextActionDue: lead.nextActionDue || "",
  nextActionOwner: lead.nextActionOwner || "",
  nextActionCompleted: Boolean(lead.nextActionCompleted),
  lastVerifiedDate: lead.lastVerifiedDate || "",
  contactStatus: lead.contactStatus || "not_contacted",
  doNotContact: Boolean(lead.doNotContact),
  doNotContactReason: lead.doNotContactReason || "",
  internalNotes: lead.internalNotes || "",
  archived: Boolean(lead.archived),
  tidalConflictReviewRequired: Boolean(lead.tidalConflictReviewRequired),
  tidalConflictReviewStatus: lead.tidalConflictReviewStatus || "not_needed",
  tidalConflictNotes: lead.tidalConflictNotes || "",
  ...changes,
});

const duplicateRows = async (sql, normalized, domain, excludeId = null) => sql`
  select id, business_name, website_url, city, stage, updated_at
  from leads
  where id <> coalesce(${excludeId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    and (normalized_business_name = ${normalized} or normalized_domain = ${domain}::text)
  order by archived asc, updated_at desc
  limit 10
`;

export async function onRequestGet({ request, env }) {
  try {
    await requireOwner(request, env);
    const sql = database(env);
    const url = new URL(request.url);
    const rows = await sql`select * from leads order by coalesce(next_action_due, '9999-12-31') asc, updated_at desc limit 500`;
    const allLeads = rows.map(serializeLead);
    const activeLeads = allLeads.filter((lead) => !lead.archived);
    const id = url.searchParams.get("id");

    if (id) {
      if (!uuidPattern.test(id)) return json({ error: "Lead id is invalid." }, 422);
      const lead = allLeads.find((item) => item.id === id);
      if (!lead) return json({ error: "Lead not found." }, 404);
      const [activities, intakes, sows, payments] = await Promise.all([
        sql`select id, activity_type, note, owner_email, created_at from lead_activities where lead_id = ${id} order by created_at desc limit 200`,
        sql`select id, customer_number, status, created_at from intake_submissions where lead_id = ${id} order by created_at desc limit 50`,
        sql`select s.id, s.intake_submission_id, s.version_number, s.title, s.status, s.payment_status, s.billing_status, s.amount_cents, s.created_at from sow_versions s join intake_submissions i on i.id = s.intake_submission_id where i.lead_id = ${id} order by s.created_at desc limit 50`,
        sql`select p.id, p.sow_version_id, p.status, p.amount_cents, p.currency, p.paid_at, p.created_at from payment_sessions p join sow_versions s on s.id = p.sow_version_id join intake_submissions i on i.id = s.intake_submission_id where i.lead_id = ${id} order by p.created_at desc limit 50`,
      ]);
      return json({ lead, activities, related: { intakes, sows, payments } });
    }

    const view = url.searchParams.get("view") || "queue";
    let leads = applyView(allLeads, view, url.searchParams).filter((lead) => rowMatch(lead, url.searchParams));
    leads = sortLeads(leads, url.searchParams.get("sort") || (view === "queue" ? "due" : "created"));
    const counts = {
      needsAction: activeLeads.filter((lead) => !lead.nextActionCompleted && (lead.nextAction || lead.nextActionDue)).length,
      newToReview: activeLeads.filter((lead) => lead.stage === "new").length,
      conflictReviews: activeLeads.filter((lead) => lead.tidalConflictReviewStatus === "pending").length,
    };
    const pipelineCounts = Object.fromEntries(pipelineStages.map((stage) => [stage, activeLeads.filter((lead) => lead.stage === stage).length]));
    return json({ view, counts, pipelineCounts, leads, stages: LEAD_STAGES });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const ownerEmail = await requireOwner(request, env);
    const data = await readJson(request, 64_000);
    const input = validateLeadInput(data);
    const sql = database(env);
    const normalized = normalizeBusinessName(input.businessName);
    const domain = input.normalizedDomain || normalizeDomain(input.websiteUrl);
    const duplicates = await duplicateRows(sql, normalized, domain);
    if (duplicates.length && data.confirmDuplicate !== true) return json({ error: "Possible duplicate lead. Review before saving.", duplicates }, 409);
    const conflictStatus = input.tidalConflictReviewRequired && (!input.tidalConflictReviewStatus || input.tidalConflictReviewStatus === "not_needed")
      ? "pending"
      : input.tidalConflictReviewStatus || "not_needed";
    const rows = await sql`
      insert into leads (
        business_name, normalized_business_name, website_url, normalized_domain, city, service_area, industry, source,
        source_urls, public_phone, public_email, public_contact_form_url, public_social_links, stage, fit_level,
        fit_reasons, services_interest, formation_date, opened_date, date_confidence, discovered_date, launch_signals,
        next_action, next_action_due, next_action_owner, next_action_completed, last_verified_date, contact_status,
        do_not_contact, do_not_contact_reason, internal_notes, archived, tidal_conflict_review_required,
        tidal_conflict_review_status, tidal_conflict_notes
      ) values (
        ${input.businessName}, ${normalized}, ${input.websiteUrl}, ${domain}, ${input.city}, ${input.serviceArea}, ${input.industry}, ${input.source || "researched"},
        ${JSON.stringify(input.sourceUrls || [])}::jsonb, ${input.publicPhone}, ${input.publicEmail}, ${input.publicContactFormUrl}, ${JSON.stringify(input.publicSocialLinks || [])}::jsonb,
        ${input.stage || "new"}, ${input.fitLevel || "medium"}, ${JSON.stringify(input.fitReasons || [])}::jsonb, ${JSON.stringify(input.servicesInterest || [])}::jsonb,
        ${input.formationDate}, ${input.openedDate}, ${input.dateConfidence || "unknown"}, ${input.discoveredDate || new Date().toISOString().slice(0, 10)}, ${JSON.stringify(input.launchSignals || [])}::jsonb,
        ${input.nextAction}, ${input.nextActionDue}, ${input.nextActionOwner || ownerEmail}, ${input.nextActionCompleted || false}, ${input.lastVerifiedDate},
        ${input.doNotContact ? "do_not_contact" : input.contactStatus || "not_contacted"}, ${input.doNotContact || false}, ${input.doNotContactReason}, ${input.internalNotes},
        ${input.archived || false}, ${input.tidalConflictReviewRequired || false}, ${conflictStatus}, ${input.tidalConflictNotes}
      ) returning *
    `;
    await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${rows[0].id}, 'research_added', 'Lead added to the private workspace.', ${ownerEmail})`;
    return json({ lead: serializeLead(rows[0]) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const ownerEmail = await requireOwner(request, env);
    const data = await readJson(request, 64_000);
    const id = String(data.id || "");
    if (!uuidPattern.test(id)) return json({ error: "Lead id is invalid." }, 422);
    const sql = database(env);

    if (data.action === "activity") {
      if (!ACTIVITY_TYPES.includes(data.activityType)) return json({ error: "Activity type is invalid." }, 422);
      const note = String(data.note || "").replaceAll("\u0000", "").trim();
      if (!note) return json({ error: "Activity note is required." }, 422);
      if (note.length > 2_000) return json({ error: "Activity note is too long." }, 422);
      const result = await sql`
        with existing as (select id from leads where id = ${id}),
        inserted as (
          insert into lead_activities (lead_id, activity_type, note, owner_email)
          select id, ${data.activityType}, ${note}, ${ownerEmail} from existing
          returning id
        )
        update leads set last_activity_date = now(), updated_at = now()
        where id in (select id from existing)
        returning id
      `;
      if (!result.length) return json({ error: "Lead not found." }, 404);
      return json({ ok: true });
    }

    if (data.action === "merge") {
      const targetId = String(data.targetId || "");
      if (!uuidPattern.test(targetId) || targetId === id) return json({ error: "Merge target is invalid." }, 422);
      const result = await sql`
        with source as (select id from leads where id = ${id}),
        target as (select id from leads where id = ${targetId}),
        moved_intakes as (
          update intake_submissions set lead_id = (select id from target)
          where lead_id in (select id from source) and exists (select 1 from target)
        ),
        moved_activities as (
          update lead_activities set lead_id = (select id from target)
          where lead_id in (select id from source) and exists (select 1 from target)
        ),
        archived_source as (
          update leads set archived = true, stage = 'archived', updated_at = now()
          where id in (select id from source) and exists (select 1 from target)
          returning id
        )
        insert into lead_activities (lead_id, activity_type, note, owner_email)
        select ${targetId}, 'internal_note', ${`Merged lead ${id} into this record.`}, ${ownerEmail}
        where exists (select 1 from archived_source)
        returning id
      `;
      if (!result.length) return json({ error: "Merge source or target was not found." }, 404);
      return json({ ok: true, mergedInto: targetId });
    }

    const existingRows = await sql`select * from leads where id = ${id} limit 1`;
    if (!existingRows.length) return json({ error: "Lead not found." }, 404);
    const existing = serializeLead(existingRows[0]);
    const changes = { ...data };
    if (data.action === "complete") changes.nextActionCompleted = true;
    if (data.action === "do_not_contact") {
      changes.doNotContact = true;
      changes.contactStatus = "do_not_contact";
    }
    if (data.action === "archive") {
      changes.archived = true;
      changes.stage = "archived";
    }
    if ((data.nextAction !== undefined || data.nextActionDue !== undefined) && data.nextActionCompleted === undefined) changes.nextActionCompleted = false;
    const input = validateLeadInput(leadInput(existing, changes));
    const normalized = normalizeBusinessName(input.businessName);
    const domain = input.normalizedDomain || normalizeDomain(input.websiteUrl);
    const duplicates = await duplicateRows(sql, normalized, domain, id);
    if (duplicates.length && data.confirmDuplicate !== true) return json({ error: "Possible duplicate lead. Review before saving.", duplicates }, 409);
    const conflictStatus = input.tidalConflictReviewRequired && input.tidalConflictReviewStatus === "not_needed" ? "pending" : input.tidalConflictReviewStatus;
    const result = await sql`
      update leads set
        business_name = ${input.businessName}, normalized_business_name = ${normalized}, website_url = ${input.websiteUrl}, normalized_domain = ${domain},
        city = ${input.city}, service_area = ${input.serviceArea}, industry = ${input.industry}, source = ${input.source}, source_urls = ${JSON.stringify(input.sourceUrls)}::jsonb,
        public_phone = ${input.publicPhone}, public_email = ${input.publicEmail}, public_contact_form_url = ${input.publicContactFormUrl}, public_social_links = ${JSON.stringify(input.publicSocialLinks)}::jsonb,
        stage = ${input.stage}, fit_level = ${input.fitLevel}, fit_reasons = ${JSON.stringify(input.fitReasons)}::jsonb, services_interest = ${JSON.stringify(input.servicesInterest)}::jsonb,
        formation_date = ${input.formationDate}, opened_date = ${input.openedDate}, date_confidence = ${input.dateConfidence}, discovered_date = ${input.discoveredDate}, launch_signals = ${JSON.stringify(input.launchSignals)}::jsonb,
        next_action = ${input.nextAction}, next_action_due = ${input.nextActionDue}, next_action_owner = ${input.nextActionOwner}, next_action_completed = ${input.nextActionCompleted},
        last_verified_date = ${input.lastVerifiedDate}, contact_status = ${input.doNotContact ? "do_not_contact" : input.contactStatus}, do_not_contact = ${input.doNotContact},
        do_not_contact_reason = ${input.doNotContactReason}, internal_notes = ${input.internalNotes}, archived = ${input.archived},
        tidal_conflict_review_required = ${input.tidalConflictReviewRequired}, tidal_conflict_review_status = ${conflictStatus}, tidal_conflict_notes = ${input.tidalConflictNotes},
        updated_at = now()
      where id = ${id}
      returning *
    `;
    const activityType = stageActivities.get(input.stage);
    if (input.stage !== existing.stage && activityType) {
      await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${id}, ${activityType}, ${`Stage changed to ${input.stage.replaceAll("_", " ")}.`}, ${ownerEmail})`;
    } else if (data.action === "do_not_contact") {
      await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${id}, 'internal_note', 'Marked do not contact.', ${ownerEmail})`;
    }
    return json({ lead: serializeLead(result[0]) });
  } catch (error) {
    return handleError(error);
  }
}

export const __test = { applyView, leadInput, rowMatch, sortLeads, uuidPattern };
