// Platform-level asset upload. Writes to Supabase Storage on behalf of
// any tenant, chosen by explicit tenant_id query param.
//
// Distinct from /api/upload-logo + /api/upload-font, which resolve the
// tenant from the subdomain via verifyAdmin. Those only let a tenant
// admin upload to their own tenant. This endpoint lets a super-admin
// upload to any tenant's folder.
//
// Query params:
//   kind        "logo" | "bg" | "font"  — logo/bg go to `logos` bucket,
//               font goes to `fonts` bucket. Keeps backing stores
//               identical to the tenant-admin flow.
//   tenant_id   target tenant UUID (folder prefix in storage).
//   filename    sanitized basename. For kind=font must end in .woff2.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "5mb",
  },
};

const KIND_TO_BUCKET = {
  logo: "logos",
  bg: "logos",
  font: "fonts",
};

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const tenantId = String(req.query.tenant_id || "");
  if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });

  const kind = String(req.query.kind || "");
  const bucket = KIND_TO_BUCKET[kind];
  if (!bucket) return res.status(400).json({ error: "kind must be one of: logo, bg, font" });

  const rawName = String(req.query.filename || "");
  const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    return res.status(400).json({ error: "Missing or invalid filename" });
  }

  // Fonts: only .woff2 is supported by our dynamic @font-face loader.
  if (kind === "font" && !safe.toLowerCase().endsWith(".woff2")) {
    return res.status(400).json({ error: "Only .woff2 font files are supported" });
  }

  const storagePath = `${tenantId}/${safe}`;
  const contentType =
    kind === "font"
      ? "font/woff2"
      : req.headers["content-type"] || "application/octet-stream";

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).json({ error: "Empty body" });

    if (kind === "font" && body.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: "Font file too large. Keep under 2MB." });
    }

    const key = getServiceKey();
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
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

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error("platform-upload error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
