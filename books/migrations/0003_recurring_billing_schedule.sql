alter table accounting_invoices
  add column if not exists billing_day smallint
    check (billing_day is null or billing_day between 1 and 28);
alter table accounting_invoices add column if not exists stripe_setup_checkout_url text;
alter table accounting_invoices add column if not exists stripe_setup_checkout_expires_at timestamptz;
alter table accounting_invoices add column if not exists payment_method_setup_at timestamptz;
