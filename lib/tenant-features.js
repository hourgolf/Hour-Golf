// Server-side tenant feature-flag loader with in-memory cache.
//
// Called from _document.js (SSR) and lib/feature-guard.js (API routes).
// Uses the anon key — tenant_features has an anon-read RLS policy
// (20260417160000_tenant_features_anon_read.sql). Service-role writes
// continue to go through /api/platform-tenant-features.
//
// Returns a flat { feature_key: boolean } object for a given tenant.
// Fail-open semantics: any lookup failure OR missing key defaults to
// `true`, so Hour Golf keeps working if the DB is unreachable or a new
// feature_key is referenced before its row lands. This is intentional
// — gating a broken lookup off would brick production; gating it on is
// at worst a brief exposure that resolves on next cache refresh.

const HOURGOLF_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CACHE_TTL_MS = 60_000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxpkqbioxoezjmcoylkw.supabase.co";

// The canonical set of feature keys. useTenantFeatures + assertFeature
// accept any key, but the loader guarantees every one of these is
// present in the returned object (as either its DB value or true).
//
// Must stay in sync with:
//   - The seed in 20260417000000_multitenant_foundation.sql
//   - ALLOWED_FEATURE_KEYS in pages/api/platform-tenant-features.js
//   - FEATURE_KEYS in pages/platform/tenants/[slug].js
export const KNOWN_FEATURE_KEYS = [
  "bookings",
  "pro_shop",
  "loyalty",
  "events",
  "punch_passes",
  "subscriptions",
  "stripe_enabled",
  "email_notifications",
  "access_codes",
];

// Default object: every known feature enabled. Used when a tenant has no
// rows or on fetch failure. Callers should treat this as "open by
// default" — features are opt-out per tenant, not opt-in.
function defaultFeatures() {
  const out = {};
  for (const k of KNOWN_FEATURE_KEYS) out[k] = true;
  return out;
}

const cache = new Map(); // tenantId -> { value, cachedAt }

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

// Load features for a tenant. Always returns a complete { key: bool }
// object covering every entry in KNOWN_FEATURE_KEYS.
export async function loadFeatures(tenantId) {
  if (!tenantId) tenantId = HOURGOLF_TENANT_ID;

  const cached = getCached(tenantId);
  if (cached) return cached;

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon || !SUPABASE_URL) return defaultFeatures();

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_features?tenant_id=eq.${encodeURIComponent(tenantId)}&select=feature_key,enabled`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        signal:
          typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(1000)
            : undefined,
      }
    );
    if (!resp.ok) {
      // Don't cache the failure — next request retries. Safer than
      // caching "all on" when the real answer might be mixed.
      return defaultFeatures();
    }
    const rows = await resp.json();
    const out = defaultFeatures();
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (r && typeof r.feature_key === "string") {
          out[r.feature_key] = !!r.enabled;
        }
      }
    }
    setCached(tenantId, out);
    return out;
  } catch {
    return defaultFeatures();
  }
}

// Flush the cache for one tenant (or all). Called by the super-admin
// PATCH endpoint so toggles show up within the current request cycle
// instead of waiting the full TTL.
export function invalidateFeatures(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

// Tiny read helper: is this feature on for this features object?
// Missing keys default to true (fail-open, matches the loader).
export function isFeatureEnabled(features, key) {
  if (!features || typeof features !== "object") return true;
  if (!(key in features)) return true;
  return features[key] !== false;
}
