-- monthly_usage view: bucket bookings by Pacific month, not UTC.
--
-- Members live in PT and read dates as PT. The previous UTC bucketing
-- caused real bills to disagree with what members saw on their
-- dashboard — a session starting at 9pm PT on March 31 (= April 1
-- 04:00 UTC) was billed in April but rendered as a March booking.
--
-- The double `AT TIME ZONE 'America/Los_Angeles'` trick:
--   1. `booking_start AT TIME ZONE 'America/Los_Angeles'` converts the
--      timestamptz to a naive timestamp in PT local time.
--   2. `date_trunc('month', ...)` floors that naive timestamp to the
--      first day of its (PT) month.
--   3. The outer `AT TIME ZONE 'America/Los_Angeles'` re-interprets
--      the naive month-start as PT and converts back to a timestamptz.
--
-- Net effect: billing_month is the UTC instant that == "PT month start"
-- for the booking. Two consecutive bookings on March 31 23:30 PT and
-- April 1 00:30 PT now land in distinct buckets correctly, regardless
-- of which side of UTC midnight they fall on.

create or replace view public.monthly_usage as
  select
    m.id as member_id,
    m.tenant_id,
    m.name,
    m.email,
    m.tier,
    t.included_hours,
    t.overage_rate,
    (date_trunc('month', b.booking_start at time zone 'America/Los_Angeles')
      at time zone 'America/Los_Angeles') as billing_month,
    coalesce(sum(b.duration_hours), 0::numeric) as total_hours,
    greatest(coalesce(sum(b.duration_hours), 0::numeric) - t.included_hours, 0::numeric) as overage_hours,
    greatest(coalesce(sum(b.duration_hours), 0::numeric) - t.included_hours, 0::numeric) * t.overage_rate as overage_charge
  from public.members m
    left join public.tier_config t
      on t.tier = m.tier and t.tenant_id = m.tenant_id
    left join public.bookings b
      on b.customer_email = m.email and b.tenant_id = m.tenant_id
  where b.booking_status is null
     or b.booking_status !~~* '%cancel%'
  group by
    m.id, m.tenant_id, m.name, m.email, m.tier,
    t.included_hours, t.overage_rate,
    (date_trunc('month', b.booking_start at time zone 'America/Los_Angeles')
      at time zone 'America/Los_Angeles');
