-- Fix cross-tenant leak in monthly_usage view.
--
-- Before: SELECT had no tenant_id column, and joins between members/
-- tier_config/bookings ignored tenant_id, so a tenant admin on their
-- own subdomain could see every tenant's members + usage rows merged
-- together.
--
-- After:
--   * tenant_id is in the SELECT list so PostgREST can filter on it
--     (useData.js now appends `?tenant_id=eq.<id>`).
--   * tier_config join matches on (tier, tenant_id) — tier names are
--     tenant-scoped by Phase 1 and can collide across tenants.
--   * bookings join matches on (customer_email, tenant_id) — same
--     reason, and it's a booking for THIS tenant that counts against
--     THIS tenant's member's allotment.
--
-- security_invoker is NOT toggled: the existing view relies on owner
-- (service-role) privileges to bypass RLS on members/bookings/tier_
-- config when the caller's JWT is authenticated. Flipping to invoker
-- would require adding per-role SELECT policies across three tables
-- and setting app.tenant_id per request — a bigger rework tracked as
-- separate tech debt.
--
-- The advisor warning "security_definer_view" on this view remains
-- by design until the above broader rework lands.

drop view if exists public.monthly_usage;

create view public.monthly_usage as
select
  m.id as member_id,
  m.tenant_id,
  m.name,
  m.email,
  m.tier,
  t.included_hours,
  t.overage_rate,
  date_trunc('month'::text, b.booking_start) as billing_month,
  coalesce(sum(b.duration_hours), 0::numeric) as total_hours,
  greatest(coalesce(sum(b.duration_hours), 0::numeric) - t.included_hours, 0::numeric) as overage_hours,
  greatest(coalesce(sum(b.duration_hours), 0::numeric) - t.included_hours, 0::numeric) * t.overage_rate as overage_charge
from members m
  left join tier_config t
    on t.tier = m.tier and t.tenant_id = m.tenant_id
  left join bookings b
    on b.customer_email = m.email and b.tenant_id = m.tenant_id
where b.booking_status is null or b.booking_status !~~* '%cancel%'::text
group by
  m.id, m.tenant_id, m.name, m.email, m.tier,
  t.included_hours, t.overage_rate,
  date_trunc('month'::text, b.booking_start);

-- Re-grant permissions (CREATE VIEW resets them). Match the pre-drop
-- grants: service_role + authenticated can SELECT; anon cannot (nothing
-- queries monthly_usage anonymously today).
grant select on public.monthly_usage to authenticated, service_role;
