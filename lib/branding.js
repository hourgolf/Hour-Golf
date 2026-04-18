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

// Platform-neutral last-resort fallback. Used only when the DB is
// unreachable OR when a tenant row has NULL for a given field.
//
// Colors are kept at Hour Golf's values so a DB outage doesn't unstyle the
// app for our most important tenant — Hour Golf's row has every color
// explicitly set so this is only relevant during DB outages anyway, and
// those Hour Golf colors are indistinguishable from the platform's default
// design intent.
//
// Asset fields (logo_url, font_display_url, background_image_url) are
// null so Hour Golf's specific assets NEVER leak into another tenant's
// render when that tenant has a null column. `app_name` falls back to the
// platform name; real tenants get their name via the tenants.name lookup
// in loadBranding below.
export const FALLBACK_BRANDING = {
  primary_color: "#4C8D73",
  accent_color: "#ddd480",
  danger_color: "#C92F1F",
  cream_color: "#EDF3E3",
  text_color: "#35443B",
  pwa_theme_color: "#4C8D73",
  // Legacy single-logo slot kept for rollback. The three slot-specific
  // URLs below fall back to `logo_url` when null, so existing code
  // paths keep rendering even if the new columns haven't been populated
  // for a given tenant.
  logo_url: null,
  welcome_logo_url: null,
  header_logo_url: null,
  icon_url: null,
  pwa_icon_url: null,
  show_welcome_logo: true,
  show_welcome_title: true,
  show_header_logo: true,
  show_header_title: false,
  show_icon: false,
  welcome_logo_size: "m",
  header_logo_size: "m",
  icon_size: "m",
  background_image_url: null,
  font_display_name: "Inter",
  font_display_url: null,
  font_body_family: "DM Sans",
  welcome_message: null,
  legal_url: null,
  terms_url: null,
  support_email: null,
  support_phone: null,
  facility_hours: null,
  backup_access_code: null,
  app_name: "Ourlee",
};

// Pixel ceilings per (slot, size preset). Keep these in one place so
// the login page, persistent header, and admin header all agree —
// tenants pick a size bucket, the platform enforces the actual
// dimensions so bad asset ratios can't blow up layout.
//
// Tuned so that L matches the pre-multi-tenant Hour Golf look
// (header-logo max-height was 110px in styles/globals.css before the
// inline size overrides). M roughly matches the old default /
// viewport-scaled behavior. S is for tenants with long wordmarks that
// would otherwise dominate the nav.
const LOGO_PIXEL_MAX = {
  welcome: { s: { h: 100, w: 320 }, m: { h: 180, w: 450 }, l: { h: 300, w: 600 } },
  header: { s: { h: 56, w: 240 }, m: { h: 80, w: 340 }, l: { h: 110, w: 460 } },
  icon: { s: { h: 24, w: 24 }, m: { h: 36, w: 36 }, l: { h: 48, w: 48 } },
};

export function getLogoMaxDims(slot, sizePreset) {
  const slotTable = LOGO_PIXEL_MAX[slot] || LOGO_PIXEL_MAX.welcome;
  const preset = sizePreset && slotTable[sizePreset] ? sizePreset : "m";
  return slotTable[preset];
}

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
    // Embedded select pulls the tenant's display name alongside branding in
    // a single round-trip. PostgREST resolves `tenants(name)` via the
    // tenant_branding.tenant_id -> tenants.id foreign key. `app_name` is
    // then derived from tenants.name so every tenant gets their real name
    // in the page title / PWA manifest without needing a separate column.
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*,tenants(name)`,
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

    // Merge: fallback values fill nulls, DB values override. `tenants` is
    // the embedded resource, not a branding column — handle it separately.
    const merged = { ...FALLBACK_BRANDING };
    for (const key of Object.keys(FALLBACK_BRANDING)) {
      if (row[key] !== null && row[key] !== undefined) merged[key] = row[key];
    }
    // app_name comes from tenants.name (not a tenant_branding column).
    // PostgREST may return the embedded resource as an object or array
    // depending on cardinality of the FK; handle both shapes.
    const tenantRow = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
    if (tenantRow && tenantRow.name) {
      merged.app_name = tenantRow.name;
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

// Render body background-image rule if the tenant uploaded a custom bg.
// Using body (not html) so installed PWAs still work. `fixed` attachment
// keeps the image anchored during scroll. `cover` scales to fit without
// distortion.
//
// Escapes quotes in the URL as a minimal defense against breaking out of
// the CSS context — the URL passes through admin-tenant-branding which
// already validates the protocol, but belt-and-suspenders is cheap.
export function buildBackgroundImageRule(branding) {
  const b = branding || FALLBACK_BRANDING;
  if (!b.background_image_url) return "";
  const safeUrl = String(b.background_image_url).replace(/['"]/g, "");
  return `body {
  background-image: url('${safeUrl}');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}`;
}
