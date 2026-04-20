-- Security + performance hardening (audit pass 2026-04-19).
-- Consolidates the advisory findings that are safe to apply in one shot:
--   1) monthly_usage view: SECURITY DEFINER -> INVOKER, revoke anon grants.
--      Without this, anyone holding the public anon key could query
--      /rest/v1/monthly_usage and receive every member's billing data across
--      every tenant (the view was running as postgres, bypassing RLS).
--   2) Pin search_path on all public functions flagged by the database linter
--      (prevents search_path injection if a SECURITY DEFINER function is ever
--      added later; hardens the ones that are DEFINER today).
--   3) Add composite indexes that anticipate Reports + TodayView scaling past
--      the current ~874 bookings / ~296 payments. Near-zero overhead today,
--      cheap insurance as we grow.

-- 1) monthly_usage: run as the caller, not the view owner.
alter view public.monthly_usage set (security_invoker = on);

-- Revoke the accidentally-broad anon grants on this view. authenticated keeps
-- SELECT because the admin UI queries it via the user JWT (see hooks/useData.js
-- — admin_all RLS on members/bookings/tier_config controls access).
revoke all on public.monthly_usage from anon;
revoke insert, update, delete, truncate, references, trigger on public.monthly_usage from authenticated;
-- Keep SELECT for authenticated so the admin dashboard continues to work.
grant select on public.monthly_usage to authenticated;
-- service_role retains full access via default supabase grants.

-- 2) Pin function search_path so functions can't resolve against a caller-
-- controlled schema. Using 'public, pg_temp' keeps current behavior for all of
-- these (they reference public.* tables and nothing from other schemas).
alter function public.platform_admin_settings_touch() set search_path = public, pg_temp;
alter function public.platform_pricing_touch() set search_path = public, pg_temp;
alter function public.platform_billing_touch() set search_path = public, pg_temp;
alter function public.auto_create_platform_billing() set search_path = public, pg_temp;
alter function public.tenant_square_config_set_updated_at() set search_path = public, pg_temp;
alter function public.tenant_birthday_bonus_config_set_updated_at() set search_path = public, pg_temp;
alter function public.tenant_shippo_config_set_updated_at() set search_path = public, pg_temp;
alter function public.news_items_set_updated_at() set search_path = public, pg_temp;
alter function public.shop_requests_set_updated_at() set search_path = public, pg_temp;
alter function public.update_updated_at() set search_path = public, pg_temp;
alter function public.calculate_booking_duration() set search_path = public, pg_temp;
alter function public.touch_updated_at() set search_path = public, pg_temp;

-- 3) Forward-looking composite indexes. Chosen to match the exact predicates
-- used by the hot admin + reporting paths.
--
-- Reports Revenue query (payments by tenant/status/billing_month):
create index if not exists idx_payments_tenant_status_billing_month
  on public.payments (tenant_id, status, billing_month);

-- TodayView: "what's happening today in this bay, not cancelled, sorted by time".
create index if not exists idx_bookings_tenant_bay_status_start
  on public.bookings (tenant_id, bay, booking_status, booking_start);

-- TodayView door codes: pull the active Seam-issued code for a specific booking.
-- Complements idx_acj_booking_id by letting the planner hit status='sent' scans
-- directly without filtering the full per-booking row set.
create index if not exists idx_acj_tenant_status_booking
  on public.access_code_jobs (tenant_id, status, booking_id);

-- shop_orders reporting + member order history.
create index if not exists idx_shop_orders_tenant_status_created
  on public.shop_orders (tenant_id, status, created_at);
