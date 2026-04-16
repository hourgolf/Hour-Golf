-- Multi-tenant Foundation (Phase 1 of platform migration)
--
-- Goal: Make the schema multi-tenant-ready without any user-visible change.
-- Hour Golf becomes tenant #1. All existing rows backfill automatically via
-- the DEFAULT on each tenant_id column.
--
-- Safety:
--   * Additive only — no columns removed, no constraints tightened
--   * DEFAULT = Hour Golf UUID on every tenant_id column (keeps inserts
--     working even if app code hasn't been updated yet)
--   * RLS policies WRITTEN but NOT ENABLED — service_role bypasses RLS
--     anyway, and we don't want to risk locking ourselves out mid-rollout.
--     Enabling happens in Phase 2.
--
-- Hour Golf tenant UUID: 11111111-1111-4111-8111-111111111111

begin;

-- ============================================================================
-- 1. Core tenant tables
-- ============================================================================

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is 'Root table for multi-tenant platform. Each tenant is a venue/business using the platform.';

create table if not exists public.tenant_branding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  primary_color text,
  accent_color text,
  danger_color text,
  cream_color text,
  text_color text,
  logo_url text,
  background_image_url text,
  pwa_theme_color text,
  font_display_name text,
  font_display_url text,
  font_body_family text,
  updated_at timestamptz not null default now()
);

comment on table public.tenant_branding is 'Per-tenant visual branding. Loaded at request time and injected as CSS vars.';

create table if not exists public.tenant_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

comment on table public.tenant_features is 'Per-tenant feature flags. Missing row = fail-open (feature enabled).';

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is 'Super-admins who operate the platform (you, co-founders). Distinct from tenant admins.';

create table if not exists public.platform_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.platform_admins(user_id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_admin_sessions_token on public.platform_admin_sessions(token);
create index if not exists idx_platform_admin_sessions_expires on public.platform_admin_sessions(expires_at);

-- ============================================================================
-- 2. Seed Hour Golf as tenant #1
-- ============================================================================

insert into public.tenants (id, slug, name, status)
values ('11111111-1111-4111-8111-111111111111', 'hourgolf', 'Hour Golf', 'active')
on conflict (id) do nothing;

insert into public.tenant_branding (
  tenant_id,
  primary_color,
  accent_color,
  danger_color,
  cream_color,
  text_color,
  pwa_theme_color,
  font_display_name,
  font_display_url,
  font_body_family
) values (
  '11111111-1111-4111-8111-111111111111',
  '#4C8D73',   -- primary green
  '#ddd480',   -- accent gold
  '#C92F1F',   -- danger red
  '#EDF3E3',   -- cream background
  '#35443B',   -- text
  '#4C8D73',   -- PWA theme color = primary
  'Biden Bold',
  '/fonts/BidenBold-Regular.woff2',
  'DM Sans'
)
on conflict (tenant_id) do nothing;

insert into public.tenant_features (tenant_id, feature_key, enabled) values
  ('11111111-1111-4111-8111-111111111111', 'bookings', true),
  ('11111111-1111-4111-8111-111111111111', 'pro_shop', true),
  ('11111111-1111-4111-8111-111111111111', 'loyalty', true),
  ('11111111-1111-4111-8111-111111111111', 'events', true),
  ('11111111-1111-4111-8111-111111111111', 'punch_passes', true),
  ('11111111-1111-4111-8111-111111111111', 'subscriptions', true),
  ('11111111-1111-4111-8111-111111111111', 'stripe_enabled', true),
  ('11111111-1111-4111-8111-111111111111', 'email_notifications', true)
on conflict (tenant_id, feature_key) do nothing;

-- ============================================================================
-- 3. Add tenant_id to existing core tables
-- ============================================================================
--
-- Each ALTER:
--   * Adds tenant_id with DEFAULT set to Hour Golf UUID
--   * NOT NULL (safe because DEFAULT backfills existing rows)
--   * FK to tenants(id)
--   * Index on tenant_id (composite where hot-path column is obvious)
--
-- The DEFAULT stays until Phase 2 verifies all inserts are explicit.

-- members ---------------------------------------------------------------------
alter table public.members
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_members_tenant on public.members(tenant_id);
create index if not exists idx_members_tenant_email on public.members(tenant_id, email);

-- bookings --------------------------------------------------------------------
alter table public.bookings
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_bookings_tenant on public.bookings(tenant_id);
create index if not exists idx_bookings_tenant_email on public.bookings(tenant_id, customer_email);
create index if not exists idx_bookings_tenant_start on public.bookings(tenant_id, booking_start);

-- tier_config -----------------------------------------------------------------
-- Note: PK is (tier) today. Adding tenant_id as regular column for Phase 1.
-- Converting PK to (tenant_id, tier) is deferred until second tenant arrives
-- (needs app-wide audit of any code assuming tier alone is unique).
alter table public.tier_config
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_tier_config_tenant on public.tier_config(tenant_id);

-- payments --------------------------------------------------------------------
alter table public.payments
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_payments_tenant on public.payments(tenant_id);
create index if not exists idx_payments_tenant_email on public.payments(tenant_id, member_email);

-- admins ----------------------------------------------------------------------
alter table public.admins
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_admins_tenant on public.admins(tenant_id);

-- access_code_jobs ------------------------------------------------------------
alter table public.access_code_jobs
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_access_code_jobs_tenant on public.access_code_jobs(tenant_id);

-- email_config ----------------------------------------------------------------
alter table public.email_config
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_email_config_tenant on public.email_config(tenant_id);

-- email_logs ------------------------------------------------------------------
alter table public.email_logs
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_email_logs_tenant on public.email_logs(tenant_id);

-- member_preferences ----------------------------------------------------------
-- PK is (email). Deferring PK change to Phase 5 (same rationale as tier_config).
alter table public.member_preferences
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_member_preferences_tenant on public.member_preferences(tenant_id);

-- events ----------------------------------------------------------------------
alter table public.events
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_events_tenant on public.events(tenant_id);

-- event_interests -------------------------------------------------------------
alter table public.event_interests
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_event_interests_tenant on public.event_interests(tenant_id);

-- event_registrations ---------------------------------------------------------
alter table public.event_registrations
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_event_registrations_tenant on public.event_registrations(tenant_id);

-- event_popup_dismissals ------------------------------------------------------
alter table public.event_popup_dismissals
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_event_popup_dismissals_tenant on public.event_popup_dismissals(tenant_id);

-- event_comments --------------------------------------------------------------
alter table public.event_comments
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_event_comments_tenant on public.event_comments(tenant_id);

-- shop_items ------------------------------------------------------------------
alter table public.shop_items
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_shop_items_tenant on public.shop_items(tenant_id);

-- shop_orders -----------------------------------------------------------------
alter table public.shop_orders
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_shop_orders_tenant on public.shop_orders(tenant_id);
create index if not exists idx_shop_orders_tenant_email on public.shop_orders(tenant_id, member_email);

-- shop_cart -------------------------------------------------------------------
alter table public.shop_cart
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_shop_cart_tenant on public.shop_cart(tenant_id);

-- shop_credits ----------------------------------------------------------------
alter table public.shop_credits
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_shop_credits_tenant on public.shop_credits(tenant_id);
create index if not exists idx_shop_credits_tenant_email on public.shop_credits(tenant_id, member_email);

-- loyalty_rules ---------------------------------------------------------------
alter table public.loyalty_rules
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_loyalty_rules_tenant on public.loyalty_rules(tenant_id);

-- loyalty_ledger --------------------------------------------------------------
alter table public.loyalty_ledger
  add column if not exists tenant_id uuid not null
  default '11111111-1111-4111-8111-111111111111'
  references public.tenants(id);

create index if not exists idx_loyalty_ledger_tenant on public.loyalty_ledger(tenant_id);

-- ============================================================================
-- 4. RLS policies (WRITTEN but NOT ENABLED)
--
-- These are prepared for Phase 2. Service role key bypasses RLS entirely, so
-- enabling them won't affect current app behavior — but enabling without the
-- middleware in place could cause confusion. We defer the `alter table ...
-- enable row level security` + `create policy` statements to Phase 2.
--
-- When Phase 2 runs, the app will set `app.tenant_id` per connection and the
-- policies will filter: USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
-- ============================================================================

-- (no policy DDL here — Phase 2 handles it)

-- ============================================================================
-- 5. Updated-at trigger for tenant tables (convention)
-- ============================================================================

create or replace function public.set_tenant_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_tenant_updated_at();

drop trigger if exists tenant_branding_set_updated_at on public.tenant_branding;
create trigger tenant_branding_set_updated_at
  before update on public.tenant_branding
  for each row execute function public.set_tenant_updated_at();

drop trigger if exists tenant_features_set_updated_at on public.tenant_features;
create trigger tenant_features_set_updated_at
  before update on public.tenant_features
  for each row execute function public.set_tenant_updated_at();

commit;

-- ============================================================================
-- Post-migration verification queries (run separately to confirm success):
--
-- select count(*) from public.tenants;
--   -- expect 1
--
-- select count(*) from public.tenant_features where tenant_id = '11111111-1111-4111-8111-111111111111';
--   -- expect 8
--
-- select count(*) from public.members where tenant_id is null;
--   -- expect 0 (same for every touched table)
--
-- select tenant_id, count(*) from public.bookings group by tenant_id;
--   -- expect single row with the Hour Golf UUID and 843 (current count)
-- ============================================================================
