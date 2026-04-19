-- Pro-shop item requests: members ask for items that aren't currently
-- stocked; admin responds and (optionally) orders them. Lives in its
-- own table rather than being shoehorned into shop_orders so status,
-- fulfillment, and audit fields don't conflict with the purchase flow.
--
-- member_email / member_name are both required at insert time (MVP is
-- members-only; guest requests via /shop come later if the volume
-- justifies it). quantity defaults to 1 and is a nice-to-have hint for
-- the admin when sourcing.

create table if not exists public.shop_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_email text not null,
  member_name text not null,
  member_phone text,
  item_name text not null,
  brand text,
  size text,
  color text,
  budget_range text,
  quantity integer not null default 1,
  reference_url text,
  notes text,
  status text not null default 'pending'
    check (status in ('pending','acknowledged','ordering','in_stock','declined','cancelled')),
  admin_response text,
  -- Set by the admin if they choose to convert this request into a
  -- public shop_items listing when ordering. Not required for MVP but
  -- the column is here so Tier 2 can wire the "also publish to shop"
  -- action without a migration.
  shop_item_id uuid references public.shop_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shop_requests_tenant_status
  on public.shop_requests (tenant_id, status, created_at desc);

create index if not exists idx_shop_requests_tenant_member
  on public.shop_requests (tenant_id, member_email);

create or replace function public.shop_requests_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists shop_requests_set_updated_at on public.shop_requests;
create trigger shop_requests_set_updated_at
  before update on public.shop_requests
  for each row execute function public.shop_requests_set_updated_at();

alter table public.shop_requests enable row level security;
