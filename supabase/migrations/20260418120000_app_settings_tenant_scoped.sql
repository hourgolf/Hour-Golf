-- Scope app_settings per-tenant-per-user.
--
-- Before: app_settings had a single row per user_id. Admins working
-- across tenants (today only matt@multifresh.com when testing from the
-- platform console) saw the same accent color/logo/font prefs on every
-- tenant they logged into. That's visually jarring — an admin who
-- themed Hour Golf's admin in forest green would then see green accents
-- on Parts Dept's admin, which has nothing to do with HG branding.
--
-- After: composite PK (user_id, tenant_id). Each admin-tenant pairing
-- gets its own prefs row. Same user admin-ing two tenants has two rows.
--
-- Migration steps:
--   1. Add nullable tenant_id column with FK to tenants.
--   2. Backfill: each existing row inherits the tenant_id of that
--      user's first admins entry. Every current row's user has exactly
--      one admin tenant (verified by hand), so this is deterministic.
--   3. Drop any rows where backfill couldn't resolve a tenant (orphans
--      from users who lost admin status between setting save and migration).
--   4. Make tenant_id NOT NULL.
--   5. Swap the primary key.
--   6. Tighten the admin_all RLS policy to require the admin's tenant to
--      match the row's tenant — prevents a user from writing a settings
--      row for a tenant they don't admin. Previously the policy only
--      checked "is the caller an admin somewhere", which sufficed when
--      rows were keyed by user_id alone. With tenant_id in the key, we
--      need a tighter check.

-- 1. Add column
alter table public.app_settings
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

-- 2. Backfill
update public.app_settings s
set tenant_id = (
  select a.tenant_id
  from public.admins a
  where a.user_id = s.user_id
  order by a.created_at nulls last
  limit 1
)
where s.tenant_id is null;

-- 3. Drop orphans
delete from public.app_settings where tenant_id is null;

-- 4. NOT NULL
alter table public.app_settings alter column tenant_id set not null;

-- 5. PK swap
alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings add primary key (user_id, tenant_id);

-- Support the tenant-matching subquery in the RLS policy.
create index if not exists app_settings_tenant_id_idx
  on public.app_settings(tenant_id);

-- 6. Tighten RLS
drop policy if exists admin_all on public.app_settings;
create policy admin_all on public.app_settings
  for all
  using (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
        and a.tenant_id = app_settings.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins a
      where a.user_id = auth.uid()
        and a.tenant_id = app_settings.tenant_id
    )
  );
