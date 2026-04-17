-- Tighten admin_all and related admin-read RLS policies so that an
-- admin of tenant A cannot read or mutate tenant B's rows via the
-- authenticated-role JWT (PostgREST client-side queries). This was
-- flagged in hooks/useData.js as a known leak:
--
-- > the RLS `admin_all` policy on members/bookings/etc. (EXISTS in
-- > admins by user_id only, no tenant check) lets any authenticated
-- > admin see every tenant's rows.
--
-- Today the client-side code works around it by appending
-- `?tenant_id=eq.<id>` to every query in useData.js, but that's
-- "remember to filter" — a future refactor that forgets would re-
-- introduce the leak. These policies make the DB enforce isolation
-- so client mistakes can't leak data.
--
-- Service-role API routes are unaffected (service_role bypasses RLS).
-- Every API route in pages/api/* already filters by tenant_id via
-- verifyAdmin; this migration only affects the authenticated-role
-- path used by useData.js and similar direct PostgREST reads.
--
-- The predicate pattern:
--   EXISTS (SELECT 1 FROM admins
--           WHERE admins.user_id = auth.uid()
--             AND admins.tenant_id = <target_table>.tenant_id)
--
-- The sub-select against admins is itself RLS-filtered by
-- admin_self_read (user_id = auth.uid()), so the lookup succeeds only
-- for the authenticated admin's own row(s).

-- ── members ──
drop policy if exists admin_all on public.members;
create policy admin_all on public.members
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = members.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = members.tenant_id
    )
  );

-- ── bookings ──
drop policy if exists admin_all on public.bookings;
create policy admin_all on public.bookings
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = bookings.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = bookings.tenant_id
    )
  );

-- ── payments ──
drop policy if exists admin_all on public.payments;
create policy admin_all on public.payments
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = payments.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = payments.tenant_id
    )
  );

-- ── tier_config ──
drop policy if exists admin_all on public.tier_config;
create policy admin_all on public.tier_config
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = tier_config.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = tier_config.tenant_id
    )
  );

-- ── access_code_jobs (two separate policies for SELECT and UPDATE) ──
drop policy if exists "admin read access_code_jobs" on public.access_code_jobs;
create policy "admin read access_code_jobs" on public.access_code_jobs
  for select to public
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = access_code_jobs.tenant_id
    )
  );

drop policy if exists "admin update access_code_jobs" on public.access_code_jobs;
create policy "admin update access_code_jobs" on public.access_code_jobs
  for update to public
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = access_code_jobs.tenant_id
    )
  );

-- ── email_config ──
drop policy if exists admins_manage_email_config on public.email_config;
create policy admins_manage_email_config on public.email_config
  for all to public
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = email_config.tenant_id
    )
  );

-- ── email_logs ──
drop policy if exists admins_read_email_logs on public.email_logs;
create policy admins_read_email_logs on public.email_logs
  for select to public
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = email_logs.tenant_id
    )
  );

-- Not touched by this migration:
--   * app_settings.admin_all — app_settings has no tenant_id (it
--     stores per-admin personal dashboard preferences, keyed by
--     user_id). Cross-tenant leak is not meaningful for that table.
--   * webhook_debug_log — no tenant_id column, no fix possible here.
--   * tenant_isolation policies — already correctly tenant-scoped via
--     `current_setting('app.tenant_id')`. Leaving untouched.
