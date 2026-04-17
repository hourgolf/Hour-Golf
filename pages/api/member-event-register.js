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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: "Missing event_id" });

  try {
    // Verify session within this tenant
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,name,stripe_customer_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = mResp.ok ? await mResp.json() : [];
    if (!members.length) return res.status(401).json({ error: "Session expired" });
    const member = members[0];

    // Check not already registered
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_registrations?event_id=eq.${event_id}&member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&select=id,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const existing = checkResp.ok ? await checkResp.json() : [];
    if (existing.length > 0) {
      return res.status(409).json({ error: "Already registered", status: existing[0].status });
    }

    // Get event within this tenant
    const evResp = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${event_id}&tenant_id=eq.${tenantId}&is_published=eq.true&select=id,title,cost`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const events = evResp.ok ? await evResp.json() : [];
    if (!events.length) return res.status(404).json({ error: "Event not found" });
    const event = events[0];

    const cost = Number(event.cost || 0);

    // Free event — register directly
    if (cost <= 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/event_registrations`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId, event_id, member_email: member.email, status: "registered", amount_cents: 0,
        }),
      });
      return res.status(200).json({ registered: true, free: true });
    }

    // Paid event — create Stripe Checkout
    let stripe;
    try {
      stripe = await getStripeClient(tenantId);
    } catch (err) {
      console.error("member-event-register getStripeClient failed:", err?.message || err);
      return res.status(503).json({
        error: "stripe_not_configured",
        detail: "Stripe is not set up for this tenant yet.",
      });
    }

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
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
        }
      );
    }

    const amountCents = Math.round(cost * 100);
    const origin = req.headers.origin || "https://hour-golf.vercel.app";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name: event.title },
        },
        quantity: 1,
      }],
      success_url: `${origin}/members/events/${event_id}?registered=true`,
      cancel_url: `${origin}/members/events/${event_id}`,
      metadata: {
        type: "event_registration",
        event_id,
        member_email: member.email,
      },
    });

    // Insert registration with pending status
    await fetch(`${SUPABASE_URL}/rest/v1/event_registrations`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId, event_id, member_email: member.email, status: "registered",
        stripe_checkout_session_id: session.id, amount_cents: amountCents,
      }),
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("member-event-register error:", e);
    return res.status(500).json({ error: e.message });
  }
}
