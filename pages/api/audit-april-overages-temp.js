// TEMPORARY — April 2026 overage reconciliation endpoint.
//
// Pulls three sources and joins them per member:
//   1. public.monthly_usage  — who SHOULD have been charged overage
//   2. Stripe charges        — what was actually charged (all sources: Skedda,
//                              Zapier, new admin dashboard, manual Stripe)
//   3. public.payments       — what the new admin dashboard is aware of
//
// The three-way diff surfaces:
//   - Uncharged members: owed, no Stripe charge found
//   - Undercharged: Stripe < expected
//   - Skedda charges missing from DB: Stripe >= expected, but payments table lags
//   - Matched: everything lines up
//
// Admin-only. Service-role DB reads. Per-tenant Stripe via Phase 7A helper.
// DELETE THIS FILE AFTER THE AUDIT LANDS. Not part of any shipping feature.

import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

// April 2026 UTC boundaries (exclusive end)
const APRIL_START = "2026-04-01T00:00:00Z";
const APRIL_END = "2026-05-01T00:00:00Z";
const APRIL_START_TS = Math.floor(new Date(APRIL_START).getTime() / 1000);
const APRIL_END_TS = Math.floor(new Date(APRIL_END).getTime() / 1000);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized", detail: reason });
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server config" });

  let stripe;
  try {
    stripe = await getStripeClient(tenantId);
  } catch (err) {
    return res.status(503).json({
      error: "stripe_not_configured",
      detail: err?.message || String(err),
    });
  }

  try {
    // ========================================================================
    // 1. Stripe charges for April (auto-paginates via async iterator)
    // ========================================================================
    const stripeCharges = [];
    for await (const ch of stripe.charges.list({
      created: { gte: APRIL_START_TS, lt: APRIL_END_TS },
      limit: 100,
    })) {
      if (stripeCharges.length > 500) break; // safety cap
      stripeCharges.push({
        id: ch.id,
        customer: ch.customer,
        email: ch.billing_details?.email || ch.receipt_email || null,
        amount_cents: ch.amount,
        amount_refunded_cents: ch.amount_refunded,
        net_cents: (ch.amount || 0) - (ch.amount_refunded || 0),
        status: ch.status,
        paid: ch.paid,
        refunded: ch.refunded,
        description: ch.description,
        invoice: ch.invoice, // non-null = subscription invoice payment
        created: ch.created,
        created_iso: new Date(ch.created * 1000).toISOString(),
      });
    }

    // ========================================================================
    // 2. Payments rows (DB) for April
    // ========================================================================
    const paymentsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&created_at=gte.${APRIL_START}&created_at=lt.${APRIL_END}&select=*&order=created_at.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const payments = paymentsResp.ok ? await paymentsResp.json() : [];

    // ========================================================================
    // 3. Monthly usage for April
    // ========================================================================
    const usageResp = await fetch(
      `${SUPABASE_URL}/rest/v1/monthly_usage?billing_month=gte.${APRIL_START}&billing_month=lt.${APRIL_END}&select=*&order=overage_charge.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const usage = usageResp.ok ? await usageResp.json() : [];

    // ========================================================================
    // 4. Members (for stripe_customer_id -> email mapping)
    // ========================================================================
    const membersResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&select=email,name,stripe_customer_id,tier&stripe_customer_id=not.is.null`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = membersResp.ok ? await membersResp.json() : [];

    const customerToEmail = {};
    for (const m of members) {
      if (m.stripe_customer_id) customerToEmail[m.stripe_customer_id] = m.email;
    }

    // ========================================================================
    // Reconcile per email
    // ========================================================================
    const byEmail = new Map();
    const ensure = (email) => {
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          name: null,
          tier: null,
          total_hours: null,
          included_hours: null,
          overage_hours: null,
          expected_cents: 0,
          stripe_overage_cents: 0, // charges with invoice === null
          stripe_subscription_cents: 0, // charges with invoice !== null
          db_payments_cents: 0,
          stripe_charges: [],
          db_payments: [],
        });
      }
      return byEmail.get(email);
    };

    for (const u of usage) {
      const r = ensure(u.email);
      r.name = u.name;
      r.tier = u.tier;
      r.total_hours = Number(u.total_hours);
      r.included_hours = Number(u.included_hours);
      r.overage_hours = Number(u.overage_hours);
      r.expected_cents = Math.round(Number(u.overage_charge) * 100);
    }

    const unmatchedStripeCharges = [];
    for (const ch of stripeCharges) {
      // Only count successful, non-fully-refunded charges
      if (ch.status !== "succeeded") continue;
      if (ch.net_cents <= 0) continue;

      const email = customerToEmail[ch.customer] || ch.email;
      if (!email) {
        unmatchedStripeCharges.push(ch);
        continue;
      }
      const r = ensure(email);
      // Separate subscription invoice payments from standalone overage charges
      if (ch.invoice) {
        r.stripe_subscription_cents += ch.net_cents;
      } else {
        r.stripe_overage_cents += ch.net_cents;
      }
      r.stripe_charges.push({
        id: ch.id,
        net_cents: ch.net_cents,
        description: ch.description,
        invoice: ch.invoice,
        created_iso: ch.created_iso,
      });
    }

    for (const p of payments) {
      const email = p.member_email;
      if (!email) continue;
      const r = ensure(email);
      r.db_payments_cents += Number(p.amount_cents) || 0;
      r.db_payments.push({
        id: p.id,
        description: p.description,
        amount_cents: p.amount_cents,
        status: p.status,
        stripe_payment_intent_id: p.stripe_payment_intent_id,
        created_at: p.created_at,
      });
    }

    // Classify + compute deltas
    const rows = [];
    for (const r of byEmail.values()) {
      const expected = r.expected_cents;
      const stripeOverage = r.stripe_overage_cents;
      const db = r.db_payments_cents;

      let status;
      if (expected === 0 && stripeOverage === 0 && db === 0) {
        status = "no_overage_activity";
      } else if (expected === 0 && (stripeOverage > 0 || db > 0)) {
        status = "review_charged_but_no_expected_overage";
      } else if (stripeOverage === 0 && expected > 0) {
        status = "UNCHARGED_owes_full_amount";
      } else if (stripeOverage < expected) {
        status = "UNDERCHARGED_owes_difference";
      } else if (stripeOverage > expected) {
        status = "review_overcharged_or_extra_skedda_charge";
      } else if (stripeOverage === expected && db < stripeOverage) {
        status = "skedda_charge_present_missing_from_db";
      } else if (stripeOverage === expected && db === stripeOverage) {
        status = "matched";
      } else {
        status = "review_needed";
      }

      rows.push({
        email: r.email,
        name: r.name,
        tier: r.tier,
        total_hours: r.total_hours,
        included_hours: r.included_hours,
        overage_hours: r.overage_hours,
        expected_usd: r.expected_cents / 100,
        stripe_overage_usd: r.stripe_overage_cents / 100,
        stripe_subscription_usd: r.stripe_subscription_cents / 100,
        db_payments_usd: r.db_payments_cents / 100,
        owed_usd: (r.expected_cents - r.stripe_overage_cents) / 100,
        status,
        stripe_charges: r.stripe_charges,
        db_payments: r.db_payments,
      });
    }

    // Sort: action-required first
    const urgencyOrder = [
      "UNCHARGED_owes_full_amount",
      "UNDERCHARGED_owes_difference",
      "review_overcharged_or_extra_skedda_charge",
      "review_charged_but_no_expected_overage",
      "skedda_charge_present_missing_from_db",
      "review_needed",
      "matched",
      "no_overage_activity",
    ];
    rows.sort(
      (a, b) =>
        urgencyOrder.indexOf(a.status) - urgencyOrder.indexOf(b.status)
    );

    const summary = {
      tenant_id: tenantId,
      window: { start: APRIL_START, end_exclusive: APRIL_END },
      row_counts: {
        monthly_usage: usage.length,
        stripe_charges_total: stripeCharges.length,
        payments_table: payments.length,
        active_members_with_stripe: members.length,
      },
      totals_usd: {
        expected_overage_revenue: rows.reduce((a, r) => a + r.expected_usd, 0),
        stripe_overage_net_charged: rows.reduce(
          (a, r) => a + r.stripe_overage_usd,
          0
        ),
        stripe_subscription_net_charged: rows.reduce(
          (a, r) => a + r.stripe_subscription_usd,
          0
        ),
        db_payments_total: rows.reduce((a, r) => a + r.db_payments_usd, 0),
      },
      counts_by_status: rows.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
      unmatched_stripe_charges_count: unmatchedStripeCharges.length,
    };

    return res.status(200).json({
      summary,
      per_member: rows,
      unmatched_stripe_charges: unmatchedStripeCharges,
    });
  } catch (err) {
    console.error("audit-april-overages-temp error:", err);
    return res.status(500).json({
      error: err?.message || String(err),
    });
  }
}
