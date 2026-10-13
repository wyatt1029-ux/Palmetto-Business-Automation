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
