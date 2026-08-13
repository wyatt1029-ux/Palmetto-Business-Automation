import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  handleError,
  readJson,
  secureJson,
} from "../_lib/security.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const validId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const validToken = (value) => /^[0-9a-f]{64,128}$/i.test(String(value || ""));
const validSession = (value) => /^cs_(test_|live_)?[A-Za-z0-9_]{20,220}$/.test(String(value || ""));

const stripe = async (env, path, options = {}) => {
  if (!env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error("Payment processing is not configured."), { status: 503 });
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(options.headers || {}),
    },
  });
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error("Stripe could not complete the request."), { status: 502 });
  }
  return result;
};

const safeQuote = (row) => ({
  customerNumber: row.customer_number,
  title: row.title,
  amountCents: Number(row.amount_cents),
  currency: "usd",
  paymentStatus: row.payment_status,
  billingType: row.billing_type,
  billingStatus: row.billing_status,
  paymentLabel: row.payment_label,
  paymentDueAt: row.payment_due_at,
  paymentTerms: row.payment_terms,
});

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");
    if (sessionId) {
      if (!validSession(sessionId)) {
        throw Object.assign(new Error("This payment confirmation link is invalid."), { status: 400 });
      }
      const session = await stripe(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
      const metadata = session.metadata || {};
      if (
        !metadata.customer_number ||
        (!validId(metadata.sow_version_id) && !validId(metadata.accounting_invoice_id))
      ) {
        throw Object.assign(new Error("This payment session does not belong to PBA billing."), { status: 404 });
      }
      return secureJson({ quote: {
        customerNumber: metadata.customer_number,
        title: metadata.project_title || "PBA professional services",
        amountCents: Number(session.amount_total || 0),
        currency: session.currency || "usd",
        paymentStatus: session.payment_status === "paid" ? "paid" : "processing",
        billingType: session.mode === "subscription" ? "recurring_monthly" : "one_time",
        billingStatus: session.mode === "subscription" && session.payment_status === "paid" ? "active" : "not_started",
        paymentLabel: metadata.payment_label || "Amount due",
        paymentDueAt: null,
        paymentTerms: metadata.payment_terms_summary || "",
      } });
    }

    const id = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    if (!validId(id) || !validToken(token)) {
      throw Object.assign(new Error("This payment link is incomplete or invalid."), { status: 400 });
    }
    const tokenHash = await digest(token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select s.id, s.title, s.amount_cents, s.payment_status, s.billing_type,
        s.billing_status, s.payment_label, s.payment_due_at, s.payment_terms, i.customer_number
      from sow_versions s join intake_submissions i on i.id = s.intake_submission_id
      where s.id = ${id} and s.review_token_hash = ${tokenHash}
        and s.review_token_expires_at > now() and s.status = 'approved'
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This payment link is invalid, expired, or awaiting scope approval."), { status: 404 });
    }
    return secureJson({ quote: safeQuote(rows[0]) });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const data = await readJson(request, 8_000);
    if (!validId(data.id) || !validToken(data.token)) {
      throw Object.assign(new Error("This payment link is incomplete or invalid."), { status: 400 });
    }
    const tokenHash = await digest(data.token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select s.id, s.title, s.client_email, s.amount_cents, s.payment_status,
        s.billing_type, s.billing_status, s.payment_label, s.payment_due_at,
        s.payment_terms, i.customer_number
      from sow_versions s join intake_submissions i on i.id = s.intake_submission_id
      where s.id = ${data.id} and s.review_token_hash = ${tokenHash}
        and s.review_token_expires_at > now() and s.status = 'approved'
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This payment link is invalid, expired, or awaiting scope approval."), { status: 404 });
    }
    const quote = rows[0];
    if (quote.billing_type === "recurring_monthly" && quote.billing_status === "active") {
      throw Object.assign(new Error("Automatic monthly payment is already active."), { status: 409 });
    }
    if (quote.billing_type === "one_time" && quote.payment_status === "paid") {
      throw Object.assign(new Error("This quote has already been paid."), { status: 409 });
    }

    const existing = await sql`
      select stripe_checkout_session_id from payment_sessions
      where sow_version_id = ${quote.id} and status in ('pending','processing')
      order by created_at desc limit 1
    `;
    if (existing.length) {
      const prior = await stripe(env, `/checkout/sessions/${encodeURIComponent(existing[0].stripe_checkout_session_id)}`);
      if (prior.status === "open" && prior.url) return secureJson({ checkoutUrl: prior.url });
    }

    const recurring = quote.billing_type === "recurring_monthly";
    const form = new URLSearchParams();
    form.set("mode", recurring ? "subscription" : "payment");
    form.set("customer_email", quote.client_email);
    form.set("client_reference_id", quote.customer_number);
    form.set("success_url", `${env.PUBLIC_SITE_URL}/payment.html?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${env.PUBLIC_SITE_URL}/payment.html?id=${quote.id}&token=${encodeURIComponent(data.token)}`);
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(quote.amount_cents));
    form.set("line_items[0][price_data][product_data][name]", quote.payment_label.slice(0, 160));
    form.set("line_items[0][price_data][product_data][description]", `${quote.title} · Customer ${quote.customer_number}`.slice(0, 500));
    if (recurring) form.set("line_items[0][price_data][recurring][interval]", "month");
    form.set("line_items[0][quantity]", "1");
    if (recurring) {
      form.set("subscription_data[metadata][sow_version_id]", quote.id);
      form.set("subscription_data[metadata][customer_number]", quote.customer_number);
      await sql`
        update sow_versions
        set review_token_expires_at = greatest(review_token_expires_at, now() + interval '1 year'),
            updated_at = now()
        where id = ${quote.id}
      `;
    } else {
      form.set("invoice_creation[enabled]", "true");
      form.set("payment_intent_data[receipt_email]", quote.client_email);
    }
    form.set("metadata[sow_version_id]", quote.id);
    form.set("metadata[customer_number]", quote.customer_number);
    form.set("metadata[project_title]", quote.title.slice(0, 100));
    form.set("metadata[payment_label]", quote.payment_label.slice(0, 100));
    form.set("metadata[payment_terms_summary]", quote.payment_terms.slice(0, 250));

    const session = await stripe(env, "/checkout/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `pba-checkout-${quote.id}-${quote.amount_cents}-${quote.billing_type}`,
      },
      body: form,
    });
    await sql`
      insert into payment_sessions
        (sow_version_id, stripe_checkout_session_id, stripe_subscription_id, amount_cents)
      values (${quote.id}, ${session.id}, ${session.subscription}, ${quote.amount_cents})
      on conflict (stripe_checkout_session_id) do nothing
    `;
    return secureJson({ checkoutUrl: session.url });
  } catch (error) {
    return handleError(error);
  }
}
