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
    const stripeError = result?.error || {};
    const detail = [stripeError.message, stripeError.code].filter(Boolean).join(" ").slice(0, 240);
    throw Object.assign(new Error(detail || "Stripe could not complete the request."), {
      status: 502,
      safeExternalError: true,
    });
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
  hostedInvoiceUrl: row.stripe_hosted_invoice_url,
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
        s.billing_status, s.payment_label, s.payment_due_at, s.payment_terms,
        s.stripe_hosted_invoice_url, i.customer_number
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
      select s.id, s.title, s.client_name, s.client_email, s.amount_cents, s.payment_status,
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
      select stripe_invoice_id, stripe_hosted_invoice_url, stripe_subscription_id
      from sow_versions
      where id = ${quote.id} and stripe_hosted_invoice_url is not null
    `;
    if (existing[0]?.stripe_hosted_invoice_url) {
      return secureJson({ hostedInvoiceUrl: existing[0].stripe_hosted_invoice_url });
    }

    const recurring = quote.billing_type === "recurring_monthly";
    const customer = await stripe(env, "/customers", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `pba-customer-${quote.id}`,
      },
      body: new URLSearchParams({
        name: quote.client_name,
        email: quote.client_email,
        "metadata[customer_number]": quote.customer_number,
        "metadata[sow_version_id]": quote.id,
      }),
    });
    let invoice;
    let subscription = null;
    const metadata = {
      "metadata[sow_version_id]": quote.id,
      "metadata[customer_number]": quote.customer_number,
      "metadata[project_title]": quote.title.slice(0, 100),
      "metadata[payment_label]": quote.payment_label.slice(0, 100),
    };
    if (recurring) {
      const product = await stripe(env, "/products", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `pba-product-${quote.id}`,
        },
        body: new URLSearchParams({
          name: quote.payment_label.slice(0, 160),
          description: `${quote.title} · Customer ${quote.customer_number}`.slice(0, 500),
          ...metadata,
        }),
      });
      const form = new URLSearchParams({
        customer: customer.id,
        payment_behavior: "default_incomplete",
        "payment_settings[save_default_payment_method]": "on_subscription",
        "items[0][price_data][currency]": "usd",
        "items[0][price_data][unit_amount]": String(quote.amount_cents),
        "items[0][price_data][recurring][interval]": "month",
        "items[0][price_data][product]": product.id,
        ...metadata,
        "metadata[payment_terms_summary]": quote.payment_terms.slice(0, 250),
      });
      subscription = await stripe(env, "/subscriptions", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `pba-subscription-${quote.id}-${quote.amount_cents}`,
        },
        body: form,
      });
      const latestInvoiceId = typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;
      if (!latestInvoiceId) throw Object.assign(new Error("Stripe did not create the initial invoice."), { status: 502 });
      invoice = await stripe(env, `/invoices/${encodeURIComponent(latestInvoiceId)}`);
      if (!invoice.hosted_invoice_url && invoice.status === "draft") {
        invoice = await stripe(env, `/invoices/${encodeURIComponent(latestInvoiceId)}/finalize`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "idempotency-key": `pba-invoice-finalize-${quote.id}-${quote.amount_cents}`,
          },
          body: new URLSearchParams(),
        });
      }
      if (!invoice.hosted_invoice_url) {
        invoice = await stripe(env, `/invoices/${encodeURIComponent(latestInvoiceId)}`);
      }
    } else {
      const item = await stripe(env, "/invoiceitems", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `pba-invoice-item-${quote.id}-${quote.amount_cents}`,
        },
        body: new URLSearchParams({
          customer: customer.id,
          amount: String(quote.amount_cents),
          currency: "usd",
          description: quote.payment_label.slice(0, 500),
          ...metadata,
        }),
      });
      invoice = await stripe(env, "/invoices", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `pba-invoice-${quote.id}-${quote.amount_cents}`,
        },
        body: new URLSearchParams({
          customer: customer.id,
          collection_method: "send_invoice",
          // One-time project payment is due when the approved SOW creates the invoice.
          days_until_due: "0",
          description: quote.title.slice(0, 500),
          ...metadata,
          "metadata[payment_terms_summary]": quote.payment_terms.slice(0, 250),
        }),
      });
      invoice = await stripe(env, `/invoices/${encodeURIComponent(invoice.id)}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(),
      });
      void item;
    }
    if (!invoice.hosted_invoice_url) throw Object.assign(new Error("Stripe did not provide a hosted invoice page."), { status: 502 });
    await sql`
      update sow_versions
      set stripe_customer_id = ${customer.id},
          stripe_invoice_id = ${invoice.id},
          stripe_hosted_invoice_url = ${invoice.hosted_invoice_url},
          stripe_subscription_id = ${subscription?.id || null},
          payment_status = ${recurring ? "processing" : "unpaid"},
          billing_status = ${recurring ? "not_started" : "not_started"},
          review_token_expires_at = greatest(review_token_expires_at, now() + interval '1 year'),
          updated_at = now()
      where id = ${quote.id}
    `;
    return secureJson({ hostedInvoiceUrl: invoice.hosted_invoice_url });
  } catch (error) {
    if (env.ENVIRONMENT === "preview" && error?.message && !error.safeExternalError && (error.status || 500) >= 500) {
      return secureJson({ error: error.message.slice(0, 240) }, error.status || 500);
    }
    return handleError(error);
  }
}
