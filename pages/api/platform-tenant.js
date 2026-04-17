// GET /api/platform-tenant?slug=hourgolf
// Returns the full detail payload for one tenant, used by
// /platform/tenants/[slug]. Service-role bypasses tenant RLS —
// intentional: platform admins read across tenants.
//
// The Stripe config is NEVER returned in plaintext. The `stripe` field
// surfaces only metadata (mode, enabled, whether keys are configured,
// last 4 of secret + whs for visual confirmation).

import { verifyPlatformAdmin } from "../../lib/platform-auth";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

function sb(key, path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json();
  });
}

// Mask a secret so the UI can confirm "yes, one is configured" without
// ever letting the super-admin (or anyone watching their screen) read
// the full value. We return length + last4 only.
function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return {
    length: trimmed.length,
    last4: trimmed.slice(-4),
    prefix: trimmed.slice(0, Math.min(7, trimmed.length)), // sk_live_, sk_test_, whsec_, pk_live_
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { user, reason } = await verifyPlatformAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const slug = (req.query.slug || "").toString().trim();
  if (!slug) return res.status(400).json({ error: "slug required" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    const tenants = await sb(
      key,
      `tenants?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,status,created_at,updated_at`
    );
    if (!tenants.length) return res.status(404).json({ error: "Tenant not found" });
    const tenant = tenants[0];

    const [branding, features, stripeRows, memberRows, adminRows] = await Promise.all([
      sb(key, `tenant_branding?tenant_id=eq.${tenant.id}&select=*`),
      sb(key, `tenant_features?tenant_id=eq.${tenant.id}&select=feature_key,enabled,config`),
      sb(key, `tenant_stripe_config?tenant_id=eq.${tenant.id}&select=*`),
      sb(key, `members?tenant_id=eq.${tenant.id}&select=email,tier`),
      sb(key, `admins?tenant_id=eq.${tenant.id}&select=user_id,email`),
    ]);

    const stripeRow = stripeRows[0] || null;
    const stripeSummary = stripeRow
      ? {
          mode: stripeRow.mode,
          enabled: !!stripeRow.enabled,
          secret_key: maskSecret(stripeRow.secret_key),
          publishable_key: maskSecret(stripeRow.publishable_key),
          webhook_secret: maskSecret(stripeRow.webhook_secret),
          created_at: stripeRow.created_at,
          updated_at: stripeRow.updated_at,
        }
      : null;

    // Member tier breakdown for Overview
    const tierBreakdown = {};
    memberRows.forEach((m) => {
      const t = m.tier || "Unknown";
      tierBreakdown[t] = (tierBreakdown[t] || 0) + 1;
    });

    return res.status(200).json({
      tenant,
      branding: branding[0] || null,
      features,
      stripe: stripeSummary,
      stats: {
        member_count: memberRows.length,
        admin_count: adminRows.length,
        tier_breakdown: tierBreakdown,
      },
      admins: adminRows,
    });
  } catch (e) {
    console.error("platform-tenant error:", e);
    return res.status(500).json({ error: "Failed to load tenant", detail: e.message });
  }
}
