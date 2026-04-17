import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-2c: per-tenant Stripe client via lib/stripe-config.

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

async function getMemberFromToken(key, token, tenantId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=*`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const member = await getMemberFromToken(key, token, tenantId);
  if (!member) return res.status(401).json({ error: "Session expired" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    console.error("member-subscription getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  // --- GET: Available tiers + current subscription ---
  if (req.method === "GET") {
    try {
      // Fetch public tiers within this tenant
      const tiersResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tier_config?tenant_id=eq.${tenantId}&is_public=eq.true&order=display_order.asc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const tiers = tiersResp.ok ? await tiersResp.json() : [];

      // Get subscription info from Stripe if member has one
      let subscription = null;
      let subId = member.stripe_subscription_id;

      // Auto-discover: if no subscription ID saved but has a Stripe customer, look it up
      if (!subId && member.stripe_customer_id) {
        try {
          const subs = await stripe.subscriptions.list({
            customer: member.stripe_customer_id,
            status: "active",
            limit: 1,
          });
          if (subs.data.length > 0) {
            subId = subs.data[0].id;
            const priceId = subs.data[0].items?.data?.[0]?.price?.id || null;
            // Save it for future lookups
            await fetch(
              `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  stripe_subscription_id: subId,
                  stripe_price_id: priceId,
                }),
              }
            );
          }
        } catch (e) {
          console.warn("Subscription auto-discover failed:", e.message);
        }
      }

      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          subscription = {
            id: sub.id,
            status: sub.status,
            cancel_at_period_end: sub.cancel_at_period_end,
            current_period_end: sub.current_period_end,
            price_id: sub.items?.data?.[0]?.price?.id,
            item_id: sub.items?.data?.[0]?.id,
          };
        } catch (e) {
          console.warn("Could not retrieve subscription:", e.message);
        }
      }

      return res.status(200).json({
        currentTier: member.tier,
        availableTiers: tiers,
        subscription,
      });
    } catch (e) {
      console.error("Subscription GET error:", e);
      return res.status(500).json({ error: "Failed to load subscription info" });
    }
  }

  // --- POST: New subscription (Stripe Checkout) ---
  if (req.method === "POST") {
    const { tier } = req.body || {};
    if (!tier) return res.status(400).json({ error: "tier required" });

    try {
      // Verify tier is public and get its price ID
      const tierResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(tier)}&tenant_id=eq.${tenantId}&is_public=eq.true`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const tierRows = tierResp.ok ? await tierResp.json() : [];
      if (!tierRows.length) return res.status(400).json({ error: "Tier not available for purchase" });

      const tierCfg = tierRows[0];
      if (!tierCfg.stripe_price_id) return res.status(400).json({ error: "Tier not configured for billing. Contact staff." });

      // Check member doesn't already have an active subscription
      if (member.stripe_subscription_id) {
        return res.status(400).json({ error: "You already have an active membership. Use upgrade/downgrade instead." });
      }

      // Ensure Stripe customer exists
      let stripeCustomerId = member.stripe_customer_id;
      if (!stripeCustomerId) {
        const existing = await stripe.customers.list({ email: member.email, limit: 1 });
        if (existing.data.length > 0) {
          stripeCustomerId = existing.data[0].id;
        } else {
          const newCust = await stripe.customers.create({
            email: member.email,
            name: member.name,
            metadata: { source: "hour-golf-portal" },
          });
          stripeCustomerId = newCust.id;
        }
        // Save customer ID
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
          }
        );
      }

      // Create Checkout Session for subscription
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [{ price: tierCfg.stripe_price_id, quantity: 1 }],
        success_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing?subscribed=${encodeURIComponent(tier)}`,
        cancel_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing`,
        metadata: { member_email: member.email, tier },
      });

      return res.status(200).json({ url: session.url });
    } catch (e) {
      console.error("Subscription POST error:", e);
      return res.status(500).json({ error: "Failed to create checkout", detail: e.message });
    }
  }

  // --- PATCH: Upgrade/downgrade ---
  if (req.method === "PATCH") {
    const { tier } = req.body || {};
    if (!tier) return res.status(400).json({ error: "tier required" });

    try {
      // Auto-discover subscription if not saved
      let subscriptionId = member.stripe_subscription_id;
      if (!subscriptionId && member.stripe_customer_id) {
        const subs = await stripe.subscriptions.list({
          customer: member.stripe_customer_id,
          status: "active",
          limit: 1,
        });
        if (subs.data.length > 0) {
          subscriptionId = subs.data[0].id;
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ stripe_subscription_id: subscriptionId }),
            }
          );
        }
      }

      if (!subscriptionId) {
        return res.status(400).json({ error: "No active subscription to modify" });
      }

      // Get new tier's price ID
      const tierResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(tier)}&tenant_id=eq.${tenantId}&is_public=eq.true`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const tierRows = tierResp.ok ? await tierResp.json() : [];
      if (!tierRows.length) return res.status(400).json({ error: "Tier not available" });

      const tierCfg = tierRows[0];
      if (!tierCfg.stripe_price_id) return res.status(400).json({ error: "Tier not configured for billing" });

      // Get current subscription to find the item ID
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = sub.items?.data?.[0]?.id;
      if (!itemId) return res.status(400).json({ error: "Subscription item not found" });

      // Update subscription with new price (prorated)
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: tierCfg.stripe_price_id }],
        proration_behavior: "always_invoice",
        payment_behavior: "allow_incomplete",
      });

      // Update member tier immediately
      await fetch(
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            tier,
            stripe_price_id: tierCfg.stripe_price_id,
            updated_at: new Date().toISOString(),
          }),
        }
      );

      return res.status(200).json({ success: true, tier });
    } catch (e) {
      console.error("Subscription PATCH error:", e);
      return res.status(500).json({ error: "Failed to update subscription", detail: e.message });
    }
  }

  // --- DELETE: Cancel membership (at period end) ---
  if (req.method === "DELETE") {
    try {
      let cancelSubId = member.stripe_subscription_id;
      if (!cancelSubId && member.stripe_customer_id) {
        const subs = await stripe.subscriptions.list({
          customer: member.stripe_customer_id, status: "active", limit: 1,
        });
        if (subs.data.length > 0) cancelSubId = subs.data[0].id;
      }
      if (!cancelSubId) {
        return res.status(400).json({ error: "No active subscription to cancel" });
      }

      const sub = await stripe.subscriptions.update(cancelSubId, {
        cancel_at_period_end: true,
      });

      return res.status(200).json({
        success: true,
        cancel_at: new Date(sub.current_period_end * 1000).toISOString(),
      });
    } catch (e) {
      console.error("Subscription DELETE error:", e);
      return res.status(500).json({ error: "Failed to cancel subscription", detail: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
