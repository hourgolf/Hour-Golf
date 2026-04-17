// Dynamic PWA manifest per tenant.
//
// Requested by the browser via <link rel="manifest"> which points at
// /manifest.json. next.config.js rewrites /manifest.json -> /api/manifest,
// so the original static file path still works for already-installed PWAs.
//
// Fields that vary per tenant: name, short_name, description, theme_color,
// background_color. Icons and start_url stay constant for Phase 3A; per-
// tenant PWA icons need an icon generation pipeline (Phase 3+).

import { loadBranding, tenantIdFromReq } from "../../lib/branding";

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
    icons: [
      { src: "/icons/icon-72x72.png", sizes: "72x72", type: "image/png" },
      { src: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png" },
      { src: "/icons/icon-128x128.png", sizes: "128x128", type: "image/png" },
      { src: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png" },
      { src: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-384x384.png", sizes: "384x384", type: "image/png" },
      { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  });
}
