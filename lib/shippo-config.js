// Server-side loader for per-tenant Shippo (shipping carrier API)
// configuration. Mirrors lib/stripe-config.js / square-config.js /
// seam-config.js: 60s TTL cache, service-role fetch, explicit
// invalidate hook for the platform-admin PATCH path.

const CACHE_TTL_MS = 60_000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxpkqbioxoezjmcoylkw.supabase.co";

const cache = new Map();

function getCached(tenantId) {
  const entry = cache.get(tenantId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(tenantId);
    return null;
  }
  return entry.value;
}

function setCached(tenantId, value) {
  cache.set(tenantId, { value, cachedAt: Date.now() });
}

// Returns the raw row or null. Shape mirrors the table columns.
export async function loadShippoConfig(tenantId) {
  if (!tenantId) return null;
  const cached = getCached(tenantId);
  if (cached) return cached;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !SUPABASE_URL) {
    throw new Error(
      "shippo-config: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not set."
    );
  }
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_shippo_config?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(2000)
          : undefined,
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (row) setCached(tenantId, row);
    return row;
  } catch { return null; }
}

// Returns { apiKey, originAddress } or throws. Caller surfaces the
// throw so admins see why shipping isn't available.
export async function getShippoCredentials(tenantId) {
  const cfg = await loadShippoConfig(tenantId);
  if (!cfg) {
    throw new Error(
      `shippo-config: no tenant_shippo_config row for tenant ${tenantId}. Add via /platform/tenants/<slug> -> Shippo.`
    );
  }
  if (!cfg.enabled) {
    throw new Error(`shippo-config: Shippo disabled for tenant ${tenantId}.`);
  }
  if (!cfg.api_key || !cfg.origin_street1 || !cfg.origin_city || !cfg.origin_state || !cfg.origin_zip) {
    throw new Error(`shippo-config: api_key or origin address incomplete for tenant ${tenantId}.`);
  }
  return {
    apiKey: cfg.api_key,
    originAddress: {
      name: cfg.origin_name || "",
      company: cfg.origin_company || "",
      street1: cfg.origin_street1,
      street2: cfg.origin_street2 || "",
      city: cfg.origin_city,
      state: cfg.origin_state,
      zip: cfg.origin_zip,
      country: cfg.origin_country || "US",
      phone: cfg.origin_phone || "",
      email: cfg.origin_email || "",
    },
  };
}

export function invalidateShippoConfig(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
