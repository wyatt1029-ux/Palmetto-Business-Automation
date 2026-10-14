import test from "node:test";
import assert from "node:assert/strict";
import { activateMonthlyAutopay } from "../worker/index.js";

const paidInvoice = { object: "invoice", id: "in_initial", amount_paid: 16350 };
const record = {
  id: "invoice-1", stripe_subscription_id: "sub_monthly",
  stripe_customer_id: "cus_client", payment_method_setup_at: null,
};

async function run(subscription, invoice = paidInvoice) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ path: new URL(url).pathname, method: options.method || "GET" });
    if (options.method === "POST") return Response.json({ ...subscription, collection_method: "charge_automatically" });
    return Response.json(subscription);
  };
  try {
    const sql = async () => [record];
    await activateMonthlyAutopay(sql, { STRIPE_SECRET_KEY: "sk_test_mock" }, invoice);
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a paid first invoice activates automatic collection only after Stripe saves the customer's card", async () => {
  const calls = await run({
    id: "sub_monthly", customer: "cus_client", status: "active",
    collection_method: "send_invoice", default_payment_method: "pm_client",
  });
  assert.deepEqual(calls.map(({ path, method }) => `${method} ${path}`), [
    "GET /v1/subscriptions/sub_monthly", "POST /v1/subscriptions/sub_monthly",
  ]);
});

test("a payment without a saved card does not silently activate autopay", async () => {
  const calls = await run({
    id: "sub_monthly", customer: "cus_client", status: "active",
    collection_method: "send_invoice", default_payment_method: null,
  });
  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
});

test("an unpaid or unrelated Stripe event cannot activate autopay", async () => {
  assert.deepEqual(await run({ default_payment_method: "pm_client" }, { ...paidInvoice, amount_paid: 0 }), []);
  const calls = await run({
    id: "sub_monthly", customer: "cus_other", status: "active",
    collection_method: "send_invoice", default_payment_method: "pm_client",
  });
  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
});
