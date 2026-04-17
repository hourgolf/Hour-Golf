// Server-side auth for the super-admin surface at /platform.
//
// Mirrors lib/api-helpers.js:verifyAdmin but checks platform_admins
// instead of admins, and does NOT tenant-scope the check — platform
// admins operate across all tenants by design.
//
// Auth model:
//   1. Client signs in via supabase.auth.signInWithPassword (same as
//      tenant admins — we reuse Supabase Auth).
//   2. JWT is sent as `Authorization: Bearer <token>` to platform APIs.
//   3. verifyPlatformAdmin validates the JWT with Supabase Auth, then
//      checks that the user's id appears in public.platform_admins.
//
// No session-cookie layer. platform_admin_sessions exists in schema but
// is unused — Supabase Auth already manages session + refresh. If we
// later want cookie-based platform sessions (e.g. for SSR-rendered
// pages), we'd wire it in then; not needed for v1.

import { SUPABASE_URL, getAnonKey, getServiceKey } from "./api-helpers";

export async function verifyPlatformAdmin(req) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.replace("Bearer ", "") : "";
    if (!token) return { user: null, reason: "missing_bearer_token" };

    const anon = getAnonKey();
    if (!anon) return { user: null, reason: "missing_anon_env" };

    const service = getServiceKey();
    if (!service) return { user: null, reason: "missing_service_env" };

    let userResp;
    try {
      userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      return { user: null, reason: `auth_user_fetch_failed:${e?.message || e}` };
    }
    if (!userResp.ok) {
      return { user: null, reason: `auth_user_${userResp.status}` };
    }
    const user = await userResp.json();
    if (!user?.id) return { user: null, reason: "no_user_id" };

    let paResp;
    try {
      paResp = await fetch(
        `${SUPABASE_URL}/rest/v1/platform_admins?user_id=eq.${user.id}&select=user_id,email,display_name`,
        { headers: { apikey: service, Authorization: `Bearer ${service}` } }
      );
    } catch (e) {
      return { user: null, reason: `platform_admins_fetch_failed:${e?.message || e}` };
    }
    if (!paResp.ok) {
      return { user: null, reason: `platform_admins_query_${paResp.status}` };
    }
    const rows = await paResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { user: null, reason: "not_in_platform_admins" };
    }

    return { user, platformAdmin: rows[0], reason: null };
  } catch (e) {
    return { user: null, reason: `exception:${e?.message || e}` };
  }
}
