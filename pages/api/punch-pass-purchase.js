import Stripe from "stripe";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PASS_OPTIONS = {
  1: { hours: 1, discount: 0, label: "1 Hour Pass" },
  5: { hours: 5, discount: 0.10, label: "5 Hour Pass (10% off)" },
  10: { hours: 10, discount: 0.25, label: "10 Hour Pass (25% off)" },
};

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

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Get member from session
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Session lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];
    const { hours } = req.body || {};
    const pass = PASS_OPTIONS[hours];
    if (!pass) return res.status(400).json({ error: "Invalid pass option. Choose 1, 5, or 10 hours." });

    // Get tier config for overage rate
    const tierResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tierCfg = tierResp.ok ? await tierResp.json() : [];
    const rate = Number(tierCfg[0]?.overage_rate || 60);

    if (rate <= 0) {
      return res.status(400).json({ error: "Your membership includes unlimited hours." });
    }

    // Calculate discounted price
    const fullPrice = pass.hours * rate;
    const discountedPrice = fullPrice * (1 - pass.discount);
    const amountCents = Math.round(discountedPrice * 100);

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
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}`,
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

    const discountLabel = pass.discount > 0 ? ` (${Math.round(pass.discount * 100)}% off)` : "";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Hour Golf \u2014 ${pass.label}`,
            description: `${pass.hours} hour${pass.hours > 1 ? "s" : ""} of bay time at $${rate}/hr${discountLabel}`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing?purchased=${pass.hours}`,
      cancel_url: `${req.headers.origin || "https://hour-golf.vercel.app"}/members/billing`,
      metadata: {
        type: "punch_pass",
        member_email: member.email,
        hours: String(pass.hours),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Punch pass purchase error:", e);
    return res.status(500).json({ error: "Failed to create checkout", detail: e.message });
  }
}
