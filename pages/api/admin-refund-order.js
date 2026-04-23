import { SUPABASE_URL, getServiceKey, verifyAdmin, getRequestOrigin } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";
import { logActivity } from "../../lib/activity-log";
import { sendShopRefundNotice } from "../../lib/email";

// Admin refund flow. First pass is FULL refunds only — the
// refund_amount_cents column exists so partial refunds can land later
// without another migration, but we reject partial requests here for
// now (keeps the email + ledger story simple).
//
// Body: { order_id: uuid, reason?: string }
// Response: 200 { success, stripe_refund_id, amount_cents }
//
// Steps:
//   1. verifyAdmin (tenant-scoped)
//   2. Load the order row (service role → RLS bypass)
//   3. Reject if already refunded or still pending (no payment to
//      refund), or if the order was a cancelled pickup (nothing charged)
//   4. Compute refund amount = unit_price * quantity (+ shipping_amount
//      if this is the first row of a multi-line shipping order)
//   5. stripe.refunds.create({ payment_intent })
//   6. PATCH shop_orders: status='refunded', stripe_refund_id, refunded_at,
//      refund_amount_cents, refund_reason
//   7. Return the item's quantity_claimed toward stock (item-level)
//   8. Email the member a branded refund notice (best-effort, non-fatal)
//   9. Log admin activity for the audit trail

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason: authReason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: authReason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { order_id, reason } = req.body || {};
  if (!order_id) return res.status(400).json({ error: "order_id required" });

  try {
    // 1. Load order
    const ordResp = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?id=eq.${encodeURIComponent(order_id)}&tenant_id=eq.${tenantId}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!ordResp.ok) throw new Error(`Order lookup failed: ${ordResp.status}`);
    const rows = await ordResp.json();
    if (!rows.length) return res.status(404).json({ error: "Order not found" });
    const order = rows[0];

    // 2. Guard rails
    if (order.refunded_at) {
      return res.status(409).json({ error: "Already refunded", stripe_refund_id: order.stripe_refund_id });
    }
    if (order.status === "pending") {
      return res.status(400).json({ error: "Order hasn't been charged yet — cancel instead of refund" });
    }
    if (!order.stripe_payment_intent_id) {
      return res.status(400).json({ error: "No payment intent on this order — nothing to refund" });
    }

    // 3. Compute refund amount. Items + shipping (which is stamped
    //    on the first row of a multi-line order).
    const itemCents = Math.round(
      (Number(order.unit_price) || 0) * (Number(order.quantity) || 1) * 100
    );
    const discountCents = Math.round(itemCents * (Number(order.discount_pct || 0) / 100));
    const shippingCents = Math.round((Number(order.shipping_amount) || 0) * 100);
    const taxCents = Math.round((Number(order.tax_amount) || 0) * 100);
    const refundCents = Math.max(0, itemCents - discountCents + shippingCents + taxCents);

    if (refundCents <= 0) {
      return res.status(400).json({ error: "Computed refund is $0 — nothing to refund" });
    }

    // 4. Stripe refund
    let stripe;
    try {
      stripe = await getStripeClient(tenantId);
    } catch (e) {
      return res.status(503).json({ error: "Stripe not configured", detail: e.message });
    }

    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      amount: refundCents,
      reason: "requested_by_customer",
      metadata: {
        order_id,
        admin_email: user.email || "",
        note: reason || "",
      },
    });

    // 5. Update the order row
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?id=eq.${encodeURIComponent(order_id)}&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          status: "refunded",
          stripe_refund_id: refund.id,
          refunded_at: new Date().toISOString(),
          refund_amount_cents: refundCents,
          refund_reason: reason || null,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!patchResp.ok) {
      // Refund already fired — row update failure is ugly but not a
      // catastrophe. Let the admin know so they can reconcile manually.
      const text = await patchResp.text();
      console.error("admin-refund-order: row update failed after refund", text);
      return res.status(502).json({
        error: "Stripe refund succeeded but DB row update failed — reconcile manually",
        detail: text,
        stripe_refund_id: refund.id,
      });
    }

    // 6. Return quantity_claimed to stock (best-effort; item might have
    //    been deleted since the order was placed).
    if (order.item_id && order.quantity) {
      try {
        const itResp = await fetch(
          `${SUPABASE_URL}/rest/v1/shop_items?id=eq.${encodeURIComponent(order.item_id)}&tenant_id=eq.${tenantId}&select=quantity_claimed`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        const its = itResp.ok ? await itResp.json() : [];
        if (its[0]) {
          const newClaimed = Math.max(0, (its[0].quantity_claimed || 0) - (order.quantity || 1));
          await fetch(
            `${SUPABASE_URL}/rest/v1/shop_items?id=eq.${encodeURIComponent(order.item_id)}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
              body: JSON.stringify({ quantity_claimed: newClaimed }),
            }
          );
        }
      } catch (e) {
        console.warn("admin-refund-order: quantity_claimed rollback failed:", e?.message || e);
      }
    }

    // 7. Email the member (best-effort — don't fail the request if the
    //    email service is down).
    if (order.member_email && sendShopRefundNotice) {
      try {
        await sendShopRefundNotice({
          tenantId,
          to: order.member_email,
          customerName: order.member_name || order.member_email,
          amountCents: refundCents,
          reason: reason || null,
          stripeRefundId: refund.id,
          portalUrl: getRequestOrigin(req),
        });
      } catch (e) {
        console.warn("admin-refund-order: refund email failed:", e?.message || e);
      }
    }

    // 8. Audit
    await logActivity({
      tenantId,
      actor: { id: user.id, email: user.email },
      action: "shop_order.refunded",
      targetType: "shop_order",
      targetId: order_id,
      metadata: {
        amount_cents: refundCents,
        stripe_refund_id: refund.id,
        member_email: order.member_email,
        reason: reason || null,
      },
    });

    return res.status(200).json({
      success: true,
      stripe_refund_id: refund.id,
      amount_cents: refundCents,
    });
  } catch (e) {
    console.error("admin-refund-order error:", e);
    if (e.type === "StripeInvalidRequestError") {
      return res.status(400).json({ error: "Stripe rejected refund", detail: e.message });
    }
    return res.status(500).json({ error: "Refund failed", detail: e.message });
  }
}
