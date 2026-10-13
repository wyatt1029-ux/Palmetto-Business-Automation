import test from "node:test";
import assert from "node:assert/strict";
import { nextMonthlyAnchor, recurringStripeItems, recurringSubscriptionFields } from "../worker/billing.js";

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
