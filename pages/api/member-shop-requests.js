// /api/member-shop-requests
//
// GET               -> list this member's requests (newest first)
// POST              -> create a new request
// PATCH ?id=<uuid>  -> cancel own request (only if still pending /
//                      acknowledged — admin-owned transitions are
//                      off-limits)

import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import { sendShopRequestAdminNotification } from "../../lib/email";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

const TRIMMABLE_STRING_FIELDS = [
  "item_name", "brand", "size", "color",
  "budget_range", "reference_url", "notes",
  "member_phone",
];

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const session = await getSessionWithMember({ token, tenantId, touch: false });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const member = session.member;

  // ── GET: list my requests ──────────────────────────────────────────
  if (req.method === "GET") {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_requests?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(member.email)}&order=created_at.desc&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return res.status(500).json({ error: "lookup failed" });
    return res.status(200).json({ requests: await r.json() });
  }

  // ── POST: create request ───────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body || {};
    if (!body.item_name || String(body.item_name).trim().length === 0) {
      return res.status(400).json({ error: "item_name is required" });
    }
    const qty = Math.max(1, Number(body.quantity) || 1);
    if (qty > 100) return res.status(400).json({ error: "quantity too large" });

    const row = {
      tenant_id: tenantId,
      member_email: member.email,
      member_name: body.member_name ? String(body.member_name).slice(0, 200) : (member.name || member.email),
      quantity: qty,
    };
    for (const f of TRIMMABLE_STRING_FIELDS) {
      if (body[f] !== undefined) {
        const s = String(body[f] || "").trim();
        row[f] = s ? s.slice(0, 2000) : null;
      }
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_requests`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      return res.status(500).json({ error: "create failed", detail: await r.text() });
    }
    const created = (await r.json())[0];

    // Admin notification — best effort, never blocks the response.
    try {
      await sendShopRequestAdminNotification({
        tenantId,
        request: created,
      });
    } catch (e) {
      console.error("member-shop-requests: admin notification failed:", e.message);
    }

    return res.status(200).json({ request: created });
  }

  // ── PATCH: cancel my request ───────────────────────────────────────
  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const body = req.body || {};

    // Members can only set status to 'cancelled', and only on their own
    // requests in a pre-fulfillment state. Anything else is an
    // admin-owned transition.
    const cancellableFrom = new Set(["pending", "acknowledged", "ordering"]);
    if (body.status !== "cancelled") {
      return res.status(400).json({ error: "members can only cancel a request" });
    }

    // Look up first so we can check status + ownership.
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_requests?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}&select=id,status,member_email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const rows = lookup.ok ? await lookup.json() : [];
    const target = rows[0];
    if (!target) return res.status(404).json({ error: "not found" });
    if (target.member_email !== member.email) {
      return res.status(403).json({ error: "not your request" });
    }
    if (!cancellableFrom.has(target.status)) {
      return res.status(400).json({ error: "this request can no longer be cancelled" });
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_requests?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: "cancelled" }),
      }
    );
    if (!r.ok) return res.status(500).json({ error: "update failed" });
    return res.status(200).json({ request: (await r.json())[0] });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
