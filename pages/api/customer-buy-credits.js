import Stripe from "stripe";
import { SUPABASE_URL, getSupabaseKey, getTenantId } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const tenantId = getTenantId(req);
  const { email, hours } = req.body;
  if (!email || !hours || hours < 1) {
    return res.status(400).json({ error: "Email and hours (min 1) required" });
  }

  try {
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(email.toLowerCase().trim())}&tenant_id=eq.${tenantId}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = await memberResp.json();
    if (!members.length) return res.status(404).json({ error: "Member not found" });
    const member = members[0];

    const tierResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tierCfg = await tierResp.json();
    const rate = tierCfg[0]?.overage_rate || 60;
    const amountCents = Math.round(hours * rate * 100);

    let stripeCustomerId = member.stripe_customer_id;
    if (!stripeCustomerId) {
      const existing = await stripe.customers.list({ email: email.toLowerCase().trim(), limit: 1 });
      if (existing.data.length > 0) {
        stripeCustomerId = existing.data[0].id;
      } else {
        const newCustomer = await stripe.customers.create({
          email: email.toLowerCase().trim(),
          name: member.name,
          metadata: { source: "hour-golf-portal" },
        });
        stripeCustomerId = newCustomer.id;
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Hour Golf \u2014 ${hours} Hour Credit${hours > 1 ? "s" : ""}`,
            description: `${hours} hour${hours > 1 ? "s" : ""} of bay time at $${rate}/hr`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${req.headers.origin || "http://localhost:3000"}/portal?purchased=${hours}`,
      cancel_url: `${req.headers.origin || "http://localhost:3000"}/portal`,
      metadata: { member_email: email.toLowerCase().trim(), hours: String(hours), source: "hour-golf-portal" },
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Buy credits error:", e);
    return res.status(500).json({ error: "Failed to create checkout", detail: e.message });
  }
}
