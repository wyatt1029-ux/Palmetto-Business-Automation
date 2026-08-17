import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("approved payment flow uses Stripe hosted invoices or subscriptions", async () => {
  const source = await readFile(new URL("../functions/api/payment.js", import.meta.url), "utf8");
  assert.match(source, /\/customers/);
  assert.match(source, /\/invoiceitems/);
  assert.match(source, /\/invoices/);
  assert.match(source, /\/subscriptions/);
  assert.match(source, /hosted_invoice_url/);
  assert.doesNotMatch(source, /stripe\(env, "\/checkout\/sessions"/);
});

test("invoice webhooks update the approved SOW", async () => {
  const source = await readFile(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");
  assert.match(source, /event\.type === "invoice\.paid"/);
  assert.match(source, /event\.type === "invoice\.payment_failed"/);
  assert.match(source, /object\.metadata\?\.sow_version_id/);
  assert.match(source, /stripe_hosted_invoice_url/);
});

test("PBA sends one-time invoices through Stripe after finalization", async () => {
  const source = await readFile(new URL("../books/worker/index.js", import.meta.url), "utf8");
  assert.match(source, /encodeURIComponent\(draft\.id\).*\/send/);
  assert.match(source, /custom_fields/);
  assert.match(source, /accounting_invoice_lines/);
  assert.match(source, /description: "Sales tax"/);
  assert.match(source, /stripeInvoice\.status === "draft"/);
});
