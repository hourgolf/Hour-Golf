// Server-side helpers for API routes.
// All Supabase calls from API routes use the service_role key, which bypasses
// Row Level Security. The service role key is server-only and never exposed
// to the browser bundle.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";

export function getServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
}

// Legacy alias used by older endpoints. Always returns the service role key
// now — we ignore client-supplied keys to keep RLS meaningful.
export function getSupabaseKey(_req) {
  return getServiceKey();
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
// Returns the user object on success, or null on any failure.
export async function verifyAdmin(req) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.replace("Bearer ", "") : "";
    if (!token) return null;

    const anon = process.env.SUPABASE_ANON_KEY || "";
    if (!anon) return null;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    if (!userResp.ok) return null;
    const user = await userResp.json();
    if (!user?.id) return null;

    const service = getServiceKey();
    const adminResp = await fetch(
      `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${user.id}&select=user_id`,
      { headers: { apikey: service, Authorization: `Bearer ${service}` } }
    );
    if (!adminResp.ok) return null;
    const rows = await adminResp.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    return user;
  } catch {
    return null;
  }
}
