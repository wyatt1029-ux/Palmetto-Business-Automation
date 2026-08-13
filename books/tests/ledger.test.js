import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBalanced,
  invoiceJournal,
  customerPaymentJournal,
  stripeFeeJournal,
  stripePayoutJournal,
  paidExpenseJournal,
  billJournal,
  billPaymentJournal,
  refundJournal,
} from "../worker/ledger.js";

const total = (lines, key) => lines.reduce((sum, line) => sum + line[key], 0);

for (const [name, factory] of [
  ["invoice", () => invoiceJournal({ subtotalCents: 100000, taxCents: 8000 })],
  ["customer payment", () => customerPaymentJournal(108000)],
  ["Stripe fee", () => stripeFeeJournal(3200)],
  ["Stripe payout", () => stripePayoutJournal(104800)],
  ["paid expense", () => paidExpenseJournal(4200)],
  ["bill", () => billJournal(22000)],
  ["bill payment", () => billPaymentJournal(22000)],
  ["refund", () => refundJournal(12000)],
]) {
  test(`${name} journal balances`, () => {
    const lines = factory();
    assert.equal(total(lines, "debitCents"), total(lines, "creditCents"));
    assert.doesNotThrow(() => assertBalanced(lines));
  });
}

test("rejects an unbalanced journal", () => {
  assert.throws(
    () => assertBalanced([
      { debitCents: 100, creditCents: 0 },
      { debitCents: 0, creditCents: 99 },
    ]),
    /not balanced/,
  );
});
