// Server-side logo upload.
// Browser sends raw file bytes; we verify the caller is an admin and then
// forward to Supabase Storage using the service role key, which bypasses RLS.
import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";

export const config = {
  api: {
    bodyParser: false, // we need raw bytes, not JSON parsing
    sizeLimit: "5mb",
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, reason } = await verifyAdmin(req);
  if (!user) {
    console.error("upload-logo verifyAdmin failed:", reason);
    return res.status(401).json({ error: "Unauthorized", detail: reason });
  }

  // Sanitize the filename so a malicious caller can't traverse paths.
  const raw = String(req.query.filename || "");
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    return res.status(400).json({ error: "Missing or invalid filename" });
  }

  const contentType = req.headers["content-type"] || "application/octet-stream";

  try {
    // Read raw body bytes.
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    if (!body.length) return res.status(400).json({ error: "Empty body" });

    const key = getServiceKey();
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${safe}`, {
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

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/logos/${safe}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error("Logo upload error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
