// TEMPORARY — find Stripe charges that aren't in the payments table.
//
// Symptom that led to this: before stripe-charge.js owned the payments
// INSERT, admins could click "Charge Overage", Stripe would succeed, but
// the client-side INSERT failed because Phase 2C dropped the tenant_id
// DEFAULT. Customer was charged; our DB didn't know.
//
// This endpoint:
//   1. Pulls last 100 Stripe charges with description starting with
//      "Hour Golf" (our dashboard-sourced descriptions)
//   2. Looks up each charge's payment_intent in the payments table
//   3. Returns any that aren't captured — these are orphans
//
// Admin only. DELETE this file after the backfill completes.

import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server config" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    return res.status(503).json({ error: "stripe_not_configured", detail: err?.message });
  }

  try {
    // Get all Stripe charges with description starting Hour Golf, last 30 days
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const stripeCharges = [];
    for await (const ch of stripe.charges.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
    })) {
      if (stripeCharges.length > 300) break;
      const desc = ch.description || "";
      if (!desc.toLowerCase().startsWith("hour golf")) continue; // dashboard-sourced only
      if (ch.status !== "succeeded") continue;
      stripeCharges.push({
        id: ch.id,
        payment_intent: ch.payment_intent,
        amount_cents: ch.amount,
        net_cents: (ch.amount || 0) - (ch.amount_refunded || 0),
        description: ch.description,
        customer: ch.customer,
        email: ch.billing_details?.email || ch.receipt_email || null,
        created: ch.created,
        created_iso: new Date(ch.created * 1000).toISOString(),
        refunded: ch.refunded,
      });
    }

    // Pull every payment_intent_id currently in payments for this tenant
    const paymentsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&select=stripe_payment_intent_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const payments = paymentsResp.ok ? await paymentsResp.json() : [];
    const knownPIs = new Set(
      payments.map((p) => p.stripe_payment_intent_id).filter(Boolean)
    );

    // Map customer_id → email via members table
    const membersResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&select=email,name,stripe_customer_id&stripe_customer_id=not.is.null`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = membersResp.ok ? await membersResp.json() : [];
    const customerToMember = {};
    for (const m of members) {
      if (m.stripe_customer_id) customerToMember[m.stripe_customer_id] = m;
    }

    // Classify
    const orphans = [];
    const captured = [];
    for (const ch of stripeCharges) {
      const member = ch.customer ? customerToMember[ch.customer] : null;
      const enriched = {
        ...ch,
        member_email: member?.email || ch.email,
        member_name: member?.name || null,
      };
      if (ch.payment_intent && knownPIs.has(ch.payment_intent)) {
        captured.push(enriched);
      } else {
        orphans.push(enriched);
      }
    }

    // Sort orphans newest first
    orphans.sort((a, b) => b.created - a.created);

    return res.status(200).json({
      summary: {
        tenant_id: tenantId,
        window_days: 30,
        stripe_dashboard_charges_found: stripeCharges.length,
        captured_in_payments_table: captured.length,
        orphans_count: orphans.length,
        orphans_total_usd: orphans.reduce((a, o) => a + o.net_cents, 0) / 100,
      },
      orphans,
      captured, // for sanity — can ignore
    });
  } catch (err) {
    console.error("find-orphaned-charges-temp error:", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
