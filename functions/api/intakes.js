import { neon } from "@neondatabase/serverless";
import { handleError, requireOwner, secureJson } from "../_lib/security.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireOwner(request, env);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select i.id, i.customer_number, i.full_name, i.email, i.organization, i.role,
        i.problem, i.outcomes, i.users, i.current_workflow, i.integrations,
        i.features, i.constraints, i.context, i.status, i.created_at, i.updated_at,
        latest.id sow_id, latest.title sow_title, latest.status sow_status,
        latest.version_number sow_version, latest.amount_cents sow_amount_cents,
        latest.billing_type sow_billing_type
      from intake_submissions i
      left join lateral (
        select s.id, s.title, s.status, s.version_number, s.amount_cents, s.billing_type
        from sow_versions s
        where s.intake_submission_id = i.id
        order by s.version_number desc
        limit 1
      ) latest on true
      order by i.created_at desc
      limit 100
    `;
    return secureJson({ intakes: rows });
  } catch (error) {
    return handleError(error);
  }
}
