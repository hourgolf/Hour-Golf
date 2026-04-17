-- Phase 2C: Lock down the multi-tenant foundation
--
-- Three hardening changes:
--
--   1. Drop DEFAULT '11111111-1111-4111-8111-111111111111' on 19 tenant_id
--      columns. Every API insert is now explicit (verified: zero NULL
--      tenant_ids after full Phase 2B smoke-test). Without the DEFAULT,
--      future buggy inserts fail loudly instead of silently landing on
--      Hour Golf.
--
--   2. EXCEPTION: bookings.tenant_id keeps its DEFAULT until Skedda/Zapier
--      are removed (1–3 month horizon). booking-webhook.js inserts bookings
--      without setting tenant_id explicitly; we agreed not to edit that
--      deprecated file. When Skedda leaves, delete booking-webhook.js and
--      run a small follow-up migration to drop the bookings DEFAULT.
--
--   3. Enable Row Level Security on all tenant-scoped tables with policies
--      that filter by `current_setting('app.tenant_id', true)::uuid`.
--      Service-role key (what every API route uses) bypasses RLS, so zero
--      behavior change today. RLS becomes the belt-and-suspenders layer for
--      any future code that uses the anon key directly.
--
-- Wrapped in BEGIN/COMMIT — any failure rolls back the whole migration.

begin;

-- ============================================================================
-- 1. Drop DEFAULTs on tenant_id columns (except bookings — see note above)
-- ============================================================================

alter table public.members              alter column tenant_id drop default;
alter table public.tier_config          alter column tenant_id drop default;
alter table public.payments             alter column tenant_id drop default;
alter table public.admins               alter column tenant_id drop default;
alter table public.access_code_jobs     alter column tenant_id drop default;
alter table public.email_config         alter column tenant_id drop default;
alter table public.email_logs           alter column tenant_id drop default;
alter table public.member_preferences   alter column tenant_id drop default;
alter table public.events               alter column tenant_id drop default;
alter table public.event_interests      alter column tenant_id drop default;
alter table public.event_registrations  alter column tenant_id drop default;
alter table public.event_popup_dismissals alter column tenant_id drop default;
alter table public.event_comments       alter column tenant_id drop default;
alter table public.shop_items           alter column tenant_id drop default;
alter table public.shop_orders          alter column tenant_id drop default;
alter table public.shop_cart            alter column tenant_id drop default;
alter table public.shop_credits         alter column tenant_id drop default;
alter table public.loyalty_rules        alter column tenant_id drop default;
alter table public.loyalty_ledger       alter column tenant_id drop default;

-- bookings.tenant_id DEFAULT intentionally KEPT until Skedda removal.
-- Delete this comment and run `alter table public.bookings alter column
-- tenant_id drop default` in a follow-up migration once booking-webhook.js
-- is removed.

-- ============================================================================
-- 2. Enable RLS + tenant-scoped policies on all tenant-scoped tables
-- ============================================================================
--
-- Policy model: `tenant_id = current_setting('app.tenant_id', true)::uuid`
--
-- Service-role key bypasses RLS entirely, which is what every API route uses
-- today. These policies only affect queries issued with the anon key or
-- authenticated (user JWT) key.
--
-- Every policy uses FOR ALL because filters apply equally to SELECT, INSERT,
-- UPDATE, and DELETE. The `current_setting(..., true)` form returns NULL (not
-- error) when the GUC is unset, so policies don't crash if tenant context
-- isn't established — they simply reject the query.

-- Helper: single policy per table, kept consistent by construction.
-- (No function needed; inlining the predicate is cleaner.)

-- members
alter table public.members enable row level security;
drop policy if exists tenant_isolation on public.members;
create policy tenant_isolation on public.members
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- bookings
alter table public.bookings enable row level security;
drop policy if exists tenant_isolation on public.bookings;
create policy tenant_isolation on public.bookings
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- tier_config
alter table public.tier_config enable row level security;
drop policy if exists tenant_isolation on public.tier_config;
create policy tenant_isolation on public.tier_config
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- payments
alter table public.payments enable row level security;
drop policy if exists tenant_isolation on public.payments;
create policy tenant_isolation on public.payments
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- admins
alter table public.admins enable row level security;
drop policy if exists tenant_isolation on public.admins;
create policy tenant_isolation on public.admins
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- access_code_jobs
alter table public.access_code_jobs enable row level security;
drop policy if exists tenant_isolation on public.access_code_jobs;
create policy tenant_isolation on public.access_code_jobs
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- email_config
alter table public.email_config enable row level security;
drop policy if exists tenant_isolation on public.email_config;
create policy tenant_isolation on public.email_config
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- email_logs
alter table public.email_logs enable row level security;
drop policy if exists tenant_isolation on public.email_logs;
create policy tenant_isolation on public.email_logs
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- member_preferences
alter table public.member_preferences enable row level security;
drop policy if exists tenant_isolation on public.member_preferences;
create policy tenant_isolation on public.member_preferences
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- events
alter table public.events enable row level security;
drop policy if exists tenant_isolation on public.events;
create policy tenant_isolation on public.events
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- event_interests
alter table public.event_interests enable row level security;
drop policy if exists tenant_isolation on public.event_interests;
create policy tenant_isolation on public.event_interests
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- event_registrations
alter table public.event_registrations enable row level security;
drop policy if exists tenant_isolation on public.event_registrations;
create policy tenant_isolation on public.event_registrations
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- event_popup_dismissals
alter table public.event_popup_dismissals enable row level security;
drop policy if exists tenant_isolation on public.event_popup_dismissals;
create policy tenant_isolation on public.event_popup_dismissals
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- event_comments
alter table public.event_comments enable row level security;
drop policy if exists tenant_isolation on public.event_comments;
create policy tenant_isolation on public.event_comments
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- shop_items
alter table public.shop_items enable row level security;
drop policy if exists tenant_isolation on public.shop_items;
create policy tenant_isolation on public.shop_items
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- shop_orders
alter table public.shop_orders enable row level security;
drop policy if exists tenant_isolation on public.shop_orders;
create policy tenant_isolation on public.shop_orders
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- shop_cart
alter table public.shop_cart enable row level security;
drop policy if exists tenant_isolation on public.shop_cart;
create policy tenant_isolation on public.shop_cart
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- shop_credits
alter table public.shop_credits enable row level security;
drop policy if exists tenant_isolation on public.shop_credits;
create policy tenant_isolation on public.shop_credits
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- loyalty_rules
alter table public.loyalty_rules enable row level security;
drop policy if exists tenant_isolation on public.loyalty_rules;
create policy tenant_isolation on public.loyalty_rules
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- loyalty_ledger
alter table public.loyalty_ledger enable row level security;
drop policy if exists tenant_isolation on public.loyalty_ledger;
create policy tenant_isolation on public.loyalty_ledger
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

commit;

-- ============================================================================
-- Verification queries (run separately):
--
-- -- All tenant columns except bookings should show column_default = NULL
-- select table_name, column_name, column_default
-- from information_schema.columns
-- where table_schema = 'public' and column_name = 'tenant_id'
-- order by table_name;
--
-- -- All tenant tables should show rowsecurity = true
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public' and tablename in (
--   'members','bookings','tier_config','payments','admins',
--   'access_code_jobs','email_config','email_logs','member_preferences',
--   'events','event_interests','event_registrations','event_popup_dismissals',
--   'event_comments','shop_items','shop_orders','shop_cart','shop_credits',
--   'loyalty_rules','loyalty_ledger'
-- )
-- order by tablename;
--
-- -- Service-role key still bypasses RLS, so existing API routes work unchanged.
-- -- Verify by running a normal `select count(*) from members` from the app.
-- ============================================================================
