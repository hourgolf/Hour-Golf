-- Platform-level billing: Ourlee charging its tenants.
--
-- This is distinct from every other Stripe config in the codebase.
-- tenant_stripe_config is for a tenant's OWN Stripe account (used to
-- collect money from their members). These two tables are for the
-- PLATFORM'S Stripe account (used to collect money from tenants). When
-- Phase 2 of billing wires actually-charging-people, it will use a new
-- set of env vars (STRIPE_PLATFORM_SECRET_KEY, etc.) and hit different
-- Stripe objects than tenant_stripe_config ever touches.
--
-- Two tables:
--
--   platform_pricing — one row per (billable unit). "Feature" rows map
--     1:1 to tenant_features keys (bookings, pro_shop, etc.). A single
--     "base" row holds any flat monthly floor. Rows are edited from
--     /platform/pricing by the platform admin.
--
--   platform_billing — one row per tenant. Holds the tenant's Ourlee
--     Stripe customer id, subscription id, current status, and a
--     monthly_cost_snapshot that's set when the tenant's plan is
--     (re)evaluated. No monetary events live here — Stripe remains the
--     source of truth for actual money. This table is the local cache
--     of "what does this tenant owe Ourlee right now."
--
-- Both tables are RLS-locked to platform_admins only. Tenant admins,
-- members, and the anon role all get zero rows back. This is the one
-- table where it would be genuinely dangerous to leak cross-tenant
-- data (a tenant could see what another tenant pays).

-- ─────────────────────────────────────────────────────────────
-- platform_pricing
-- ─────────────────────────────────────────────────────────────

create table if not exists public.platform_pricing (
  -- Unit of billing. For features: the feature_key (bookings, pro_shop,
  -- ...). For the optional flat floor: 'base'. We don't FK to
  -- tenant_features.feature_key because that's a per-tenant row; the
  -- canonical list of feature keys lives in the app layer (KNOWN_
  -- FEATURE_KEYS in lib/tenant-features.js).
  unit_key text primary key,

  -- Human-readable label for the UI. Redundant with feature labels in
  -- the app layer, kept here so the pricing surface can render without
  -- a lookup.
  label text not null,

  -- Short description shown on the pricing page.
  description text,

  -- Classification for rendering. 'feature' = maps to a tenant_features
  -- key. 'base' = flat floor that applies regardless of enabled features.
  -- 'addon' = future expansion (e.g. a custom domain upcharge, setup fee).
  kind text not null default 'feature' check (kind in ('base', 'feature', 'addon')),

  -- Monthly price in cents. 0 means free / not currently charged.
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),

  -- When this price ships through Stripe (Phase 2), we'll create a
  -- Stripe Price object and store its id here. null = not yet live in
  -- Stripe.
  stripe_price_id text,

  -- Display ordering on the pricing page.
  sort_order integer not null default 0,

  -- Toggles whether the platform admin currently offers this as a
  -- billable unit. Setting false hides it from the /platform/pricing
  -- page and stops it from contributing to any tenant's cost snapshot
  -- calculation. Keeps the row around for historical invoices.
  is_active boolean not null default true,

  updated_at timestamptz not null default now()
);

create or replace function public.platform_pricing_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_pricing_touch on public.platform_pricing;
create trigger platform_pricing_touch
  before update on public.platform_pricing
  for each row execute function public.platform_pricing_touch();

alter table public.platform_pricing enable row level security;

drop policy if exists platform_admin_only on public.platform_pricing;
create policy platform_admin_only on public.platform_pricing
  for all
  using (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid()))
  with check (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid()));

-- Seed the 9 feature keys plus a base row with placeholder prices of 0.
-- The platform admin sets real prices via /platform/pricing. Zeroes mean
-- "not yet priced" — rendering the tenant detail page today will show
-- every tenant owes $0, which is the correct current state.
insert into public.platform_pricing (unit_key, label, description, kind, monthly_price_cents, sort_order) values
  ('base',                'Platform base',        'Flat monthly floor applied to every active tenant regardless of enabled features.', 'base', 0, 0),
  ('bookings',            'Bookings',             'Bay reservation system — the core product.',                                         'feature', 0, 10),
  ('subscriptions',       'Subscriptions',        'Tier-based monthly memberships via Stripe.',                                         'feature', 0, 20),
  ('stripe_enabled',      'Stripe payments',      'Master kill switch for every Stripe-backed flow.',                                   'feature', 0, 25),
  ('email_notifications', 'Email notifications',  'Transactional emails (booking, cancellation, welcome, receipts).',                   'feature', 0, 30),
  ('access_codes',        'Smart-lock access codes','Seam-driven per-booking door codes emailed 10 min before start.',                  'feature', 0, 40),
  ('pro_shop',            'Pro Shop',             'Curated pro-shop tab with inventory, sizes, drop dates, checkout.',                  'feature', 0, 50),
  ('events',              'Events',               'Event pages, RSVPs, paid event tickets.',                                            'feature', 0, 60),
  ('loyalty',             'Loyalty',              'Monthly rules converting activity into pro-shop credit.',                            'feature', 0, 70),
  ('punch_passes',        'Punch Passes',         'Discounted bulk-hour packages via Stripe Checkout.',                                 'feature', 0, 80)
on conflict (unit_key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- platform_billing
-- ─────────────────────────────────────────────────────────────

create table if not exists public.platform_billing (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Ourlee's Stripe customer id for this tenant. Null until the tenant
  -- is enrolled. Distinct from tenant_stripe_config (which is the
  -- TENANT'S Stripe account — this is Ourlee's customer record of the
  -- tenant).
  stripe_customer_id text,

  -- Ourlee's subscription id for this tenant. Null until enrolled.
  stripe_subscription_id text,

  -- Machine-readable state. Derived + cached from Stripe events (when
  -- Phase 2 hooks webhooks up).
  --   not_enrolled — no Stripe customer yet
  --   trialing    — free trial period
  --   active      — paying
  --   past_due    — last charge failed, Stripe retrying
  --   suspended   — platform admin manually paused
  --   cancelled   — no longer billing
  status text not null default 'not_enrolled' check (
    status in ('not_enrolled', 'trialing', 'active', 'past_due', 'suspended', 'cancelled')
  ),

  -- Cached monthly cost in cents, recomputed whenever features toggle
  -- or pricing changes. Not authoritative — just a quick read for the
  -- UI so we don't re-sum on every page render. Stripe's subscription
  -- line items are the real source of truth when enrolled.
  monthly_cost_cents integer not null default 0 check (monthly_cost_cents >= 0),

  -- When the monthly_cost_cents was last recomputed.
  cost_snapshot_at timestamptz,

  -- Admin notes — free-text field for "manually grandfathered $0",
  -- "paused while venue under renovation", etc.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.platform_billing_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists platform_billing_touch on public.platform_billing;
create trigger platform_billing_touch
  before update on public.platform_billing
  for each row execute function public.platform_billing_touch();

alter table public.platform_billing enable row level security;

drop policy if exists platform_admin_only on public.platform_billing;
create policy platform_admin_only on public.platform_billing
  for all
  using (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid()))
  with check (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid()));

-- Auto-create a billing row when a new tenant is created. Keeps the
-- invariant that every tenant has a (possibly not_enrolled) billing row
-- so the UI never needs null-guarding on load.
create or replace function public.auto_create_platform_billing()
returns trigger language plpgsql as $$
begin
  insert into public.platform_billing (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_auto_billing on public.tenants;
create trigger tenants_auto_billing
  after insert on public.tenants
  for each row execute function public.auto_create_platform_billing();

-- Backfill rows for any tenant that already exists.
insert into public.platform_billing (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;
