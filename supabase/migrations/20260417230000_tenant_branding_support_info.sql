-- Tenant-configurable support + legal info. Previously hardcoded into
-- components/members/HelpDrawer.js, MemberLayout.js, and MemberBooking.js
-- with Hour Golf values (hour.golf/legal/, starter@hour.golf,
-- 503-765-6906, "24/7 for Starter tier or above", etc.) — a prospective
-- new tenant rolling out the platform would have been showing HG's
-- legal links and support contact to their own members.
--
-- New columns on tenant_branding (kept here instead of on `tenants`
-- because the editing surface — admin + platform branding editors —
-- already reads/writes this table):
--
--   legal_url       External URL for "Terms & Conditions"
--   terms_url       External URL for "Club Policies" (often different
--                   from legal_url — one is ToS, the other is house
--                   rules)
--   support_email   Public-facing support email (mailto: links)
--   support_phone   Public-facing phone, display format (e.g.
--                   "(503) 765-6906"). The tel: link is derived from
--                   this by stripping non-digits at render time.
--   facility_hours  Free-form sentence describing hours / access
--                   policy. Rendered in the Help drawer's FAQ.
--
-- Hour Golf's row seeded with the prior hardcoded values so nothing
-- visible changes for HG members. Fallbacks for unset columns handled
-- at the UI layer: support blocks hide cleanly when the value is null.

alter table public.tenant_branding
  add column if not exists legal_url text,
  add column if not exists terms_url text,
  add column if not exists support_email text,
  add column if not exists support_phone text,
  add column if not exists facility_hours text;

update public.tenant_branding
   set legal_url       = 'https://hour.golf/legal/',
       terms_url       = 'https://hour.golf/terms/',
       support_email   = 'starter@hour.golf',
       support_phone   = '(503) 765-6906',
       facility_hours  = 'Members have 24/7 access. Non-member bookings are available 10 AM – 8 PM.'
 where tenant_id = '11111111-1111-4111-8111-111111111111';
