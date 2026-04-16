-- Rollback for 20260417000000_multitenant_foundation.sql
--
-- DO NOT RUN unless Phase 1 needs to be reverted. This DROPs the tenant_id
-- columns and the new tenant tables. No data is preserved.
--
-- Safe to run only if:
--   * No Phase 2 middleware / code changes have been deployed
--   * No non-Hour-Golf tenants exist
--
-- Dropping a column with a FK is non-trivial if anything references it;
-- this script assumes nothing outside Phase 1 depends on these columns.

begin;

-- Drop triggers
drop trigger if exists tenants_set_updated_at on public.tenants;
drop trigger if exists tenant_branding_set_updated_at on public.tenant_branding;
drop trigger if exists tenant_features_set_updated_at on public.tenant_features;
drop function if exists public.set_tenant_updated_at();

-- Drop tenant_id columns (indexes drop with them via CASCADE)
alter table public.loyalty_ledger drop column if exists tenant_id cascade;
alter table public.loyalty_rules drop column if exists tenant_id cascade;
alter table public.shop_credits drop column if exists tenant_id cascade;
alter table public.shop_cart drop column if exists tenant_id cascade;
alter table public.shop_orders drop column if exists tenant_id cascade;
alter table public.shop_items drop column if exists tenant_id cascade;
alter table public.event_comments drop column if exists tenant_id cascade;
alter table public.event_popup_dismissals drop column if exists tenant_id cascade;
alter table public.event_registrations drop column if exists tenant_id cascade;
alter table public.event_interests drop column if exists tenant_id cascade;
alter table public.events drop column if exists tenant_id cascade;
alter table public.member_preferences drop column if exists tenant_id cascade;
alter table public.email_logs drop column if exists tenant_id cascade;
alter table public.email_config drop column if exists tenant_id cascade;
alter table public.access_code_jobs drop column if exists tenant_id cascade;
alter table public.admins drop column if exists tenant_id cascade;
alter table public.payments drop column if exists tenant_id cascade;
alter table public.tier_config drop column if exists tenant_id cascade;
alter table public.bookings drop column if exists tenant_id cascade;
alter table public.members drop column if exists tenant_id cascade;

-- Drop tenant tables (order matters: children before parents)
drop table if exists public.platform_admin_sessions cascade;
drop table if exists public.platform_admins cascade;
drop table if exists public.tenant_features cascade;
drop table if exists public.tenant_branding cascade;
drop table if exists public.tenants cascade;

commit;
