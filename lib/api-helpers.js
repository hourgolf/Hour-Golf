// Shared helper for portal API routes to get Supabase credentials
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";

export function getSupabaseKey(req) {
  // 1. env var (production)
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  // 2. x-api-key header (portal client sends from localStorage)
  const headerKey = req.headers["x-api-key"];
  if (headerKey) return headerKey;
  // 3. Authorization Bearer token (admin client)
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.replace("Bearer ", "");
  return null;
}

export function supaFetch(key, table, params = "") {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
}
