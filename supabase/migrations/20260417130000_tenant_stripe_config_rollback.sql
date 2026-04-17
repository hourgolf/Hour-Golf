-- Rollback for Phase 7A — tenant_stripe_config
--
-- Drops the table and its trigger. DATA LOSS: any tenant keys stored in
-- the table will be erased. Only run if reverting Phase 7A is the right call.
--
-- The shared trigger function public.set_tenant_updated_at() is NOT dropped
-- because other tables (tenants, tenant_branding, tenant_features) still
-- use it.

begin;

drop trigger if exists tenant_stripe_config_set_updated_at on public.tenant_stripe_config;
drop table if exists public.tenant_stripe_config cascade;

commit;
