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
