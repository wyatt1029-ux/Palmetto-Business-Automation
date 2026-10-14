import test from "node:test";
import assert from "node:assert/strict";
import { updateInvoiceDetails } from "../worker/index.js";

const baseInvoice = () => ({
  id: "invoice-1",
  invoice_number: "PBA-INV-DEMO",
  issue_date: "2026-10-14",
  due_date: "2026-10-15",
  status: "open",
  amount_paid_cents: 0,
  total_cents: 16350,
  memo: "Original memo",
  stripe_invoice_id: "in_demo",
  stripe_customer_id: "cus_demo",
});

const stripeInvoice = () => ({
  id: "in_demo",
  status: "open",
  collection_method: "send_invoice",
  customer: "cus_demo",
  total: 16350,
  amount_paid: 0,
  due_date: Date.parse("2026-10-15T19:23:00Z") / 1000,
  description: "Original memo",
  metadata: { accounting_invoice_id: "invoice-1" },
});

async function exercise({ local = baseInvoice(), remote = stripeInvoice(), revision = null, data = { memo: "Updated scope and exclusions", dueDate: "2026-10-15" } } = {}) {
  const queries = [];
  const requests = [];
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-10-14T19:00:00Z");
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const form = options.body ? Object.fromEntries(options.body.entries()) : null;
    requests.push({ path, method: options.method || "GET", form });
    if (path === "/v1/invoices/in_revision" && revision) return Response.json(revision);
    if (path !== "/v1/invoices/in_demo") throw new Error(`Unexpected Stripe path ${path}`);
    return Response.json(options.method === "POST" ? {
      ...remote,
      description: form.description,
      metadata: { ...remote.metadata, project_title: form["metadata[project_title]"] },
    } : remote);
  };
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("select i.*, c.stripe_customer_id")) return [local];
    if (query.includes("update accounting_invoices")) return [{
      id: local.id, invoice_number: local.invoice_number,
      memo: data.memo, due_date: data.dueDate, total_cents: local.total_cents,
    }];
    return [];
  };
  try {
    const result = await updateInvoiceDetails(sql, { STRIPE_SECRET_KEY: "sk_test_mock" }, "owner@example.test", "invoice-1", data);
    return { result, requests, queries };
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
}

test("updates an unpaid invoice in Stripe and PBA Books without changing its amount or sending again", async () => {
  const { result, requests, queries } = await exercise();
  assert.equal(result.memo, "Updated scope and exclusions");
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    "GET /v1/invoices/in_demo", "POST /v1/invoices/in_demo",
  ]);
  const form = requests[1].form;
  assert.equal(form.description, "Updated scope and exclusions");
  assert.ok(!("due_date" in form));
  assert.equal(form["metadata[payment_terms_summary]"], "Due October 15, 2026");
  assert.ok(!("amount" in form) && !("customer" in form));
  assert.ok(queries.some(({ query }) => query.includes("update accounting_invoices")));
  assert.ok(queries.some(({ query }) => query.includes("insert into accounting_audit_events")));
});

test("rejects a paid invoice before contacting Stripe", async () => {
  await assert.rejects(exercise({ local: { ...baseInvoice(), status: "paid", amount_paid_cents: 16350 } }),
    /Only an unpaid/);
});

test("rejects a mismatched Stripe invoice before updating either system", async () => {
  await assert.rejects(exercise({ remote: { ...stripeInvoice(), total: 9999 } }),
    /no longer matches PBA Books/);
});

test("requires a Stripe revision to change the due date of a finalized invoice", async () => {
  await assert.rejects(exercise({ data: { memo: "Updated", dueDate: "2026-10-16" } }),
    /Create and finalize a revision/);
});

test("reconnects a matching Stripe revision without posting a second receivable or sending", async () => {
  const memo = "Updated scope and exclusions";
  const { result, requests, queries } = await exercise({
    remote: { ...stripeInvoice(), status: "void", latest_revision: "in_revision" },
    revision: {
      ...stripeInvoice(), id: "in_revision", status: "open", description: memo,
      due_date: Date.parse("2026-10-16T19:23:00Z") / 1000,
      from_invoice: { action: "revision", invoice: "in_demo" },
    },
    data: { memo, dueDate: "2026-10-16" },
  });
  assert.equal(result.memo, memo);
  assert.deepEqual(requests.map(({ method, path }) => `${method} ${path}`), [
    "GET /v1/invoices/in_demo", "GET /v1/invoices/in_revision",
  ]);
  assert.ok(queries.some(({ query, values }) => query.includes("set stripe_invoice_id") && values.includes("in_revision")));
  assert.ok(queries.some(({ query }) => query.includes("insert into accounting_audit_events")));
  assert.ok(!queries.some(({ query }) => query.includes("insert into accounting_journal_entries")));
});

test("refuses a Stripe revision with a changed total", async () => {
  await assert.rejects(exercise({
    remote: { ...stripeInvoice(), status: "void", latest_revision: "in_revision" },
    revision: {
      ...stripeInvoice(), id: "in_revision", status: "open", total: 17000,
      due_date: Date.parse("2026-10-16T19:23:00Z") / 1000,
      from_invoice: { action: "revision", invoice: "in_demo" },
    },
    data: { memo: "Updated scope and exclusions", dueDate: "2026-10-16" },
  }), /revision does not match/i);
});

test("rejects invalid due dates and overlong memos", async () => {
  await assert.rejects(exercise({ data: { memo: "Updated", dueDate: "2026-02-30" } }), /due date is invalid/i);
  await assert.rejects(exercise({ data: { memo: "x".repeat(501), dueDate: "2026-10-16" } }), /too long/);
});
