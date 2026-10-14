export function nextMonthlyAnchor(day, now = new Date()) {
  const billingDay = Number(day);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    throw new RangeError("Monthly billing day must be between 1 and 28.");
  }
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let anchor = Date.UTC(year, month, billingDay, 12, 0, 0);
  if (billingDay <= now.getUTCDate() || anchor <= now.getTime()) {
    month += 1;
    if (month > 11) { year += 1; month = 0; }
    anchor = Date.UTC(year, month, billingDay, 12, 0, 0);
  }
  return {
    date: new Date(anchor).toISOString().slice(0, 10),
    timestamp: Math.floor(anchor / 1000),
  };
}

export function invoiceDaysUntilDue(value, now = new Date()) {
  const raw = value instanceof Date ? value.toISOString() : String(value || "");
  const date = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/)?.[1];
  if (!date || !Number.isFinite(Date.parse(raw)) || !Number.isFinite(now.getTime())) {
    throw Object.assign(new Error("Invoice due date is invalid."), { status: 422 });
  }
  const dueAtNoon = Date.parse(`${date}T12:00:00Z`);
  if (new Date(dueAtNoon).toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error("Invoice due date is invalid."), { status: 422 });
  }
  if (date < now.toISOString().slice(0, 10)) {
    throw Object.assign(new Error("Invoice due date has passed. Update it before sending."), { status: 422 });
  }
  const days = Math.ceil((dueAtNoon - now.getTime()) / 86_400_000);
  if (days < 0) {
    throw Object.assign(new Error("Invoice due date has passed. Update it before sending."), { status: 422 });
  }
  if (days > 365) {
    throw Object.assign(new Error("Invoice due date is more than 365 days away."), { status: 422 });
  }
  return days;
}

export function missingInvoiceItems(expected, pending, invoiceId, currency) {
  if (pending.has_more || !Array.isArray(pending.data)) {
    throw Object.assign(new Error("Stripe invoice items need manual review before sending."), { status: 409 });
  }
  const matched = new Set();
  for (const item of pending.data) {
    const index = expected.findIndex((line, candidate) =>
      !matched.has(candidate) &&
      item.invoice === null &&
      item.metadata?.accounting_invoice_id === invoiceId &&
      item.amount === line.amountCents &&
      item.currency === currency &&
      item.description === line.description
    );
    if (index < 0) {
      throw Object.assign(new Error("Stripe has unexpected pending items for this customer. Review them before sending."), { status: 409 });
    }
    matched.add(index);
  }
  return expected.filter((_, index) => !matched.has(index));
}

export function recurringStripeItems({ subtotalCents, taxCents, memo }) {
  const subtotal = Number(subtotalCents);
  const tax = Number(taxCents || 0);
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || !Number.isSafeInteger(tax) || tax < 0) {
    throw new RangeError("Recurring invoice amounts are invalid.");
  }
  const items = [{
    amountCents: subtotal,
    name: String(memo || "Monthly service").slice(0, 120),
    description: "Monthly service",
  }];
  if (tax > 0) items.push({
    amountCents: tax,
    name: "Sales tax",
    description: "Manually determined sales tax",
  });
  return items;
}

export function recurringSubscriptionFields({
  customerId,
  invoiceId,
  customerNumber,
  currency = "usd",
  billingDay,
  now = new Date(),
  subtotalCents,
  taxCents,
  memo,
}) {
  const anchor = nextMonthlyAnchor(billingDay, now);
  const items = recurringStripeItems({ subtotalCents, taxCents, memo });
  return {
    anchor,
    fields: {
      customer: customerId,
      payment_behavior: "default_incomplete",
      billing_cycle_anchor: anchor.timestamp,
      trial_end: anchor.timestamp,
      proration_behavior: "none",
      "payment_settings[save_default_payment_method]": "on_subscription",
      ...Object.fromEntries(items.flatMap((item, index) => [
        [`items[${index}][price_data][currency]`, currency],
        [`items[${index}][price_data][unit_amount]`, item.amountCents],
        [`items[${index}][price_data][recurring][interval]`, "month"],
        [`items[${index}][price_data][product_data][name]`, item.name],
        [`items[${index}][price_data][product_data][description]`, item.description],
      ])),
      "metadata[accounting_invoice_id]": invoiceId,
      "metadata[customer_number]": customerNumber,
    },
  };
}

// A monthly invoice can be paid once while its subscription is authorized in
// the same Stripe-hosted flow. The first service period is an invoice item;
// the recurring prices begin on the selected future billing day.
export function monthlyInvoiceSubscriptionFields({
  customerId,
  invoiceId,
  customerNumber,
  currency = "usd",
  billingDay,
  dueDays,
  now = new Date(),
  subtotalCents,
  taxCents,
  serviceProductId,
  taxProductId,
}) {
  const anchor = nextMonthlyAnchor(billingDay, now);
  const subtotal = Number(subtotalCents);
  const tax = Number(taxCents || 0);
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || !Number.isSafeInteger(tax) || tax < 0) {
    throw new RangeError("Monthly invoice amounts are invalid.");
  }
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
    throw new RangeError("Monthly invoice due days are invalid.");
  }
  const fields = {
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: dueDays,
    billing_cycle_anchor: anchor.timestamp,
    proration_behavior: "none",
    "payment_settings[save_default_payment_method]": "on_subscription",
    "payment_settings[payment_method_types][0]": "card",
    "items[0][price_data][currency]": currency,
    "items[0][price_data][unit_amount]": subtotal,
    "items[0][price_data][recurring][interval]": "month",
    "items[0][price_data][product]": serviceProductId,
    "add_invoice_items[0][price_data][currency]": currency,
    "add_invoice_items[0][price_data][unit_amount]": subtotal,
    "add_invoice_items[0][price_data][product]": serviceProductId,
    "metadata[accounting_invoice_id]": invoiceId,
    "metadata[customer_number]": customerNumber,
  };
  if (tax > 0) {
    Object.assign(fields, {
      "items[1][price_data][currency]": currency,
      "items[1][price_data][unit_amount]": tax,
      "items[1][price_data][recurring][interval]": "month",
      "items[1][price_data][product]": taxProductId,
      "add_invoice_items[1][price_data][currency]": currency,
      "add_invoice_items[1][price_data][unit_amount]": tax,
      "add_invoice_items[1][price_data][product]": taxProductId,
    });
  }
  return { anchor, fields };
}
