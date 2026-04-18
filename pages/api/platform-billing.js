// GET   /api/platform-billing?tenant_id=<uuid>
//   → { billing: {...}, pricing: [...], enabled_keys: [...], breakdown: [...] }
//
// PATCH /api/platform-billing
//   body: { tenant_id, status?, notes?, stripe_customer_id?, stripe_subscription_id? }
//   → { billing: {...} }
//
// Platform-admin only. PATCH is intentionally narrow: the goal for the
// current phase is just to let the platform admin manually set status
// ("trialing", "suspended", etc.) and jot notes. The real Stripe
// Customer+Subscription creation flow lands in Phase 2 when Ourlee's
// own Stripe account is wired in.

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import {
  loadPlatformPricing,
  loadTenantBilling,
  computeMonthlyCostCents,
  refreshTenantCostSnapshot,
} from "../../lib/platform-billing";

const EDITABLE_FIELDS = [
  "status",
  "notes",
  "stripe_customer_id",
  "stripe_subscription_id",
];

const VALID_STATUSES = new Set([
  "not_enrolled",
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default async function handler(req, res) {
  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  if (req.method === "GET") {
    const tenantId = req.query.tenant_id;
    if (!isUuid(tenantId)) {
      return res.status(400).json({ error: "tenant_id must be a valid uuid" });
    }

    try {
      const [pricing, billing, featuresResp] = await Promise.all([
        loadPlatformPricing(),
        loadTenantBilling(tenantId),
        fetch(
          `${SUPABASE_URL}/rest/v1/tenant_features?tenant_id=eq.${encodeURIComponent(tenantId)}&select=feature_key,enabled`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        ),
      ]);
      const features = featuresResp.ok ? await featuresResp.json() : [];
      const enabledKeys = features.filter((f) => f.enabled).map((f) => f.feature_key);

      // Per-line-item breakdown for the UI table
      const breakdown = [];
      for (const row of pricing) {
        if (!row.is_active) continue;
        if (row.kind === "base") {
          breakdown.push({
            unit_key: row.unit_key,
            label: row.label,
            kind: row.kind,
            monthly_price_cents: row.monthly_price_cents,
            applies: true,
          });
        } else if (row.kind === "feature") {
          breakdown.push({
            unit_key: row.unit_key,
            label: row.label,
            kind: row.kind,
            monthly_price_cents: row.monthly_price_cents,
            applies: enabledKeys.includes(row.unit_key),
          });
        }
      }

      const computedMonthly = computeMonthlyCostCents(enabledKeys, pricing);
      const cachedMonthly = billing?.monthly_cost_cents ?? 0;
      const drift = computedMonthly !== cachedMonthly;

      return res.status(200).json({
        billing,
        pricing,
        enabled_keys: enabledKeys,
        breakdown,
        computed_monthly_cents: computedMonthly,
        cached_monthly_cents: cachedMonthly,
        drift,
      });
    } catch (e) {
      return res.status(500).json({ error: "Load failed", detail: e.message });
    }
  }

  if (req.method === "PATCH") {
    const { tenant_id, ...rest } = req.body || {};
    if (!isUuid(tenant_id)) {
      return res.status(400).json({ error: "tenant_id must be a valid uuid" });
    }

    const payload = {};
    for (const field of EDITABLE_FIELDS) {
      if (!(field in rest)) continue;
      const value = rest[field];
      if (field === "status") {
        if (!VALID_STATUSES.has(value)) {
          return res.status(400).json({ error: `status must be one of ${[...VALID_STATUSES].join(", ")}` });
        }
        payload[field] = value;
      } else {
        if (value !== null && typeof value !== "string") {
          return res.status(400).json({ error: `${field} must be a string or null` });
        }
        if (value && value.length > 1000) {
          return res.status(400).json({ error: `${field} too long (max 1000 chars)` });
        }
        payload[field] = value || null;
      }
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "No editable fields in body" });
    }

    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_billing?tenant_id=eq.${encodeURIComponent(tenant_id)}`,
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
      return res.status(200).json({ billing: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: "Update failed", detail: e.message });
    }
  }

  return res.status(405).json({ error: "GET or PATCH only" });
}

// Exported for the features toggle endpoint to call after a toggle.
export async function handleFeatureToggleRecompute(tenantId) {
  const key = getServiceKey();
  if (!key) return;
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/tenant_features?tenant_id=eq.${encodeURIComponent(tenantId)}&select=feature_key,enabled`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!resp.ok) return;
  const features = await resp.json();
  const enabled = features.filter((f) => f.enabled).map((f) => f.feature_key);
  try {
    await refreshTenantCostSnapshot(tenantId, enabled);
  } catch {
    /* best effort */
  }
}
