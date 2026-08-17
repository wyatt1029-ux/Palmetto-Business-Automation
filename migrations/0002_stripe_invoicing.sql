alter table sow_versions add column if not exists stripe_invoice_id text;
alter table sow_versions add column if not exists stripe_hosted_invoice_url text;
create unique index if not exists sow_versions_stripe_invoice_idx
  on sow_versions (stripe_invoice_id) where stripe_invoice_id is not null;
