import { assertBalanced } from "./ledger.js";
import { companyId, nextDocumentNumber } from "./db.js";

export async function postJournal(sql, env, actor, {
  date,
  description,
  sourceType,
  sourceId = null,
  externalId = null,
  lines,
}) {
  assertBalanced(lines);
  const entryDate = date || new Date().toISOString().slice(0, 10);
  const periods = await sql`
    select id from accounting_periods
    where company_id = ${companyId(env)}
      and ${entryDate}::date between starts_on and ends_on
      and status = 'open'
    limit 1
  `;
  if (!periods.length) {
    throw Object.assign(new Error("That accounting date is outside an open period."), { status: 409 });
  }

  if (externalId) {
    const existing = await sql`
      select id, entry_number from accounting_journal_entries
      where company_id = ${companyId(env)}
        and source_type = ${sourceType}
        and external_id = ${externalId}
      limit 1
    `;
    if (existing.length) return existing[0];
  }

  const accounts = await sql`
    select id, code from accounting_accounts
    where company_id = ${companyId(env)} and active = true
  `;
  const byCode = new Map(accounts.map((account) => [account.code, account.id]));
  for (const line of lines) {
    if (!byCode.has(line.code)) throw new Error(`Ledger account ${line.code} is unavailable.`);
  }

  const id = crypto.randomUUID();
  const entryNumber = await nextDocumentNumber(sql, env, "journal");
  const queries = [
    sql`
      insert into accounting_journal_entries
        (id, company_id, entry_number, entry_date, description, source_type, source_id,
         external_id, status, posted_at, posted_by)
      values
        (${id}, ${companyId(env)}, ${entryNumber}, ${entryDate}, ${description}, ${sourceType},
         ${sourceId}, ${externalId}, 'posted', now(), ${actor})
    `,
    ...lines.map((line) => sql`
      insert into accounting_journal_lines
        (journal_entry_id, account_id, description, debit_cents, credit_cents, customer_id, vendor_id)
      values
        (${id}, ${byCode.get(line.code)}, ${line.description || description},
         ${line.debitCents || 0}, ${line.creditCents || 0},
         ${line.customerId || null}, ${line.vendorId || null})
    `),
  ];
  await sql.transaction(queries);
  return { id, entry_number: entryNumber };
}

export async function reverseJournal(sql, env, actor, entryId, reason) {
  const entries = await sql`
    select * from accounting_journal_entries
    where id = ${entryId} and company_id = ${companyId(env)} and status = 'posted'
  `;
  if (!entries.length) throw Object.assign(new Error("Posted journal entry not found."), { status: 404 });
  const original = entries[0];
  const lines = await sql`
    select a.code, l.debit_cents, l.credit_cents, l.customer_id, l.vendor_id, l.description
    from accounting_journal_lines l
    join accounting_accounts a on a.id = l.account_id
    where l.journal_entry_id = ${entryId}
  `;
  const reversal = await postJournal(sql, env, actor, {
    date: new Date().toISOString().slice(0, 10),
    description: `Reversal of ${original.entry_number}: ${reason}`,
    sourceType: "reversal",
    sourceId: entryId,
    externalId: `reversal:${entryId}`,
    lines: lines.map((line) => ({
      code: line.code,
      debitCents: Number(line.credit_cents),
      creditCents: Number(line.debit_cents),
      customerId: line.customer_id,
      vendorId: line.vendor_id,
      description: line.description,
    })),
  });
  await sql`
    update accounting_journal_entries
    set status = 'reversed'
    where id = ${entryId} and status = 'posted'
  `;
  await sql`
    update accounting_journal_entries
    set reverses_entry_id = ${entryId}
    where id = ${reversal.id}
  `;
  return reversal;
}
