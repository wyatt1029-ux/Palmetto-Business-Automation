export const LEAD_STAGES = ["new", "contacted", "discovery_scheduled", "qualified", "scope_sent", "approved", "paid_active", "lost", "not_a_fit", "archived"];
export const FIT_LEVELS = ["high", "medium", "low"];
export const CONFLICT_STATUSES = ["not_needed", "pending", "cleared", "declined"];
export const CONTACT_STATUSES = ["not_contacted", "attempted", "replied", "connected", "do_not_contact"];
export const DATE_CONFIDENCE_LEVELS = ["confirmed", "estimated", "unknown"];
export const LEAD_SOURCES = ["researched", "new_business_radar", "website_inquiry", "referral", "other"];
export const ACTIVITY_TYPES = ["research_added", "call_attempted", "email_drafted", "email_sent_manually", "replied", "discovery_scheduled", "discovery_completed", "scope_sent", "sow_accepted", "payment_received", "lost", "not_a_fit", "internal_note", "inquiry_received"];

export const normalizeBusinessName = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export const normalizeDomain = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
};

export const cleanLeadText = (value, max = 2_000) => String(value ?? "").replaceAll("\u0000", "").trim().slice(0, max);
export const asList = (value, max = 40) => (Array.isArray(value) ? value : String(value || "").split(","))
  .map((item) => cleanLeadText(item, 240)).filter(Boolean).slice(0, max);

const textValue = (value, label, max) => {
  const clean = String(value ?? "").replaceAll("\u0000", "").trim();
  if (clean.length > max) throw Object.assign(new Error(`${label} is too long.`), { status: 422 });
  return clean;
};

const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const validHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadInput(data = {}, { partial = false } = {}) {
  const result = {};
  const required = (key, label, max = 240) => {
    if (partial && data[key] === undefined) return;
    const value = textValue(data[key], label, max);
    if (!value && !partial) throw Object.assign(new Error(`${label} is required.`), { status: 422 });
    result[key] = value;
  };
  const optional = (key, label, max = 240) => {
    if (partial && data[key] === undefined) return;
    result[key] = textValue(data[key], label, max) || null;
  };
  required("businessName", "Business name", 200);
  if (data.websiteUrl !== undefined || !partial) {
    const websiteUrl = textValue(data.websiteUrl, "Website URL", 500);
    if (websiteUrl && !validHttpUrl(websiteUrl)) throw Object.assign(new Error("Website URL is invalid."), { status: 422 });
    result.websiteUrl = websiteUrl || null;
    result.normalizedDomain = normalizeDomain(websiteUrl);
  }
  for (const [key, label, max] of [
    ["city", "City", 120], ["serviceArea", "Service area", 160], ["industry", "Industry", 160],
    ["nextAction", "Next action", 500], ["nextActionOwner", "Next-action owner", 254],
    ["publicPhone", "Public phone", 80], ["publicEmail", "Public email", 254],
    ["publicContactFormUrl", "Public contact-form URL", 500], ["doNotContactReason", "Do-not-contact reason", 500],
    ["tidalConflictNotes", "Conflict-review notes", 2_000], ["internalNotes", "Internal notes", 8_000],
  ]) optional(key, label, max);
  for (const [key, allowed, label] of [
    ["stage", LEAD_STAGES, "Lead stage"], ["fitLevel", FIT_LEVELS, "Fit level"],
    ["source", LEAD_SOURCES, "Lead source"], ["contactStatus", CONTACT_STATUSES, "Contact status"],
    ["dateConfidence", DATE_CONFIDENCE_LEVELS, "Date confidence"],
    ["tidalConflictReviewStatus", CONFLICT_STATUSES, "Conflict-review status"],
  ]) {
    if (data[key] === undefined) continue;
    if (!allowed.includes(data[key])) throw Object.assign(new Error(`${label} is invalid.`), { status: 422 });
    result[key] = data[key];
  }
  for (const [key, label] of [["nextActionDue", "Next-action date"], ["lastVerifiedDate", "Last-verified date"], ["formationDate", "Formation date"], ["openedDate", "Opened date"], ["discoveredDate", "Discovered date"]]) {
    if (data[key] === undefined) continue;
    const value = textValue(data[key], label, 10);
    if (value && !validDate(value)) throw Object.assign(new Error(`${label} is invalid.`), { status: 422 });
    result[key] = value || null;
  }
  if (result.publicEmail && !emailPattern.test(result.publicEmail)) throw Object.assign(new Error("Public email is invalid."), { status: 422 });
  if (result.publicContactFormUrl && !validHttpUrl(result.publicContactFormUrl)) throw Object.assign(new Error("Public contact-form URL is invalid."), { status: 422 });
  for (const key of ["sourceUrls", "publicSocialLinks"]) {
    if (data[key] === undefined) continue;
    const values = asList(data[key]);
    if (values.some((value) => !validHttpUrl(value))) throw Object.assign(new Error(`${key === "sourceUrls" ? "Source" : "Social"} URL is invalid.`), { status: 422 });
    result[key] = values;
  }
  for (const key of ["fitReasons", "servicesInterest", "launchSignals"]) if (data[key] !== undefined) result[key] = asList(data[key]);
  for (const key of ["tidalConflictReviewRequired", "doNotContact", "archived", "nextActionCompleted"]) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw Object.assign(new Error(`${key} must be true or false.`), { status: 422 });
    result[key] = data[key];
  }
  return result;
}

const parseJson = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "null") ?? fallback; } catch { return fallback; }
};
export const serializeLead = (row) => ({
  id: row.id, businessName: row.business_name, websiteUrl: row.website_url, normalizedDomain: row.normalized_domain,
  city: row.city, serviceArea: row.service_area, industry: row.industry, source: row.source,
  sourceUrls: parseJson(row.source_urls), publicPhone: row.public_phone, publicEmail: row.public_email,
  publicContactFormUrl: row.public_contact_form_url, publicSocialLinks: parseJson(row.public_social_links),
  stage: row.stage, fitLevel: row.fit_level, fitReasons: parseJson(row.fit_reasons), servicesInterest: parseJson(row.services_interest),
  formationDate: row.formation_date, openedDate: row.opened_date, dateConfidence: row.date_confidence, discoveredDate: row.discovered_date,
  launchSignals: parseJson(row.launch_signals), nextAction: row.next_action, nextActionDue: row.next_action_due,
  nextActionOwner: row.next_action_owner, nextActionCompleted: row.next_action_completed, lastActivityDate: row.last_activity_date,
  lastVerifiedDate: row.last_verified_date, contactStatus: row.contact_status, doNotContact: row.do_not_contact,
  doNotContactReason: row.do_not_contact_reason, internalNotes: row.internal_notes, archived: row.archived,
  tidalConflictReviewRequired: row.tidal_conflict_review_required, tidalConflictReviewStatus: row.tidal_conflict_review_status,
  tidalConflictNotes: row.tidal_conflict_notes, intakeSubmissionId: row.intake_submission_id, createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function syncLeadFromIntake(sql, { id, customerNumber, organization }) {
  const businessName = cleanLeadText(organization, 200);
  const normalized = normalizeBusinessName(businessName);
  const rows = await sql`
    select id from leads
    where normalized_business_name = ${normalized} and archived = false
    order by updated_at desc
    limit 1
  `;
  let leadId = rows[0]?.id;
  if (!leadId) {
    const created = await sql`
      insert into leads (business_name, normalized_business_name, source, discovered_date, next_action, next_action_owner, intake_submission_id)
      values (${businessName}, ${normalized}, 'website_inquiry', current_date, 'Review website inquiry', 'Owner', ${id})
      returning id
    `;
    leadId = created[0].id;
  }
  await sql`update leads set intake_submission_id = coalesce(intake_submission_id, ${id}), updated_at = now() where id = ${leadId}`;
  await sql`
    update intake_submissions set lead_id = ${leadId} where id = ${id}
  `;
  await sql`
    insert into lead_activities (lead_id, activity_type, note, owner_email)
    values (${leadId}, 'inquiry_received', ${`Website inquiry received${customerNumber ? ` (${customerNumber})` : ""}.`}, 'system:intake')
  `;
  return leadId;
}
