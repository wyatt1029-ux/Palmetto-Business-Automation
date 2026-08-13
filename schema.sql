create sequence if not exists pba_customer_number_seq start 1001;

create table if not exists intake_submissions (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique default (
    'PBA-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('pba_customer_number_seq')::text, 6, '0')
  ),
  full_name text not null,
  email text not null,
  organization text not null,
  role text not null,
  problem text not null,
  outcomes text not null,
  users text not null,
  current_workflow text not null,
  integrations text,
  features text not null,
  constraints text,
  context text,
  timeline text not null,
  budget text not null,
  decision_process text,
  idempotency_key text not null unique,
  status text not null default 'new' check (status in ('new','under_review','needs_clarification','qualified','declined','converted_to_sow')),
  revision_token_hash text not null unique,
  revision_token_expires_at timestamptz not null,
  internal_notes text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intake_submissions_email_idx on intake_submissions (lower(email));
create index if not exists intake_submissions_status_idx on intake_submissions (status, created_at desc);

create table if not exists sow_versions (
  id uuid primary key default gen_random_uuid(),
  intake_submission_id uuid not null references intake_submissions(id) on delete cascade,
  version_number integer not null,
  title text not null,
  client_name text not null,
  client_email text not null,
  content jsonb not null,
  amount_cents integer not null check (amount_cents >= 50),
  billing_type text not null default 'recurring_monthly' check (billing_type in ('one_time','recurring_monthly')),
  payment_label text not null default 'Monthly service',
  payment_due_at date,
  payment_terms text not null,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','processing','paid','refunded','failed')),
  billing_status text not null default 'not_started' check (billing_status in ('not_started','active','past_due','canceled')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null default 'draft' check (status in ('draft','sent','changes_requested','approved','declined','superseded')),
  review_token_hash text unique,
  review_token_expires_at timestamptz,
  sent_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (intake_submission_id, version_number)
);

create table if not exists sow_approval_events (
  id uuid primary key default gen_random_uuid(),
  sow_version_id uuid not null references sow_versions(id) on delete cascade,
  action text not null check (action in ('sent','viewed','approved','changes_requested','declined')),
  signer_name text,
  signer_email text,
  notes text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists sow_versions_intake_idx on sow_versions (intake_submission_id, version_number desc);
create index if not exists sow_versions_status_idx on sow_versions (status, updated_at desc);
create index if not exists sow_approval_events_version_idx on sow_approval_events (sow_version_id, created_at);

create table if not exists payment_sessions (
  id uuid primary key default gen_random_uuid(),
  sow_version_id uuid not null references sow_versions(id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','processing','paid','expired','failed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists payment_sessions_sow_idx on payment_sessions (sow_version_id, created_at desc);

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table intake_submissions add column if not exists idempotency_key text;
create unique index if not exists intake_submissions_idempotency_idx
  on intake_submissions (idempotency_key) where idempotency_key is not null;
