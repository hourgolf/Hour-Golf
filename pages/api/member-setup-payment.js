import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";
import { getSessionWithMember } from "../../lib/member-session";
import { requireSameOrigin } from "../../lib/security";

// Phase 7B-2b: per-tenant Stripe client via lib/stripe-config.

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Get member from session within this tenant
    const sess = await getSessionWithMember({ token, tenantId, touch: true });
    if (!sess) return res.status(401).json({ error: "Session expired" });

    const member = sess.member;

    let stripe;
    try {
      stripe = await getStripeClient(tenantId);
    } catch (err) {
      console.error("member-setup-payment getStripeClient failed:", err?.message || err);
      return res.status(503).json({
        error: "stripe_not_configured",
        detail: "Stripe is not set up for this tenant yet.",
      });
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

    // Create Checkout Session in setup mode (collects card without charging)
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "setup",
      payment_method_types: ["card"],
      success_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing?card_added=true`,
      cancel_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing`,
      metadata: {
        type: "payment_setup",
        member_email: member.email,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Payment setup error:", e);
    return res.status(500).json({ error: "Failed to create payment setup", detail: e.message });
  }
}
