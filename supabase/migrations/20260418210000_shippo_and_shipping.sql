-- Shippo integration: per-tenant shipping config + per-item dimensions
-- + per-order shipping detail. All additive; existing pickup-only flow
-- keeps working untouched (delivery_method default = 'pickup').
--
-- Three additions:
--   1. tenant_shippo_config — API key + default origin address. Mirrors
--      tenant_stripe_config / tenant_seam_config / tenant_square_config:
--      service-role-only RLS, plain-text secrets, kill switch.
--   2. shop_items.weight_oz / dims_in_* / is_shippable — Shippo needs
--      a parcel definition per shipment. Keep dimensions per-item so
--      the shipment payload can sum or pick the largest parcel.
--   3. shop_orders.delivery_method + shipping_* + tracking_* — per-row
--      shipping context. delivery_method drives whether the row needs
--      a label after payment. Existing rows default to 'pickup' so
--      they're never reprocessed.

create table if not exists public.tenant_shippo_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  api_key text not null,
  -- Origin address fields are flat columns rather than JSONB so the
  -- platform admin UI is straightforward (one input per field) and
  -- partial updates don't require merge logic.
  origin_name text,
  origin_company text,
  origin_street1 text not null,
  origin_street2 text,
  origin_city text not null,
  origin_state text not null,
  origin_zip text not null,
  origin_country text not null default 'US',
  origin_phone text,
  origin_email text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_shippo_config enable row level security;

create or replace function public.tenant_shippo_config_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists tenant_shippo_config_set_updated_at on public.tenant_shippo_config;
create trigger tenant_shippo_config_set_updated_at
  before update on public.tenant_shippo_config
  for each row execute function public.tenant_shippo_config_set_updated_at();

-- shop_items: Shippo parcel inputs. Defaults are sized for a sleeve of
-- golf balls (the most common HG SKU); override per item in the admin
-- product editor when you add larger gear.
alter table public.shop_items
  add column if not exists is_shippable boolean not null default true,
  add column if not exists weight_oz numeric(8, 2),
  add column if not exists length_in numeric(6, 2),
  add column if not exists width_in numeric(6, 2),
  add column if not exists height_in numeric(6, 2);

-- shop_orders: per-order shipping context.
alter table public.shop_orders
  add column if not exists delivery_method text not null default 'pickup'
    check (delivery_method in ('pickup', 'ship')),
  add column if not exists shipping_address jsonb,
  add column if not exists shipping_amount numeric(10, 2),
  add column if not exists shipping_carrier text,
  add column if not exists shipping_service text,
  add column if not exists shippo_rate_id text,
  add column if not exists shippo_transaction_id text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists label_url text;

-- Useful lookups for the admin orders view.
create index if not exists idx_shop_orders_tenant_method
  on public.shop_orders (tenant_id, delivery_method);
