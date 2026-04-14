import Stripe from "stripe";
import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function findStripeCustomer(email) {
  const customers = await stripe.customers.list({ email, limit: 1 });
  return customers.data.length > 0 ? customers.data[0].id : null;
}

async function findPaymentMethod(customerId) {
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

  const { user, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // 1. Get Non-Member overage rate
    const tcResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.Non-Member&select=overage_rate`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tcRows = tcResp.ok ? await tcResp.json() : [];
    const rate = Number(tcRows[0]?.overage_rate || 60);

    // 2. Get all members and build lookup
    const memResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=email,tier,stripe_customer_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const allMembers = memResp.ok ? await memResp.json() : [];
    const memberTiers = {};
    allMembers.forEach((m) => { memberTiers[m.email] = m; });

    // 3. Get all existing charged_booking_ids to skip
    const pResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?charged_booking_id=not.is.null&select=charged_booking_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const paidBookings = new Set((pResp.ok ? await pResp.json() : []).map((p) => p.charged_booking_id));

    // 4. Get confirmed non-member bookings that ended 12+ hours ago
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const bkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_status=eq.Confirmed&booking_end=lt.${encodeURIComponent(cutoff)}&select=booking_id,customer_email,customer_name,booking_start,booking_end,duration_hours&order=booking_start.asc&limit=200`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const allBookings = bkResp.ok ? await bkResp.json() : [];

    // Filter to non-members only
    const eligible = allBookings.filter((b) => {
      const m = memberTiers[b.customer_email];
      if (m && m.tier && m.tier !== "Non-Member") return false;
      if (paidBookings.has(b.booking_id)) return false;
      if (Number(b.duration_hours || 0) <= 0) return false;
      return true;
    });

    const results = { charged: [], failed: [], skipped: [] };
    // Cache Stripe lookups so we don't search the same email twice
    const stripeCache = {};

    for (const bk of eligible) {
      const hours = Number(bk.duration_hours);
      const amountCents = Math.round(hours * rate * 100);
      if (amountCents < 50) {
        results.skipped.push({ booking_id: bk.booking_id, email: bk.customer_email, reason: "amount_too_small" });
        continue;
      }

      try {
        // Find Stripe customer: members table first, then Stripe search by email
        let stripeId = memberTiers[bk.customer_email]?.stripe_customer_id || null;
        if (!stripeId) {
          if (stripeCache[bk.customer_email] !== undefined) {
            stripeId = stripeCache[bk.customer_email];
          } else {
            stripeId = await findStripeCustomer(bk.customer_email);
            stripeCache[bk.customer_email] = stripeId;
            // Save back to members table
            if (stripeId) {
              await fetch(
                `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(bk.customer_email)}`,
                {
                  method: "PATCH",
                  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ stripe_customer_id: stripeId }),
                }
              );
            }
          }
        }

        if (!stripeId) {
          results.skipped.push({ booking_id: bk.booking_id, email: bk.customer_email, reason: "no_stripe" });
          continue;
        }

        const pm = await findPaymentMethod(stripeId);
        if (!pm) {
          results.skipped.push({ booking_id: bk.booking_id, email: bk.customer_email, reason: "no_payment_method" });
          continue;
        }

        const desc = `Hour Golf non-member session — ${new Date(bk.booking_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${hours}h)`;
        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: stripeId,
          payment_method: pm,
          off_session: true,
          confirm: true,
          description: desc,
          metadata: { member_email: bk.customer_email, booking_id: bk.booking_id, source: "hour-golf-nonmember-batch" },
        });

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
            charged_booking_id: bk.booking_id,
          }),
        });

        results.charged.push({ booking_id: bk.booking_id, email: bk.customer_email, amount_cents: amountCents, pi_id: pi.id });
      } catch (err) {
        results.failed.push({ booking_id: bk.booking_id, email: bk.customer_email, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        charged: results.charged.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
      },
      ...results,
    });
  } catch (err) {
    console.error("charge-nonmembers-batch error:", err);
    return res.status(500).json({ error: "Batch charge failed", detail: err.message });
  }
}
