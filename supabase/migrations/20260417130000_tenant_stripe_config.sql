-- Phase 7A — Per-tenant Stripe foundation
--
-- Adds `public.tenant_stripe_config` to hold each tenant's Stripe keys.
-- Every Stripe API call in the app today goes through a single account via
-- `process.env.STRIPE_SECRET_KEY`. This table is the foundation for
-- migrating those 12 routes to tenant-scoped Stripe clients in Phase 7B.
--
-- Safety:
--   * Additive only — new table, no changes to existing tables.
--   * Zero behavior change. No code reads this table yet.
--   * Hour Golf keys must be seeded after deploy via a separate INSERT
--     (run by the user in the Supabase SQL editor, keys not in git).
--
-- Security:
--   * RLS enabled with NO policies. Matches the precedent for
--     platform_admins, platform_admin_sessions, and tenant_features:
--     service_role bypasses RLS; anon and authenticated roles get nothing.
--   * Secret key is stored as plain text in a service-role-only row.
--     Acceptable for MVP per multi-tenant SaaS norms. Future upgrade path
--     is Supabase Vault / pgsodium (tracked as tech debt).

begin;

-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.tenant_stripe_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  secret_key text not null,
  publishable_key text not null,
  webhook_secret text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenant_stripe_config is
  'Per-tenant Stripe account keys. Service-role-only (RLS on, no policies). '
  'Populated by super-admin. Consumed by API routes via lib/stripe-config.js '
  'getStripeClient(tenantId).';

comment on column public.tenant_stripe_config.mode is
  'test or live — so different tenants can be on different modes while we roll out.';

comment on column public.tenant_stripe_config.secret_key is
  'Stripe sk_live_... or sk_test_... — NEVER expose to the client. Service role only.';

comment on column public.tenant_stripe_config.webhook_secret is
  'Stripe whsec_... for webhook signature verification. Nullable so rows can be '
  'created before the tenant configures their webhook endpoint.';

comment on column public.tenant_stripe_config.enabled is
  'Kill switch. When false, getStripeClient() throws and payment routes should '
  'return a feature-disabled error without deleting the keys.';

-- ============================================================================
-- Trigger: auto-update updated_at
-- ============================================================================

drop trigger if exists tenant_stripe_config_set_updated_at on public.tenant_stripe_config;
create trigger tenant_stripe_config_set_updated_at
  before update on public.tenant_stripe_config
  for each row execute function public.set_tenant_updated_at();

-- ============================================================================
-- RLS: service-role only (no policies)
-- ============================================================================

alter table public.tenant_stripe_config enable row level security;

-- Explicitly no policies. Matches the pattern for platform_admins,
-- platform_admin_sessions, tenant_features. anon + authenticated roles
-- hit the RLS gate and get zero rows; service_role bypasses RLS entirely.
-- This will trigger an `rls_enabled_no_policy` INFO advisor warning —
-- intentional and expected.

commit;
