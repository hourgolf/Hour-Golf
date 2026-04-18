// Platform billing helpers. Pure-ish — fetches from Supabase via service
// role and returns normalized objects. Used by:
//   - /api/platform-tenant (embeds pricing + cost on the tenant detail
//     response so the Billing tab renders without a second round-trip)
//   - /api/platform-billing (Billing tab enrollment actions — Phase 2)
//   - /api/platform-pricing (pricing admin page)

import { SUPABASE_URL, getServiceKey } from "./api-helpers";

// Compute a tenant's expected monthly cost in cents, given the list of
// enabled feature keys and the pricing rows.
//
// Rule:
//   base row (if active) + sum of (feature row for each enabled key, if active)
//
// Features without a corresponding active pricing row contribute 0.
// Features that are toggled off contribute 0 regardless of pricing.
export function computeMonthlyCostCents(enabledFeatureKeys, pricingRows) {
  if (!Array.isArray(pricingRows)) return 0;
  const byKey = new Map();
  for (const row of pricingRows) {
    if (!row || !row.is_active) continue;
    byKey.set(row.unit_key, row);
  }

  let total = 0;
  const base = byKey.get("base");
  if (base) total += base.monthly_price_cents || 0;

  const enabled = new Set(enabledFeatureKeys || []);
  for (const key of enabled) {
    const row = byKey.get(key);
    if (row && row.kind === "feature") total += row.monthly_price_cents || 0;
  }

  return total;
}

// Format a cent amount as a display string like "$0.00" or "$199.00".
// Centralized so every billing surface shows the same shape.
export function formatCentsUsd(cents) {
  const n = Number(cents || 0);
  return `$${(n / 100).toFixed(2)}`;
}

// Load all platform_pricing rows, sorted for display order.
export async function loadPlatformPricing() {
  const key = getServiceKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_pricing?select=*&order=sort_order.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!resp.ok) throw new Error(`platform_pricing load failed: ${resp.status}`);
  return resp.json();
}

// Load a single tenant's billing row. Returns null if none (though the
// auto-create trigger means every tenant should have one).
export async function loadTenantBilling(tenantId) {
  const key = getServiceKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/platform_billing?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!resp.ok) throw new Error(`platform_billing load failed: ${resp.status}`);
  const rows = await resp.json();
  return rows[0] || null;
}

// Recompute + persist a tenant's monthly cost snapshot. Called after a
// feature toggle or a pricing edit. Cheap — the math is just a few
// rows' summation.
export async function refreshTenantCostSnapshot(tenantId, enabledFeatureKeys) {
  const key = getServiceKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  const pricing = await loadPlatformPricing();
  const cents = computeMonthlyCostCents(enabledFeatureKeys, pricing);

  await fetch(
    `${SUPABASE_URL}/rest/v1/platform_billing?tenant_id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        monthly_cost_cents: cents,
        cost_snapshot_at: new Date().toISOString(),
      }),
    }
  );

  return cents;
}
