-- Duplicate review is handled explicitly by the owner API. Keep a lookup
-- index for fast matching without preventing an owner-approved association or
-- separate record after review.
drop index if exists leads_name_domain_unique_idx;
create index if not exists leads_name_domain_lookup_idx
  on leads (normalized_business_name, coalesce(normalized_domain, ''));
