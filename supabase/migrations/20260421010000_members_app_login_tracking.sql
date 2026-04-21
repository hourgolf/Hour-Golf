-- Track when each member first + last authenticated into the new app so
-- the admin can see launch-day adoption at a glance. Backfills from
-- member_sessions so the "ever logged in" state matches reality on day 0
-- of the launch push, not "starting from this migration forward".

alter table public.members add column if not exists first_app_login_at timestamptz;
alter table public.members add column if not exists last_app_login_at timestamptz;

-- Primary backfill: use the member_sessions table (the source of truth
-- since 2026-04-17).
update public.members m
set first_app_login_at = s.first_session,
    last_app_login_at = s.last_session
from (
  select member_id,
         min(created_at) as first_session,
         greatest(max(last_used_at), max(created_at)) as last_session
  from public.member_sessions
  group by member_id
) s
where s.member_id = m.id
  and m.first_app_login_at is null;

-- Secondary backfill: legacy scalar column (member_sessions didn't exist
-- before 2026-04-17). If a member's session_expires_at was ever set,
-- they logged in at least once. Approximate first/last from that single
-- timestamp — not ideal but better than leaving them invisible.
update public.members
set last_app_login_at = coalesce(last_app_login_at, session_expires_at),
    first_app_login_at = coalesce(first_app_login_at, session_expires_at)
where last_app_login_at is null
  and session_expires_at is not null;

create index if not exists idx_members_tenant_first_login
  on public.members (tenant_id, first_app_login_at)
  where first_app_login_at is not null;
