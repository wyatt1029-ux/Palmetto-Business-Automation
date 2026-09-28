import { neon } from "@neondatabase/serverless";
import { handleError, requireOwner, secureJson } from "../../_lib/security.js";

const database = (env) => env.__TEST_SQL || neon(env.DATABASE_URL);

export async function onRequestGet({ request, env }) {
  try {
    await requireOwner(request, env);
    const view = new URL(request.url).searchParams.get("view") || "clients";
    const sql = database(env);

    if (view === "clients") {
      const rows = await sql`
        select i.id, i.lead_id, i.customer_number, i.organization, i.full_name,
          i.email, i.status, i.created_at, i.updated_at,
          latest.id sow_id, latest.title sow_title, latest.status sow_status,
          latest.version_number sow_version, latest.amount_cents,
          latest.billing_type, latest.payment_status, latest.billing_status,
          latest.approved_at
        from intake_submissions i
        left join lateral (
          select s.id, s.title, s.status, s.version_number, s.amount_cents,
            s.billing_type, s.payment_status, s.billing_status, s.approved_at
          from sow_versions s
          where s.intake_submission_id = i.id
          order by s.version_number desc
          limit 1
        ) latest on true
        order by i.updated_at desc
        limit 250
      `;
      return secureJson({ view, records: rows });
    }

    if (view === "payments") {
      const rows = await sql`
        select s.id, s.intake_submission_id, s.title, s.amount_cents,
          s.billing_type, s.payment_status, s.billing_status,
          s.stripe_invoice_id, s.stripe_hosted_invoice_url,
          s.approved_at, s.updated_at, i.lead_id, i.customer_number,
          i.organization, i.full_name
        from sow_versions s
        join intake_submissions i on i.id = s.intake_submission_id
        where s.status = 'approved'
          or s.payment_status <> 'unpaid'
          or s.billing_status <> 'not_started'
          or s.stripe_invoice_id is not null
        order by s.updated_at desc
        limit 250
      `;
      return secureJson({ view, records: rows });
    }

    return secureJson({ error: "Owner records view is invalid." }, 422);
  } catch (error) {
    return handleError(error);
  }
}
