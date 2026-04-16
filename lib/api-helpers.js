// Server-side helpers for API routes.
// All Supabase calls from API routes use the service_role key, which bypasses
// Row Level Security. The service role key is server-only and never exposed
// to the browser bundle.

import { HOURGOLF_TENANT_ID } from "./constants";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";

// Resolve the tenant for an incoming request.
//
// Reads the x-tenant-id header set by middleware.js. Falls back to Hour Golf
// if the header is missing — which happens when:
//   - Called outside of a request (background jobs, scripts)
//   - Webhook endpoints that bypass middleware (Stripe, Skedda)
//   - Tests that construct a mock req without going through middleware
//
// This fallback is intentional: with a single tenant and service-role DB
// access, returning Hour Golf is always safe. Once a second tenant exists,
// webhook endpoints need explicit tenant resolution from payload (see Phase 7).
export function getTenantId(req) {
  const headerValue = req?.headers?.["x-tenant-id"];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }
  return HOURGOLF_TENANT_ID;
}

export function getServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function getAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

// Legacy alias used by older endpoints. Always returns the service role key
// now — we ignore client-supplied keys to keep RLS meaningful.
export function getSupabaseKey(_req) {
  return getServiceKey() || getAnonKey();
}

export function supaFetch(key, table, params = "") {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
}

// Verify a request comes from a signed-in admin whose tenant matches the
// tenant this request is scoped to (from middleware.js, via x-tenant-id).
// 1) Pull the JWT from the Authorization header
// 2) Ask Supabase Auth who the JWT belongs to
// 3) Resolve request tenant via getTenantId(req)
// 4) Check that (user_id, tenant_id) appears in public.admins
//
// Returns { user, tenantId, reason }. On success: { user, tenantId, reason: null }.
// On failure: { user: null, tenantId: null, reason: "<short code>" }.
//
// The tenant filter means a Hour Golf admin attempting to hit an admin
// endpoint on a different tenant's subdomain will 401 with reason
// "not_in_admins" rather than operating on the wrong tenant's data.
export async function verifyAdmin(req) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.replace("Bearer ", "") : "";
    if (!token) return { user: null, tenantId: null, reason: "missing_bearer_token" };

    const anon = getAnonKey();
    if (!anon) return { user: null, tenantId: null, reason: "missing_anon_env" };

    const service = getServiceKey();
    if (!service) return { user: null, tenantId: null, reason: "missing_service_env" };

    const tenantId = getTenantId(req);

    let userResp;
    try {
      userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      return { user: null, tenantId: null, reason: `auth_user_fetch_failed:${e?.message || e}` };
    }
    if (!userResp.ok) {
      return { user: null, tenantId: null, reason: `auth_user_${userResp.status}` };
    }
    const user = await userResp.json();
    if (!user?.id) return { user: null, tenantId: null, reason: "no_user_id" };

    let adminResp;
    try {
      adminResp = await fetch(
        `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${user.id}&tenant_id=eq.${tenantId}&select=user_id`,
        { headers: { apikey: service, Authorization: `Bearer ${service}` } }
      );
    } catch (e) {
      return { user: null, tenantId: null, reason: `admins_fetch_failed:${e?.message || e}` };
    }
    if (!adminResp.ok) {
      return { user: null, tenantId: null, reason: `admins_query_${adminResp.status}` };
    }
    const rows = await adminResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { user: null, tenantId: null, reason: "not_in_admins" };
    }

    return { user, tenantId, reason: null };
  } catch (e) {
    return { user: null, tenantId: null, reason: `exception:${e?.message || e}` };
  }
}
