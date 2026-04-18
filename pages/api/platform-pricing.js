// GET   /api/platform-pricing          — list all pricing rows
// PATCH /api/platform-pricing          — update one row
//   body: { unit_key, monthly_price_cents?, is_active?, label?, description? }
//
// Platform-admin only. Changing a row triggers a best-effort refresh of
// every tenant's cost snapshot so the tenant list + detail pages show
// the new totals on the next render.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { loadPlatformPricing, refreshTenantCostSnapshot } from "../../lib/platform-billing";

const EDITABLE_FIELDS = [
  "monthly_price_cents",
  "is_active",
  "label",
  "description",
  "sort_order",
];

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    try {
      const rows = await loadPlatformPricing();
      return res.status(200).json({ pricing: rows });
    } catch (e) {
      return res.status(500).json({ error: "Load failed", detail: e.message });
    }
  }

  if (req.method === "PATCH") {
    const { unit_key, ...rest } = req.body || {};
    if (!unit_key || typeof unit_key !== "string") {
      return res.status(400).json({ error: "unit_key required" });
    }

    // Whitelist + validate payload
    const payload = {};
    for (const field of EDITABLE_FIELDS) {
      if (!(field in rest)) continue;
      const value = rest[field];
      if (field === "monthly_price_cents") {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
          return res.status(400).json({ error: `${field} must be an integer between 0 and 1,000,000` });
        }
        payload[field] = Math.round(n);
      } else if (field === "is_active") {
        payload[field] = !!value;
      } else if (field === "sort_order") {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          return res.status(400).json({ error: `${field} must be an integer` });
        }
        payload[field] = Math.round(n);
      } else {
        if (value !== null && typeof value !== "string") {
          return res.status(400).json({ error: `${field} must be a string or null` });
        }
        if (value && value.length > 500) {
          return res.status(400).json({ error: `${field} too long (max 500 chars)` });
        }
        payload[field] = value || null;
      }
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No editable fields in body" });
    }

    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_pricing?unit_key=eq.${encodeURIComponent(unit_key)}`,
        {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(payload),
        }
      );
      if (!resp.ok) {
        return res.status(500).json({ error: "Update failed", detail: await resp.text() });
      }
      const rows = await resp.json();
      if (!rows[0]) {
        return res.status(404).json({ error: "unit_key not found" });
      }

      // Best-effort: recompute every tenant's cost snapshot so any cached
      // monthly_cost_cents value reflects the new pricing. Done inline
      // (not background) because /platform/pricing is low-traffic and
      // we want the next tenant detail page load to already be correct.
      try {
        await refreshAllTenantSnapshots(key);
      } catch (e) {
        console.warn("refreshAllTenantSnapshots failed:", e.message);
      }

      return res.status(200).json({ row: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: "Update failed", detail: e.message });
    }
  }

  return res.status(405).json({ error: "GET or PATCH only" });
}

// Pull every (tenant, enabled-features) tuple, then refresh their cost
// snapshots. Bounded loop — current tenant count is low single digits
// and will realistically stay <100 in the foreseeable future.
async function refreshAllTenantSnapshots(key) {
  const tenantsResp = await fetch(
    `${SUPABASE_URL}/rest/v1/tenants?select=id,tenant_features(feature_key,enabled)`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!tenantsResp.ok) throw new Error("tenants fetch failed");
  const tenants = await tenantsResp.json();

  for (const t of tenants) {
    const enabled = (t.tenant_features || [])
      .filter((f) => f.enabled)
      .map((f) => f.feature_key);
    await refreshTenantCostSnapshot(t.id, enabled);
  }
}
