// /api/admin-news
//
// GET     -> list all news items (any state) for the tenant
// POST    -> create a news item
// PATCH   -> ?id=<uuid> update fields
// DELETE  -> ?id=<uuid> hard delete (cascade clears dismissals)

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const ALLOWED_SEVERITY = new Set(["info", "success", "warning", "urgent"]);

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

function buildPatch(body) {
  const patch = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new Error("title required");
    }
    patch.title = body.title.trim().slice(0, 200);
  }
  if ("body" in body) {
    if (typeof body.body !== "string" || body.body.trim().length === 0) {
      throw new Error("body required");
    }
    patch.body = body.body.trim().slice(0, 4000);
  }
  if ("image_url" in body) {
    patch.image_url = body.image_url ? String(body.image_url).slice(0, 2000) : null;
  }
  if ("severity" in body) {
    if (!ALLOWED_SEVERITY.has(body.severity)) {
      throw new Error("severity must be info / success / warning / urgent");
    }
    patch.severity = body.severity;
  }
  if ("show_as_popup" in body) patch.show_as_popup = !!body.show_as_popup;
  if ("show_on_dashboard" in body) patch.show_on_dashboard = !!body.show_on_dashboard;
  if ("is_published" in body) patch.is_published = !!body.is_published;
  if ("display_order" in body) {
    const n = Number(body.display_order);
    if (!Number.isFinite(n)) throw new Error("display_order must be a number");
    patch.display_order = Math.round(n);
  }
  if ("starts_at" in body) {
    patch.starts_at = body.starts_at ? new Date(body.starts_at).toISOString() : null;
  }
  if ("ends_at" in body) {
    patch.ends_at = body.ends_at ? new Date(body.ends_at).toISOString() : null;
  }
  return patch;
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const r = await sb(
      key,
      `news_items?tenant_id=eq.${tenantId}&order=display_order.asc,created_at.desc`
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    return res.status(200).json({ news: await r.json() });
  }

  if (req.method === "POST") {
    let patch;
    try { patch = buildPatch(req.body || {}); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    if (!patch.title || !patch.body) {
      return res.status(400).json({ error: "title + body required to create" });
    }
    patch.tenant_id = tenantId;
    const r = await sb(key, "news_items", {
      method: "POST",
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(500).json({ error: "create failed", detail: await r.text() });
    return res.status(200).json((await r.json())[0]);
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    let patch;
    try { patch = buildPatch(req.body || {}); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no fields to update" });
    }
    const r = await sb(
      key,
      `news_items?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    if (!r.ok) return res.status(500).json({ error: "update failed", detail: await r.text() });
    const rows = await r.json();
    if (rows.length === 0) return res.status(404).json({ error: "not found" });
    return res.status(200).json(rows[0]);
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const r = await sb(
      key,
      `news_items?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,
      { method: "DELETE" }
    );
    if (!r.ok) return res.status(500).json({ error: "delete failed" });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
