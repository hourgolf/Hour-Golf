import { SUPABASE_URL } from "./constants";

const SB = SUPABASE_URL;

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function supa(key, table, params = "") {
  const r = await fetch(`${SB}/rest/v1/${table}${params}`, { headers: headers(key) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function supaPost(key, table, data) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(key), Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function supaPatch(key, table, match, data) {
  const p = Object.entries(match)
    .map(([a, b]) => `${a}=eq.${encodeURIComponent(b)}`)
    .join("&");
  const r = await fetch(`${SB}/rest/v1/${table}?${p}`, {
    method: "PATCH",
    headers: headers(key),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function supaDelete(key, table, match) {
  const p = Object.entries(match)
    .map(([a, b]) => `${a}=eq.${encodeURIComponent(b)}`)
    .join("&");
  const r = await fetch(`${SB}/rest/v1/${table}?${p}`, {
    method: "DELETE",
    headers: headers(key),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
