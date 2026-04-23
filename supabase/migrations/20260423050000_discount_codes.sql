-- Discount / promo codes for the pro shop.
--
-- Admin creates a code with a type (percent or amount), value, and
-- optional expiry / usage caps / min order threshold. Members or
-- guests enter the code at checkout; server validates + applies.
--
-- Rule decided 2026-04-23: discount codes do NOT stack with the
-- member tier discount. If a member applies a code, their tier
-- discount is skipped for that order. Keeps the ledger + receipt
-- legible and avoids the "am I double-dipping?" confusion.
--
-- Scope controls who can use the code:
--   member — requires a logged-in member at checkout
--   public — requires a guest (is_guest=true) at checkout
--   both   — no gate
--
-- Usage tracking: discount_codes.total_uses is an advisory counter
-- bumped by the checkout path. Per-member caps are computed from
-- shop_orders.discount_code_id at validation time.

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  type text not null check (type in ('percent', 'amount')),
  value numeric not null,
  min_order_cents integer,
  expires_at timestamptz,
  usage_limit_total integer,
  usage_limit_per_member integer,
  total_uses integer not null default 0,
  is_active boolean not null default true,
  scope text not null default 'both' check (scope in ('member', 'public', 'both')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Codes are case-insensitive per tenant. Members type SUMMER10 or
-- summer10; both hit the same row.
create unique index if not exists uq_discount_codes_tenant_code
  on public.discount_codes (tenant_id, upper(code));

create index if not exists idx_discount_codes_tenant_active
  on public.discount_codes (tenant_id, is_active, expires_at);

create or replace function public.discount_codes_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists discount_codes_set_updated_at on public.discount_codes;
create trigger discount_codes_set_updated_at
  before update on public.discount_codes
  for each row execute function public.discount_codes_set_updated_at();

alter table public.discount_codes enable row level security;

drop policy if exists admin_all on public.discount_codes;
create policy admin_all on public.discount_codes
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = discount_codes.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = discount_codes.tenant_id
    )
  );

-- Link each redemption back to the code that was applied so
-- per-member usage caps + reporting have something to join on.
alter table public.shop_orders
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists discount_code_amount_cents integer;

create index if not exists idx_shop_orders_discount_code
  on public.shop_orders (tenant_id, discount_code_id)
  where discount_code_id is not null;
