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
import { getShippoCredentials } from "../../lib/shippo-config";
import {
  buildParcelFromItems,
  createShipmentAndGetRates,
} from "../../lib/shippo-api";

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

  // ── POST: shipping rate quote ───────────────────────────────────────
  // Body: { items: [{item_id, quantity}], destination: { name, street1,
  //        street2?, city, state, zip, country?, phone?, email? } }
  // Returns: { rates: [{ object_id, provider, servicelevel: { name },
  //                      amount, currency, estimated_days }] }
  if (req.method === "POST" && action === "rates") {
    const body = req.body || {};
    const cart = Array.isArray(body.items) ? body.items : [];
    const dest = body.destination || {};
    if (cart.length === 0) return res.status(400).json({ error: "Cart is empty" });
    if (!dest.street1 || !dest.city || !dest.state || !dest.zip) {
      return res.status(400).json({ error: "Destination address incomplete" });
    }

    let shippo;
    try { shippo = await getShippoCredentials(tenantId); }
    catch (e) { return res.status(503).json({ error: "Shipping not configured", detail: e.message }); }

    // Fetch item dims to build the parcel.
    const itemIds = [...new Set(cart.map((c) => c.item_id).filter(Boolean))];
    const itResp = await sb(
      key,
      `shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}&select=id,is_shippable,weight_oz,length_in,width_in,height_in`
    );
    const items = itResp.ok ? await itResp.json() : [];
    const itemMap = {};
    items.forEach((i) => { itemMap[i.id] = i; });

    // Reject if any item is flagged not-shippable.
    for (const c of cart) {
      const it = itemMap[c.item_id];
      if (!it) return res.status(400).json({ error: "Item not found" });
      if (it.is_shippable === false) {
        return res.status(400).json({ error: "Cart contains a pickup-only item" });
      }
    }

    const itemsWithDims = cart.map((c) => ({
      ...itemMap[c.item_id],
      quantity: c.quantity || 1,
    }));
    const parcel = buildParcelFromItems(itemsWithDims);

    try {
      const result = await createShipmentAndGetRates({
        apiKey: shippo.apiKey,
        addressFrom: shippo.originAddress,
        addressTo: {
          name: dest.name || "",
          street1: dest.street1,
          street2: dest.street2 || "",
          city: dest.city,
          state: dest.state.toUpperCase(),
          zip: dest.zip,
          country: (dest.country || "US").toUpperCase(),
          phone: dest.phone || "",
          email: dest.email || "",
        },
        parcel,
      });
      // Sort cheapest first; trim to a reasonable number so the UI
      // doesn't drown in obscure servicelevels.
      const rates = (result.rates || [])
        .filter((r) => r.amount && Number(r.amount) > 0)
        .map((r) => ({
          object_id: r.object_id,
          provider: r.provider,
          servicelevel_name: r.servicelevel?.name || r.servicelevel?.token || "",
          amount: Number(r.amount),
          currency: r.currency || "USD",
          estimated_days: r.estimated_days || null,
          duration_terms: r.duration_terms || "",
        }))
        .sort((a, b) => a.amount - b.amount)
        .slice(0, 8);
      if (rates.length === 0) {
        return res.status(400).json({ error: "No shipping rates available for this destination." });
      }
      return res.status(200).json({ shipment_id: result.shipment_id, rates });
    } catch (e) {
      console.error("public-shop rates error:", e?.message || e);
      return res.status(500).json({ error: "Could not fetch shipping rates", detail: e.message });
    }
  }

  // ── POST: checkout ──────────────────────────────────────────────────
  if (req.method === "POST" && action === "checkout") {
    const body = req.body || {};
    const cart = Array.isArray(body.items) ? body.items : [];
    const buyer = body.buyer || {};
    const deliveryMethod = body.delivery_method === "ship" ? "ship" : "pickup";
    const shipping = body.shipping || null; // { address, rate_id, amount, carrier, service }

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

    if (deliveryMethod === "ship") {
      if (!shipping || !shipping.rate_id || !shipping.address) {
        return res.status(400).json({ error: "Shipping rate + address required for ship delivery" });
      }
      if (!shipping.address.street1 || !shipping.address.city || !shipping.address.state || !shipping.address.zip) {
        return res.status(400).json({ error: "Shipping address incomplete" });
      }
      if (typeof shipping.amount !== "number" || shipping.amount <= 0) {
        return res.status(400).json({ error: "Shipping amount missing" });
      }
    }

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

    // Append shipping line item if shipping. Stripe will sum it into
    // the total automatically; webhook reads metadata to know the
    // shipping context for label generation.
    if (deliveryMethod === "ship") {
      const shippingCents = Math.round(shipping.amount * 100);
      stripeLineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: shippingCents,
          product_data: {
            name: shipping.carrier && shipping.service
              ? `Shipping (${shipping.carrier} ${shipping.service})`
              : "Shipping",
          },
        },
      });
    }

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
          delivery_method: deliveryMethod,
          // Stash the chosen rate id so the webhook can purchase the
          // label without re-running the Shippo rate API.
          shippo_rate_id: deliveryMethod === "ship" ? (shipping.rate_id || "") : "",
          shipping_amount: deliveryMethod === "ship" ? String(shipping.amount) : "",
          shipping_carrier: deliveryMethod === "ship" ? (shipping.carrier || "") : "",
          shipping_service: deliveryMethod === "ship" ? (shipping.service || "") : "",
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
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        // Only the FIRST row in a multi-line order carries the
        // shipping detail (shippo_rate_id, address, amount). The
        // webhook purchases one label per session, then mirrors
        // tracking info onto every row of that session for display.
        const isFirst = idx === 0;
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
            delivery_method: deliveryMethod,
            shipping_address: deliveryMethod === "ship" && isFirst ? shipping.address : null,
            shipping_amount: deliveryMethod === "ship" && isFirst ? shipping.amount : null,
            shipping_carrier: deliveryMethod === "ship" && isFirst ? (shipping.carrier || null) : null,
            shipping_service: deliveryMethod === "ship" && isFirst ? (shipping.service || null) : null,
            shippo_rate_id: deliveryMethod === "ship" && isFirst ? shipping.rate_id : null,
            notes: deliveryMethod === "ship" ? "Will ship after payment" : "Pickup at next visit",
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
