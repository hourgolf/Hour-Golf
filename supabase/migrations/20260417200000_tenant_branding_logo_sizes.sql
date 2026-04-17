-- Per-slot logo size preset (S/M/L). The actual pixel dimensions live
-- in the UI layer so the platform can keep layouts predictable —
-- tenants pick a bucket, the render site applies the right max-height.
--
-- Using a text + CHECK instead of an enum so it's easy to extend
-- later (e.g. 'xs'/'xl') without a migration dance.

alter table public.tenant_branding
  add column if not exists welcome_logo_size text not null default 'm',
  add column if not exists header_logo_size text not null default 'm',
  add column if not exists icon_size text not null default 'm';

alter table public.tenant_branding
  drop constraint if exists tenant_branding_welcome_logo_size_check;
alter table public.tenant_branding
  add constraint tenant_branding_welcome_logo_size_check
  check (welcome_logo_size in ('s', 'm', 'l'));

alter table public.tenant_branding
  drop constraint if exists tenant_branding_header_logo_size_check;
alter table public.tenant_branding
  add constraint tenant_branding_header_logo_size_check
  check (header_logo_size in ('s', 'm', 'l'));

alter table public.tenant_branding
  drop constraint if exists tenant_branding_icon_size_check;
alter table public.tenant_branding
  add constraint tenant_branding_icon_size_check
  check (icon_size in ('s', 'm', 'l'));
