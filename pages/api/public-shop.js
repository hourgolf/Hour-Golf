// /api/public-shop
//
// Unauthenticated counterpart to /api/member-shop. Powers the public
// /shop route so guests can browse + buy without an account.
//
// GET  ?action=items       -> published items for this tenant
// POST ?action=checkout    -> validates cart, creates pending
//                             shop_orders rows + a Stripe Checkout
//                             Session, returns the Stripe URL for
//                             redirect.
//
// Member discounts / pro-shop credits / loyalty are intentionally NOT
// applied here — guests are unauthenticated. If the buyer's email
// matches an existing member row the order will still appear under
// that member's history (member_email is the lookup key everywhere
// else), which is a feature, not a bug. Tier discount + credit
// remain member-only perks via the in-app shop.
//
// Phase 1 is pickup-only. Shipping (Shippo) lands in Phase 2; tax
// (Stripe Tax) lands in Phase 3.

import {
  SUPABASE_URL,
  getServiceKey,
  getTenantId,
} from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";

export const config = { maxDuration: 30 };

async function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

function isEmailish(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const action = req.query.action;

  // ── GET: published items ────────────────────────────────────────────
  if (req.method === "GET" && action === "items") {
    const r = await sb(
      key,
      `shop_items?tenant_id=eq.${tenantId}&is_published=eq.true&order=display_order.asc,created_at.desc`
    );
    if (!r.ok) return res.status(500).json({ error: "Item lookup failed" });
    const items = await r.json();
    return res.status(200).json({ items });
  }

  // ── POST: checkout ──────────────────────────────────────────────────
  if (req.method === "POST" && action === "checkout") {
    const body = req.body || {};
    const cart = Array.isArray(body.items) ? body.items : [];
    const buyer = body.buyer || {};

    if (cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    if (!isEmailish(buyer.email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    const buyerName = (buyer.name || "").trim();
    if (!buyerName) {
      return res.status(400).json({ error: "Name is required" });
    }
    const buyerPhone = (buyer.phone || "").trim() || null;

    // Validate items + compute totals against the catalog (never trust
    // client-provided prices). Reject if anything is unpublished or out
    // of stock.
    const itemIds = [...new Set(cart.map((c) => c.item_id).filter(Boolean))];
    if (itemIds.length === 0) {
      return res.status(400).json({ error: "Cart has no recognizable items" });
    }
    const itResp = await sb(
      key,
      `shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}`
    );
    const items = itResp.ok ? await itResp.json() : [];
    const itemMap = {};
    items.forEach((i) => { itemMap[i.id] = i; });

    const lineItems = [];
    const stripeLineItems = [];
    let grandTotalCents = 0;

    for (const c of cart) {
      const it = itemMap[c.item_id];
      if (!it || !it.is_published) {
        return res.status(400).json({ error: `Item "${it?.title || "unknown"}" is no longer available.` });
      }
      const qty = Math.max(1, Number(c.quantity) || 1);
      if (it.quantity_available != null) {
        const remaining = it.quantity_available - (it.quantity_claimed || 0);
        if (remaining < qty) {
          return res.status(400).json({
            error: `Not enough stock for "${it.title}". Only ${remaining} left.`,
          });
        }
      }
      if (it.sizes && Array.isArray(it.sizes) && it.sizes.length > 0 && c.size && !it.sizes.includes(c.size)) {
        return res.status(400).json({ error: `Size "${c.size}" no longer available for "${it.title}".` });
      }
      const unitPriceCents = Math.round(Number(it.price) * 100);
      const lineTotalCents = unitPriceCents * qty;
      grandTotalCents += lineTotalCents;
      lineItems.push({ cart: c, item: it, qty, unitPriceCents, lineTotalCents });

      const productName = c.size ? `${it.title} (${c.size})` : it.title;
      stripeLineItems.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: unitPriceCents,
          product_data: {
            name: productName,
            ...(it.image_url ? { images: [it.image_url] } : {}),
          },
        },
      });
    }

    if (grandTotalCents < 50) {
      return res.status(400).json({ error: "Order total too small to process." });
    }

    let stripe;
    try {
      stripe = await getStripeClient(tenantId);
    } catch (err) {
      console.error("public-shop getStripeClient failed:", err?.message || err);
      return res.status(503).json({ error: "Stripe is not configured for this tenant." });
    }

    // Build absolute return URLs so Stripe knows where to send the
    // browser back. Vercel + middleware preserve x-forwarded-host so we
    // don't have to hardcode the tenant subdomain.
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${proto}://${host}`;

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: stripeLineItems,
        customer_email: buyer.email.trim().toLowerCase(),
        success_url: `${origin}/shop?success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/shop?canceled=1`,
        metadata: {
          type: "guest_shop",
          tenant_id: tenantId,
          buyer_name: buyerName.slice(0, 200),
          buyer_phone: buyerPhone || "",
          item_count: String(lineItems.length),
        },
        payment_intent_data: {
          metadata: {
            type: "guest_shop",
            tenant_id: tenantId,
          },
        },
      });
    } catch (e) {
      console.error("Stripe Checkout Session create failed:", e?.message || e);
      return res.status(500).json({ error: "Could not start checkout. Try again." });
    }

    // Create pending shop_orders rows. Webhook flips them to confirmed
    // when the session completes; if the buyer abandons checkout the
    // rows remain pending and an admin can clean them up later.
    const buyerEmail = buyer.email.trim().toLowerCase();
    try {
      for (const li of lineItems) {
        await sb(key, "shop_orders", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: buyerEmail,
            member_name: buyerName,
            item_id: li.cart.item_id,
            size: li.cart.size || null,
            quantity: li.qty,
            unit_price: li.unitPriceCents / 100,
            discount_pct: 0,
            total: li.lineTotalCents / 100,
            status: "pending",
            stripe_checkout_session_id: session.id,
            is_guest: true,
            guest_phone: buyerPhone,
            notes: "Pickup at next visit",
          }),
        });
      }
    } catch (e) {
      console.error("public-shop pending order insert failed:", e?.message || e);
      // The Stripe session still exists; if we lose this insert the
      // webhook will land with no rows to update and just log a
      // "no pending orders found" message. Better to surface the
      // failure than silently let the buyer pay for nothing.
      return res.status(500).json({ error: "Could not record order. Try again." });
    }

    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
