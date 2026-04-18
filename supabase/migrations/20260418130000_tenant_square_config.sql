-- Per-tenant Square POS configuration and member linkage. Mirrors the
-- tenant_stripe_config / tenant_seam_config pattern: service-role-only
-- RLS, narrow secrets, plain-text storage.
--
-- Goal: enable Square Register POS scanning of member QR codes so that
-- in-store purchases can round-trip back into the app's loyalty /
-- activity surface. Square's scan lookup is by the `reference_id`
-- field on the Square customer record — we set reference_id to the
-- member UUID so the QR encodes a stable, globally-unique identifier.
--
-- Columns on tenant_square_config:
--   tenant_id       PK/FK to tenants, ON DELETE CASCADE.
--   environment     'sandbox' | 'production'. Determines the Square
--                   API base URL (sandbox for testing, production for
--                   live scans). Separate from Stripe's mode because
--                   Square sandbox and production accounts have
--                   independent credentials.
--   access_token    Square OAuth access token. Starts with EAAA... for
--                   production or EAAAE... for sandbox. Plain text,
--                   service-role only, never logged.
--   location_id     Square location UUID. Required for payments /
--                   orders lookups; a single Square account can have
--                   multiple locations (HG currently has one). Text
--                   rather than uuid because Square's format can
--                   include letters, digits, and mixed case.
--   application_id  Square application ID. Needed by the Square
--                   Terminal flow if we ever push orders; harmless to
--                   store for Phase 1.
--   webhook_signature_key
--                   Square webhook signing secret. Set once the
--                   tenant subscribes to Square webhooks. Used to
--                   verify payload authenticity in /api/square-webhook.
--   enabled         Kill switch independent of tenant_features. Pause
--                   Square sync without deleting creds.
--   created_at,
--   updated_at      Standard timestamps.

create table if not exists public.tenant_square_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  access_token text not null,
  location_id text not null,
  application_id text,
  webhook_signature_key text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_square_config enable row level security;
-- Intentionally zero policies. Service-role bypasses RLS; anon and
-- authenticated roles get no access. Same pattern as stripe/seam.

-- Auto-maintain updated_at on writes.
create or replace function public.tenant_square_config_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_square_config_set_updated_at on public.tenant_square_config;
create trigger tenant_square_config_set_updated_at
  before update on public.tenant_square_config
  for each row execute function public.tenant_square_config_set_updated_at();

-- Link each member to their Square customer record. Nullable so members
-- without a Square account yet (pre-backfill) still exist. Unique per
-- tenant because Square customer IDs are unique within one Square
-- account, and a tenant maps 1:1 to a Square account.
alter table public.members
  add column if not exists square_customer_id text;

create unique index if not exists idx_members_tenant_square_customer
  on public.members (tenant_id, square_customer_id)
  where square_customer_id is not null;

-- For the reverse lookup (Square webhook → find member by
-- square_customer_id within a tenant). The unique index above already
-- covers this query path, so no separate index needed.
