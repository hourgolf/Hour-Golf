// Member-authenticated image upload.
//
// Mirrors the admin upload endpoints (MIME sniff on the magic bytes, fixed
// content-type sent to Storage, tenant-prefixed path) but authenticates
// via the hg-member-token cookie instead of verifyAdmin. Used by the
// "Request an item" form to attach a photo of what the member is after.
//
// Query:
//   purpose  required enum. Today only "shop-request". Any future member-
//            upload use cases (event photo upload? profile picture?)
//            should add an explicit string here so the storage path
//            organizes cleanly.
//
// Body:     raw image bytes. Client sets Content-Type but we IGNORE it
//           and derive the actual MIME from the file's magic bytes.
//
// Returns:  { url: "https://…/storage/v1/object/public/shop/<path>" }

import crypto from "crypto";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import {
  requireSameOrigin,
  enforceRateLimit,
  validateImageUpload,
} from "../../lib/security";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "6mb", // Vercel hard-caps at ~4.5MB; we enforce 5MB inline too.
  },
};

const ALLOWED_PURPOSES = new Set(["shop-request"]);

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!requireSameOrigin(req, res)) return;
  // Generous per-IP cap: a member tweaking a bad photo a few times is
  // normal; 30 uploads/hour blocks scripted abuse without getting in
  // a real member's way.
  if (!enforceRateLimit(req, res, { bucket: "mupload", limit: 30, windowMs: 60 * 60 * 1000 })) return;

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  const session = await getSessionWithMember({ token, tenantId, touch: false });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const member = session.member;

  const purpose = String(req.query.purpose || "");
  if (!ALLOWED_PURPOSES.has(purpose)) {
    return res.status(400).json({ error: "invalid purpose" });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).json({ error: "Empty body" });
    if (body.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "Image too large (max 5MB)" });
    }

    // Sniff the magic bytes and force that MIME into the Storage write —
    // never trust the client-supplied Content-Type.
    const contentType = validateImageUpload(req, res, body);
    if (!contentType) return;
    const ext = contentType.split("/")[1] || "bin";

    // Random filename so member uploads can't overwrite each other, and
    // path is prefixed by tenant + member so listing stays organized.
    const id = crypto.randomBytes(8).toString("hex");
    const storagePath = `${tenantId}/${purpose}/${member.id}/${Date.now()}-${id}.${ext}`;

    const resp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/shop/${storagePath}`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": contentType,
          "x-upsert": "false", // never overwrite; random id guarantees uniqueness
        },
        body,
      }
    );
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: "Upload failed", detail: text });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/shop/${storagePath}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error("member-upload-image error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
