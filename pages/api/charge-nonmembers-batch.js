import { verifyAdmin, SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// Phase 7B-2d: per-tenant Stripe client via lib/stripe-config.

// See charge-nonmember.js for why: stripe.customers.list is
// case-sensitive on email, so try the Search API first.
async function findStripeCustomer(stripe, email) {
  const safeEmail = String(email || "").replace(/'/g, "");
  try {
    const search = await stripe.customers.search({
      query: `email:'${safeEmail}'`,
      limit: 1,
    });
    if (search.data.length > 0) return search.data[0].id;
  } catch (err) {
    console.warn("stripe.customers.search failed, falling back to list:", err?.message || err);
  }
  const list = await stripe.customers.list({ email, limit: 1 });
  if (list.data.length > 0) return list.data[0].id;
  const lower = String(email || "").toLowerCase();
  if (lower !== email) {
    const listLower = await stripe.customers.list({ email: lower, limit: 1 });
    if (listLower.data.length > 0) return listLower.data[0].id;
  }
  return null;
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

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    console.error("charge-nonmembers-batch getStripeClient failed:", err?.message || err);
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: "Stripe is not set up for this tenant yet.",
    });
  }

  try {
    // 1. Get Non-Member overage rate within this tenant
    const tcResp = await fetch(
      `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.Non-Member&tenant_id=eq.${tenantId}&select=overage_rate`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const tcRows = tcResp.ok ? await tcResp.json() : [];
    const rate = Number(tcRows[0]?.overage_rate || 60);

    // 2. Get all members in this tenant and build lookup
    const memResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&select=email,tier,stripe_customer_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const allMembers = memResp.ok ? await memResp.json() : [];
    const memberTiers = {};
    allMembers.forEach((m) => { memberTiers[m.email] = m; });

    // 3. Get all existing charged_booking_ids in this tenant to skip
    const pResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&charged_booking_id=not.is.null&select=charged_booking_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const paidBookings = new Set((pResp.ok ? await pResp.json() : []).map((p) => p.charged_booking_id));

    // 4. Get confirmed non-member bookings that ended 12+ hours ago within this tenant
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const bkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_end=lt.${encodeURIComponent(cutoff)}&select=booking_id,customer_email,customer_name,booking_start,booking_end,duration_hours&order=booking_start.asc&limit=200`,
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
            stripeId = await findStripeCustomer(stripe, bk.customer_email);
            stripeCache[bk.customer_email] = stripeId;
            // Save back to members table
            if (stripeId) {
              await fetch(
                `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(bk.customer_email)}&tenant_id=eq.${tenantId}`,
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

        const pm = await findPaymentMethod(stripe, stripeId);
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
            tenant_id: tenantId,
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
