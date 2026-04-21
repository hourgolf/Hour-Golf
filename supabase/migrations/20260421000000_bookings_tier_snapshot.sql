-- Snapshot each booking's tier at the time it was created.
--
-- Why: without this, the admin Overview tab + monthly_usage view both
-- joined through members.tier (the member's CURRENT tier) to compute
-- included hours + overage rate. When a member cancels their
-- subscription mid-month, their tier flips to 'Non-Member' — and every
-- booking they made that month retroactively gets reclassified at the
-- Non-Member rate ($60/hr), double-charging them against overage they'd
-- already paid. Will Koenig 2026-04-21: 3h Patron usage + $30 paid
-- overage became "$180 owed" overnight after cancel.
--
-- Approach: stamp tier on every booking at INSERT time via a trigger
-- (handles ALL creation paths — customer-book, admin direct REST,
-- booking-webhook — without touching each). Rebuild monthly_usage to
-- aggregate by the booking-snapshot tier, not the current member tier.

-- 1. Column
alter table public.bookings add column if not exists tier text;

-- 2. Trigger to stamp on insert
create or replace function public.stamp_booking_tier() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tier is null then
    select tier into new.tier from public.members
    where email = new.customer_email and tenant_id = new.tenant_id;
    if new.tier is null then new.tier := 'Non-Member'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_tier_on_booking_insert on public.bookings;
create trigger stamp_tier_on_booking_insert
before insert on public.bookings
for each row execute function public.stamp_booking_tier();

-- 3. Backfill existing rows.
-- 3a. Currently-paying members: use their current tier.
update public.bookings b
set tier = m.tier
from public.members m
where m.email = b.customer_email
  and m.tenant_id = b.tenant_id
  and m.tier is not null
  and m.tier != 'Non-Member'
  and b.tier is null;

-- 3b. Currently-Non-Member BUT had a MEMBERSHIP payment in the ±45d
-- window around the booking → default to Patron (most common HG tier).
-- Catches lapsed members without touching true walk-ins.
update public.bookings b
set tier = 'Patron'
from public.members m
where m.email = b.customer_email
  and m.tenant_id = b.tenant_id
  and m.tier = 'Non-Member'
  and (b.tier is null or b.tier = 'Non-Member')
  and exists (
    select 1 from public.payments p
    where p.member_email = m.email
      and p.tenant_id = m.tenant_id
      and p.description ilike '%membership%'
      and p.status = 'succeeded'
      and p.created_at between (b.booking_start - interval '45 days')
                           and (b.booking_start + interval '5 days')
  );

-- 3c. Everything else is a true walk-in.
update public.bookings set tier = 'Non-Member' where tier is null;

-- 4. Rebuild monthly_usage. Partitions by the snapshot tier, so a
-- member with mid-month tier changes produces one row per tier bucket
-- (rare but accurate). security_invoker preserved from the 2026-04-19
-- audit migration.
create or replace view public.monthly_usage
with (security_invoker = on) as
select
  m.id as member_id,
  m.tenant_id,
  m.name,
  m.email,
  coalesce(b.tier, m.tier) as tier,
  t.included_hours,
  t.overage_rate,
  (date_trunc('month', (b.booking_start at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles') as billing_month,
  coalesce(sum(b.duration_hours), 0) as total_hours,
  greatest(coalesce(sum(b.duration_hours), 0) - t.included_hours, 0) as overage_hours,
  greatest(coalesce(sum(b.duration_hours), 0) - t.included_hours, 0) * t.overage_rate as overage_charge
from public.members m
  left join public.bookings b
    on b.customer_email = m.email
   and b.tenant_id = m.tenant_id
  left join public.tier_config t
    on t.tier = coalesce(b.tier, m.tier)
   and t.tenant_id = m.tenant_id
where (b.booking_status is null or b.booking_status !~~* '%cancel%')
group by
  m.id, m.tenant_id, m.name, m.email,
  coalesce(b.tier, m.tier),
  t.included_hours, t.overage_rate,
  (date_trunc('month', (b.booking_start at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles');
