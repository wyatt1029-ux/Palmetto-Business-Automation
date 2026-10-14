import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import worker from "../worker/index.js";
import { database } from "../worker/db.js";
import { stripeForm, stripeGet } from "../worker/stripe.js";

const sandboxAccount = "acct_1Tz2RYH1zz06h42p";
const previewHost = "ep-broad-violet-aui3siqu-pooler.c-10.us-east-1.aws.neon.tech";
const email = `pba-monthly-${randomUUID()}@example.invalid`;
const origin = "http://pba-books-sandbox.invalid";
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: "whsec_local_monthly_smoke_test",
  ENVIRONMENT: "development",
  DEV_BYPASS_AUTH: "true",
  DEV_OWNER_EMAIL: "sandbox-owner@example.invalid",
};

if (process.env.PBA_BOOKS_SANDBOX_SMOKE !== "yes" ||
    !env.DATABASE_URL || !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("Use an isolated database, a Stripe test key, and PBA_BOOKS_SANDBOX_SMOKE=yes.");
}
assert.equal(new URL(env.DATABASE_URL).hostname, previewHost,
  "The sandbox smoke test may only use the PBA Preview Neon database.");

const account = await stripeGet(env, "/account");
assert.equal(account.id, sandboxAccount, "The key must belong to the PBA sandbox.");
const sql = database(env);
const existing = await sql`
  select count(*)::int as count from accounting_customers
  where name <> 'PBA Sandbox Monthly Test' or email not like 'pba-monthly-%@example.invalid'
`;
assert.equal(existing[0].count, 0, "Use a Books database containing only synthetic test customers.");

const call = async (path, method, body) => {
  const response = await worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
};
const postStripe = (path, fields) => stripeForm(env, path, new URLSearchParams(fields));

let subscriptionId;
let stripeCustomerId;
let localInvoiceId;
let localCustomerId;
try {
  const customer = (await call("/api/customers", "POST", {
    name: "PBA Sandbox Monthly Test", email,
  })).customer;
  localCustomerId = customer.id;
  const now = new Date();
  const issueDate = now.toISOString().slice(0, 10);
  const dueDate = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const billingDay = now.getUTCDate() <= 21 ? now.getUTCDate() + 7 : 7;
  const invoice = (await call("/api/invoices", "POST", {
    customerId: customer.id, issueDate, dueDate,
    recurring: true, billingDay, taxCents: 90,
    memo: "Synthetic PBA Books monthly billing test; no real services or customer.",
    lines: [{ description: "Synthetic monthly website care", quantity: 1, unitAmountCents: 1000 }],
  })).invoice;
  localInvoiceId = invoice.id;
  const collected = await call(`/api/invoices/${invoice.id}/collect`, "POST");
  assert.equal(collected.monthly, true);
  const rows = await sql`
    select i.stripe_invoice_id, i.stripe_subscription_id, i.status, i.total_cents,
           c.stripe_customer_id from accounting_invoices i
    join accounting_customers c on c.id = i.customer_id where i.id = ${invoice.id}
  `;
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].total_cents), 1090);
  stripeCustomerId = rows[0].stripe_customer_id;
  subscriptionId = rows[0].stripe_subscription_id;
  const stripeInvoice = await stripeGet(env, `/invoices/${rows[0].stripe_invoice_id}`);
  assert.equal(stripeInvoice.status, "open");
  assert.equal(stripeInvoice.total, 1090);
  assert.equal(stripeInvoice.parent?.subscription_details?.subscription, subscriptionId);

  const paymentMethod = await postStripe("/payment_methods", {
    type: "card", "card[token]": "tok_visa",
  });
  await postStripe(`/payment_methods/${paymentMethod.id}/attach`, {
    customer: rows[0].stripe_customer_id,
  });
  const paid = await postStripe(`/invoices/${stripeInvoice.id}/pay`, {
    payment_method: paymentMethod.id,
  });
  assert.equal(paid.status, "paid");
  const subscription = await stripeGet(env, `/subscriptions/${subscriptionId}`);
  assert.equal(subscription.default_payment_method, paymentMethod.id,
    "Paying the first invoice must save its card to the subscription.");

  const event = { id: `evt_local_${randomUUID()}`, type: "invoice.paid", data: { object: paid } };
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`).digest("hex");
  const webhook = await worker.fetch(new Request(`${origin}/api/stripe/webhook`, {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body: payload,
  }), env);
  assert.equal(webhook.status, 200, await webhook.text());
  const retry = await worker.fetch(new Request(`${origin}/api/stripe/webhook`, {
    method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body: payload,
  }), env);
  assert.equal(retry.status, 200, "A duplicate Stripe event should be harmless.");
  const booked = await sql`
    select status, amount_paid_cents, payment_method_setup_at
    from accounting_invoices where id = ${invoice.id}
  `;
  assert.equal(booked[0].status, "paid");
  assert.equal(Number(booked[0].amount_paid_cents), 1090);
  assert.ok(booked[0].payment_method_setup_at);
  const payments = await sql`
    select count(*)::int as count from accounting_payment_allocations where invoice_id = ${invoice.id}
  `;
  assert.equal(payments[0].count, 1);
  const active = await stripeGet(env, `/subscriptions/${subscriptionId}`);
  assert.equal(active.collection_method, "charge_automatically");
  console.log(`PASS PBA sandbox invoice ${invoice.invoiceNumber}: first payment recorded, card saved, monthly autopay active.`);
} finally {
  if (!stripeCustomerId && localCustomerId) {
    const rows = await sql`
      select stripe_customer_id from accounting_customers where id = ${localCustomerId}
    `;
    stripeCustomerId = rows[0]?.stripe_customer_id;
  }
  if (!subscriptionId && stripeCustomerId && localInvoiceId) {
    const found = await stripeGet(env,
      `/subscriptions?customer=${encodeURIComponent(stripeCustomerId)}&status=all&limit=100`);
    subscriptionId = found.data.find((item) =>
      item.metadata?.accounting_invoice_id === localInvoiceId)?.id;
  }
  if (subscriptionId) {
    const canceled = await postStripe(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: "true" });
    assert.equal(canceled.cancel_at, canceled.billing_cycle_anchor,
      "Sandbox subscription must cancel before its first renewal charge.");
    console.log(`Sandbox subscription ${subscriptionId} set to cancel before renewal.`);
  }
}
