import Stripe from "stripe";
import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const { booking_id } = req.body;
  if (!booking_id) return res.status(400).json({ error: "Missing booking_id" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // 1. Check if already charged (idempotency via charged_booking_id unique index)
    const dupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?charged_booking_id=eq.${encodeURIComponent(booking_id)}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (dupResp.ok) {
      const dups = await dupResp.json();
      if (dups.length > 0) return res.status(409).json({ error: "Already charged", booking_id });
    }

    // 2. Get the booking
    const bkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!bkResp.ok) throw new Error(`Booking lookup failed: ${bkResp.status}`);
    const bkRows = await bkResp.json();
    if (!bkRows.length) return res.status(404).json({ error: "Booking not found" });
    const bk = bkRows[0];

    // 3. Get member's stripe_customer_id
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(bk.customer_email)}&select=stripe_customer_id,name`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!mResp.ok) throw new Error(`Member lookup failed: ${mResp.status}`);
    const mRows = await mResp.json();
    const member = mRows[0];
    if (!member?.stripe_customer_id) {
      return res.status(400).json({ error: "No Stripe customer", detail: `${bk.customer_email} has no payment method on file.` });
    }

    // 4. Get Non-Member overage rate from tier_config
    const tcResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.Non-Member&select=overage_rate`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tcRows = tcResp.ok ? await tcResp.json() : [];
    const rate = Number(tcRows[0]?.overage_rate || 60);

    // 5. Calculate amount
    const hours = Number(bk.duration_hours || 0);
    if (hours <= 0) return res.status(400).json({ error: "Booking has no duration" });
    const amountCents = Math.round(hours * rate * 100);
    if (amountCents < 50) return res.status(400).json({ error: "Amount too small to charge" });

    // 6. Find payment method (same logic as stripe-charge.js)
    const customer = await stripe.customers.retrieve(member.stripe_customer_id);
    let paymentMethod = customer.invoice_settings?.default_payment_method || customer.default_source;

    if (!paymentMethod) {
      const methods = await stripe.paymentMethods.list({ customer: member.stripe_customer_id, type: "card", limit: 5 });
      if (methods.data.length > 0) paymentMethod = methods.data[0].id;
    }
    if (!paymentMethod) {
      const full = await stripe.customers.retrieve(member.stripe_customer_id, { expand: ["sources"] });
      if (full.sources?.data?.length > 0) paymentMethod = full.sources.data[0].id;
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: "No payment method found", detail: `No cards attached to ${bk.customer_email}.` });
    }

    // 7. Create Stripe PaymentIntent
    const desc = `Hour Golf non-member session — ${new Date(bk.booking_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${hours}h)`;
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: member.stripe_customer_id,
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
