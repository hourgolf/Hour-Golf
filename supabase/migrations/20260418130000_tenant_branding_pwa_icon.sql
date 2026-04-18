-- Per-tenant PWA icon.
--
-- Before: every tenant's installed PWA showed Hour Golf's icon-192x192
-- / icon-512x512 PNGs served from /public/icons/. When a Parts Dept
-- member installed their portal as a PWA on iOS/Android, the home-
-- screen icon was HG's, not Parts Dept's.
--
-- After: tenant_branding.pwa_icon_url holds a URL to a square icon
-- (uploaded via the branding admin UI). /api/manifest.js and the
-- <link rel="apple-touch-icon"> in _document.js pick it up when set.
-- Tenants that skip this field fall back to the bundled HG icons —
-- equivalent to today's behavior, so this migration is safe to ship
-- without any tenant action.
--
-- Upload guidance (for the admin UI): PNG, square, ≥512x512. 1024x1024
-- is the Resend recommendation for best maskable rendering. Single
-- file; the browser handles downscaling to the 8 manifest sizes.

alter table public.tenant_branding
  add column if not exists pwa_icon_url text;
