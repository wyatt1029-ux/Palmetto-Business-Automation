import { database, companyId, nextDocumentNumber, writeAudit } from "./db.js";
import { requireOwner } from "./auth.js";
import {
  ACCOUNT_CODES,
  invoiceJournal,
  customerPaymentJournal,
  stripeFeeJournal,
  stripePayoutJournal,
  paidExpenseJournal,
  billJournal,
  billPaymentJournal,
  refundJournal,
} from "./ledger.js";
import { postJournal, reverseJournal } from "./journals.js";
import { stripeForm, stripeGet, verifyStripeWebhook } from "./stripe.js";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const errorResponse = (error) => {
  console.error(error);
  return json({ error: error.message || "The request could not be completed." }, error.status || 500);
};
const bodyJson = async (request) => {
  const limit = 1_000_000;
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw Object.assign(new Error("Request is too large."), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > limit) {
    throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("A valid JSON request is required."), { status: 400 });
  }
};
const requiredText = (value, label, max = 500) => {
  const clean = String(value || "").trim();
  if (!clean) throw Object.assign(new Error(`${label} is required.`), { status: 422 });
  if (clean.length > max) throw Object.assign(new Error(`${label} is too long.`), { status: 422 });
  return clean;
};
const cents = (value, label = "Amount") => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw Object.assign(new Error(`${label} must be greater than zero.`), { status: 422 });
  }
  return amount;
};
const isoDate = (value, label = "Date") => {
  const clean = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00Z`))) {
    throw Object.assign(new Error(`${label} is invalid.`), { status: 422 });
  }
  return clean;
};
const routeId = (path, pattern) => path.match(pattern)?.[1] || null;
const formBody = (values) => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => form.append(key, item));
    else if (value !== null && value !== undefined) form.set(key, String(value));
  }
  return form;
};

const accountByCode = async (sql, env, code) => {
  const rows = await sql`
    select id, code, name from accounting_accounts
    where company_id = ${companyId(env)} and code = ${code} and active = true
  `;
  if (!rows.length) throw new Error(`Account ${code} is not configured.`);
  return rows[0];
};

async function dashboard(sql, env) {
  const [summary, recent, overdueInvoices, overdueBills] = await Promise.all([
    sql`
      select
        coalesce(sum(case when a.account_type = 'revenue' then l.credit_cents - l.debit_cents else 0 end),0) as revenue_cents,
        coalesce(sum(case when a.account_type = 'expense' then l.debit_cents - l.credit_cents else 0 end),0) as expense_cents,
        coalesce(sum(case when a.subtype = 'bank' then l.debit_cents - l.credit_cents else 0 end),0) as cash_cents
      from accounting_journal_lines l
      join accounting_journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
      join accounting_accounts a on a.id = l.account_id
      where j.company_id = ${companyId(env)}
        and j.entry_date between date_trunc('year', current_date)::date and current_date
    `,
    sql`
      select id, transaction_date, description, amount_cents, status
      from accounting_bank_transactions
      where company_id = ${companyId(env)}
      order by transaction_date desc, created_at desc limit 8
    `,
    sql`
      select count(*)::int as count, coalesce(sum(total_cents - amount_paid_cents),0) as cents
      from accounting_invoices
      where company_id = ${companyId(env)} and due_date < current_date
        and status in ('open','partially_paid')
    `,
    sql`
      select count(*)::int as count, coalesce(sum(amount_cents - amount_paid_cents),0) as cents
      from accounting_bills
      where company_id = ${companyId(env)} and due_date < current_date
        and status in ('open','partially_paid')
    `,
  ]);
  const unreviewed = await sql`
    select count(*)::int as count from accounting_bank_transactions
    where company_id = ${companyId(env)} and status = 'unreviewed'
  `;
  return {
    summary: summary[0],
    recentTransactions: recent,
    overdueInvoices: overdueInvoices[0],
    overdueBills: overdueBills[0],
    unreviewedCount: unreviewed[0]?.count || 0,
  };
}

async function syncApprovedCustomers(sql, env, actor) {
  const rows = await sql`
    insert into accounting_customers
      (company_id, intake_submission_id, customer_number, name, organization, email,
       stripe_customer_id, created_at, updated_at)
    select distinct on (i.id)
      ${companyId(env)}, i.id, i.customer_number, i.full_name, i.organization, i.email,
      s.stripe_customer_id, now(), now()
    from intake_submissions i
    join sow_versions s on s.intake_submission_id = i.id
    where s.status = 'approved'
    order by i.id, s.version_number desc
    on conflict (company_id, customer_number)
    do update set
      name = excluded.name,
      organization = excluded.organization,
      email = excluded.email,
      stripe_customer_id = coalesce(excluded.stripe_customer_id, accounting_customers.stripe_customer_id),
      updated_at = now()
    returning id
  `;
  await writeAudit(sql, env, actor, "customers.sync", "customer", null, { count: rows.length });
  return rows.length;
}

async function createInvoice(sql, env, actor, data) {
  const customerId = requiredText(data.customerId, "Customer", 80);
  const description = requiredText(data.description, "Description", 500);
  const amount = cents(data.amountCents);
  const issueDate = isoDate(data.issueDate, "Issue date");
  const dueDate = isoDate(data.dueDate, "Due date");
  if (dueDate < issueDate) throw Object.assign(new Error("Due date cannot precede issue date."), { status: 422 });
  const tax = Number(data.taxCents || 0);
  if (!Number.isSafeInteger(tax) || tax < 0) throw Object.assign(new Error("Tax amount is invalid."), { status: 422 });
  const customer = await sql`
    select * from accounting_customers
    where id = ${customerId} and company_id = ${companyId(env)} and active = true
  `;
  if (!customer.length) throw Object.assign(new Error("Customer not found."), { status: 404 });
  const revenue = await accountByCode(sql, env, ACCOUNT_CODES.SERVICE_REVENUE);
  const invoiceNumber = await nextDocumentNumber(sql, env, "invoice");
  const invoiceId = crypto.randomUUID();
  await sql.transaction([
    sql`
      insert into accounting_invoices
        (id, company_id, customer_id, sow_version_id, invoice_number, issue_date, due_date,
         status, subtotal_cents, tax_cents, payment_terms, memo, recurring)
      values
        (${invoiceId}, ${companyId(env)}, ${customerId}, ${data.sowVersionId || null},
         ${invoiceNumber}, ${issueDate}, ${dueDate}, 'draft', ${amount}, ${tax},
         ${data.paymentTerms || "Due on receipt"}, ${data.memo || null}, ${Boolean(data.recurring)})
    `,
    sql`
      insert into accounting_invoice_lines
        (invoice_id, description, quantity, unit_amount_cents, amount_cents, revenue_account_id)
      values (${invoiceId}, ${description}, 1, ${amount}, ${amount}, ${revenue.id})
    `,
  ]);
  const journal = await postJournal(sql, env, actor, {
    date: issueDate,
    description: `${invoiceNumber} · ${description}`,
    sourceType: "invoice",
    sourceId: invoiceId,
    lines: invoiceJournal({ subtotalCents: amount, taxCents: tax }).map((line) => ({
      ...line,
      customerId,
    })),
  });
  await sql`
    update accounting_invoices
    set posted_journal_entry_id = ${journal.id}, status = 'open', updated_at = now()
    where id = ${invoiceId}
  `;
  await writeAudit(sql, env, actor, "invoice.create", "invoice", invoiceId, { invoiceNumber, totalCents: amount + tax });
  return { id: invoiceId, invoiceNumber };
}

async function createStripeCollection(sql, env, actor, invoiceId) {
  const rows = await sql`
    select i.*, c.name customer_name, c.email customer_email, c.customer_number, c.stripe_customer_id
    from accounting_invoices i join accounting_customers c on c.id = i.customer_id
    where i.id = ${invoiceId} and i.company_id = ${companyId(env)}
      and i.status in ('open','partially_paid')
  `;
  if (!rows.length) throw Object.assign(new Error("Open invoice not found."), { status: 404 });
  const invoice = rows[0];
  let stripeCustomerId = invoice.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripeForm(env, "/customers", formBody({
      name: invoice.customer_name,
      email: invoice.customer_email,
      "metadata[customer_number]": invoice.customer_number,
    }), `customer:${invoice.customer_id}`);
    stripeCustomerId = customer.id;
    await sql`
      update accounting_customers set stripe_customer_id = ${stripeCustomerId}, updated_at = now()
      where id = ${invoice.customer_id}
    `;
  }
  const remaining = Number(invoice.total_cents) - Number(invoice.amount_paid_cents);
  const recurring = invoice.recurring;
  const form = formBody({
    mode: recurring ? "subscription" : "payment",
    customer: stripeCustomerId,
    client_reference_id: invoice.customer_number,
    success_url: `${env.PUBLIC_SITE_URL || "https://palmettobusinessautomation.com"}/pay/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_SITE_URL || "https://palmettobusinessautomation.com"}/`,
    "line_items[0][price_data][currency]": invoice.currency,
    "line_items[0][price_data][unit_amount]": remaining,
    "line_items[0][price_data][product_data][name]": invoice.invoice_number,
    "line_items[0][price_data][product_data][description]": invoice.memo || "PBA professional services",
    ...(recurring ? { "line_items[0][price_data][recurring][interval]": "month" } : {}),
    "line_items[0][quantity]": 1,
    "metadata[accounting_invoice_id]": invoice.id,
    "metadata[customer_number]": invoice.customer_number,
    "metadata[project_title]": invoice.memo || invoice.invoice_number,
    "metadata[payment_label]": `${invoice.invoice_number} · PBA professional services`,
    "metadata[payment_terms_summary]": invoice.payment_terms || "Due on receipt",
    ...(recurring ? { "subscription_data[metadata][accounting_invoice_id]": invoice.id } : {
      "payment_intent_data[metadata][accounting_invoice_id]": invoice.id,
      "payment_intent_data[receipt_email]": invoice.customer_email,
      "invoice_creation[enabled]": "true",
    }),
  });
  const session = await stripeForm(env, "/checkout/sessions", form, `invoice-collection:${invoice.id}:${remaining}`);
  await writeAudit(sql, env, actor, "invoice.collection_created", "invoice", invoice.id, {
    checkoutSessionId: session.id,
    recurring,
  });
  return session.url;
}

async function createExpense(sql, env, actor, data) {
  const amount = cents(data.amountCents);
  const date = isoDate(data.date);
  const description = requiredText(data.description, "Description", 500);
  const expenseAccount = await sql`
    select id, code from accounting_accounts
    where id = ${requiredText(data.expenseAccountId, "Expense account", 80)}
      and company_id = ${companyId(env)} and account_type = 'expense' and active = true
  `;
  if (!expenseAccount.length) throw Object.assign(new Error("Expense account not found."), { status: 404 });
  const bank = await accountByCode(sql, env, ACCOUNT_CODES.BANK);
  const id = crypto.randomUUID();
  await sql`
    insert into accounting_expenses
      (id, company_id, vendor_id, expense_account_id, expense_date, description,
       amount_cents, status, payment_account_id, bank_transaction_id)
    values
      (${id}, ${companyId(env)}, ${data.vendorId || null}, ${expenseAccount[0].id},
       ${date}, ${description}, ${amount}, 'draft', ${bank.id}, ${data.bankTransactionId || null})
  `;
  const journal = await postJournal(sql, env, actor, {
    date,
    description,
    sourceType: "expense",
    sourceId: id,
    lines: paidExpenseJournal(amount, expenseAccount[0].code).map((line) => ({
      ...line,
      vendorId: data.vendorId || null,
    })),
  });
  await sql`
    update accounting_expenses
    set posted_journal_entry_id = ${journal.id}, status = 'paid', updated_at = now()
    where id = ${id}
  `;
  if (data.bankTransactionId) {
    await sql`
      update accounting_bank_transactions
      set status = 'categorized', matched_entity_type = 'expense', matched_entity_id = ${id}
      where id = ${data.bankTransactionId} and company_id = ${companyId(env)} and status = 'unreviewed'
    `;
  }
  await writeAudit(sql, env, actor, "expense.create", "expense", id, { amountCents: amount });
  return { id };
}

async function createBill(sql, env, actor, data) {
  const amount = cents(data.amountCents);
  const issueDate = isoDate(data.issueDate, "Issue date");
  const dueDate = isoDate(data.dueDate, "Due date");
  if (dueDate < issueDate) throw Object.assign(new Error("Due date cannot precede issue date."), { status: 422 });
  const vendorId = requiredText(data.vendorId, "Vendor", 80);
  const description = requiredText(data.description, "Description", 500);
  const expenseAccount = await sql`
    select id, code from accounting_accounts
    where id = ${requiredText(data.expenseAccountId, "Expense account", 80)}
      and company_id = ${companyId(env)} and account_type = 'expense' and active = true
  `;
  const vendor = await sql`
    select id from accounting_vendors
    where id = ${vendorId} and company_id = ${companyId(env)} and active = true
  `;
  if (!expenseAccount.length || !vendor.length) throw Object.assign(new Error("Vendor or expense account not found."), { status: 404 });
  const billNumber = await nextDocumentNumber(sql, env, "bill");
  const id = crypto.randomUUID();
  await sql`
    insert into accounting_bills
      (id, company_id, vendor_id, bill_number, vendor_reference, issue_date, due_date,
       description, amount_cents, expense_account_id, status)
    values
      (${id}, ${companyId(env)}, ${vendorId}, ${billNumber}, ${data.vendorReference || null},
       ${issueDate}, ${dueDate}, ${description}, ${amount}, ${expenseAccount[0].id}, 'draft')
  `;
  const journal = await postJournal(sql, env, actor, {
    date: issueDate,
    description: `${billNumber} · ${description}`,
    sourceType: "bill",
    sourceId: id,
    lines: billJournal(amount, expenseAccount[0].code).map((line) => ({ ...line, vendorId })),
  });
  await sql`
    update accounting_bills
    set posted_journal_entry_id = ${journal.id}, status = 'open', updated_at = now()
    where id = ${id}
  `;
  await writeAudit(sql, env, actor, "bill.create", "bill", id, { billNumber, amountCents: amount });
  return { id, billNumber };
}

async function payBill(sql, env, actor, id, data) {
  const amount = cents(data.amountCents);
  const date = isoDate(data.date);
  const rows = await sql`
    select b.*, v.name vendor_name from accounting_bills b
    join accounting_vendors v on v.id = b.vendor_id
    where b.id = ${id} and b.company_id = ${companyId(env)}
      and b.status in ('open','partially_paid')
  `;
  if (!rows.length) throw Object.assign(new Error("Open bill not found."), { status: 404 });
  const bill = rows[0];
  const remaining = Number(bill.amount_cents) - Number(bill.amount_paid_cents);
  if (amount > remaining) throw Object.assign(new Error("Payment exceeds the bill balance."), { status: 422 });
  const journal = await postJournal(sql, env, actor, {
    date,
    description: `Payment · ${bill.bill_number} · ${bill.vendor_name}`,
    sourceType: "bill_payment",
    sourceId: id,
    externalId: data.bankTransactionId ? `bank:${data.bankTransactionId}` : null,
    lines: billPaymentJournal(amount).map((line) => ({ ...line, vendorId: bill.vendor_id })),
  });
  const newPaid = Number(bill.amount_paid_cents) + amount;
  await sql`
    update accounting_bills
    set amount_paid_cents = ${newPaid},
        status = ${newPaid === Number(bill.amount_cents) ? "paid" : "partially_paid"},
        updated_at = now()
    where id = ${id}
  `;
  await sql`
    insert into accounting_bill_payments
      (company_id, bill_id, payment_date, amount_cents, bank_transaction_id, posted_journal_entry_id)
    values
      (${companyId(env)}, ${id}, ${date}, ${amount}, ${data.bankTransactionId || null}, ${journal.id})
  `;
  if (data.bankTransactionId) {
    await sql`
      update accounting_bank_transactions
      set status = 'matched', matched_entity_type = 'bill', matched_entity_id = ${id}
      where id = ${data.bankTransactionId} and company_id = ${companyId(env)}
    `;
  }
  await writeAudit(sql, env, actor, "bill.payment_recorded", "bill", id, { amountCents: amount, journalId: journal.id });
  return { id, amountPaidCents: newPaid };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += char;
  }
  values.push(value.trim());
  return values;
}

const fingerprint = async (parts) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function importCsv(sql, env, actor, data) {
  const financialAccountId = requiredText(data.financialAccountId, "Financial account", 80);
  const text = requiredText(data.csv, "CSV data", 5_000_000);
  const account = await sql`
    select id from accounting_financial_accounts
    where id = ${financialAccountId} and company_id = ${companyId(env)}
  `;
  if (!account.length) throw Object.assign(new Error("Financial account not found."), { status: 404 });
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const columns = rows.shift().map((value) => value.toLowerCase());
  const dateIndex = columns.findIndex((value) => ["date", "transaction date", "posted date"].includes(value));
  const descriptionIndex = columns.findIndex((value) => ["description", "memo", "name", "details"].includes(value));
  const amountIndex = columns.findIndex((value) => ["amount", "transaction amount"].includes(value));
  if ([dateIndex, descriptionIndex, amountIndex].some((index) => index < 0)) {
    throw Object.assign(new Error("CSV must contain Date, Description, and Amount columns."), { status: 422 });
  }
  const batchId = crypto.randomUUID();
  await sql`
    insert into accounting_import_batches
      (id, company_id, financial_account_id, source, filename, created_by)
    values (${batchId}, ${companyId(env)}, ${financialAccountId}, 'csv', ${data.filename || null}, ${actor})
  `;
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const parsedDate = new Date(row[dateIndex]);
      if (Number.isNaN(parsedDate.valueOf())) throw new Error("Invalid date");
      const date = parsedDate.toISOString().slice(0, 10);
      const description = row[descriptionIndex].trim();
      const amountCents = Math.round(Number(row[amountIndex].replace(/[$,()]/g, (match) => match === "(" ? "-" : "")) * 100);
      if (!description || !Number.isSafeInteger(amountCents) || amountCents === 0) throw new Error("Invalid transaction");
      const hash = await fingerprint([financialAccountId, date, description.toLowerCase(), amountCents]);
      const inserted = await sql`
        insert into accounting_bank_transactions
          (company_id, financial_account_id, fingerprint, transaction_date, description,
           amount_cents, status, import_batch_id)
        values
          (${companyId(env)}, ${financialAccountId}, ${hash}, ${date}, ${description},
           ${amountCents}, 'unreviewed', ${batchId})
        on conflict (company_id, fingerprint) do nothing
        returning id
      `;
      if (inserted.length) imported += 1;
      else duplicates += 1;
    } catch {
      errors += 1;
    }
  }
  await sql`
    update accounting_import_batches
    set imported_count = ${imported}, duplicate_count = ${duplicates}, error_count = ${errors}
    where id = ${batchId}
  `;
  await writeAudit(sql, env, actor, "bank.csv_import", "import_batch", batchId, { imported, duplicates, errors });
  return { batchId, imported, duplicates, errors };
}

async function connectBank(env) {
  if (!env.STRIPE_ACCOUNT_CUSTOMER_ID) {
    throw Object.assign(new Error("STRIPE_ACCOUNT_CUSTOMER_ID is not configured."), { status: 503 });
  }
  const session = await stripeForm(env, "/financial_connections/sessions", formBody({
    "account_holder[type]": "customer",
    "account_holder[customer]": env.STRIPE_ACCOUNT_CUSTOMER_ID,
    "permissions[]": ["balances", "transactions"],
    "prefetch[]": ["balances", "transactions"],
    "filters[countries][]": ["US"],
  }), crypto.randomUUID());
  return { id: session.id, clientSecret: session.client_secret };
}

async function completeBankConnection(sql, env, actor, sessionId) {
  const session = await stripeGet(env, `/financial_connections/sessions/${encodeURIComponent(sessionId)}`);
  const bank = await accountByCode(sql, env, ACCOUNT_CODES.BANK);
  let count = 0;
  for (const account of session.accounts?.data || []) {
    const inserted = await sql`
      insert into accounting_financial_accounts
        (company_id, ledger_account_id, provider, provider_account_id, display_name,
         institution_name, last4, account_type, current_balance_cents, available_balance_cents, last_synced_at)
      values
        (${companyId(env)}, ${bank.id}, 'stripe_financial_connections', ${account.id},
         ${account.display_name || account.institution_name || "Connected account"},
         ${account.institution_name || null}, ${account.last4 || null}, ${account.subcategory || account.category || null},
         ${account.balance?.current?.[env.DEFAULT_CURRENCY || "usd"] ?? null},
         ${account.balance?.cash?.available?.[env.DEFAULT_CURRENCY || "usd"] ?? null}, now())
      on conflict (company_id, provider, provider_account_id)
      do update set display_name = excluded.display_name, institution_name = excluded.institution_name,
        current_balance_cents = excluded.current_balance_cents,
        available_balance_cents = excluded.available_balance_cents,
        last_synced_at = now(), active = true
      returning id
    `;
    if (inserted.length) count += 1;
  }
  await writeAudit(sql, env, actor, "bank.connection_complete", "financial_account", null, { sessionId, count });
  return { count };
}

async function syncBankTransactions(sql, env, actor = "system:daily-sync", requestRefresh = true) {
  if (!env.STRIPE_SECRET_KEY) return { accounts: 0, imported: 0 };
  const accounts = await sql`
    select id, provider_account_id from accounting_financial_accounts
    where company_id = ${companyId(env)} and provider = 'stripe_financial_connections' and active = true
  `;
  let imported = 0;
  for (const account of accounts) {
    const result = await stripeGet(env, `/financial_connections/transactions?account=${encodeURIComponent(account.provider_account_id)}&limit=100`);
    for (const transaction of result.data || []) {
      const date = new Date(transaction.transacted_at * 1000).toISOString().slice(0, 10);
      const amount = Number(transaction.amount);
      const hash = await fingerprint([account.id, transaction.id]);
      const rows = await sql`
        insert into accounting_bank_transactions
          (company_id, financial_account_id, provider_transaction_id, fingerprint,
           transaction_date, posted_at, description, amount_cents, currency, status, raw_data)
        values
          (${companyId(env)}, ${account.id}, ${transaction.id}, ${hash}, ${date},
           ${new Date(transaction.transacted_at * 1000).toISOString()},
           ${transaction.description || "Bank transaction"}, ${amount},
           ${transaction.currency || "usd"}, 'unreviewed', ${JSON.stringify(transaction)}::jsonb)
        on conflict (company_id, fingerprint) do nothing
        returning id
      `;
      imported += rows.length;
    }
    await sql`
      update accounting_financial_accounts set last_synced_at = now()
      where id = ${account.id}
    `;
    if (requestRefresh) {
      try {
        await stripeForm(
          env,
          `/financial_connections/accounts/${encodeURIComponent(account.provider_account_id)}/refresh`,
          formBody({ "features[]": ["transactions", "balance"] }),
          `refresh:${account.provider_account_id}:${new Date().toISOString().slice(0, 10)}`,
        );
      } catch (error) {
        console.warn("Financial Connections refresh could not be started.", error);
      }
    }
  }
  if (accounts.length) await writeAudit(sql, env, actor, "bank.sync", "financial_account", null, { accounts: accounts.length, imported });
  return { accounts: accounts.length, imported };
}

async function saveDocument(request, sql, env, actor) {
  if (!env.RECEIPTS) throw Object.assign(new Error("Receipt storage is not configured."), { status: 503 });
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 11 * 1024 * 1024) {
    throw Object.assign(new Error("Upload is too large."), { status: 413 });
  }
  const form = await request.formData();
  const file = form.get("file");
  const entityType = requiredText(form.get("entityType"), "Entity type", 40);
  const entityId = requiredText(form.get("entityId"), "Entity", 80);
  if (!["expense", "bill", "vendor", "invoice", "bank_transaction"].includes(entityType)) {
    throw Object.assign(new Error("Unsupported document type."), { status: 422 });
  }
  if (!(file instanceof File) || !file.size) throw Object.assign(new Error("Choose a document to upload."), { status: 422 });
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  if (!allowed.has(file.type) || file.size > 10 * 1024 * 1024) {
    throw Object.assign(new Error("Use a PDF, JPEG, or PNG no larger than 10 MB."), { status: 422 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signatures = {
    "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  };
  if (!signatures[file.type].every((value, index) => bytes[index] === value)) {
    throw Object.assign(new Error("The file contents do not match the selected document type."), { status: 422 });
  }
  const id = crypto.randomUUID();
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const key = `${companyId(env)}/${entityType}/${entityId}/${id}.${extension}`;
  const safeFilename = file.name.replace(/[\r\n"]/g, "").slice(0, 180) || `document.${extension}`;
  await env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: file.type, contentDisposition: `attachment; filename="${safeFilename}"` },
    customMetadata: { uploadedBy: actor, originalName: safeFilename },
  });
  await sql`
    insert into accounting_documents
      (id, company_id, entity_type, entity_id, object_key, filename, content_type, size_bytes, uploaded_by)
    values
      (${id}, ${companyId(env)}, ${entityType}, ${entityId}, ${key}, ${safeFilename}, ${file.type}, ${file.size}, ${actor})
  `;
  await writeAudit(sql, env, actor, "document.upload", entityType, entityId, { documentId: id, filename: safeFilename });
  return { id, filename: safeFilename };
}

async function getReport(sql, env, url) {
  const type = url.searchParams.get("type") || "profit-loss";
  const basis = url.searchParams.get("basis") === "accrual" ? "accrual" : "cash";
  const from = isoDate(url.searchParams.get("from") || `${new Date().getFullYear()}-01-01`, "Start date");
  const to = isoDate(url.searchParams.get("to") || new Date().toISOString().slice(0, 10), "End date");
  if (type === "profit-loss" && basis === "accrual") {
    const rows = await sql`
      select a.account_type, a.code, a.name,
        sum(case when a.normal_balance = 'debit' then l.debit_cents - l.credit_cents
                 else l.credit_cents - l.debit_cents end)::bigint as amount_cents
      from accounting_journal_lines l
      join accounting_journal_entries j on j.id = l.journal_entry_id
      join accounting_accounts a on a.id = l.account_id
      where j.company_id = ${companyId(env)} and j.status = 'posted'
        and j.entry_date between ${from} and ${to}
        and a.account_type in ('revenue','expense')
      group by a.account_type, a.code, a.name order by a.code
    `;
    return { type, basis, from, to, rows };
  }
  if (type === "profit-loss") {
    const rows = await sql`
      with cash_revenue as (
        select 'revenue'::text account_type, '4000'::text code, 'Service revenue'::text name,
          coalesce(sum(pa.amount_cents),0)::bigint amount_cents
        from accounting_payment_allocations pa
        join accounting_payments p on p.id = pa.payment_id
        where p.company_id = ${companyId(env)} and p.status = 'succeeded'
          and p.payment_date between ${from} and ${to}
      ), direct_expense as (
        select 'expense'::text account_type, a.code, a.name,
          coalesce(sum(x.amount_cents),0)::bigint amount_cents
        from accounting_expenses x join accounting_accounts a on a.id = x.expense_account_id
        where x.company_id = ${companyId(env)} and x.status = 'paid'
          and x.expense_date between ${from} and ${to}
        group by a.code, a.name
      ), paid_bills as (
        select 'expense'::text account_type, a.code, a.name,
          coalesce(sum(bp.amount_cents),0)::bigint amount_cents
        from accounting_bill_payments bp
        join accounting_bills b on b.id = bp.bill_id
        join accounting_accounts a on a.id = b.expense_account_id
        where bp.company_id = ${companyId(env)}
          and bp.payment_date between ${from} and ${to}
        group by a.code, a.name
      ), stripe_fees as (
        select 'expense'::text account_type, a.code, a.name,
          coalesce(sum(l.debit_cents - l.credit_cents),0)::bigint amount_cents
        from accounting_journal_lines l
        join accounting_journal_entries j on j.id = l.journal_entry_id
        join accounting_accounts a on a.id = l.account_id
        where j.company_id = ${companyId(env)} and j.status = 'posted'
          and j.source_type = 'stripe_fee' and j.entry_date between ${from} and ${to}
        group by a.code, a.name
      ), cash_refunds as (
        select 'revenue'::text account_type, '4000'::text code, 'Service revenue'::text name,
          -coalesce(sum(l.debit_cents - l.credit_cents),0)::bigint amount_cents
        from accounting_journal_lines l
        join accounting_journal_entries j on j.id = l.journal_entry_id
        join accounting_accounts a on a.id = l.account_id
        where j.company_id = ${companyId(env)} and j.status = 'posted'
          and j.source_type = 'refund' and a.code = '4000'
          and j.entry_date between ${from} and ${to}
      ), combined as (
        select * from cash_revenue
        union all select * from direct_expense
        union all select * from paid_bills
        union all select * from stripe_fees
        union all select * from cash_refunds
      )
      select account_type, code, name, sum(amount_cents)::bigint amount_cents
      from combined group by account_type, code, name order by code
    `;
    return { type, basis, from, to, rows };
  }
  if (type === "balance-sheet" || type === "trial-balance") {
    const rows = await sql`
      select a.account_type, a.code, a.name,
        sum(l.debit_cents - l.credit_cents)::bigint debit_balance_cents
      from accounting_journal_lines l
      join accounting_journal_entries j on j.id = l.journal_entry_id
      join accounting_accounts a on a.id = l.account_id
      where j.company_id = ${companyId(env)} and j.status = 'posted' and j.entry_date <= ${to}
      group by a.account_type, a.code, a.name order by a.code
    `;
    return { type, basis: "accrual", from, to, rows };
  }
  if (type === "general-ledger") {
    const rows = await sql`
      select j.entry_date, j.entry_number, j.description, j.source_type,
        a.code, a.name, l.debit_cents, l.credit_cents
      from accounting_journal_lines l
      join accounting_journal_entries j on j.id = l.journal_entry_id
      join accounting_accounts a on a.id = l.account_id
      where j.company_id = ${companyId(env)} and j.entry_date between ${from} and ${to}
      order by j.entry_date, j.entry_number, a.code
    `;
    return { type, basis: "accrual", from, to, rows };
  }
  if (type === "ar-aging") {
    const rows = await sql`
      select i.invoice_number, c.customer_number, c.name customer_name, i.due_date,
        i.total_cents - i.amount_paid_cents balance_cents,
        greatest(0, current_date - i.due_date)::int days_past_due
      from accounting_invoices i join accounting_customers c on c.id = i.customer_id
      where i.company_id = ${companyId(env)} and i.status in ('open','partially_paid')
      order by i.due_date
    `;
    return { type, basis, from, to, rows };
  }
  if (type === "ap-aging") {
    const rows = await sql`
      select b.bill_number, v.name vendor_name, b.due_date,
        b.amount_cents - b.amount_paid_cents balance_cents,
        greatest(0, current_date - b.due_date)::int days_past_due
      from accounting_bills b join accounting_vendors v on v.id = b.vendor_id
      where b.company_id = ${companyId(env)} and b.status in ('open','partially_paid')
      order by b.due_date
    `;
    return { type, basis, from, to, rows };
  }
  throw Object.assign(new Error("Unsupported report."), { status: 422 });
}

async function recordStripePayment(sql, env, event) {
  const object = event.data.object;
  let invoiceId = object.metadata?.accounting_invoice_id;
  const subscriptionId = object.subscription || object.parent?.subscription_details?.subscription || null;
  if (!invoiceId && subscriptionId) {
    const templates = await sql`
      select id from accounting_invoices
      where company_id = ${companyId(env)} and stripe_subscription_id = ${subscriptionId}
      order by created_at desc limit 1
    `;
    invoiceId = templates[0]?.id;
  }
  if (!invoiceId && subscriptionId) {
    const subscription = await stripeGet(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    invoiceId = subscription.metadata?.accounting_invoice_id;
  }
  if (!invoiceId) return;
  let rows = await sql`
    select i.*, c.id customer_id from accounting_invoices i
    join accounting_customers c on c.id = i.customer_id
    where i.id = ${invoiceId} and i.company_id = ${companyId(env)}
  `;
  if (!rows.length) return;
  let invoice = rows[0];
  const stripeInvoiceId = object.invoice || (object.object === "invoice" ? object.id : null);
  if (
    object.object === "invoice" &&
    subscriptionId &&
    invoice.status === "paid" &&
    stripeInvoiceId &&
    stripeInvoiceId !== invoice.stripe_invoice_id
  ) {
    const renewalId = crypto.randomUUID();
    const renewalNumber = await nextDocumentNumber(sql, env, "invoice");
    const renewalDate = new Date((object.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
    await sql`
      insert into accounting_invoices
        (id, company_id, customer_id, sow_version_id, invoice_number, issue_date, due_date,
         status, subtotal_cents, tax_cents, payment_terms, memo, recurring,
         stripe_invoice_id, stripe_subscription_id)
      values
        (${renewalId}, ${companyId(env)}, ${invoice.customer_id}, ${invoice.sow_version_id},
         ${renewalNumber}, ${renewalDate}, ${renewalDate}, 'open',
         ${invoice.subtotal_cents}, ${invoice.tax_cents}, ${invoice.payment_terms},
         ${invoice.memo}, true, ${stripeInvoiceId}, ${subscriptionId})
    `;
    await sql`
      insert into accounting_invoice_lines
        (invoice_id, description, quantity, unit_amount_cents, amount_cents, revenue_account_id, sort_order)
      select ${renewalId}, description, quantity, unit_amount_cents, amount_cents, revenue_account_id, sort_order
      from accounting_invoice_lines where invoice_id = ${invoice.id}
    `;
    const renewalJournal = await postJournal(sql, env, "system:stripe", {
      date: renewalDate,
      description: `${renewalNumber} · Monthly recurring service`,
      sourceType: "invoice",
      sourceId: renewalId,
      externalId: `invoice:${stripeInvoiceId}`,
      lines: invoiceJournal({
        subtotalCents: Number(invoice.subtotal_cents),
        taxCents: Number(invoice.tax_cents),
      }).map((line) => ({ ...line, customerId: invoice.customer_id })),
    });
    await sql`update accounting_invoices set posted_journal_entry_id = ${renewalJournal.id} where id = ${renewalId}`;
    rows = await sql`
      select i.*, c.id customer_id from accounting_invoices i
      join accounting_customers c on c.id = i.customer_id where i.id = ${renewalId}
    `;
    invoice = rows[0];
    invoiceId = renewalId;
  }
  const paymentIntent = object.payment_intent || object.id;
  const existing = await sql`
    select id from accounting_payments where stripe_payment_intent_id = ${paymentIntent}
  `;
  if (existing.length) return;
  const amount = Number(object.amount_total || object.amount_paid || 0);
  if (!amount) return;
  const paymentId = crypto.randomUUID();
  await sql`
    insert into accounting_payments
      (id, company_id, customer_id, payment_date, amount_cents, status, method,
       stripe_payment_intent_id)
    values
      (${paymentId}, ${companyId(env)}, ${invoice.customer_id}, ${new Date().toISOString().slice(0, 10)},
       ${amount}, 'pending', 'stripe', ${paymentIntent})
  `;
  const journal = await postJournal(sql, env, "system:stripe", {
    date: new Date().toISOString().slice(0, 10),
    description: `Stripe payment · ${invoice.invoice_number}`,
    sourceType: "customer_payment",
    sourceId: paymentId,
    externalId: event.id,
    lines: customerPaymentJournal(amount).map((line) => ({ ...line, customerId: invoice.customer_id })),
  });
  await sql.transaction([
    sql`
      update accounting_payments
      set posted_journal_entry_id = ${journal.id}, status = 'succeeded'
      where id = ${paymentId}
    `,
    sql`
      insert into accounting_payment_allocations (payment_id, invoice_id, amount_cents)
      values (${paymentId}, ${invoiceId}, ${Math.min(amount, Number(invoice.total_cents) - Number(invoice.amount_paid_cents))})
    `,
    sql`
      update accounting_invoices
      set amount_paid_cents = least(total_cents, amount_paid_cents + ${amount}),
          status = case when amount_paid_cents + ${amount} >= total_cents then 'paid' else 'partially_paid' end,
          stripe_subscription_id = coalesce(${object.subscription || null}, stripe_subscription_id),
          stripe_invoice_id = coalesce(${stripeInvoiceId}, stripe_invoice_id),
          updated_at = now()
      where id = ${invoiceId}
    `,
  ]);
}

async function handleStripeWebhook(request, env) {
  const raw = await request.text();
  if (!await verifyStripeWebhook(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(raw);
  const sql = database(env);
  const processed = await sql`
    insert into accounting_processed_events (provider, event_id, event_type)
    values ('stripe', ${event.id}, ${event.type})
    on conflict do nothing returning event_id
  `;
  if (!processed.length) return new Response("ok");
  try {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "invoice.paid"].includes(event.type)) {
      await recordStripePayment(sql, env, event);
    } else if (event.type === "financial_connections.account.refreshed_transactions") {
      await syncBankTransactions(sql, env, "system:stripe", false);
    } else if (event.type === "charge.succeeded" && event.data.object.balance_transaction) {
      if (event.data.object.payment_intent) {
        await sql`
          update accounting_payments
          set stripe_charge_id = ${event.data.object.id}
          where stripe_payment_intent_id = ${event.data.object.payment_intent}
        `;
      }
      const balance = await stripeGet(env, `/balance_transactions/${event.data.object.balance_transaction}`);
      if (Number(balance.fee) > 0) {
        await postJournal(sql, env, "system:stripe", {
          date: new Date(balance.created * 1000).toISOString().slice(0, 10),
          description: "Stripe processing fee",
          sourceType: "stripe_fee",
          externalId: balance.id,
          lines: stripeFeeJournal(Number(balance.fee)),
        });
      }
    } else if (event.type === "payout.paid") {
      await postJournal(sql, env, "system:stripe", {
        date: new Date(event.data.object.arrival_date * 1000).toISOString().slice(0, 10),
        description: `Stripe payout ${event.data.object.id}`,
        sourceType: "stripe_payout",
        externalId: event.data.object.id,
        lines: stripePayoutJournal(Number(event.data.object.amount)),
      });
    } else if (event.type === "charge.refunded" && Number(event.data.object.amount_refunded) > 0) {
      const payment = await sql`
        select p.id, p.amount_cents, pa.invoice_id
        from accounting_payments p
        left join accounting_payment_allocations pa on pa.payment_id = p.id
        where p.company_id = ${companyId(env)}
          and (p.stripe_charge_id = ${event.data.object.id}
            or p.stripe_payment_intent_id = ${event.data.object.payment_intent || null})
        limit 1
      `;
      await postJournal(sql, env, "system:stripe", {
        date: new Date().toISOString().slice(0, 10),
        description: `Stripe refund ${event.data.object.id}`,
        sourceType: "refund",
        externalId: `${event.data.object.id}:${event.data.object.amount_refunded}`,
        lines: refundJournal(Number(event.data.object.amount_refunded)),
      });
      if (payment.length) {
        const refunded = Number(event.data.object.amount_refunded);
        await sql`
          update accounting_payments
          set status = ${refunded >= Number(payment[0].amount_cents) ? "refunded" : "succeeded"}
          where id = ${payment[0].id}
        `;
        if (payment[0].invoice_id) {
          await sql`
            update accounting_invoices
            set amount_paid_cents = greatest(0, amount_paid_cents - ${refunded}),
                status = case
                  when greatest(0, amount_paid_cents - ${refunded}) = 0 then 'open'
                  else 'partially_paid'
                end,
                updated_at = now()
            where id = ${payment[0].invoice_id}
          `;
        }
      }
    } else if (event.type === "charge.dispute.created") {
      await sql`
        update accounting_payments
        set status = 'disputed'
        where company_id = ${companyId(env)}
          and (stripe_charge_id = ${event.data.object.charge}
            or stripe_payment_intent_id = ${event.data.object.payment_intent || null})
      `;
      await writeAudit(sql, env, "system:stripe", "payment.disputed", "payment", null, {
        disputeId: event.data.object.id,
        amountCents: event.data.object.amount,
      });
    }
  } catch (error) {
    await sql`delete from accounting_processed_events where provider = 'stripe' and event_id = ${event.id}`;
    throw error;
  }
  return new Response("ok");
}

async function api(request, env, actor) {
  const sql = database(env);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/me" && method === "GET") return json({ user: actor });
  if (path === "/api/config" && method === "GET") {
    return json({
      stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
      environment: env.ENVIRONMENT || "production",
    });
  }
  if (path === "/api/dashboard" && method === "GET") return json(await dashboard(sql, env));
  if (path === "/api/accounts" && method === "GET") {
    return json({ accounts: await sql`
      select id, code, name, account_type, subtype, normal_balance, active
      from accounting_accounts where company_id = ${companyId(env)}
      order by code
    ` });
  }
  if (path === "/api/accounts" && method === "POST") {
    const data = await bodyJson(request);
    const type = requiredText(data.accountType, "Account type", 20);
    if (!["asset", "liability", "equity", "revenue", "expense"].includes(type)) {
      throw Object.assign(new Error("Account type is invalid."), { status: 422 });
    }
    const normal = ["asset", "expense"].includes(type) ? "debit" : "credit";
    const rows = await sql`
      insert into accounting_accounts
        (company_id, code, name, account_type, subtype, normal_balance)
      values
        (${companyId(env)}, ${requiredText(data.code, "Account code", 20)},
         ${requiredText(data.name, "Account name", 120)}, ${type},
         ${data.subtype || null}, ${normal})
      returning id, code, name, account_type, subtype, normal_balance, active
    `;
    await writeAudit(sql, env, actor.email, "account.create", "account", rows[0].id);
    return json({ account: rows[0] }, 201);
  }
  const accountId = routeId(path, /^\/api\/accounts\/([^/]+)$/);
  if (accountId && method === "PATCH") {
    const data = await bodyJson(request);
    const rows = await sql`
      update accounting_accounts
      set name = coalesce(${data.name ? requiredText(data.name, "Account name", 120) : null}, name),
          active = coalesce(${typeof data.active === "boolean" ? data.active : null}, active),
          updated_at = now()
      where id = ${accountId} and company_id = ${companyId(env)} and system_account = false
      returning id, code, name, account_type, subtype, normal_balance, active
    `;
    if (!rows.length) throw Object.assign(new Error("Editable account not found."), { status: 404 });
    await writeAudit(sql, env, actor.email, "account.update", "account", accountId);
    return json({ account: rows[0] });
  }
  if (path === "/api/opening-balances" && method === "POST") {
    const data = await bodyJson(request);
    const amount = cents(data.bankBalanceCents, "Opening bank balance");
    const entry = await postJournal(sql, env, actor.email, {
      date: isoDate(data.date, "Opening-balance date"),
      description: "Opening balances",
      sourceType: "opening_balance",
      externalId: `opening:${data.date}`,
      lines: [
        { code: ACCOUNT_CODES.BANK, debitCents: amount, creditCents: 0 },
        { code: ACCOUNT_CODES.OWNER_EQUITY, debitCents: 0, creditCents: amount },
      ],
    });
    await writeAudit(sql, env, actor.email, "opening_balance.post", "journal_entry", entry.id, { amountCents: amount });
    return json({ journal: entry }, 201);
  }
  if (path === "/api/periods" && method === "GET") {
    return json({ periods: await sql`
      select id, starts_on, ends_on, status, closed_at, closed_by
      from accounting_periods where company_id = ${companyId(env)}
      order by starts_on desc
    ` });
  }
  if (path === "/api/customers" && method === "GET") {
    return json({ customers: await sql`
      select id, customer_number, name, organization, email, stripe_customer_id, active
      from accounting_customers where company_id = ${companyId(env)}
      order by name
    ` });
  }
  if (path === "/api/customers/sync" && method === "POST") {
    return json({ synced: await syncApprovedCustomers(sql, env, actor.email) });
  }
  if (path === "/api/vendors" && method === "GET") {
    return json({ vendors: await sql`
      select id, name, email, phone, notes, active
      from accounting_vendors where company_id = ${companyId(env)}
      order by name
    ` });
  }
  if (path === "/api/vendors" && method === "POST") {
    const data = await bodyJson(request);
    const rows = await sql`
      insert into accounting_vendors
        (company_id, name, email, phone, notes)
      values
        (${companyId(env)}, ${requiredText(data.name, "Vendor name", 200)},
         ${data.email || null}, ${data.phone || null}, ${data.notes || null})
      returning id, name
    `;
    await writeAudit(sql, env, actor.email, "vendor.create", "vendor", rows[0].id);
    return json({ vendor: rows[0] }, 201);
  }
  if (path === "/api/invoices" && method === "GET") {
    return json({ invoices: await sql`
      select i.id, i.invoice_number, i.issue_date, i.due_date, i.status, i.total_cents,
        i.amount_paid_cents, i.recurring, c.name customer_name, c.customer_number
      from accounting_invoices i join accounting_customers c on c.id = i.customer_id
      where i.company_id = ${companyId(env)}
      order by i.issue_date desc, i.created_at desc limit 200
    ` });
  }
  if (path === "/api/invoices" && method === "POST") {
    return json({ invoice: await createInvoice(sql, env, actor.email, await bodyJson(request)) }, 201);
  }
  const collectInvoiceId = routeId(path, /^\/api\/invoices\/([^/]+)\/collect$/);
  if (collectInvoiceId && method === "POST") {
    return json({ checkoutUrl: await createStripeCollection(sql, env, actor.email, collectInvoiceId) });
  }
  if (path === "/api/expenses" && method === "GET") {
    return json({ expenses: await sql`
      select x.id, x.expense_date, x.description, x.amount_cents, x.status,
        a.name account_name, v.name vendor_name
      from accounting_expenses x
      join accounting_accounts a on a.id = x.expense_account_id
      left join accounting_vendors v on v.id = x.vendor_id
      where x.company_id = ${companyId(env)}
      order by x.expense_date desc, x.created_at desc limit 200
    ` });
  }
  if (path === "/api/expenses" && method === "POST") {
    return json({ expense: await createExpense(sql, env, actor.email, await bodyJson(request)) }, 201);
  }
  if (path === "/api/bills" && method === "GET") {
    return json({ bills: await sql`
      select b.id, b.bill_number, b.vendor_reference, b.issue_date, b.due_date,
        b.description, b.amount_cents, b.amount_paid_cents, b.status, v.name vendor_name
      from accounting_bills b join accounting_vendors v on v.id = b.vendor_id
      where b.company_id = ${companyId(env)}
      order by b.due_date, b.created_at desc limit 200
    ` });
  }
  if (path === "/api/bills" && method === "POST") {
    return json({ bill: await createBill(sql, env, actor.email, await bodyJson(request)) }, 201);
  }
  const billPaymentId = routeId(path, /^\/api\/bills\/([^/]+)\/payments$/);
  if (billPaymentId && method === "POST") {
    return json({ bill: await payBill(sql, env, actor.email, billPaymentId, await bodyJson(request)) });
  }
  if (path === "/api/bank/accounts" && method === "GET") {
    return json({ accounts: await sql`
      select id, display_name, institution_name, last4, account_type,
        current_balance_cents, available_balance_cents, last_synced_at, provider
      from accounting_financial_accounts
      where company_id = ${companyId(env)} and active = true order by display_name
    ` });
  }
  if (path === "/api/bank/transactions" && method === "GET") {
    const status = url.searchParams.get("status") || "unreviewed";
    return json({ transactions: await sql`
      select t.id, t.transaction_date, t.description, t.amount_cents, t.currency,
        t.status, t.matched_entity_type, f.display_name account_name
      from accounting_bank_transactions t
      join accounting_financial_accounts f on f.id = t.financial_account_id
      where t.company_id = ${companyId(env)}
        and (${status} = 'all' or t.status = ${status})
      order by t.transaction_date desc, t.created_at desc limit 300
    ` });
  }
  if (path === "/api/bank/connect" && method === "POST") return json(await connectBank(env));
  if (path === "/api/bank/complete" && method === "POST") {
    const data = await bodyJson(request);
    return json(await completeBankConnection(sql, env, actor.email, requiredText(data.sessionId, "Session", 200)));
  }
  if (path === "/api/bank/sync" && method === "POST") return json(await syncBankTransactions(sql, env, actor.email));
  if (path === "/api/bank/import" && method === "POST") {
    return json(await importCsv(sql, env, actor.email, await bodyJson(request)), 201);
  }
  const bankCategorizeId = routeId(path, /^\/api\/bank\/transactions\/([^/]+)\/categorize$/);
  if (bankCategorizeId && method === "POST") {
    const transaction = await sql`
      select id, transaction_date, description, amount_cents
      from accounting_bank_transactions
      where id = ${bankCategorizeId} and company_id = ${companyId(env)} and status = 'unreviewed'
    `;
    if (!transaction.length) throw Object.assign(new Error("Unreviewed transaction not found."), { status: 404 });
    if (Number(transaction[0].amount_cents) >= 0) {
      throw Object.assign(new Error("Income should be matched to a customer payment or owner contribution."), { status: 422 });
    }
    const data = await bodyJson(request);
    return json({ expense: await createExpense(sql, env, actor.email, {
      ...data,
      amountCents: Math.abs(Number(transaction[0].amount_cents)),
      date: transaction[0].transaction_date,
      description: data.description || transaction[0].description,
      bankTransactionId: bankCategorizeId,
    }) });
  }
  if (path === "/api/reports" && method === "GET") return json(await getReport(sql, env, url));
  if (path === "/api/documents" && method === "POST") {
    return json({ document: await saveDocument(request, sql, env, actor.email) }, 201);
  }
  const documentId = routeId(path, /^\/api\/documents\/([^/]+)$/);
  if (documentId && method === "GET") {
    if (!env.RECEIPTS) throw Object.assign(new Error("Receipt storage is not configured."), { status: 503 });
    const rows = await sql`
      select object_key, filename, content_type from accounting_documents
      where id = ${documentId} and company_id = ${companyId(env)}
    `;
    if (!rows.length) throw Object.assign(new Error("Document not found."), { status: 404 });
    const object = await env.RECEIPTS.get(rows[0].object_key);
    if (!object) throw Object.assign(new Error("Document file not found."), { status: 404 });
    await writeAudit(sql, env, actor.email, "document.download", "document", documentId);
    return new Response(object.body, {
      headers: {
        "content-type": rows[0].content_type,
        "content-disposition": `attachment; filename="${rows[0].filename.replace(/[\r\n"]/g, "").slice(0, 180)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const reverseId = routeId(path, /^\/api\/journals\/([^/]+)\/reverse$/);
  if (reverseId && method === "POST") {
    const data = await bodyJson(request);
    return json({ journal: await reverseJournal(sql, env, actor.email, reverseId, requiredText(data.reason, "Reason", 500)) });
  }
  const closePeriodId = routeId(path, /^\/api\/periods\/([^/]+)\/close$/);
  if (closePeriodId && method === "POST") {
    const rows = await sql`
      update accounting_periods set status = 'closed', closed_at = now(), closed_by = ${actor.email}
      where id = ${closePeriodId} and company_id = ${companyId(env)} and status = 'open'
      returning id
    `;
    if (!rows.length) throw Object.assign(new Error("Open accounting period not found."), { status: 404 });
    await writeAudit(sql, env, actor.email, "period.close", "accounting_period", closePeriodId);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }
      const actor = await requireOwner(request, env);
      if (
        url.pathname.startsWith("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers.get("origin") !== url.origin
      ) {
        throw Object.assign(new Error("Cross-origin request blocked."), { status: 403 });
      }
      if (url.pathname.startsWith("/api/")) return await api(request, env, actor);
      const response = await env.ASSETS.fetch(request);
      const securedHeaders = new Headers(response.headers);
      securedHeaders.set("cache-control", "private, no-store");
      securedHeaders.set("x-frame-options", "DENY");
      securedHeaders.set("x-content-type-options", "nosniff");
      securedHeaders.set("referrer-policy", "no-referrer");
      securedHeaders.set("content-security-policy", "default-src 'self'; script-src 'self' https://js.stripe.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src https://js.stripe.com https://connect-js.stripe.com; connect-src 'self' https://api.stripe.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      return new Response(response.body, { status: response.status, headers: securedHeaders });
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const sql = database(env);
      await syncBankTransactions(sql, env);
    })());
  },
};
