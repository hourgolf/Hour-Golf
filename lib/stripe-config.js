// Server-side loader for per-tenant Stripe configuration.
//
// Mirrors the cache pattern in lib/branding.js: module-scope Map, 60s TTL,
// explicit invalidate hook. Critical differences:
//
//   * Uses the SERVICE_ROLE key, not the anon key. The `tenant_stripe_config`
//     table has RLS enabled with NO policies — anon gets zero rows. Only
//     service_role can read it.
//
//   * MUST only be imported from server-side contexts — API routes via
//     pages/api/*. Never from _document.js, _app.js, or any component.
//     Importing client-side would ship SUPABASE_SERVICE_ROLE_KEY reads into
//     the browser bundle. Both are safe at build time because Node-only
//     APIs like `process.env.SUPABASE_SERVICE_ROLE_KEY` simply resolve to
//     undefined in the browser, but the helper would silently return null
//     and mask real bugs. Guard rail: we throw early if called without a
//     service-role key present.
//
//   * No fallback object. If a tenant has no stripe config row,
//     getStripeClient(tenantId) throws. Silently falling back to
//     process.env.STRIPE_SECRET_KEY would route other tenants' payments
//     through Hour Golf's account — exactly the bug Phase 7 is fixing.
//
// Callers migrate one-by-one in Phase 7B:
//   import { getStripeClient } from "../../lib/stripe-config";
//   const stripe = await getStripeClient(tenantId);
//   // ...use stripe as before...

import Stripe from "stripe";

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

// Load the raw stripe_config row for a tenant.
// Returns the config object or null if no row exists / fetch fails.
//
// Shape:
//   {
//     tenant_id: string,
//     mode: "test" | "live",
//     secret_key: string,
//     publishable_key: string,
//     webhook_secret: string | null,
//     enabled: boolean,
//   }
export async function loadStripeConfig(tenantId) {
  if (!tenantId) return null;

  const cached = getCached(tenantId);
  if (cached) return cached;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !SUPABASE_URL) {
    // Intentionally throw so we fail loudly during rollout rather than
    // silently returning null and masking a misconfigured environment.
    throw new Error(
      "stripe-config: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not set. This module must run server-side only."
    );
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_stripe_config?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal:
          typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(2000)
            : undefined,
      }
    );
    if (!resp.ok) {
      // Do NOT cache a failure — next call retries. Branding caches the
      // fallback object, but here null means "this tenant literally has no
      // config", which is important for getStripeClient to throw correctly.
      return null;
    }
    const rows = await resp.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (row) setCached(tenantId, row);
    return row;
  } catch {
    return null;
  }
}

// Return an initialized Stripe client scoped to the tenant's keys.
// Throws if the tenant has no config or the kill-switch is off. Callers
// should surface the throw as a clear HTTP 503 so admins can see the
// tenant is not payment-enabled yet.
export async function getStripeClient(tenantId) {
  const cfg = await loadStripeConfig(tenantId);
  if (!cfg) {
    throw new Error(
      `stripe-config: no tenant_stripe_config row for tenant ${tenantId}. Seed via the super-admin UI or Supabase SQL editor.`
    );
  }
  if (!cfg.enabled) {
    throw new Error(
      `stripe-config: Stripe is disabled (enabled=false) for tenant ${tenantId}.`
    );
  }
  if (!cfg.secret_key) {
    // Should be impossible given NOT NULL on the column, but guard anyway.
    throw new Error(`stripe-config: secret_key missing for tenant ${tenantId}.`);
  }
  return new Stripe(cfg.secret_key);
}

// Invalidate a tenant's cached stripe config. Call from the super-admin
// PATCH handler when keys are rotated so the next request picks up the
// new values instead of waiting up to 60s.
export function invalidateStripeConfig(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
