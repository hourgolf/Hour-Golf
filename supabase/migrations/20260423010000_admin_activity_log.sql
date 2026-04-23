-- Admin activity log: append-only audit trail of "who did what when"
-- for admin-initiated mutations. Powers the Recent activity card in
-- DetailView and the Activity sub-section on ReportsView. Operators
-- repeatedly asked "who cancelled that booking?" and "when did
-- so-and-so get upgraded?" — this closes the gap.
--
-- Scope: admin-triggered actions only. Member-initiated actions
-- (self-serve booking, shop checkout, subscription flips via Stripe
-- webhook) are intentionally out of scope — those already have paper
-- trails elsewhere (bookings, payments, Stripe dashboard). Keeping
-- member code paths untouched means this migration has zero effect
-- on members.
--
-- Write path: lib/activity-log.js (service role, fire-and-forget).
-- Read path: useData via authenticated role + admin_all policy.
--
-- Columns:
--   actor_user_id    auth.users.id of the admin who took the action
--   actor_email      cached email at write time (survives admin email
--                    changes; useful because auth.users is not joinable
--                    via PostgREST without extra setup)
--   action           dotted identifier: "booking.cancelled",
--                    "member.tier_changed", "overage.charged", etc.
--   target_type      "booking" | "member" | "tier" | "event" |
--                    "shop_item" | "shop_request" | "settings"
--   target_id        natural key (booking uuid, member email, tier id)
--                    stored as text so heterogeneous targets fit
--   metadata         jsonb with action-specific context:
--                      booking.cancelled → { member_email, start, end,
--                        bay, reason }
--                      member.tier_changed → { from, to }

create table if not exists public.admin_activity_log (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Timeline reads (Activity sub-section, newest first).
create index if not exists idx_admin_activity_log_tenant_created
  on public.admin_activity_log (tenant_id, created_at desc);

-- Per-entity history (DetailView card: "recent activity for this member").
create index if not exists idx_admin_activity_log_target
  on public.admin_activity_log (tenant_id, target_type, target_id, created_at desc)
  where target_type is not null and target_id is not null;

alter table public.admin_activity_log enable row level security;

-- Tenant-scoped admin_all: admin of tenant A can read/write only
-- tenant A's rows via authenticated-role queries. Service-role writes
-- from lib/activity-log.js bypass RLS. Follows the pattern in
-- 20260417210000_admin_all_tenant_scoped.sql.
drop policy if exists admin_all on public.admin_activity_log;
create policy admin_all on public.admin_activity_log
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = admin_activity_log.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = admin_activity_log.tenant_id
    )
  );
