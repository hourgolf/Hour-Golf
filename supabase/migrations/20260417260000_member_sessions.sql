-- Multi-device member sessions (Tier 2).
--
-- Before this migration, a member's active session was stored as two
-- scalar columns on members: session_token + session_expires_at. Logging
-- in on device B overwrote device A's token, invalidating A. With this
-- table, a member can hold any number of concurrent sessions.
--
-- Rollout is staged. This migration ships the table + backfill only.
-- The API layer keeps writing to the scalar columns as a fallback so
-- existing readers (19 files) continue to work unchanged. A follow-up
-- PR migrates each reader to a new helper, then drops the scalar columns.
--
-- Schema:
--   token           Random 64-hex from crypto.randomBytes(32). Primary key
--                   because every caller looks up by token from a cookie.
--   member_id       FK to members.id (ON DELETE CASCADE so deleting a
--                   member cleans up their sessions).
--   tenant_id       Denormalized from members.tenant_id for fast tenant-
--                   scoped reads without an extra join. Enforced by
--                   app-level code (insert always copies from member).
--   expires_at      TTL. 7d default, 90d on remember-me. A daily cron will
--                   eventually delete expired rows.
--   created_at      When this session began. Shown in a future "sessions"
--                   UI for members to audit/revoke.
--   last_used_at    Touched on every authenticated request (best effort).
--                   Powers an "inactive sessions" culling rule later.
--   user_agent      Debugging + future UI.
--   ip_address      Debugging + future UI. Truncated by caller if needed.

create table if not exists public.member_sessions (
  token text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  user_agent text,
  ip_address text
);

create index if not exists member_sessions_member_id_idx
  on public.member_sessions(member_id);

create index if not exists member_sessions_tenant_id_idx
  on public.member_sessions(tenant_id);

-- Supports the cron that purges expired rows and sessions-by-age reports.
create index if not exists member_sessions_expires_at_idx
  on public.member_sessions(expires_at);

-- Service-role-only: same RLS posture as tenant_stripe_config and
-- tenant_seam_config. API routes use SUPABASE_SERVICE_ROLE_KEY which
-- bypasses RLS. The anon key has no access. Supabase advisor will flag
-- this at INFO level — intentional.
alter table public.member_sessions enable row level security;

-- One-shot backfill: any member with a non-null, not-yet-expired scalar
-- session_token becomes a row in member_sessions. We only backfill the
-- unexpired ones so we don't pollute the new table with stale tokens.
-- Fresh sessions will be dual-written by member-auth.js going forward.
insert into public.member_sessions (token, member_id, tenant_id, expires_at, created_at)
select session_token, id, tenant_id, session_expires_at, now()
from public.members
where session_token is not null
  and session_expires_at is not null
  and session_expires_at > now()
on conflict (token) do nothing;
