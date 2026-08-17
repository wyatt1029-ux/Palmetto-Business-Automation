alter table accounting_invoices add column if not exists invoice_footer text;
alter table accounting_invoices add column if not exists custom_fields jsonb not null default '[]'::jsonb;
