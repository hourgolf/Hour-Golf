// Dynamic PWA manifest per tenant.
//
// Requested by the browser via <link rel="manifest"> which points at
// /manifest.json. next.config.js rewrites /manifest.json -> /api/manifest,
// so the original static file path still works for already-installed PWAs.
//
// Per-tenant fields: name, short_name, description, theme_color,
// background_color, icons. Icons source from tenant_branding.pwa_icon_url
// when the tenant has uploaded one; otherwise fall back to the HG-shipped
// defaults in /public/icons/ (safe for tenants who haven't set a PWA
// icon yet — behavior matches pre-Phase-7 status quo).

import { loadBranding, tenantIdFromReq } from "../../lib/branding";

const DEFAULT_ICONS = [
  { src: "/icons/icon-72x72.png", sizes: "72x72", type: "image/png" },
  { src: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png" },
  { src: "/icons/icon-128x128.png", sizes: "128x128", type: "image/png" },
  { src: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png" },
  { src: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png", purpose: "any" },
  { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
  { src: "/icons/icon-384x384.png", sizes: "384x384", type: "image/png" },
  { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
];

// A tenant that uploaded a single high-res square icon gets the same 8
// size declarations, all pointing at that one URL. Browsers downscale
// per install context. Guidance to tenants: PNG, square, ≥512x512,
// ideally 1024x1024 for best iOS/maskable rendering.
function iconsFor(pwaIconUrl) {
  if (!pwaIconUrl) return DEFAULT_ICONS;
  return [
    { src: pwaIconUrl, sizes: "72x72", type: "image/png" },
    { src: pwaIconUrl, sizes: "96x96", type: "image/png" },
    { src: pwaIconUrl, sizes: "128x128", type: "image/png" },
    { src: pwaIconUrl, sizes: "144x144", type: "image/png" },
    { src: pwaIconUrl, sizes: "152x152", type: "image/png", purpose: "any" },
    { src: pwaIconUrl, sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: pwaIconUrl, sizes: "384x384", type: "image/png" },
    { src: pwaIconUrl, sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ];
}

export default async function handler(req, res) {
  const tenantId = tenantIdFromReq(req);
  const branding = await loadBranding(tenantId);
  const name = branding.app_name || "Ourlee";

  // Manifest is cacheable for 5 minutes to reduce per-request work, but
  // short enough that branding edits propagate quickly.
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

  return res.status(200).json({
    name,
    short_name: name,
    description: `Book bays, manage your membership, and stay connected with ${name}.`,
    start_url: "/members/dashboard",
    display: "standalone",
    background_color: branding.cream_color || "#EDF3E3",
    theme_color: branding.pwa_theme_color || branding.primary_color || "#4C8D73",
    orientation: "portrait",
    icons: iconsFor(branding.pwa_icon_url),
  });
}
