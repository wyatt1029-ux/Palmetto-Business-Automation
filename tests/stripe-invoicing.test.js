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

test("SOW builder provides billing-specific payment defaults without replacing owner edits", async () => {
  const [builder, markup] = await Promise.all([
    readFile(new URL("../sow-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../sow-builder.html", import.meta.url), "utf8"),
  ]);
  assert.match(builder, /Project payment due at approval/);
  assert.match(builder, /Payment is due upon approval of this Statement of Work/);
  assert.match(builder, /This service is billed automatically monthly in advance/);
  assert.match(builder, /label\.value === previous\.label/);
  assert.match(builder, /terms\.value === previous\.terms/);
  assert.match(markup, /Reset to recommended terms/);
});

test("one-time Stripe invoices are due at approval rather than Net 30", async () => {
  const source = await readFile(new URL("../functions/api/payment.js", import.meta.url), "utf8");
  assert.match(source, /collection_method: "send_invoice"/);
  assert.match(source, /days_until_due: "0"/);
  assert.doesNotMatch(source, /days_until_due:[\s\S]{0,240}: 30/);
});

test("customer payment and SOW copy describe approval, payment, and kickoff in order", async () => {
  const [payment, sow] = await Promise.all([
    readFile(new URL("../payment.js", import.meta.url), "utf8"),
    readFile(new URL("../sow.js", import.meta.url), "utf8"),
  ]);
  assert.match(payment, /Work begins after approved scope and payment are received\./);
  assert.match(payment, /billed automatically monthly in advance/);
  assert.match(sow, /Project payment and kickoff/);
  assert.match(sow, /Changes to scope/);
  assert.match(sow, /Optional care plans are billed automatically monthly in advance/);
});

test("FAQ and optional SOW template explain third-party access responsibilities", async () => {
  const [faq, builder, markup] = await Promise.all([
    readFile(new URL("../faq/index.html", import.meta.url), "utf8"),
    readFile(new URL("../sow-builder.js", import.meta.url), "utf8"),
    readFile(new URL("../sow-builder.html", import.meta.url), "utf8"),
  ]);
  assert.match(faq, /What do I need to provide for Stripe, QuickBooks, or other integrations\?/);
  assert.match(faq, /Please do not send passwords by email or text\./);
  assert.match(faq, /<details id="third-party-access">/);
  assert.match(builder, /Client Responsibilities & Third-Party Access/);
  assert.match(builder, /Clients should not send passwords by email or text\./);
  assert.match(builder, /addClientResponsibilitiesTemplate/);
  assert.match(markup, /Add client responsibilities template/);
});
