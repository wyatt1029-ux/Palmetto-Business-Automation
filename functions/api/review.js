import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  cleanText,
  handleError,
  readJson,
  requireOwner,
  secureJson,
} from "../_lib/security.js";

const validId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const statuses = new Set([
  "new",
  "under_review",
  "needs_clarification",
  "qualified",
  "declined",
  "converted_to_sow",
]);

export async function onRequestGet({ request, env }) {
  try {
    await requireOwner(request, env);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select id, customer_number, full_name, email, organization, role, problem, outcomes,
        users, current_workflow, integrations, features, constraints, context, timeline,
        budget, decision_process, status, internal_notes, created_at, updated_at, last_reviewed_at
      from intake_submissions
      order by created_at desc
      limit 100
    `;
    return secureJson({ intakes: rows });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    await requireOwner(request, env);
    const data = await readJson(request, 16_000);
    if (!validId(data.id) || !statuses.has(data.status)) {
      throw Object.assign(new Error("Intake or status is invalid."), { status: 422 });
    }
    const notes = cleanText(data.internalNotes, "Internal notes", { max: 10_000 });
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      update intake_submissions
      set status = ${data.status}, internal_notes = ${notes || null},
          last_reviewed_at = now(), updated_at = now()
      where id = ${data.id}
      returning id, status, internal_notes, last_reviewed_at
    `;
    if (!rows.length) throw Object.assign(new Error("Intake record not found."), { status: 404 });
    return secureJson({ ok: true, intake: rows[0] });
  } catch (error) {
    return handleError(error);
  }
}
