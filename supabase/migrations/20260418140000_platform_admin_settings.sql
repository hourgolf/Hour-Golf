-- Per-platform-admin UI preferences.
--
-- Deliberately NOT reusing app_settings, which was just migrated to
-- (user_id, tenant_id) scope. Platform admins operate across all
-- tenants; their personal prefs for the super-admin console should
-- persist regardless of which tenant's subdomain they're currently
-- looking at. A dedicated table also keeps tenant-admin prefs and
-- platform-admin prefs from sharing a shape as they diverge (the
-- platform surface will grow its own keys: accent, density,
-- sidebar-collapsed, etc.).
--
-- Keyed only by user_id. Settings are an opaque JSONB blob so the
-- schema doesn't need a migration every time we add a toggle.

create table if not exists public.platform_admin_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Touch trigger: keep updated_at honest without relying on callers
-- to set it. Mirrors public.app_settings_touch.
create or replace function public.platform_admin_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_admin_settings_touch on public.platform_admin_settings;
create trigger platform_admin_settings_touch
  before update on public.platform_admin_settings
  for each row execute function public.platform_admin_settings_touch();

-- RLS: only platform admins can read/write, and only their own row.
alter table public.platform_admin_settings enable row level security;

drop policy if exists platform_admin_self on public.platform_admin_settings;
create policy platform_admin_self on public.platform_admin_settings
  for all
  using (
    user_id = auth.uid()
    and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  );
