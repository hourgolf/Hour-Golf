// Server-side tenant branding loader with in-memory cache.
//
// Called from _document.js on every page request (SSR) and from the dynamic
// manifest.json route. Uses the anon key; the tenant_branding table has a
// public-read RLS policy for this reason.
//
// Cache sits at module scope so it persists across requests in a warm Node
// process (Vercel serverless instance). Cold start reloads. TTL is short
// so branding edits in the admin UI propagate within a minute.
//
// Tenant resolution: reads x-tenant-id header set by middleware.js. Falls
// back to Hour Golf if missing (tests, error paths).

const HOURGOLF_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CACHE_TTL_MS = 60_000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxpkqbioxoezjmcoylkw.supabase.co";

// Hour Golf's exact current branding — shipped as the fallback so a DB
// outage never unstyles the app for our most important tenant. Every key
// here matches a tenant_branding column; extras are derived defaults.
export const FALLBACK_BRANDING = {
  primary_color: "#4C8D73",
  accent_color: "#ddd480",
  danger_color: "#C92F1F",
  cream_color: "#EDF3E3",
  text_color: "#35443B",
  pwa_theme_color: "#4C8D73",
  logo_url: "/blobs/HG-Script-White.svg",
  background_image_url: null,
  font_display_name: "Biden Bold",
  font_display_url: "/fonts/BidenBold-Regular.woff2",
  font_body_family: "DM Sans",
  // Not stored in DB today; derived from the tenant's slug/name in later
  // phases if needed.
  app_name: "Hour Golf",
};

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

// Extract tenant id from an incoming Next.js request (page or API route).
// `req` shape differs between _document.js (req.headers[k]) and App Router
// (not used in this codebase), so normalize defensively.
export function tenantIdFromReq(req) {
  const headers = req?.headers;
  if (!headers) return HOURGOLF_TENANT_ID;
  // Node.js req.headers uses lowercase keys; Next.js preserves that.
  const value = headers["x-tenant-id"];
  if (typeof value === "string" && value.length > 0) return value;
  return HOURGOLF_TENANT_ID;
}

// Load branding for a tenant. Always returns a complete branding object —
// falls back to FALLBACK_BRANDING values for any column that's null or on
// any fetch failure. Callers never need to null-check individual fields.
export async function loadBranding(tenantId) {
  if (!tenantId) tenantId = HOURGOLF_TENANT_ID;

  const cached = getCached(tenantId);
  if (cached) return cached;

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon || !SUPABASE_URL) return FALLBACK_BRANDING;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        // Short abort: never hold up a page render for more than 1s.
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(1000)
          : undefined,
      }
    );
    if (!resp.ok) {
      setCached(tenantId, FALLBACK_BRANDING);
      return FALLBACK_BRANDING;
    }
    const rows = await resp.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!row) {
      setCached(tenantId, FALLBACK_BRANDING);
      return FALLBACK_BRANDING;
    }

    // Merge: fallback values fill nulls, DB values override.
    const merged = { ...FALLBACK_BRANDING };
    for (const key of Object.keys(FALLBACK_BRANDING)) {
      if (row[key] !== null && row[key] !== undefined) merged[key] = row[key];
    }
    setCached(tenantId, merged);
    return merged;
  } catch {
    // Timeouts, network errors — fall through to fallback. Don't cache the
    // failure; next request retries.
    return FALLBACK_BRANDING;
  }
}

// Invalidate a tenant's cached branding. Called by admin-tenant-branding
// PATCH so an admin's edit is visible within the current request cycle
// (otherwise they'd wait up to 60s to see changes).
export function invalidateBranding(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

// Render the :root CSS variable block from a branding object. Injected by
// _document.js into <head>.
//
// Selector uses `:root:root` (specificity 0,0,2,0) rather than plain `:root`
// (0,0,1,0) to guarantee these overrides win regardless of whether the
// bundled globals.css stylesheet <link> lands before or after our inline
// <style>. In Next.js pages router the order isn't guaranteed.
//
// The full set of overrides is colors (5 slots) + fonts (display + body).
// Other vars in globals.css (--surface, --border, --radius, etc.) stay
// constant across tenants for now — they're structural, not branding.
export function buildRootCssVars(branding) {
  const b = branding || FALLBACK_BRANDING;
  // Font family values need single quotes around the name so CSS accepts
  // multi-word fonts like "DM Sans" or "Playfair Display". Fallback chain
  // ensures rendering doesn't blank out if a custom font fails to load.
  const displayStack = `'${b.font_display_name}', 'Bungee', sans-serif`;
  const bodyStack = `'${b.font_body_family}', sans-serif`;
  return `:root:root {
  --primary: ${b.primary_color};
  --accent: ${b.accent_color};
  --red: ${b.danger_color};
  --bg: ${b.cream_color};
  --text: ${b.text_color};
  --font-display: ${displayStack};
  --font-body: ${bodyStack};
  --font: ${bodyStack};
}`;
}

// Render a @font-face declaration for a tenant's custom display font.
// Returns empty string if the tenant is using a web-safe / Google font.
// The URL may be a public Supabase Storage path (cross-tenant uploads are
// tenant-prefixed by Phase 2B-3, so no collision risk).
export function buildDisplayFontFace(branding) {
  const b = branding || FALLBACK_BRANDING;
  if (!b.font_display_url) return "";
  // font-display: swap so the page never blocks on a missing font file.
  // If the URL is wrong, the body font renders until it loads (or never).
  return `@font-face {
  font-family: '${b.font_display_name.replace(/'/g, "")}';
  src: url('${b.font_display_url}') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`;
}
