import test from "node:test";
import assert from "node:assert/strict";
import { createStripeCollection } from "../worker/index.js";

const invoice = (overrides = {}) => ({
  id: "invoice-1",
  customer_id: "customer-1",
  customer_name: "Demo Marine",
  customer_email: "billing@example.test",
  customer_number: "PBA-DEMO",
  stripe_customer_id: "cus_demo",
  stripe_invoice_id: null,
  invoice_number: "PBA-INV-DEMO",
  due_date: "2026-10-15T00:00:00.000Z",
  status: "open",
  currency: "usd",
  total_cents: 16350,
  subtotal_cents: 15000,
  tax_cents: 1350,
  amount_paid_cents: 0,
  memo: "Monthly website maintenance",
  lines: [{ description: "Monthly website hosting and routine maintenance", quantity: 1, amountCents: 15000 }],
  ...overrides,
});

const pendingItems = [
  { invoice: null, amount: 15000, currency: "usd", description: "Monthly website hosting and routine maintenance", metadata: { accounting_invoice_id: "invoice-1" } },
  { invoice: null, amount: 1350, currency: "usd", description: "Sales tax", metadata: { accounting_invoice_id: "invoice-1" } },
];

async function withStripeMock(record, stripeResponse) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const form = options.body ? Object.fromEntries(options.body.entries()) : null;
    calls.push({ path, method: options.method || "GET", form });
    return Response.json(stripeResponse(path, options, form));
  };
  try {
    const sql = async () => [record];
    const result = await createStripeCollection(sql, { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1");
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("retry reuses pending service and tax items, verifies the draft, and sends once", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T19:00:00.000Z");
  try {
    const { result, calls } = await withStripeMock(invoice(), (path, options) => {
      if (path === "/v1/invoices" && !options.method) return { data: [], has_more: false };
      if (path === "/v1/invoiceitems") return { data: pendingItems, has_more: false };
      if (path === "/v1/invoices") return { id: "in_demo", total: 16350, lines: { total_count: 2 } };
      if (path.endsWith("/finalize") || path.endsWith("/send")) return { id: "in_demo", hosted_invoice_url: "https://invoice.stripe.com/demo" };
      throw new Error(`Unexpected Stripe path: ${path}`);
    });
    assert.equal(result.invoiceUrl, "https://invoice.stripe.com/demo");
    assert.equal(calls.filter((call) => call.path === "/v1/invoiceitems" && call.method === "POST").length, 0);
    const draft = calls.find((call) => call.path === "/v1/invoices" && call.method === "POST");
    assert.equal(draft.form.days_until_due, "1");
    assert.equal(draft.form.pending_invoice_items_behavior, "include");
    assert.equal(calls.filter((call) => call.path.endsWith("/send")).length, 1);
  } finally {
    Date.now = now;
  }
});

test("mismatched Stripe draft is never finalized or sent", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T19:00:00.000Z");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/v1/invoices" && !options.method) return Response.json({ data: [], has_more: false });
    if (path === "/v1/invoiceitems") return Response.json({ data: pendingItems, has_more: false });
    if (path === "/v1/invoices") return Response.json({ id: "in_demo", total: 32700, lines: { total_count: 4 } });
    throw new Error(`Unexpected Stripe path: ${path}`);
  };
  try {
    await assert.rejects(
      createStripeCollection(async () => [invoice()], { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1"),
      /does not match PBA Books/,
    );
    assert.ok(!calls.some((path) => path.endsWith("/finalize") || path.endsWith("/send")));
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = now;
  }
});

test("an existing Stripe invoice blocks a second send even when PBA Books has no invoice ID", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T19:00:00.000Z");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/v1/invoices") return Response.json({
      data: [{ id: "in_existing", status: "open", metadata: { accounting_invoice_id: "invoice-1" } }],
      has_more: false,
    });
    throw new Error(`Unexpected Stripe path: ${path}`);
  };
  try {
    await assert.rejects(
      createStripeCollection(async () => [invoice()], { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1"),
      /already has an invoice/,
    );
    assert.deepEqual(calls, ["/v1/invoices"]);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = now;
  }
});

test("monthly billing accepts a database Date and sends one invoice attached to a future-anchored subscription", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T14:00:00.000Z");
  let productCount = 0;
  try {
    const { result, calls } = await withStripeMock(invoice({ recurring: true, billing_day: 7, due_date: new Date("2026-10-16T00:00:00.000Z") }), (path, options) => {
      if (path === "/v1/subscriptions" && !options.method) return { data: [], has_more: false };
      if (path === "/v1/products") return { id: ++productCount === 1 ? "prod_service" : "prod_tax" };
      if (path === "/v1/subscriptions") return {
        id: "sub_demo", customer: "cus_demo", collection_method: "send_invoice", status: "active",
        billing_cycle_anchor: Date.parse("2026-11-07T12:00:00Z") / 1000,
        metadata: { accounting_invoice_id: "invoice-1" }, latest_invoice: null,
      };
      if (path === "/v1/invoices" && !options.method) return { data: [], has_more: false };
      if (path === "/v1/invoices") return {
        id: "in_monthly", customer: "cus_demo", total: 16350, status: "draft",
        parent: { subscription_details: { subscription: "sub_demo" } },
      };
      if (path === "/v1/invoices/in_monthly") return { id: "in_monthly" };
      if (path.endsWith("/finalize")) return { id: "in_monthly", total: 16350, status: "open" };
      if (path.endsWith("/send")) return { id: "in_monthly", status: "open", hosted_invoice_url: "https://invoice.stripe.com/monthly" };
      throw new Error(`Unexpected Stripe path: ${path}`);
    });
    assert.equal(result.invoiceUrl, "https://invoice.stripe.com/monthly");
    assert.equal(result.monthly, true);
    const subscription = calls.find((call) => call.path === "/v1/subscriptions" && call.method === "POST");
    assert.equal(subscription.form.billing_cycle_anchor, String(Date.parse("2026-11-07T12:00:00Z") / 1000));
    assert.equal(subscription.form["add_invoice_items[0][price_data][unit_amount]"], "15000");
    assert.equal(subscription.form["add_invoice_items[1][price_data][unit_amount]"], "1350");
    const draft = calls.find((call) => call.path === "/v1/invoices" && call.method === "POST");
    assert.equal(draft.form.subscription, "sub_demo");
    assert.equal(draft.form.pending_invoice_items_behavior, undefined);
    assert.equal(calls.filter((call) => call.path.endsWith("/send")).length, 1);
    assert.equal(calls.filter((call) => call.path === "/v1/invoiceitems").length, 0);
  } finally {
    Date.now = now;
  }
});

test("monthly billing refuses a mismatched first Stripe invoice without sending", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T14:00:00.000Z");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/v1/subscriptions" && !options.method) return Response.json({ data: [], has_more: false });
    if (path === "/v1/products") return Response.json({ id: "prod_demo" });
    if (path === "/v1/subscriptions") return Response.json({
      id: "sub_demo", customer: "cus_demo", collection_method: "send_invoice", status: "active",
      billing_cycle_anchor: Date.parse("2026-11-07T12:00:00Z") / 1000,
      metadata: { accounting_invoice_id: "invoice-1" }, latest_invoice: null,
    });
    if (path === "/v1/invoices" && !options.method) return Response.json({ data: [], has_more: false });
    if (path === "/v1/invoices") return Response.json({
      id: "in_monthly", customer: "cus_demo", total: 32700, status: "draft",
      parent: { subscription_details: { subscription: "sub_demo" } },
    });
    throw new Error(`Unexpected Stripe path: ${path}`);
  };
  try {
    await assert.rejects(createStripeCollection(async () => [invoice({ recurring: true, billing_day: 7, due_date: "2026-10-16T00:00:00.000Z" })], { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1"), /does not match PBA Books/);
    assert.ok(!calls.some((path) => path.endsWith("/send") || path.endsWith("/finalize")));
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = now;
  }
});

test("a previously created monthly subscription is resumed without creating another", async () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-10-14T14:00:00.000Z");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/v1/subscriptions") return Response.json({
      data: [{ id: "sub_existing", customer: "cus_demo", collection_method: "send_invoice", status: "active",
        billing_cycle_anchor: Date.parse("2026-11-07T12:00:00Z") / 1000,
        latest_invoice: null, metadata: { accounting_invoice_id: "invoice-1" } }], has_more: false,
    });
    if (path === "/v1/invoices" && !options.method) return Response.json({
      data: [{ id: "in_existing", customer: "cus_demo", total: 16350, status: "draft",
        metadata: { accounting_invoice_id: "invoice-1" },
        parent: { subscription_details: { subscription: "sub_existing" } } }], has_more: false,
    });
    if (path === "/v1/invoices/in_existing") return Response.json({ id: "in_existing" });
    if (path.endsWith("/finalize")) return Response.json({ id: "in_existing", total: 16350, status: "open" });
    if (path.endsWith("/send")) return Response.json({ id: "in_existing", status: "open", hosted_invoice_url: "https://invoice.stripe.com/existing" });
    throw new Error(`Unexpected Stripe path: ${path}`);
  };
  try {
    const result = await createStripeCollection(async () => [invoice({ recurring: true, billing_day: 7, due_date: "2026-10-16T00:00:00.000Z" })], { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1");
    assert.equal(result.invoiceUrl, "https://invoice.stripe.com/existing");
    assert.equal(calls.filter((path) => path === "/v1/subscriptions").length, 1);
    assert.equal(calls.filter((path) => path === "/v1/products").length, 0);
    assert.equal(calls.filter((path) => path === "/v1/invoices").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = now;
  }
});
