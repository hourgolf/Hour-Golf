// Server-side helpers for API routes.
// All Supabase calls from API routes use the service_role key, which bypasses
// Row Level Security. The service role key is server-only and never exposed
// to the browser bundle.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";

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

// Verify a request comes from a signed-in admin.
// 1) Pull the JWT from the Authorization header
// 2) Ask Supabase Auth who the JWT belongs to
// 3) Check that user_id appears in the public.admins table
//
// Returns { user, reason }. On success: { user: {...}, reason: null }.
// On failure: { user: null, reason: "<short code>" }.
// The reason makes 401s actionable (which step actually failed).
export async function verifyAdmin(req) {
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

    let adminResp;
    try {
      adminResp = await fetch(
        `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${user.id}&select=user_id`,
        { headers: { apikey: service, Authorization: `Bearer ${service}` } }
      );
    } catch (e) {
      return { user: null, reason: `admins_fetch_failed:${e?.message || e}` };
    }
    if (!adminResp.ok) {
      return { user: null, reason: `admins_query_${adminResp.status}` };
    }
    const rows = await adminResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { user: null, reason: "not_in_admins" };
    }

    return { user, reason: null };
  } catch (e) {
    return { user: null, reason: `exception:${e?.message || e}` };
  }
}
