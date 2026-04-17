// Tenant display-font upload. Mirrors upload-logo.js / upload-shop-image.js
// but writes to a fonts/ bucket and restricts to .woff2.
//
// Files land at storage path `<tenantId>/<safeFilename>` inside the fonts
// bucket so tenants can't collide. Returned public URL is saved into
// tenant_branding.font_display_url by the admin UI.

import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "2mb",
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const raw = String(req.query.filename || "");
  // Keep dots so .woff2 extension survives; strip everything else weird.
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    return res.status(400).json({ error: "Missing or invalid filename" });
  }

  // Require .woff2 — we don't currently support .ttf/.otf in the
  // dynamic @font-face declaration in lib/branding.js buildDisplayFontFace.
  if (!safe.toLowerCase().endsWith(".woff2")) {
    return res.status(400).json({ error: "Only .woff2 font files are supported" });
  }

  const storagePath = `${tenantId}/${safe}`;
  const contentType = "font/woff2";

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).json({ error: "Empty body" });
    // Vercel caps request bodies at ~4.5MB; we also enforce a smaller cap
    // client-side. Most .woff2 files are well under 1MB.
    if (body.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: "Font file too large. Keep under 2MB." });
    }

    const key = getServiceKey();
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/fonts/${storagePath}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: "Upload failed", detail: text });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/fonts/${storagePath}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error("Font upload error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
