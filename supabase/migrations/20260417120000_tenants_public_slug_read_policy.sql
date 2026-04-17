-- Regression fix from Phase 2C: middleware subdomain resolution broken.
--
-- middleware.js runs on Vercel Edge and uses the Supabase anon key to
-- resolve subdomain slugs to tenant IDs:
--
--   GET /rest/v1/tenants?slug=eq.<slug>&status=eq.active&select=id
--
-- Phase 2C enabled RLS on `public.tenants` with no policies, which locks
-- out the anon role entirely. Every middleware lookup returned an empty
-- array; with MULTI_TENANT_STRICT=true, hourgolf.ourlee.co returned 404.
--
-- Fix: allow the anon role to SELECT active tenants. Slug + id + status
-- are public routing metadata (effectively DNS-level data), not sensitive.
--
-- What stays locked down:
--   - anon cannot INSERT/UPDATE/DELETE tenants
--   - anon cannot see suspended or archived tenants (status != 'active')
--   - service_role retains full access (bypasses RLS as always)
--
-- tenant_branding will need a similar anon-read policy in Phase 3 when
-- branding starts rendering client-side. tenant_features, platform_admins,
-- and platform_admin_sessions stay service-role-only.

create policy tenants_public_slug_read
  on public.tenants
  for select
  to anon
  using (status = 'active');
