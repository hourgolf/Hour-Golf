// GET /api/platform-tenants
// Returns a read-only list of every tenant in the platform, with the
// shape the super-admin dashboard needs to render a tenant grid.
//
// Service-role bypasses tenant RLS — which is intentional here, because
// platform admins operate across all tenants.
//
// Auth: requires a Supabase JWT from a user listed in public.platform_admins
// (enforced by verifyPlatformAdmin).

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

async function sb(key, path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    const [tenants, branding, features, stripeCfg, memberCounts, adminCounts] =
      await Promise.all([
        sb(key, `tenants?select=id,slug,name,status,created_at&order=created_at.asc`),
        sb(key, `tenant_branding?select=tenant_id,logo_url,primary_color`),
        sb(key, `tenant_features?select=tenant_id,feature_key,enabled`),
        sb(
          key,
          `tenant_stripe_config?select=tenant_id,mode,enabled,webhook_secret,secret_key`
        ),
        sb(key, `members?select=tenant_id`),
        sb(key, `admins?select=tenant_id`),
      ]);

    const brandingByTenant = new Map();
    branding.forEach((b) => brandingByTenant.set(b.tenant_id, b));

    const featuresByTenant = new Map();
    features.forEach((f) => {
      if (!featuresByTenant.has(f.tenant_id)) featuresByTenant.set(f.tenant_id, {});
      featuresByTenant.get(f.tenant_id)[f.feature_key] = !!f.enabled;
    });

    const stripeByTenant = new Map();
    stripeCfg.forEach((s) =>
      stripeByTenant.set(s.tenant_id, {
        mode: s.mode,
        enabled: !!s.enabled,
        has_secret: !!s.secret_key,
        has_webhook_secret: !!s.webhook_secret,
      })
    );

    const memberCountByTenant = new Map();
    memberCounts.forEach((m) =>
      memberCountByTenant.set(m.tenant_id, (memberCountByTenant.get(m.tenant_id) || 0) + 1)
    );

    const adminCountByTenant = new Map();
    adminCounts.forEach((a) =>
      adminCountByTenant.set(a.tenant_id, (adminCountByTenant.get(a.tenant_id) || 0) + 1)
    );

    const rows = tenants.map((t) => {
      const f = featuresByTenant.get(t.id) || {};
      const enabledFeatureCount = Object.values(f).filter(Boolean).length;
      const totalFeatureCount = Object.keys(f).length;
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        created_at: t.created_at,
        branding: brandingByTenant.get(t.id) || null,
        feature_summary: {
          enabled: enabledFeatureCount,
          total: totalFeatureCount,
        },
        stripe: stripeByTenant.get(t.id) || null,
        member_count: memberCountByTenant.get(t.id) || 0,
        admin_count: adminCountByTenant.get(t.id) || 0,
      };
    });

    return res.status(200).json({ tenants: rows });
  } catch (e) {
    console.error("platform-tenants error:", e);
    return res.status(500).json({ error: "Failed to load tenants", detail: e.message });
  }
}
