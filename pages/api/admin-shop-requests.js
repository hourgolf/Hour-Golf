// /api/admin-shop-requests
//
// GET                -> list all requests for the tenant (newest first)
// PATCH ?id=<uuid>   -> update status / admin_response
//
// Status transitions are admin-owned with one exception (members can
// self-cancel via /api/member-shop-requests). When a status moves into
// 'in_stock' we fire the "ready for pickup" email to the requesting
// member — that's the only status-change email in MVP.

import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { sendShopRequestReadyEmail } from "../../lib/email";

const ALLOWED_STATUS = new Set([
  "pending", "acknowledged", "ordering", "in_stock", "declined", "cancelled",
]);

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const r = await sb(
      key,
      `shop_requests?tenant_id=eq.${tenantId}&order=created_at.desc`
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    return res.status(200).json({ requests: await r.json() });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const body = req.body || {};
    const patch = {};
    if ("status" in body) {
      if (!ALLOWED_STATUS.has(body.status)) {
        return res.status(400).json({ error: "invalid status" });
      }
      patch.status = body.status;
    }
    if ("admin_response" in body) {
      const v = body.admin_response;
      patch.admin_response = v ? String(v).slice(0, 2000) : null;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no fields to update" });
    }

    // Look up first so we can detect a transition INTO in_stock vs
    // already there — skip the email on idempotent re-saves.
    const lookup = await sb(
      key,
      `shop_requests?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=*`
    );
    const rows = lookup.ok ? await lookup.json() : [];
    const prev = rows[0];
    if (!prev) return res.status(404).json({ error: "not found" });

    const r = await sb(
      key,
      `shop_requests?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    if (!r.ok) return res.status(500).json({ error: "update failed", detail: await r.text() });
    const updated = (await r.json())[0];

    // "Ready for pickup" email on transition into in_stock.
    if (patch.status === "in_stock" && prev.status !== "in_stock") {
      try {
        await sendShopRequestReadyEmail({
          tenantId,
          to: updated.member_email,
          memberName: updated.member_name,
          itemName: updated.item_name,
          brand: updated.brand || null,
          size: updated.size || null,
          color: updated.color || null,
          quantity: Number(updated.quantity || 1),
          adminResponse: updated.admin_response || null,
        });
      } catch (e) {
        console.error("admin-shop-requests: ready email failed:", e.message);
      }
    }

    return res.status(200).json({ request: updated });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
