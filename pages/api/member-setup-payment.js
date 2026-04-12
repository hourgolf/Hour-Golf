import Stripe from "stripe";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=email,name,stripe_customer_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Session lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];

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
