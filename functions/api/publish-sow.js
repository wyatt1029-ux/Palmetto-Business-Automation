import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  cleanText,
  escapeHtml,
  handleError,
  readJson,
  requireOwner,
  secureJson,
} from "../_lib/security.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const makeToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
const safeSubject = (value) => String(value).replace(/[\r\n]+/g, " ").slice(0, 180);

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    await requireOwner(request, env);
    const data = await readJson(request, 128_000);
    const amountCents = Number(data.amountCents);
    const billingType = data.billingType === "one_time" ? "one_time" : "recurring_monthly";
    const intakeId = cleanText(data.intakeId, "Intake", { required: true, max: 80 });
    const title = cleanText(data.title, "Title", { required: true, max: 240 });
    const clientName = cleanText(data.clientName, "Client name", { required: true, max: 160 });
    const clientEmail = cleanText(data.clientEmail, "Client email", { required: true, max: 254 }).toLowerCase();
    const paymentLabel = cleanText(
      data.paymentLabel || (billingType === "recurring_monthly" ? "Monthly service" : "Project payment"),
      "Payment label",
      { required: true, max: 160 },
    );
    const paymentTerms = cleanText(data.paymentTerms, "Payment terms", { required: true, max: 3_000 });
    const paymentDueAt = data.paymentDueAt
      ? cleanText(data.paymentDueAt, "Payment due date", { max: 10 })
      : null;
    if (!/^[0-9a-f-]{36}$/i.test(intakeId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      throw Object.assign(new Error("Intake or client email is invalid."), { status: 422 });
    }
    if (!Number.isInteger(amountCents) || amountCents < 50 || amountCents > 100_000_000) {
      throw Object.assign(new Error("Amount is invalid."), { status: 422 });
    }
    if (paymentDueAt && !/^\d{4}-\d{2}-\d{2}$/.test(paymentDueAt)) {
      throw Object.assign(new Error("Payment due date is invalid."), { status: 422 });
    }
    if (!Array.isArray(data.sections) || !data.sections.length || data.sections.length > 20) {
      throw Object.assign(new Error("One to twenty scope sections are required."), { status: 422 });
    }
    const sections = data.sections.map((section, index) => ({
      title: cleanText(section?.title, `Section ${index + 1} title`, { required: true, max: 200 }),
      body: cleanText(section?.body, `Section ${index + 1} body`, { required: true, max: 8_000 }),
    }));
    if (JSON.stringify(sections).length > 100_000) {
      throw Object.assign(new Error("Scope content is too large."), { status: 422 });
    }

    const reviewToken = makeToken();
    const tokenHash = await digest(reviewToken);
    const sql = neon(env.DATABASE_URL);
    const intake = await sql`
      select customer_number from intake_submissions where id = ${intakeId} limit 1
    `;
    if (!intake.length) throw Object.assign(new Error("Intake record not found."), { status: 404 });
    const existing = await sql`
      select coalesce(max(version_number), 0)::int as version
      from sow_versions where intake_submission_id = ${intakeId}
    `;
    const version = existing[0].version + 1;
    await sql`
      update sow_versions set status = 'superseded', updated_at = now()
      where intake_submission_id = ${intakeId} and status in ('sent','changes_requested')
    `;
    const rows = await sql`
      insert into sow_versions
        (intake_submission_id, version_number, title, client_name, client_email, content,
         amount_cents, billing_type, payment_label, payment_due_at, payment_terms, status,
         review_token_hash, review_token_expires_at, sent_at)
      values
        (${intakeId}, ${version}, ${title}, ${clientName}, ${clientEmail},
         ${JSON.stringify({ sections })}::jsonb, ${amountCents}, ${billingType},
         ${paymentLabel}, ${paymentDueAt}, ${paymentTerms}, 'sent', ${tokenHash},
         now() + interval '30 days', now())
      returning id
    `;
    const id = rows[0].id;
    await sql`
      insert into sow_approval_events (sow_version_id, action) values (${id}, 'sent')
    `;
    const customerNumber = intake[0].customer_number;
    const reviewUrl = `${env.PUBLIC_SITE_URL}/sow.html?id=${id}&token=${reviewToken}`;

    if (env.OUTLOOK_ACCESS_TOKEN) {
      await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OUTLOOK_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: safeSubject(`${customerNumber} · Scope ready for review: ${title}`),
            body: {
              contentType: "HTML",
              content: `<p>Hello ${escapeHtml(clientName)},</p><p>Your project scope and quote for <strong>${escapeHtml(customerNumber)}</strong> are ready.</p><p><strong>${escapeHtml(paymentLabel)}:</strong> $${(amountCents / 100).toFixed(2)}${billingType === "recurring_monthly" ? " per month with automatic monthly billing" : ""}</p><p><a href="${escapeHtml(reviewUrl)}">Review and approve the SOW</a></p><p>After approval, the same secure link will take you directly to payment setup. It expires in 30 days.</p>`,
            },
            toRecipients: [{ emailAddress: { address: clientEmail } }],
          },
        }),
      });
    }
    return secureJson({ ok: true, id, version, customerNumber, reviewUrl }, 201);
  } catch (error) {
    return handleError(error);
  }
}
