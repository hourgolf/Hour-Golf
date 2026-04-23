import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";
import { logActivity } from "../../lib/activity-log";

// Admin CRUD for discount_codes.
// GET                  list all codes for the tenant
// POST  body = row     create
// PATCH ?id= body=row  update
// DELETE ?id=          delete
//
// Codes are stored verbatim (operator-entered casing preserved for
// display) but matched case-insensitively at checkout via the
// unique index on upper(code). That means two codes differing only
// in case collide on insert — the DB rejects, we surface as a 409.

const EDITABLE_FIELDS = [
  "code", "type", "value", "min_order_cents", "expires_at",
  "usage_limit_total", "usage_limit_per_member", "is_active",
  "scope", "description",
];

function sanitize(body) {
  const out = {};
  for (const f of EDITABLE_FIELDS) {
    if (body[f] === undefined) continue;
    if (body[f] === "" || body[f] === null) {
      out[f] = null;
      continue;
    }
    if (["value", "min_order_cents", "usage_limit_total", "usage_limit_per_member"].includes(f)) {
      out[f] = Number(body[f]);
    } else if (f === "is_active") {
      out[f] = !!body[f];
    } else {
      out[f] = String(body[f]).trim();
    }
  }
  return out;
}

export default async function handler(req, res) {
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });

  try {
    if (req.method === "GET") {
      const r = await sb(`discount_codes?tenant_id=eq.${tenantId}&order=created_at.desc`);
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = sanitize(req.body || {});
      if (!body.code || !body.type || body.value === undefined || body.value === null) {
        return res.status(400).json({ error: "code, type, and value are required" });
      }
      if (body.type !== "percent" && body.type !== "amount") {
        return res.status(400).json({ error: "type must be 'percent' or 'amount'" });
      }
      const r = await sb("discount_codes", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, ...body }),
      });
      if (!r.ok) {
        const text = await r.text();
        if (r.status === 409 || /duplicate key/i.test(text)) {
          return res.status(409).json({ error: "A code with that name already exists" });
        }
        throw new Error(text);
      }
      const rows = await r.json();
      await logActivity({
        tenantId,
        actor: { id: user.id, email: user.email },
        action: "discount_code.created",
        targetType: "discount_code",
        targetId: rows[0]?.id,
        metadata: { code: body.code, type: body.type, value: body.value },
      });
      return res.status(201).json(rows[0]);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const body = sanitize(req.body || {});
      const r = await sb(`discount_codes?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      await logActivity({
        tenantId,
        actor: { id: user.id, email: user.email },
        action: "discount_code.updated",
        targetType: "discount_code",
        targetId: id,
        metadata: { fields_changed: Object.keys(body) },
      });
      return res.status(200).json(rows[0] || null);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const r = await sb(`discount_codes?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      await logActivity({
        tenantId,
        actor: { id: user.id, email: user.email },
        action: "discount_code.deleted",
        targetType: "discount_code",
        targetId: id,
      });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-discount-codes error:", e);
    return res.status(500).json({ error: e.message });
  }
}
