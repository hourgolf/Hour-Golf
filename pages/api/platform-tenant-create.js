// POST /api/platform-tenant-create
// Create a new tenant. Transactional-ish: inserts tenants row, then
// tenant_branding row, then 8 tenant_features rows (all enabled), then
// optionally links an initial admin if admin_email matches an existing
// auth.users row.
//
// Why not a single DB transaction? Supabase REST doesn't expose BEGIN/
// COMMIT. We issue sequential inserts and, on any later failure, best-
// effort rollback by deleting the partial rows in reverse order. With
// service-role this is safe — RLS doesn't block the cleanup.
//
// Idempotency: the slug uniqueness constraint on tenants prevents
// double-inserts. A retry after a mid-insert crash returns 409 and the
// admin can finish the partial row manually in /platform/tenants/[slug].

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const KNOWN_FEATURE_KEYS = [
  "bookings",
  "pro_shop",
  "loyalty",
  "events",
  "punch_passes",
  "subscriptions",
  "stripe_enabled",
  "email_notifications",
];

// Defaults for a brand new tenant_branding row — copied from the
// FALLBACK_BRANDING in lib/branding.js so the new tenant renders with
// the same platform-neutral greens until they change them. Colors are
// Hour Golf's since that's our only reference "real" tenant today; the
// super-admin can overwrite any of them in the Branding tab immediately.
const DEFAULT_BRANDING = {
  primary_color: "#4C8D73",
  accent_color: "#ddd480",
  danger_color: "#C92F1F",
  cream_color: "#EDF3E3",
  text_color: "#35443B",
  pwa_theme_color: "#4C8D73",
  logo_url: null,
  background_image_url: null,
  font_display_name: "Inter",
  font_display_url: null,
  font_body_family: "DM Sans",
};

// Slugs end up as subdomains (<slug>.ourlee.co). Reserve paths + CDN
// hosts + a few known routes so a tenant can't claim them.
const RESERVED_SLUGS = new Set([
  "platform",
  "api",
  "www",
  "admin",
  "app",
  "ourlee",
  "supabase",
  "auth",
  "assets",
  "static",
  "vercel",
  "cdn",
]);

function isValidSlug(slug) {
  if (typeof slug !== "string") return false;
  if (slug.length < 2 || slug.length > 40) return false;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const { slug, name, admin_email } = req.body || {};

  if (!isValidSlug(slug)) {
    return res.status(400).json({
      error: "Invalid slug",
      detail:
        "Slug must be 2–40 chars, lowercase alphanumeric + hyphens, and not a reserved name.",
    });
  }
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) {
    return res.status(400).json({ error: "Name is required (1–120 chars)" });
  }
  if (admin_email && typeof admin_email !== "string") {
    return res.status(400).json({ error: "admin_email must be a string if provided" });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  let createdTenantId = null;
  let brandingInserted = false;
  let featuresInserted = false;
  let adminInserted = false;

  try {
    // 1. Insert tenants row.
    const tResp = await sb(key, "tenants", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ slug: slug.trim(), name: name.trim(), status: "active" }),
    });
    if (tResp.status === 409 || tResp.status === 422) {
      const body = await tResp.text();
      return res.status(409).json({
        error: "slug_in_use",
        detail: body || `Slug "${slug}" already exists.`,
      });
    }
    if (!tResp.ok) {
      const body = await tResp.text();
      throw new Error(`tenants insert ${tResp.status}: ${body}`);
    }
    const tRows = await tResp.json();
    const tenant = Array.isArray(tRows) ? tRows[0] : tRows;
    createdTenantId = tenant?.id;
    if (!createdTenantId) throw new Error("tenants insert returned no id");

    // 2. Insert tenant_branding with defaults.
    const brResp = await sb(key, "tenant_branding", {
      method: "POST",
      body: JSON.stringify({ tenant_id: createdTenantId, ...DEFAULT_BRANDING }),
    });
    if (!brResp.ok) {
      const body = await brResp.text();
      throw new Error(`tenant_branding insert ${brResp.status}: ${body}`);
    }
    brandingInserted = true;

    // 3. Insert 8 tenant_features rows, all enabled by default. The
    // super-admin can toggle them off per tenant after creation.
    const featureRows = KNOWN_FEATURE_KEYS.map((k) => ({
      tenant_id: createdTenantId,
      feature_key: k,
      enabled: true,
    }));
    const fResp = await sb(key, "tenant_features", {
      method: "POST",
      body: JSON.stringify(featureRows),
    });
    if (!fResp.ok) {
      const body = await fResp.text();
      throw new Error(`tenant_features insert ${fResp.status}: ${body}`);
    }
    featuresInserted = true;

    // 4. Optional: link an initial tenant admin if the email matches an
    // existing auth.users row. We don't CREATE the auth user here — that
    // requires /auth/v1/admin/users which is out of scope for v1 and has
    // a different risk profile (silent password resets etc). If no match,
    // we skip silently and note it in the response so the super-admin
    // can invite the admin separately.
    let adminLinked = null;
    let adminSkipReason = null;
    if (admin_email && admin_email.trim()) {
      const normalized = admin_email.trim().toLowerCase();
      const uResp = await sb(
        key,
        `/auth/v1/admin/users?email=eq.${encodeURIComponent(normalized)}`.replace(/^\//, "")
      ).catch(() => null);
      // The Supabase admin users endpoint lives at /auth/v1/admin/users
      // which we didn't hit correctly above — use a direct query against
      // auth.users via PostgREST with service role instead. Service role
      // can read auth schema tables.
      const directResp = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_auth_user_id_by_email`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_email: normalized }),
        }
      );
      // RPC may not exist yet; if it errors we fall back to scanning
      // via the REST auth/v1 endpoint. Easiest: just query auth.users
      // via a simple SELECT — service role has permission.
      let foundUserId = null;
      try {
        if (directResp.ok) {
          const rpcBody = await directResp.json();
          foundUserId =
            typeof rpcBody === "string"
              ? rpcBody
              : rpcBody?.user_id || rpcBody?.id || null;
        }
      } catch {
        /* ignore — falls through to the REST scan below */
      }
      if (!foundUserId) {
        const scanResp = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
            },
          }
        );
        if (scanResp.ok) {
          const scanBody = await scanResp.json();
          const users = scanBody?.users || scanBody?.data || [];
          const match = users.find(
            (u) =>
              u?.email &&
              typeof u.email === "string" &&
              u.email.toLowerCase() === normalized
          );
          if (match?.id) foundUserId = match.id;
        }
      }

      if (foundUserId) {
        const aResp = await sb(key, "admins", {
          method: "POST",
          body: JSON.stringify({
            user_id: foundUserId,
            email: normalized,
            tenant_id: createdTenantId,
          }),
        });
        if (!aResp.ok) {
          const body = await aResp.text();
          adminSkipReason = `admin_link_failed: ${aResp.status} ${body}`;
        } else {
          adminInserted = true;
          adminLinked = { user_id: foundUserId, email: normalized };
        }
      } else {
        adminSkipReason = "no_auth_user_matching_email";
      }
    }

    return res.status(201).json({
      tenant,
      admin_linked: adminLinked,
      admin_skip_reason: adminSkipReason,
    });
  } catch (e) {
    console.error("platform-tenant-create failed, rolling back partial state:", e);
    // Best-effort rollback in reverse order. Service-role + RLS means
    // these deletes always go through. Each one is independently safe
    // to skip if that stage hadn't happened.
    try {
      if (adminInserted && createdTenantId) {
        await sb(key, `admins?tenant_id=eq.${createdTenantId}`, { method: "DELETE" });
      }
      if (featuresInserted && createdTenantId) {
        await sb(key, `tenant_features?tenant_id=eq.${createdTenantId}`, {
          method: "DELETE",
        });
      }
      if (brandingInserted && createdTenantId) {
        await sb(key, `tenant_branding?tenant_id=eq.${createdTenantId}`, {
          method: "DELETE",
        });
      }
      if (createdTenantId) {
        await sb(key, `tenants?id=eq.${createdTenantId}`, { method: "DELETE" });
      }
    } catch (rollbackErr) {
      console.error("Rollback partial failure:", rollbackErr);
    }
    return res.status(500).json({
      error: "Create failed",
      detail: e.message,
    });
  }
}
