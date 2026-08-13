create table if not exists accounting_companies (
  id uuid primary key,
  legal_name text not null,
  display_name text not null,
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  accounting_basis_default text not null default 'cash' check (accounting_basis_default in ('cash','accrual')),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into accounting_companies (id, legal_name, display_name)
values ('00000000-0000-0000-0000-000000000001', 'Palmetto Business Automation LLC', 'PBA')
on conflict (id) do nothing;

create table if not exists accounting_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by text,
  created_at timestamptz not null default now(),
  unique (company_id, starts_on, ends_on),
  check (ends_on >= starts_on)
);

insert into accounting_periods (company_id, starts_on, ends_on)
values ('00000000-0000-0000-0000-000000000001', '2026-01-01', '2026-12-31')
on conflict do nothing;

create table if not exists accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  subtype text,
  normal_balance text not null check (normal_balance in ('debit','credit')),
  active boolean not null default true,
  system_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

insert into accounting_accounts (company_id, code, name, account_type, subtype, normal_balance, system_account)
values
  ('00000000-0000-0000-0000-000000000001','1000','Operating bank','asset','bank','debit',true),
  ('00000000-0000-0000-0000-000000000001','1050','Stripe clearing','asset','clearing','debit',true),
  ('00000000-0000-0000-0000-000000000001','1100','Accounts receivable','asset','accounts_receivable','debit',true),
  ('00000000-0000-0000-0000-000000000001','1200','Prepaid expenses','asset','other_current_asset','debit',false),
  ('00000000-0000-0000-0000-000000000001','2000','Accounts payable','liability','accounts_payable','credit',true),
  ('00000000-0000-0000-0000-000000000001','2100','Sales tax payable','liability','sales_tax','credit',true),
  ('00000000-0000-0000-0000-000000000001','3000','Owner equity','equity','owner_equity','credit',true),
  ('00000000-0000-0000-0000-000000000001','3100','Owner draws','equity','owner_draws','debit',false),
  ('00000000-0000-0000-0000-000000000001','4000','Service revenue','revenue','services','credit',true),
  ('00000000-0000-0000-0000-000000000001','6100','Software and subscriptions','expense','software','debit',false),
  ('00000000-0000-0000-0000-000000000001','6200','Contractor expense','expense','contractors','debit',false),
  ('00000000-0000-0000-0000-000000000001','6300','Merchant processing fees','expense','merchant_fees','debit',true),
  ('00000000-0000-0000-0000-000000000001','6400','Insurance expense','expense','insurance','debit',false),
  ('00000000-0000-0000-0000-000000000001','6500','Marketing expense','expense','marketing','debit',false),
  ('00000000-0000-0000-0000-000000000001','6900','General business expense','expense','general','debit',true)
on conflict (company_id, code) do nothing;

create table if not exists accounting_document_sequences (
  company_id uuid not null references accounting_companies(id),
  sequence_name text not null check (sequence_name in ('invoice','bill','journal')),
  prefix text not null,
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, sequence_name)
);

insert into accounting_document_sequences (company_id, sequence_name, prefix)
values
  ('00000000-0000-0000-0000-000000000001','invoice','PBA-INV-'),
  ('00000000-0000-0000-0000-000000000001','bill','PBA-BILL-'),
  ('00000000-0000-0000-0000-000000000001','journal','PBA-JE-')
on conflict do nothing;

create table if not exists accounting_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  intake_submission_id uuid references intake_submissions(id),
  customer_number text not null,
  name text not null,
  organization text,
  email text not null,
  phone text,
  billing_address jsonb,
  stripe_customer_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, customer_number)
);

create table if not exists accounting_vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  name text not null,
  email text,
  phone text,
  default_expense_account_id uuid references accounting_accounts(id),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists accounting_journal_entries (
  id uuid primary key,
  company_id uuid not null references accounting_companies(id),
  entry_number text not null,
  entry_date date not null,
  description text not null,
  source_type text not null check (source_type in ('opening_balance','invoice','customer_payment','stripe_fee','stripe_payout','expense','bill','bill_payment','refund','manual','reversal')),
  source_id uuid,
  external_id text,
  status text not null default 'posted' check (status in ('draft','posted','reversed')),
  reverses_entry_id uuid references accounting_journal_entries(id),
  posted_at timestamptz,
  posted_by text,
  created_at timestamptz not null default now(),
  unique (company_id, entry_number),
  unique (company_id, source_type, external_id)
);

create table if not exists accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references accounting_journal_entries(id),
  account_id uuid not null references accounting_accounts(id),
  description text,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  customer_id uuid references accounting_customers(id),
  vendor_id uuid references accounting_vendors(id),
  created_at timestamptz not null default now(),
  check ((debit_cents > 0 and credit_cents = 0) or (credit_cents > 0 and debit_cents = 0))
);

create index if not exists accounting_journal_lines_entry_idx on accounting_journal_lines(journal_entry_id);
create index if not exists accounting_journal_entries_date_idx on accounting_journal_entries(company_id, entry_date desc);

create table if not exists accounting_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  customer_id uuid not null references accounting_customers(id),
  sow_version_id uuid references sow_versions(id),
  invoice_number text not null,
  issue_date date not null,
  due_date date not null,
  status text not null default 'draft' check (status in ('draft','open','partially_paid','paid','void','uncollectible')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint generated always as (subtotal_cents + tax_cents) stored,
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  currency text not null default 'usd',
  payment_terms text,
  memo text,
  recurring boolean not null default false,
  stripe_invoice_id text unique,
  stripe_subscription_id text,
  posted_journal_entry_id uuid references accounting_journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number),
  check (due_date >= issue_date)
);

create table if not exists accounting_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references accounting_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  revenue_account_id uuid not null references accounting_accounts(id),
  sort_order integer not null default 0
);

create table if not exists accounting_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  customer_id uuid not null references accounting_customers(id),
  payment_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'succeeded' check (status in ('pending','succeeded','failed','refunded','disputed')),
  method text,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  posted_journal_entry_id uuid references accounting_journal_entries(id),
  created_at timestamptz not null default now()
);

create table if not exists accounting_payment_allocations (
  payment_id uuid not null references accounting_payments(id),
  invoice_id uuid not null references accounting_invoices(id),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (payment_id, invoice_id)
);

create table if not exists accounting_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  vendor_id uuid references accounting_vendors(id),
  expense_account_id uuid not null references accounting_accounts(id),
  expense_date date not null,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'paid' check (status in ('draft','paid','void')),
  payment_account_id uuid not null references accounting_accounts(id),
  bank_transaction_id uuid,
  posted_journal_entry_id uuid references accounting_journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  vendor_id uuid not null references accounting_vendors(id),
  bill_number text not null,
  vendor_reference text,
  issue_date date not null,
  due_date date not null,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  expense_account_id uuid not null references accounting_accounts(id),
  status text not null default 'open' check (status in ('draft','open','partially_paid','paid','void')),
  posted_journal_entry_id uuid references accounting_journal_entries(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, bill_number),
  check (due_date >= issue_date)
);

create table if not exists accounting_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  ledger_account_id uuid not null references accounting_accounts(id),
  provider text not null check (provider in ('stripe_financial_connections','csv')),
  provider_account_id text,
  display_name text not null,
  institution_name text,
  last4 text,
  account_type text,
  current_balance_cents bigint,
  available_balance_cents bigint,
  last_synced_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, provider, provider_account_id)
);

insert into accounting_financial_accounts
  (company_id, ledger_account_id, provider, provider_account_id, display_name, institution_name, account_type)
select
  '00000000-0000-0000-0000-000000000001',
  id,
  'csv',
  'pba-operating-csv',
  'PBA operating account',
  'Statement import',
  'checking'
from accounting_accounts
where company_id = '00000000-0000-0000-0000-000000000001' and code = '1000'
on conflict (company_id, provider, provider_account_id) do nothing;

create table if not exists accounting_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  financial_account_id uuid not null references accounting_financial_accounts(id),
  provider_transaction_id text,
  fingerprint text not null,
  transaction_date date not null,
  posted_at timestamptz,
  description text not null,
  amount_cents bigint not null,
  currency text not null default 'usd',
  status text not null default 'unreviewed' check (status in ('unreviewed','matched','categorized','excluded')),
  matched_entity_type text,
  matched_entity_id uuid,
  raw_data jsonb,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);

create index if not exists accounting_bank_transactions_review_idx
  on accounting_bank_transactions(company_id, status, transaction_date desc);

create table if not exists accounting_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  financial_account_id uuid not null references accounting_financial_accounts(id),
  statement_ending_date date not null,
  statement_ending_balance_cents bigint not null,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  unique (financial_account_id, statement_ending_date)
);

create table if not exists accounting_bill_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  bill_id uuid not null references accounting_bills(id),
  payment_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  bank_transaction_id uuid references accounting_bank_transactions(id),
  posted_journal_entry_id uuid not null references accounting_journal_entries(id),
  created_at timestamptz not null default now()
);

create index if not exists accounting_bill_payments_bill_idx
  on accounting_bill_payments(bill_id, payment_date);

create table if not exists accounting_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  entity_type text not null check (entity_type in ('expense','bill','vendor','invoice','bank_transaction')),
  entity_id uuid not null,
  object_key text not null unique,
  filename text not null,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists accounting_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  financial_account_id uuid references accounting_financial_accounts(id),
  source text not null check (source in ('stripe','csv')),
  filename text,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists accounting_processed_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table if not exists accounting_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references accounting_companies(id),
  actor_email text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists accounting_audit_events_created_idx
  on accounting_audit_events(company_id, created_at desc);
