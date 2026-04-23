-- Saved shipping addresses for members.
--
-- Today shop checkout collects a fresh address every time a member
-- ships, or pulls the billing address off their Stripe customer —
-- which is wrong when the member ships to a gift recipient. This
-- table lets members save N addresses, mark one default, and pick
-- at checkout.
--
-- Members can save up to 5 addresses (enforced at the API layer, not
-- the DB). The default flag is advisory — at most one address per
-- member should have is_default=true. Enforced by the API path, not
-- a partial unique index, because the constraint is easier to reason
-- about in one place (clearing other defaults happens on every
-- upsert that sets is_default=true).
--
-- `name` is the recipient name — intentionally separate from the
-- member's account name so a member can ship to spouse/kid/gift
-- recipient without editing their profile.

create table if not exists public.member_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_email text not null,
  label text not null default 'Home',
  is_default boolean not null default false,
  name text,
  street1 text not null,
  street2 text,
  city text not null,
  state text not null,
  zip text not null,
  country text not null default 'US',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup for "give me this member's addresses."
create index if not exists idx_member_addresses_tenant_member
  on public.member_addresses (tenant_id, member_email, created_at desc);

create or replace function public.member_addresses_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists member_addresses_set_updated_at on public.member_addresses;
create trigger member_addresses_set_updated_at
  before update on public.member_addresses
  for each row execute function public.member_addresses_set_updated_at();

alter table public.member_addresses enable row level security;

-- Admin read/write within the tenant (for operator support).
drop policy if exists admin_all on public.member_addresses;
create policy admin_all on public.member_addresses
  for all to authenticated
  using (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = member_addresses.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.admins
      where admins.user_id = auth.uid()
        and admins.tenant_id = member_addresses.tenant_id
    )
  );

-- Members never read/write this table via PostgREST — the
-- /api/member-addresses route uses the service role and gates on
-- the member session cookie. No direct-client policies needed.
