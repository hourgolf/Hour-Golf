// Server-side loader for per-tenant Square POS configuration.
//
// Mirrors lib/stripe-config.js and lib/seam-config.js: module-scope
// cache with 60s TTL, service-role fetch against tenant_square_config,
// explicit invalidate hook for the platform-admin PATCH path.
//
// Callers:
//   /api/admin-square-backfill — sync Square customers <-> members
//   /api/square-webhook/[slug] — verify + process POS payment webhooks
//   /api/admin-square-status    — expose config state to tenant admin UI

const CACHE_TTL_MS = 60_000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxpkqbioxoezjmcoylkw.supabase.co";

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

// Raw row or null. Shape:
//   {
//     tenant_id, environment, access_token, location_id,
//     application_id, webhook_signature_key, enabled,
//     created_at, updated_at,
//   }
export async function loadSquareConfig(tenantId) {
  if (!tenantId) return null;

  const cached = getCached(tenantId);
  if (cached) return cached;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !SUPABASE_URL) {
    throw new Error(
      "square-config: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not set. Server-side only."
    );
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_square_config?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal:
          typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(2000)
            : undefined,
      }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (row) setCached(tenantId, row);
    return row;
  } catch {
    return null;
  }
}

// Return { accessToken, locationId, applicationId, environment, apiBase }
// or throw. Callers surface the throw so admins see the state.
export async function getSquareCredentials(tenantId) {
  const cfg = await loadSquareConfig(tenantId);
  if (!cfg) {
    throw new Error(
      `square-config: no tenant_square_config row for tenant ${tenantId}. Add via /platform/tenants/<slug> → Square.`
    );
  }
  if (!cfg.enabled) {
    throw new Error(`square-config: Square disabled (enabled=false) for tenant ${tenantId}.`);
  }
  if (!cfg.access_token || !cfg.location_id) {
    throw new Error(`square-config: access_token or location_id missing for tenant ${tenantId}.`);
  }
  const apiBase =
    cfg.environment === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";
  return {
    accessToken: cfg.access_token,
    locationId: cfg.location_id,
    applicationId: cfg.application_id || null,
    webhookSignatureKey: cfg.webhook_signature_key || null,
    environment: cfg.environment,
    apiBase,
  };
}

// Flush cache on PATCH (mirrors invalidateStripeConfig / invalidateSeamConfig).
export function invalidateSquareConfig(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
