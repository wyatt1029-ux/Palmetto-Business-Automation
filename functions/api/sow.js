import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  cleanText,
  escapeHtml,
  handleError,
  readJson,
  secureJson,
} from "../_lib/security.js";
import { sendOutlookMail } from "../_lib/outlook.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const validId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const validToken = (value) => /^[0-9a-f]{64,128}$/i.test(String(value || ""));

const notifyOwner = async (env, subject, content) => {
  await sendOutlookMail(env, env.INTAKE_OWNER_EMAIL, subject, content);
};

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    if (!validId(id) || !validToken(token)) {
      throw Object.assign(new Error("The review link is incomplete or invalid."), { status: 400 });
    }
    const tokenHash = await digest(token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select s.id, s.title, s.client_name, s.version_number, s.content, s.status,
        s.amount_cents, s.billing_type, s.payment_label, s.payment_due_at, s.payment_terms,
        s.payment_status, s.billing_status, i.customer_number
      from sow_versions s
      join intake_submissions i on i.id = s.intake_submission_id
      where s.id = ${id} and s.review_token_hash = ${tokenHash}
        and s.review_token_expires_at > now()
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This review link is invalid or has expired."), { status: 404 });
    }
    const sow = rows[0];
    if (sow.status === "sent") {
      await sql`
        insert into sow_approval_events (sow_version_id, action, ip_address, user_agent)
        select ${sow.id}, 'viewed', ${request.headers.get("cf-connecting-ip")},
          ${String(request.headers.get("user-agent") || "").slice(0, 500)}
        where not exists (
          select 1 from sow_approval_events
          where sow_version_id = ${sow.id} and action = 'viewed'
            and created_at > now() - interval '1 hour'
        )
      `;
    }
    return secureJson({ sow: {
      id: sow.id,
      title: sow.title,
      clientName: sow.client_name,
      versionNumber: sow.version_number,
      status: sow.status,
      customerNumber: sow.customer_number,
      amountCents: sow.amount_cents,
      billingType: sow.billing_type,
      paymentLabel: sow.payment_label,
      paymentDueAt: sow.payment_due_at,
      paymentTerms: sow.payment_terms,
      paymentStatus: sow.payment_status,
      billingStatus: sow.billing_status,
      paymentUrl: sow.status === "approved" && sow.billing_status !== "active" && sow.payment_status !== "paid"
        ? `${env.PUBLIC_SITE_URL}/pay/?id=${sow.id}&token=${encodeURIComponent(token)}`
        : null,
      billingPortalUrl: sow.status === "approved" && sow.billing_status === "active"
        ? `${env.PUBLIC_SITE_URL}/pay/?id=${sow.id}&token=${encodeURIComponent(token)}`
        : null,
      sections: Array.isArray(sow.content?.sections) ? sow.content.sections : [],
    } });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const data = await readJson(request, 16_000);
    if (!validId(data.id) || !validToken(data.token) || !["approve", "request_changes"].includes(data.action)) {
      throw Object.assign(new Error("Invalid decision."), { status: 400 });
    }
    const signerName = data.action === "approve"
      ? cleanText(data.signerName, "Full name", { required: true, max: 160 })
      : "";
    const notes = data.action === "request_changes"
      ? cleanText(data.notes, "Requested changes", { required: true, max: 5_000 })
      : "";
    const tokenHash = await digest(data.token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select s.id, s.intake_submission_id, s.title, s.version_number, s.client_email,
        s.amount_cents, s.billing_type, i.customer_number
      from sow_versions s
      join intake_submissions i on i.id = s.intake_submission_id
      where s.id = ${data.id} and s.review_token_hash = ${tokenHash}
        and s.review_token_expires_at > now() and s.status = 'sent'
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This SOW is no longer available for a decision."), { status: 409 });
    }
    const sow = rows[0];
    if (data.action === "approve" && sow.billing_type === "recurring_monthly" && data.autopayConfirmed !== true) {
      throw Object.assign(new Error("Please confirm the monthly automatic-payment terms."), { status: 422 });
    }
    const action = data.action === "approve" ? "approved" : "changes_requested";
    const updated = await sql`
      update sow_versions
      set status = ${action},
          approved_at = ${action === "approved" ? new Date().toISOString() : null},
          updated_at = now()
      where id = ${sow.id} and status = 'sent'
      returning id
    `;
    if (!updated.length) {
      throw Object.assign(new Error("This SOW decision was already recorded."), { status: 409 });
    }
    await sql`
      insert into sow_approval_events
        (sow_version_id, action, signer_name, signer_email, notes, ip_address, user_agent)
      values
        (${sow.id}, ${action}, ${signerName || null}, ${sow.client_email}, ${notes || null},
         ${request.headers.get("cf-connecting-ip")},
         ${String(request.headers.get("user-agent") || "").slice(0, 500)})
    `;
    if (action === "approved") {
      await sql`
        update intake_submissions set status = 'converted_to_sow', updated_at = now()
        where id = ${sow.intake_submission_id}
      `;
    }
    await notifyOwner(
      env,
      `${action === "approved" ? "SOW approved" : "SOW changes requested"}: ${sow.title}`,
      `<p>Version ${sow.version_number} of <strong>${escapeHtml(sow.title)}</strong> was ${escapeHtml(action.replace("_", " "))}.</p>${notes ? `<p>${escapeHtml(notes)}</p>` : ""}`,
    );
    return secureJson({
      ok: true,
      status: action,
      customerNumber: sow.customer_number,
      paymentUrl: action === "approved"
        ? `${env.PUBLIC_SITE_URL}/pay/?id=${sow.id}&token=${encodeURIComponent(data.token)}`
        : null,
    });
  } catch (error) {
    return handleError(error);
  }
}
