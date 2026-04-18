-- Birthday-bonus feature: per-tenant opt-in to auto-issue a shop credit
-- and/or bonus bay hours on a member's birthday.
--
-- Two tables:
--   tenant_birthday_bonus_config  per-tenant toggle + amounts
--   birthday_bonus_ledger         one row per member per year, prevents
--                                 double-issuance when an admin fires
--                                 the manual trigger AND the daily cron
--                                 runs on the same calendar day
--
-- Tenants pick any combination of reward types. Both NULL = inert even
-- if enabled=true (acts as "off"). Admin UI renders both as optional
-- input rows with hints.

create table if not exists public.tenant_birthday_bonus_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  credit_amount numeric(10, 2),
  bonus_hours numeric(6, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_birthday_bonus_config enable row level security;
-- Service-role only; admins go through /api/admin-birthday-bonus which
-- uses the service key.

create or replace function public.tenant_birthday_bonus_config_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_birthday_bonus_config_set_updated_at on public.tenant_birthday_bonus_config;
create trigger tenant_birthday_bonus_config_set_updated_at
  before update on public.tenant_birthday_bonus_config
  for each row execute function public.tenant_birthday_bonus_config_set_updated_at();

create table if not exists public.birthday_bonus_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_email text not null,
  bonus_year integer not null,
  credit_issued numeric(10, 2),
  hours_issued numeric(6, 2),
  issued_at timestamptz not null default now()
);

-- Idempotency across both the manual admin button and the daily cron.
-- If a member's birthday somehow fires twice in one year, the second
-- INSERT collides and the processor treats it as already-issued.
create unique index if not exists idx_birthday_bonus_ledger_tenant_member_year
  on public.birthday_bonus_ledger (tenant_id, member_email, bonus_year);

create index if not exists idx_birthday_bonus_ledger_tenant_issued
  on public.birthday_bonus_ledger (tenant_id, issued_at desc);

alter table public.birthday_bonus_ledger enable row level security;
