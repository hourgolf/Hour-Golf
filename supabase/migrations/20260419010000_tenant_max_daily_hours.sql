-- Add a tenant-configurable per-day usage cap so members extending an
-- in-flight booking from the dashboard hero can be stopped at a
-- sensible limit. Distinct from tier_config.included_hours (which is
-- a monthly allowance) — this is a hard daily ceiling enforced
-- server-side by /api/member-extend-booking and (later) by the booking
-- create flow.
--
-- Storage choice: tenant_branding (not tenants or a new table) for the
-- same reason cancel_cutoff_hours lives there — it's an operational
-- setting the admin-tenant-branding editor already loads/saves, and
-- it gets injected into the SSR branding payload so the client can
-- pre-validate before round-tripping the API.
--
-- NULL = no cap. HG ships uncapped initially; the operator opts in by
-- setting a number (e.g. 4 for "members can play up to 4 hours per day,
-- regardless of tier").

alter table public.tenant_branding
  add column if not exists max_daily_hours_per_member numeric;

-- Keep values sane: non-negative, capped at 24h/day. NULL stays
-- explicit-no-limit and is preserved.
alter table public.tenant_branding
  drop constraint if exists tenant_branding_max_daily_hours_check;
alter table public.tenant_branding
  add constraint tenant_branding_max_daily_hours_check
  check (max_daily_hours_per_member is null
         or (max_daily_hours_per_member >= 0 and max_daily_hours_per_member <= 24));
