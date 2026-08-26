import { neon } from "@neondatabase/serverless";
import { assertSameOrigin, handleError, readJson, requireOwner, secureJson } from "../_lib/security.js";
import { ACTIVITY_TYPES, LEAD_STAGES, cleanLeadText, normalizeBusinessName, normalizeDomain, serializeLead, validateLeadInput } from "../_lib/leads.js";

const json = (body, status = 200) => secureJson(body, status);
const parseList = (value) => { try { return JSON.parse(value || "[]"); } catch { return []; } };
const rowMatch = (lead, params) => {
  const search = String(params.get("search") || "").toLowerCase();
  if (search && ![lead.businessName, lead.city, lead.websiteUrl, lead.normalizedDomain, lead.industry, lead.internalNotes].some((value) => String(value || "").toLowerCase().includes(search))) return false;
  for (const [param, key] of [["stage", "stage"], ["source", "source"], ["fit", "fitLevel"], ["conflict", "tidalConflictReviewStatus"], ["contact", "contactStatus"]]) if (params.get(param) && lead[key] !== params.get(param)) return false;
  if (params.get("archived") === "false" && lead.archived) return false;
  if (params.get("overdue") === "true" && (!lead.nextActionDue || lead.nextActionCompleted || lead.nextActionDue >= new Date().toISOString().slice(0, 10))) return false;
  if (params.get("services") && !lead.servicesInterest.includes(params.get("services"))) return false;
  if (params.get("city") && !String(lead.city || "").toLowerCase().includes(params.get("city").toLowerCase())) return false;
  return true;
};

const sortLeads = (items, sort) => [...items].sort((a, b) => {
  const av = a[sort] || ""; const bv = b[sort] || "";
  return String(av).localeCompare(String(bv)) || String(a.businessName).localeCompare(String(b.businessName));
});

export async function onRequestGet({ request, env }) {
  try {
    await requireOwner(request, env);
    const sql = neon(env.DATABASE_URL);
    const url = new URL(request.url);
    const rows = await sql`select * from leads order by coalesce(next_action_due, '9999-12-31') asc, updated_at desc limit 500`;
    let leads = rows.map(serializeLead).filter((lead) => rowMatch(lead, url.searchParams));
    const view = url.searchParams.get("view") || "queue";
    if (view === "queue") leads = leads.filter((lead) => !lead.archived && !lead.nextActionCompleted && (lead.nextAction || lead.nextActionDue));
    if (view === "radar") {
      const serviceAreaPattern = /charleston|mount pleasant|summerville|north charleston|goose creek|myrtle beach|grand strand|pawleys|georgetown/i;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
      leads = leads.filter((lead) => {
        const launchDate = lead.formationDate || lead.openedDate || lead.discoveredDate;
        return !lead.archived && ["high", "medium"].includes(lead.fitLevel) && lead.contactStatus === "not_contacted" && lead.tidalConflictReviewStatus !== "pending" && serviceAreaPattern.test(`${lead.city || ""} ${lead.serviceArea || ""}`) && launchDate && new Date(`${launchDate}T12:00:00`) >= cutoff;
      });
    }
    if (view === "pipeline") leads = leads.filter((lead) => !lead.archived);
    const sort = { due: "nextActionDue", activity: "lastActivityDate", created: "createdAt", verified: "lastVerifiedDate" }[url.searchParams.get("sort")] || (view === "queue" ? "nextActionDue" : "createdAt");
    leads = sortLeads(leads, sort);
    if (url.searchParams.get("id")) {
      const lead = leads.find((item) => item.id === url.searchParams.get("id")) || (rows.map(serializeLead).find((item) => item.id === url.searchParams.get("id")));
      if (!lead) return json({ error: "Lead not found." }, 404);
      const activities = await sql`select id, activity_type, note, owner_email, created_at from lead_activities where lead_id = ${lead.id} order by created_at desc limit 200`;
      return json({ lead, activities, related: { intake: lead.intakeSubmissionId ? `/intake.html?submission=${lead.intakeSubmissionId}` : null, sow: lead.intakeSubmissionId ? `/sow-builder.html?intake=${lead.intakeSubmissionId}` : null } });
    }
    const counts = { needsAction: leads.filter((lead) => !lead.nextActionCompleted && lead.nextAction).length, newToReview: leads.filter((lead) => lead.stage === "new").length, conflictReviews: leads.filter((lead) => lead.tidalConflictReviewStatus === "pending").length };
    return json({ view, counts, leads, stages: LEAD_STAGES });
  } catch (error) { return handleError(error); }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const ownerEmail = await requireOwner(request, env);
    const data = await readJson(request, 64_000);
    const input = validateLeadInput(data);
    const sql = neon(env.DATABASE_URL);
    const normalized = normalizeBusinessName(input.businessName);
    const domain = input.normalizedDomain || normalizeDomain(input.websiteUrl);
    const duplicates = await sql`select id, business_name, website_url, city, stage, updated_at from leads where normalized_business_name = ${normalized} or (${domain} is not null and normalized_domain = ${domain}) limit 10`;
    if (duplicates.length && data.confirmDuplicate !== true) return json({ error: "Possible duplicate lead. Review before saving.", duplicates }, 409);
    const rows = await sql`
      insert into leads (business_name, normalized_business_name, website_url, normalized_domain, city, service_area, industry, source, source_urls, public_phone, public_email, public_contact_form_url, public_social_links, stage, fit_level, fit_reasons, services_interest, launch_signals, next_action, next_action_due, next_action_owner, last_verified_date, contact_status, do_not_contact, do_not_contact_reason, internal_notes, tidal_conflict_review_required, tidal_conflict_review_status, tidal_conflict_notes)
      values (${input.businessName}, ${normalized}, ${input.websiteUrl}, ${domain}, ${input.city || null}, ${input.serviceArea || null}, ${input.industry || null}, ${input.source || "researched"}, ${JSON.stringify(input.sourceUrls || [])}::jsonb, ${cleanLeadText(data.publicPhone, 80) || null}, ${cleanLeadText(data.publicEmail, 254) || null}, ${cleanLeadText(data.publicContactFormUrl, 500) || null}, ${JSON.stringify(input.publicSocialLinks || [])}::jsonb, ${input.stage || "new"}, ${input.fitLevel || "medium"}, ${JSON.stringify(input.fitReasons || [])}::jsonb, ${JSON.stringify(input.servicesInterest || [])}::jsonb, ${JSON.stringify(input.launchSignals || [])}::jsonb, ${input.nextAction || null}, ${input.nextActionDue || null}, ${input.nextActionOwner || ownerEmail}, ${input.lastVerifiedDate || null}, ${input.contactStatus || "not_contacted"}, ${input.doNotContact || false}, ${input.doNotContactReason || null}, ${input.internalNotes || null}, ${input.tidalConflictReviewRequired || false}, ${input.tidalConflictReviewStatus || "not_needed"}, ${input.tidalConflictNotes || null})
      returning *
    `;
    await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${rows[0].id}, 'research_added', 'Lead added to the private workspace.', ${ownerEmail})`;
    return json({ lead: serializeLead(rows[0]) }, 201);
  } catch (error) { return handleError(error); }
}

export async function onRequestPut({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const ownerEmail = await requireOwner(request, env);
    const data = await readJson(request, 64_000);
    const id = cleanLeadText(data.id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Lead id is invalid." }, 422);
    const sql = neon(env.DATABASE_URL);
    if (data.action === "activity") {
      if (!ACTIVITY_TYPES.includes(data.activityType)) return json({ error: "Activity type is invalid." }, 422);
      const note = cleanLeadText(data.note, 2_000); if (!note) return json({ error: "Activity note is required." }, 422);
      await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${id}, ${data.activityType}, ${note}, ${ownerEmail})`;
      await sql`update leads set last_activity_date = now(), updated_at = now() where id = ${id}`;
      return json({ ok: true });
    }
    if (data.action === "merge") {
      const targetId = cleanLeadText(data.targetId, 80); if (!/^[0-9a-f-]{36}$/i.test(targetId) || targetId === id) return json({ error: "Merge target is invalid." }, 422);
      await sql`update intake_submissions set lead_id = ${targetId} where lead_id = ${id}`;
      await sql`update lead_activities set lead_id = ${targetId} where lead_id = ${id}`;
      await sql`update leads set archived = true, stage = 'archived', updated_at = now() where id = ${id}`;
      return json({ ok: true, mergedInto: targetId });
    }
    const input = validateLeadInput(data, { partial: true });
    if (data.stage !== undefined && !LEAD_STAGES.includes(data.stage)) return json({ error: "Lead stage is invalid." }, 422);
    const result = await sql`update leads set business_name = coalesce(${input.businessName || null}, business_name), normalized_business_name = coalesce(${input.businessName ? normalizeBusinessName(input.businessName) : null}, normalized_business_name), website_url = coalesce(${input.websiteUrl}, website_url), normalized_domain = coalesce(${input.normalizedDomain}, normalized_domain), city = coalesce(${input.city || null}, city), service_area = coalesce(${input.serviceArea || null}, service_area), industry = coalesce(${input.industry || null}, industry), stage = coalesce(${data.stage || null}, stage), fit_level = coalesce(${data.fitLevel || null}, fit_level), next_action = coalesce(${input.nextAction || null}, next_action), next_action_due = coalesce(${input.nextActionDue || null}, next_action_due), next_action_owner = coalesce(${input.nextActionOwner || null}, next_action_owner), next_action_completed = coalesce(${input.nextActionCompleted ?? null}, next_action_completed), contact_status = coalesce(${data.contactStatus || null}, contact_status), do_not_contact = coalesce(${input.doNotContact ?? null}, do_not_contact), do_not_contact_reason = coalesce(${input.doNotContactReason || null}, do_not_contact_reason), archived = coalesce(${input.archived ?? null}, archived), tidal_conflict_review_required = coalesce(${input.tidalConflictReviewRequired ?? null}, tidal_conflict_review_required), tidal_conflict_review_status = coalesce(${data.tidalConflictReviewStatus || null}, tidal_conflict_review_status), tidal_conflict_notes = coalesce(${input.tidalConflictNotes || null}, tidal_conflict_notes), internal_notes = coalesce(${input.internalNotes || null}, internal_notes), updated_at = now() where id = ${id} returning *`;
    if (!result.length) return json({ error: "Lead not found." }, 404);
    if (data.action === "do_not_contact") await sql`insert into lead_activities (lead_id, activity_type, note, owner_email) values (${id}, 'internal_note', 'Marked do not contact.', ${ownerEmail})`;
    return json({ lead: serializeLead(result[0]) });
  } catch (error) { return handleError(error); }
}
