import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-1: per-tenant Stripe client. See stripe-config.js for the
// resolution path (reads public.tenant_stripe_config by tenant_id).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    console.error("backfill-subscriptions getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  try {
    // Get all members with stripe_customer_id but no stripe_subscription_id within this tenant
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&stripe_customer_id=not.is.null&stripe_subscription_id=is.null&tier=not.eq.Non-Member&select=email,stripe_customer_id,tier`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = mResp.ok ? await mResp.json() : [];

    const results = { linked: [], no_sub: [], failed: [] };

    for (const m of members) {
      try {
        // Look up active subscriptions for this customer
        const subs = await stripe.subscriptions.list({
          customer: m.stripe_customer_id,
          status: "active",
          limit: 1,
        });

        if (subs.data.length > 0) {
          const sub = subs.data[0];
          const priceId = sub.items?.data?.[0]?.price?.id || null;

          // Save subscription ID and price ID to members table
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(m.email)}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: {
                apikey: key, Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                stripe_subscription_id: sub.id,
                stripe_price_id: priceId,
              }),
            }
          );
          results.linked.push({ email: m.email, sub_id: sub.id });
        } else {
          results.no_sub.push({ email: m.email, customer_id: m.stripe_customer_id });
        }
      } catch (err) {
        results.failed.push({ email: m.email, error: err.message });
      }
    }

    return res.status(200).json({
      total: members.length,
      linked: results.linked.length,
      no_sub: results.no_sub.length,
      failed: results.failed.length,
      details: results,
    });
  } catch (e) {
    console.error("Backfill error:", e);
    return res.status(500).json({ error: e.message });
  }
}
