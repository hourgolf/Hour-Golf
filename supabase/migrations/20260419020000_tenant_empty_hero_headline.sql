-- Member dashboard's empty-state hero headline. The default "Ready to
-- swing?" copy is golf-specific and bleeds Hour Golf's voice into any
-- non-golf tenant's portal. Add a tenant-configurable column so each
-- venue can match its own modality (Ready to play? Ready to court? etc).
--
-- NULL = use the platform default ("Ready to play?" — generic enough
-- to read sensibly for golf, squash, sims, courts). HG retains its
-- existing voice by being seeded with "Ready to swing?".

alter table public.tenant_branding
  add column if not exists dashboard_empty_headline text;

alter table public.tenant_branding
  drop constraint if exists tenant_branding_dashboard_empty_headline_len;
alter table public.tenant_branding
  add constraint tenant_branding_dashboard_empty_headline_len
  check (dashboard_empty_headline is null or char_length(dashboard_empty_headline) <= 80);

update public.tenant_branding
   set dashboard_empty_headline = 'Ready to swing?'
 where tenant_id = '11111111-1111-4111-8111-111111111111';
