-- Phase 4: allow anon-key SELECT on tenant_features so _document.js can
-- read feature flags during SSR (same pattern tenant_branding uses).
--
-- Feature flags are metadata about which parts of the app a tenant has
-- enabled. The values themselves aren't sensitive — they affect which
-- nav items and APIs are exposed on the tenant's subdomain, which is
-- visible anyway from rendered HTML. No secrets, no PII. Service-role
-- continues to write them via the super-admin PATCH endpoint.
--
-- This mirrors the public-read policy on public.tenants
-- (20260417120000_tenants_public_slug_read_policy.sql).

create policy "tenant_features_public_read"
  on public.tenant_features
  for select
  to anon, authenticated
  using (true);
