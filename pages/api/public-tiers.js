// Public-read endpoint for membership tier pricing. Same shape as the
// admin's tier_config rows, trimmed to the fields a prospective member
// should see. Used by the /book landing page to show "here's what
// membership gets you" before a signup decision.
//
// Deliberately server-mediated instead of a direct PostgREST read so we
// don't have to add an anon-read RLS policy on tier_config (which would
// also surface stripe_price_id and other back-office columns).

import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);

  try {
    // display_order < 50 hides tier_config rows the admin uses as
    // historical backups (e.g. the legacy "Jacket" row at 99). Same
    // rule the member portal uses.
    //
    // Also selects `is_public` so callers can decide what to render:
    // /book filters card display to is_public=true (hides Non-Member +
    // privately-shared tiers like HG's Unlimited); /join/<slug> still
    // accepts any tier with a monthly_fee so the operator can share a
    // direct link to a hidden tier.
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tenant_id=eq.${tenantId}&display_order=lt.50&order=display_order&select=tier,monthly_fee,included_hours,overage_rate,pro_shop_discount,display_order,booking_hours_start,booking_hours_end,is_public`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) throw new Error(`tier_config lookup failed (${resp.status})`);
    const tiers = await resp.json();

    // Short cache — these values don't change often but we want admin
    // edits to propagate quickly. Edge caches for 60s, keeps a stale
    // copy around for 5 min while the next fetch warms.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json({ tiers });
  } catch (e) {
    console.error("public-tiers error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
