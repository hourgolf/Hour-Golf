import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./constants";

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Singleton Supabase client used for auth (signIn, signOut, session restore).
// We pass anon key here; per-user JWT comes from the active session.
export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "hg-auth",
  },
});

const SB = SUPABASE_URL;

// All REST calls need the public anon key in the apikey header AND a Bearer
// token (the user's JWT after login, or anon key when unauthenticated).
function headers(jwt) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt || ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function supa(jwt, table, params = "") {
  const r = await fetch(`${SB}/rest/v1/${table}${params}`, { headers: headers(jwt) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function supaPost(jwt, table, data) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(jwt), Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function supaPatch(jwt, table, match, data) {
  const p = Object.entries(match)
    .map(([a, b]) => `${a}=eq.${encodeURIComponent(b)}`)
    .join("&");
  const r = await fetch(`${SB}/rest/v1/${table}?${p}`, {
    method: "PATCH",
    headers: headers(jwt),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function supaDelete(jwt, table, match) {
  const p = Object.entries(match)
    .map(([a, b]) => `${a}=eq.${encodeURIComponent(b)}`)
    .join("&");
  const r = await fetch(`${SB}/rest/v1/${table}?${p}`, {
    method: "DELETE",
    headers: headers(jwt),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
