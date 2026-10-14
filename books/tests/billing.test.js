import test from "node:test";
import assert from "node:assert/strict";
import { invoiceDaysUntilDue, missingInvoiceItems, nextMonthlyAnchor, recurringStripeItems, recurringSubscriptionFields } from "../worker/billing.js";

test("invoice due days accepts both date-only and Neon timestamp values", () => {
  const now = new Date("2026-10-14T19:00:00.000Z");
  assert.equal(invoiceDaysUntilDue("2026-10-15", now), 1);
  assert.equal(invoiceDaysUntilDue("2026-10-15T00:00:00.000Z", now), 1);
  assert.throws(() => invoiceDaysUntilDue("2026-02-31", now), /invalid/);
  assert.throws(() => invoiceDaysUntilDue("2026-10-13T00:00:00.000Z", now), /passed/);
});

test("pending Stripe items are reused only when every line matches this invoice", () => {
  const expected = [
    { amountCents: 15000, description: "Monthly website hosting and routine maintenance" },
    { amountCents: 1350, description: "Sales tax" },
  ];
  const service = { invoice: null, amount: 15000, currency: "usd", description: expected[0].description, metadata: { accounting_invoice_id: "invoice-1" } };
  const tax = { invoice: null, amount: 1350, currency: "usd", description: expected[1].description, metadata: { accounting_invoice_id: "invoice-1" } };
  assert.deepEqual(missingInvoiceItems(expected, { data: [tax, service], has_more: false }, "invoice-1", "usd"), []);
  assert.deepEqual(missingInvoiceItems(expected, { data: [service], has_more: false }, "invoice-1", "usd"), [expected[1]]);
  assert.throws(() => missingInvoiceItems(expected, { data: [service, service], has_more: false }, "invoice-1", "usd"), /unexpected pending/);
  assert.throws(() => missingInvoiceItems(expected, { data: [{ ...service, metadata: { accounting_invoice_id: "other" } }], has_more: false }, "invoice-1", "usd"), /unexpected pending/);
  assert.throws(() => missingInvoiceItems(expected, { data: [service], has_more: true }, "invoice-1", "usd"), /manual review/);
});

test("monthly renewal anchor selects the next requested day", () => {
  assert.deepEqual(
    nextMonthlyAnchor(7, new Date("2026-10-13T14:00:00.000Z")),
    { date: "2026-11-07", timestamp: Date.parse("2026-11-07T12:00:00.000Z") / 1000 },
  );
});

test("monthly anchor skips today to avoid an immediate second charge", () => {
  assert.equal(nextMonthlyAnchor(7, new Date("2026-11-07T10:00:00.000Z")).date, "2026-12-07");
});

test("monthly anchor advances when today's billing time has passed", () => {
  assert.equal(nextMonthlyAnchor(7, new Date("2026-11-07T13:00:00.000Z")).date, "2026-12-07");
});

test("monthly anchors reject invalid days", () => {
  for (const day of [0, 29, 1.5, "abc"]) {
    assert.throws(() => nextMonthlyAnchor(day), /between 1 and 28/);
  }
});

test("recurring Stripe items separate service subtotal from manually recorded tax", () => {
  assert.deepEqual(recurringStripeItems({ subtotalCents: 15000, taxCents: 1350, memo: "Site maintenance" }), [
    { amountCents: 15000, name: "Site maintenance", description: "Monthly service" },
    { amountCents: 1350, name: "Sales tax", description: "Manually determined sales tax" },
  ]);
});

test("recurring Stripe items omit a zero tax line and reject invalid amounts", () => {
  assert.equal(recurringStripeItems({ subtotalCents: 15000, taxCents: 0 }).length, 1);
  assert.throws(() => recurringStripeItems({ subtotalCents: 0 }), /amounts are invalid/);
});

test("subscription fields bill the next selected day with no proration and separate tax", () => {
  const result = recurringSubscriptionFields({
    customerId: "cus_test",
    invoiceId: "invoice_test",
    customerNumber: "PBA-TEST",
    billingDay: 7,
    now: new Date("2026-10-13T14:00:00.000Z"),
    subtotalCents: 15000,
    taxCents: 1350,
    memo: "Site maintenance",
  });
  assert.equal(result.anchor.date, "2026-11-07");
  assert.equal(result.fields.billing_cycle_anchor, result.anchor.timestamp);
  assert.equal(result.fields.trial_end, result.anchor.timestamp);
  assert.equal(result.fields.proration_behavior, "none");
  assert.equal(result.fields["items[0][price_data][unit_amount]"], 15000);
  assert.equal(result.fields["items[1][price_data][unit_amount]"], 1350);
  assert.equal(result.fields["items[1][price_data][product_data][name]"], "Sales tax");
});
