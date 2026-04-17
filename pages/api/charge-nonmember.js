import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-2d: per-tenant Stripe client via lib/stripe-config.

async function findStripeCustomer(stripe, email) {
  const customers = await stripe.customers.list({ email, limit: 1 });
  return customers.data.length > 0 ? customers.data[0].id : null;
}

async function findPaymentMethod(stripe, customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  let pm = customer.invoice_settings?.default_payment_method || customer.default_source;

  if (!pm) {
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 5 });
    if (methods.data.length > 0) pm = methods.data[0].id;
  }
  if (!pm) {
    const full = await stripe.customers.retrieve(customerId, { expand: ["sources"] });
    if (full.sources?.data?.length > 0) pm = full.sources.data[0].id;
  }
  return pm;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: "Missing booking_id" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    console.error("charge-nonmember getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  try {
    // 1. Check if already charged (idempotency via charged_booking_id unique index)
    const dupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?charged_booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (dupResp.ok) {
      const dups = await dupResp.json();
      if (dups.length > 0) return res.status(409).json({ error: "Already charged", booking_id });
    }

    // 2. Get the booking within this tenant
    const bkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!bkResp.ok) throw new Error(`Booking lookup failed: ${bkResp.status}`);
    const bkRows = await bkResp.json();
    if (!bkRows.length) return res.status(404).json({ error: "Booking not found" });
    const bk = bkRows[0];

    // 3. Find Stripe customer: check members table first, then search Stripe by email
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(bk.customer_email)}&tenant_id=eq.${tenantId}&select=stripe_customer_id,name`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const mRows = mResp.ok ? await mResp.json() : [];
    let stripeCustomerId = mRows[0]?.stripe_customer_id || null;

    // Fallback: search Stripe directly by email
    if (!stripeCustomerId) {
      stripeCustomerId = await findStripeCustomer(stripe, bk.customer_email);
      // Save it back to members table for future use
      if (stripeCustomerId && mRows.length > 0) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(bk.customer_email)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
          }
        );
      }
    }

    if (!stripeCustomerId) {
      return res.status(400).json({ error: "No Stripe customer", detail: `No Stripe account found for ${bk.customer_email}.` });
    }

    // 4. Get Non-Member overage rate from tier_config within this tenant
    const tcResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.Non-Member&tenant_id=eq.${tenantId}&select=overage_rate`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tcRows = tcResp.ok ? await tcResp.json() : [];
    const rate = Number(tcRows[0]?.overage_rate || 60);

    // 5. Calculate amount
    const hours = Number(bk.duration_hours || 0);
    if (hours <= 0) return res.status(400).json({ error: "Booking has no duration" });
    const amountCents = Math.round(hours * rate * 100);
    if (amountCents < 50) return res.status(400).json({ error: "Amount too small to charge" });

    // 6. Find payment method
    const paymentMethod = await findPaymentMethod(stripe, stripeCustomerId);
    if (!paymentMethod) {
      return res.status(400).json({ error: "No payment method found", detail: `No cards attached to ${bk.customer_email}.` });
    }

    // 7. Create Stripe PaymentIntent
    const desc = `Hour Golf non-member session — ${new Date(bk.booking_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${hours}h)`;
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: paymentMethod,
      off_session: true,
      confirm: true,
      description: desc,
      metadata: {
        member_email: bk.customer_email,
        booking_id,
        source: "hour-golf-nonmember-charge",
      },
    });

    // 8. Record payment with charged_booking_id
    const billingMonth = (() => {
      const d = new Date(bk.booking_start);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+00:00`;
    })();

    await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        member_email: bk.customer_email,
        billing_month: billingMonth,
        amount_cents: amountCents,
        stripe_payment_intent_id: pi.id,
        status: "succeeded",
        description: desc,
        charged_booking_id: booking_id,
      }),
    });

    return res.status(200).json({
      success: true,
      payment_intent_id: pi.id,
      amount_cents: amountCents,
      booking_id,
      customer_email: bk.customer_email,
    });
  } catch (err) {
    console.error("charge-nonmember error:", err);
    if (err.type === "StripeCardError") {
      return res.status(400).json({ error: "Card declined", detail: err.message, code: err.code });
    }
    return res.status(500).json({ error: "Charge failed", detail: err.message });
  }
}
