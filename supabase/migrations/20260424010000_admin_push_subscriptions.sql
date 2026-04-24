-- Admin PWA push-notification subscriptions.
--
-- One row per (device, browser) that an admin has opted-in on. Same
-- admin user can have multiple — their laptop Chrome + their phone
-- Safari are two separate subscriptions.
--
-- Fields come straight from the browser's PushSubscription object:
--   endpoint    the push service URL (Apple APNs / Google FCM / etc)
--   p256dh_key  client's public ECDH key (base64url)
--   auth_key    client's auth secret (base64url)
--
-- `endpoint` is globally unique — if the same subscription re-
-- registers (e.g. after a permission flip), the upsert path should
-- no-op. We tie rows to (tenant, user) so lookups for "who gets
-- this notification" stay cheap.

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Fast "who to notify for this tenant?" lookup.
create index if not exists idx_admin_push_subs_tenant
  on public.admin_push_subscriptions (tenant_id);

-- Per-user cleanup (when an admin revokes from one device).
create index if not exists idx_admin_push_subs_user
  on public.admin_push_subscriptions (tenant_id, user_id);

alter table public.admin_push_subscriptions enable row level security;

-- Tenant-scoped admin_all: an admin can manage their own tenant's
-- subscription rows. Service-role (API routes) bypasses RLS for
-- writes, which is fine — we always gate the API routes with
-- verifyAdmin(req) first.
drop policy if exists admin_all on public.admin_push_subscriptions;
create policy admin_all on public.admin_push_subscriptions
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = admin_push_subscriptions.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = admin_push_subscriptions.tenant_id
    )
  );
