// PATCH /api/platform-tenant-features
// Toggle a single feature on/off for a tenant. Upserts on
// (tenant_id, feature_key) so it works whether the row exists yet or
// not.
//
// Body:
//   tenant_id    (REQUIRED) uuid
//   feature_key  (REQUIRED) one of ALLOWED_FEATURE_KEYS
//   enabled      (REQUIRED) boolean
//
// Note: nothing in the app reads tenant_features yet (Phase 4 wires it
// up). This endpoint lets the super-admin set values today so the data
// is ready when assertFeature / useTenantFeatures land.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { invalidateFeatures } from "../../lib/tenant-features";

// Only keys already seeded for Hour Golf in the Phase 1 migration. Adding
// a new key later means inserting a row for every tenant first, so we
// gate writes to this known set for now.
const ALLOWED_FEATURE_KEYS = new Set([
  "bookings",
  "pro_shop",
  "loyalty",
  "events",
  "punch_passes",
  "subscriptions",
  "stripe_enabled",
  "email_notifications",
]);

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "PATCH only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const body = req.body || {};
  const tenantId = body.tenant_id;
  const featureKey = body.feature_key;
  const enabled = body.enabled;

  if (!isUuid(tenantId)) return res.status(400).json({ error: "tenant_id must be a valid uuid" });
  if (!ALLOWED_FEATURE_KEYS.has(featureKey)) {
    return res.status(400).json({
      error: "feature_key not allowed",
      detail: `Must be one of: ${[...ALLOWED_FEATURE_KEYS].join(", ")}`,
    });
  }
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be boolean" });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // Upsert on (tenant_id, feature_key). PostgREST: use on_conflict.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_features?on_conflict=tenant_id,feature_key`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          feature_key: featureKey,
          enabled,
        }),
      }
    );
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const rows = await r.json();

    // Flush the in-memory feature-flags cache so the next page render
    // or API request reads the fresh value instead of the stale cached
    // one (up to 60s otherwise).
    invalidateFeatures(tenantId);

    return res.status(200).json(rows[0] || { tenant_id: tenantId, feature_key: featureKey, enabled });
  } catch (e) {
    console.error("platform-tenant-features error:", e);
    return res.status(500).json({ error: "Update failed", detail: e.message });
  }
}
