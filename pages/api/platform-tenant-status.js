// PATCH /api/platform-tenant-status
// Toggle a tenant's status between "active" and "suspended". Soft-
// delete only — hard delete is intentionally out of scope, since
// cascading across every tenant_id table is reversible only via DB
// backup. Suspended tenants:
//   * return 404 on their subdomain when MULTI_TENANT_STRICT=true
//   * remain visible in the platform dashboard so you can re-activate
//   * keep all their data intact (bookings, members, orders, etc.)

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const ALLOWED_STATUSES = new Set(["active", "suspended"]);

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "PATCH only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const { tenant_id, status } = req.body || {};
  if (!isUuid(tenant_id)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });
  if (!ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({
      error: "status must be 'active' or 'suspended'",
    });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenant_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) {
      const body = await r.text();
      return res.status(500).json({ error: "Update failed", detail: body });
    }
    const rows = await r.json();
    if (!rows.length) return res.status(404).json({ error: "Tenant not found" });
    return res.status(200).json(rows[0]);
  } catch (e) {
    console.error("platform-tenant-status error:", e);
    return res.status(500).json({ error: e.message });
  }
}
