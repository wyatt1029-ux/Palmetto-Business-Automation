create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  normalized_business_name text not null,
  website_url text,
  normalized_domain text,
  city text,
  service_area text,
  industry text,
  source text not null default 'researched',
  source_urls jsonb not null default '[]'::jsonb,
  public_phone text,
  public_email text,
  public_contact_form_url text,
  public_social_links jsonb not null default '[]'::jsonb,
  stage text not null default 'new' check (stage in ('new','contacted','discovery_scheduled','qualified','scope_sent','approved','paid_active','lost','not_a_fit','archived')),
  fit_level text not null default 'medium' check (fit_level in ('high','medium','low')),
  fit_reasons jsonb not null default '[]'::jsonb,
  services_interest jsonb not null default '[]'::jsonb,
  formation_date date,
  opened_date date,
  date_confidence text not null default 'unknown' check (date_confidence in ('confirmed','estimated','unknown')),
  discovered_date date,
  launch_signals jsonb not null default '[]'::jsonb,
  next_action text,
  next_action_due date,
  next_action_owner text,
  next_action_completed boolean not null default false,
  last_activity_date timestamptz,
  last_verified_date date,
  contact_status text not null default 'not_contacted' check (contact_status in ('not_contacted','attempted','replied','connected','do_not_contact')),
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  internal_notes text,
  archived boolean not null default false,
  tidal_conflict_review_required boolean not null default false,
  tidal_conflict_review_status text not null default 'not_needed' check (tidal_conflict_review_status in ('not_needed','pending','cleared','declined')),
  tidal_conflict_notes text,
  intake_submission_id uuid references intake_submissions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_name_domain_unique_idx
  on leads (normalized_business_name, coalesce(normalized_domain, ''));
create index if not exists leads_queue_idx on leads (archived, next_action_completed, next_action_due);
create index if not exists leads_stage_idx on leads (stage, updated_at desc);
create index if not exists leads_radar_idx on leads (discovered_date, fit_level, contact_status);
create index if not exists leads_domain_idx on leads (normalized_domain) where normalized_domain is not null;

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  activity_type text not null check (activity_type in ('research_added','call_attempted','email_drafted','email_sent_manually','replied','discovery_scheduled','discovery_completed','scope_sent','sow_accepted','payment_received','lost','not_a_fit','internal_note','inquiry_received')),
  note text not null,
  owner_email text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on lead_activities (lead_id, created_at desc);

alter table intake_submissions add column if not exists lead_id uuid references leads(id) on delete set null;
create index if not exists intake_submissions_lead_idx on intake_submissions (lead_id);
