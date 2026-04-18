import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getStripeClient } from "../../lib/stripe-config";
import { getSquareCredentials } from "../../lib/square-config";
import { adjustGiftCard } from "../../lib/square-api";
import { sendShopOrderNotification } from "../../lib/email";
import { assertFeature } from "../../lib/feature-guard";
import { getSessionWithMember } from "../../lib/member-session";

// Phase 7B-2b: per-tenant Stripe client via lib/stripe-config.

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
  return pm || null;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

function sb(key, path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  // The `loyalty` sub-action has its own gate below. All other shop
  // actions require the pro_shop feature.
  const action = req.query.action || "browse";
  if (action === "loyalty") {
    if (!(await assertFeature(res, tenantId, "loyalty"))) return;
  } else {
    if (!(await assertFeature(res, tenantId, "pro_shop"))) return;
  }

  try {
    const sess = await getSessionWithMember({ token, tenantId, touch: true });
    if (!sess) return res.status(401).json({ error: "Session expired" });
    const member = sess.member;

    let discountPct = 0;
    if (member.tier) {
      const tcResp = await sb(key, `tier_config?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}&select=pro_shop_discount`);
      const tc = tcResp.ok ? await tcResp.json() : [];
      if (tc.length > 0) discountPct = Number(tc[0].pro_shop_discount || 0);
    }

    // ── GET: browse items ──
    if (req.method === "GET" && action === "browse") {
      const itResp = await sb(key, `shop_items?tenant_id=eq.${tenantId}&is_published=eq.true&order=display_order.asc,created_at.desc`);
      const items = itResp.ok ? await itResp.json() : [];
      const now = new Date().toISOString();

      const visible = items.filter((it) => {
        if (it.is_limited && it.drop_date && it.drop_date > now) return false;
        return true;
      });

      const enriched = visible.map((it) => {
        const remaining = it.quantity_available != null
          ? Math.max(0, it.quantity_available - (it.quantity_claimed || 0))
          : null;
        return {
          id: it.id, title: it.title, subtitle: it.subtitle,
          description: it.description, image_url: it.image_url,
          image_urls: Array.isArray(it.image_urls) && it.image_urls.length > 0 ? it.image_urls : (it.image_url ? [it.image_url] : []),
          price: Number(it.price), category: it.category, brand: it.brand,
          is_limited: it.is_limited, sizes: it.sizes,
          quantity_remaining: remaining,
          sold_out: remaining !== null && remaining <= 0,
          discount_pct: discountPct,
          member_price: Math.round(Number(it.price) * (1 - discountPct / 100) * 100) / 100,
        };
      });

      return res.status(200).json({ items: enriched, discount_pct: discountPct });
    }

    // ── GET: my orders ──
    if (req.method === "GET" && action === "my-orders") {
      const ordResp = await sb(key, `shop_orders?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&order=created_at.desc`);
      const orders = ordResp.ok ? await ordResp.json() : [];
      const itemIds = [...new Set(orders.map((o) => o.item_id))];
      let items = [];
      if (itemIds.length > 0) {
        const itResp = await sb(key, `shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}`);
        items = itResp.ok ? await itResp.json() : [];
      }
      const itemMap = {};
      items.forEach((i) => { itemMap[i.id] = i; });
      const enriched = orders.map((o) => ({
        ...o,
        item_title: itemMap[o.item_id]?.title || "Unknown",
        item_image: itemMap[o.item_id]?.image_url || null,
      }));
      return res.status(200).json(enriched);
    }

    // ── GET: credit history ──
    if (req.method === "GET" && action === "credit-history") {
      const crResp = await sb(key, `shop_credits?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&order=created_at.desc`);
      const credits = crResp.ok ? await crResp.json() : [];
      return res.status(200).json({ credits, balance: Number(member.shop_credit_balance || 0) });
    }

    // ── GET: loyalty progress ──
    if (req.method === "GET" && action === "loyalty") {
      // Fetch enabled rules within this tenant
      const rulesResp = await sb(key, `loyalty_rules?tenant_id=eq.${tenantId}&enabled=eq.true`);
      const rules = rulesResp.ok ? await rulesResp.json() : [];
      if (!rules.length) return res.status(200).json({ rules: [], progress: [] });

      // Current month
      const now = new Date();
      const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

      // Booking hours + count this month
      const bkResp = await sb(key, `bookings?tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&customer_email=eq.${encodeURIComponent(member.email)}&booking_start=gte.${monthStart}&booking_start=lt.${monthEnd}&select=duration_hours`);
      const bks = bkResp.ok ? await bkResp.json() : [];
      const totalHours = bks.reduce((s, b) => s + Number(b.duration_hours || 0), 0);
      const totalBookings = bks.length;

      // Shop spend this month
      const ordResp = await sb(key, `shop_orders?tenant_id=eq.${tenantId}&status=eq.confirmed&member_email=eq.${encodeURIComponent(member.email)}&created_at=gte.${monthStart}&created_at=lt.${monthEnd}&select=total`);
      const ords = ordResp.ok ? await ordResp.json() : [];
      const totalSpend = ords.reduce((s, o) => s + Number(o.total || 0), 0);

      // Recent rewards
      const ledgerResp = await sb(key, `loyalty_ledger?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&reward_issued=gt.0&order=created_at.desc&limit=10`);
      const recentRewards = ledgerResp.ok ? await ledgerResp.json() : [];

      const progress = rules.map((r) => {
        let current = 0;
        if (r.rule_type === "hours") current = totalHours;
        else if (r.rule_type === "bookings") current = totalBookings;
        else if (r.rule_type === "shop_spend") current = totalSpend;
        return {
          rule_type: r.rule_type,
          threshold: Number(r.threshold),
          reward: Number(r.reward),
          current: Math.round(current * 100) / 100,
          pct: Math.min(100, Math.round((current / Number(r.threshold)) * 100)),
        };
      });

      const isMember = !!member.tier && member.tier !== "Non-Member";
      return res.status(200).json({ progress, recent_rewards: recentRewards, is_member: isMember });
    }

    // ── GET: cart ──
    if (req.method === "GET" && action === "cart") {
      const cartResp = await sb(key, `shop_cart?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&order=created_at.asc`);
      const cartItems = cartResp.ok ? await cartResp.json() : [];
      const itemIds = [...new Set(cartItems.map((c) => c.item_id))];
      let items = [];
      if (itemIds.length > 0) {
        const itResp = await sb(key, `shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}`);
        items = itResp.ok ? await itResp.json() : [];
      }
      const itemMap = {};
      items.forEach((i) => { itemMap[i.id] = i; });

      const enriched = cartItems.map((c) => {
        const it = itemMap[c.item_id] || {};
        const unitPrice = Number(it.price || 0);
        const memberPrice = Math.round(unitPrice * (1 - discountPct / 100) * 100) / 100;
        return {
          cart_id: c.id,
          item_id: c.item_id,
          size: c.size,
          quantity: c.quantity,
          title: it.title || "Unknown",
          brand: it.brand,
          image_url: it.image_url,
          price: unitPrice,
          member_price: memberPrice,
          line_total: Math.round(memberPrice * c.quantity * 100) / 100,
        };
      });

      const cartTotal = enriched.reduce((s, c) => s + c.line_total, 0);
      const creditBalance = Number(member.shop_credit_balance || 0);
      return res.status(200).json({ cart: enriched, discount_pct: discountPct, cart_total: Math.round(cartTotal * 100) / 100, credit_balance: creditBalance });
    }

    // ── POST: add to cart ──
    if (req.method === "POST" && action === "add-to-cart") {
      const { item_id, size, quantity } = req.body || {};
      if (!item_id) return res.status(400).json({ error: "Item ID required" });

      // Check if same item+size already in cart
      const sizeFilter = size ? `&size=eq.${encodeURIComponent(size)}` : "&size=is.null";
      const existResp = await sb(key, `shop_cart?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&item_id=eq.${item_id}${sizeFilter}`);
      const existing = existResp.ok ? await existResp.json() : [];

      if (existing.length > 0) {
        // Increment quantity
        const newQty = existing[0].quantity + Number(quantity || 1);
        await sb(key, `shop_cart?id=eq.${existing[0].id}&tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity: newQty, updated_at: new Date().toISOString() }),
        });
      } else {
        await sb(key, "shop_cart", {
          method: "POST",
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: member.email,
            item_id,
            size: size || null,
            quantity: Number(quantity || 1),
          }),
        });
      }

      // Return updated cart count
      const countResp = await sb(key, `shop_cart?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&select=quantity`);
      const countItems = countResp.ok ? await countResp.json() : [];
      const cartCount = countItems.reduce((s, c) => s + c.quantity, 0);
      return res.status(200).json({ success: true, cart_count: cartCount });
    }

    // ── PATCH: update cart quantity ──
    if (req.method === "PATCH" && action === "update-cart") {
      const { cart_id, quantity } = req.body || {};
      if (!cart_id) return res.status(400).json({ error: "Cart ID required" });
      const qty = Number(quantity || 1);
      if (qty < 1) return res.status(400).json({ error: "Quantity must be at least 1" });

      await sb(key, `shop_cart?id=eq.${cart_id}&member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: qty, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ success: true });
    }

    // ── DELETE: remove from cart ──
    if (req.method === "DELETE" && action === "remove-from-cart") {
      const cartId = req.query.cart_id || req.body?.cart_id;
      if (!cartId) return res.status(400).json({ error: "Cart ID required" });

      await sb(key, `shop_cart?id=eq.${cartId}&member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`, {
        method: "DELETE",
      });
      return res.status(200).json({ success: true });
    }

    // ── POST: checkout (charge full cart) ──
    if (req.method === "POST" && action === "checkout") {
      // 1. Fetch cart
      const cartResp = await sb(key, `shop_cart?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&order=created_at.asc`);
      const cartItems = cartResp.ok ? await cartResp.json() : [];
      if (!cartItems.length) return res.status(400).json({ error: "Cart is empty" });

      // 2. Fetch all items
      const itemIds = [...new Set(cartItems.map((c) => c.item_id))];
      const itResp = await sb(key, `shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}`);
      const items = itResp.ok ? await itResp.json() : [];
      const itemMap = {};
      items.forEach((i) => { itemMap[i.id] = i; });

      // 3. Validate stock + calculate totals
      let grandTotal = 0;
      const lineItems = [];
      for (const c of cartItems) {
        const it = itemMap[c.item_id];
        if (!it || !it.is_published) return res.status(400).json({ error: `Item "${it?.title || "unknown"}" is no longer available.` });
        if (it.quantity_available != null) {
          const remaining = it.quantity_available - (it.quantity_claimed || 0);
          if (remaining < c.quantity) return res.status(400).json({ error: `Not enough stock for "${it.title}". Only ${remaining} left.` });
        }
        if (it.sizes && Array.isArray(it.sizes) && it.sizes.length > 0 && c.size && !it.sizes.includes(c.size)) {
          return res.status(400).json({ error: `Size "${c.size}" no longer available for "${it.title}".` });
        }
        const unitPrice = Number(it.price);
        const lineTotal = Math.round(unitPrice * c.quantity * (1 - discountPct / 100) * 100) / 100;
        grandTotal += lineTotal;
        lineItems.push({ cart: c, item: it, unitPrice, lineTotal });
      }

      grandTotal = Math.round(grandTotal * 100) / 100;

      // 4. Apply pro shop credits
      const creditBalance = Number(member.shop_credit_balance || 0);
      const creditsUsed = Math.min(creditBalance, grandTotal);
      const cardCharge = Math.round((grandTotal - creditsUsed) * 100) / 100;
      const cardChargeCents = Math.round(cardCharge * 100);

      // 5. Charge Stripe (if card charge needed)
      let pi = null;
      if (cardChargeCents >= 50) {
        if (!member.stripe_customer_id) {
          return res.status(400).json({ error: "No payment method on file. Please add a card in the Billing tab." });
        }
        let stripe;
        try {
          stripe = await getStripeClient(tenantId);
        } catch (err) {
          console.error("member-shop getStripeClient failed:", err?.message || err);
          return res.status(503).json({
            error: "stripe_not_configured",
            detail: "Stripe is not set up for this tenant yet.",
          });
        }
        const paymentMethod = await findPaymentMethod(stripe, member.stripe_customer_id);
        if (!paymentMethod) {
          return res.status(400).json({ error: "No payment method found. Please update your card in the Billing tab." });
        }

        const itemNames = lineItems.map((li) => li.item.title).join(", ");
        try {
          pi = await stripe.paymentIntents.create({
            amount: cardChargeCents,
            currency: "usd",
            customer: member.stripe_customer_id,
            payment_method: paymentMethod,
            off_session: true,
            confirm: true,
            description: `Hour Golf Pro Shop — ${itemNames}`.slice(0, 200),
            metadata: {
              member_email: member.email,
              item_count: String(lineItems.length),
              credits_used: creditsUsed.toFixed(2),
              source: "hour-golf-pro-shop",
            },
            // Expand the latest_charge so we get the public receipt_url and
            // card brand / last-4 back in the same round-trip. Saves a
            // second paymentIntents.retrieve() call before we write the
            // shop_orders rows below.
            expand: ["latest_charge"],
          });
        } catch (stripeErr) {
          console.error("Stripe checkout failed:", stripeErr);
          return res.status(400).json({ error: "Payment failed. Please check your card details in the Billing tab." });
        }
      } else if (creditsUsed <= 0) {
        return res.status(400).json({ error: "Order total too small to process." });
      }
      // If cardChargeCents < 50 but creditsUsed > 0, we skip Stripe (fully covered by credits)

      // 6. Deduct credits if used
      if (creditsUsed > 0) {
        const newBalance = Math.round((creditBalance - creditsUsed) * 100) / 100;
        await sb(key, `members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          body: JSON.stringify({ shop_credit_balance: newBalance, updated_at: new Date().toISOString() }),
        });
        await sb(key, "shop_credits", {
          method: "POST",
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: member.email,
            amount: creditsUsed,
            type: "debit",
            reason: `Pro Shop purchase — ${lineItems.length} item${lineItems.length > 1 ? "s" : ""}`,
          }),
        });

        // Keep the Square gift card in lockstep if the member has one
        // linked so Register doesn't keep showing stale credit. Any
        // Square API failure here is logged but never blocks the
        // in-app purchase — next sync-gift-cards run will reconcile.
        if (member.square_gift_card_id) {
          try {
            const square = await getSquareCredentials(tenantId);
            await adjustGiftCard({
              apiBase: square.apiBase,
              accessToken: square.accessToken,
              locationId: square.locationId,
              giftCardId: member.square_gift_card_id,
              deltaCents: Math.round(creditsUsed * 100),
              direction: "DECREMENT",
              reason: "OTHER",
              idempotencyKey: `gc-shop-dec-${member.email}-${Date.now()}`,
            });
          } catch (e) {
            console.error(`shop checkout: gift card decrement failed for ${member.email}:`, e.message);
          }
        }
      }

      // Extract receipt / card detail from the expanded latest_charge
      // so every shop_orders row in this checkout shares the same
      // receipt_url. All rows with the same stripe_payment_intent_id
      // represent one purchase on the Orders tab.
      const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const card = charge?.payment_method_details?.card || null;
      const receiptUrl = charge?.receipt_url || null;
      const receiptNumber = charge?.receipt_number || null;
      const paymentMethodKind = charge?.payment_method_details?.type || (pi ? "card" : null);
      const cardLast4 = card?.last4 || null;
      const cardBrand = card?.brand ? String(card.brand).toUpperCase() : null;

      // 7. Create orders for each line item
      for (const li of lineItems) {
        await sb(key, "shop_orders", {
          method: "POST",
          body: JSON.stringify({
            tenant_id: tenantId,
            member_email: member.email,
            member_name: member.name,
            item_id: li.cart.item_id,
            size: li.cart.size || null,
            quantity: li.cart.quantity,
            unit_price: li.unitPrice,
            discount_pct: discountPct,
            total: li.lineTotal,
            status: "confirmed",
            stripe_payment_intent_id: pi?.id || null,
            notes: "Pick up at next visit",
            receipt_url: receiptUrl,
            receipt_number: receiptNumber,
            payment_method: paymentMethodKind,
            card_last_4: cardLast4,
            card_brand: cardBrand,
          }),
        });
        // Increment quantity_claimed
        await sb(key, `shop_items?id=eq.${li.cart.item_id}&tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity_claimed: (li.item.quantity_claimed || 0) + li.cart.quantity }),
        });
      }

      // 6. Clear cart
      await sb(key, `shop_cart?member_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`, { method: "DELETE" });

      // 7. Notify admin. Await so Vercel doesn't freeze the process
      // and drop the Resend call before it completes.
      try {
        await sendShopOrderNotification({
          tenantId,
          customerName: member.name,
          customerEmail: member.email,
          items: lineItems.map((li) => ({ title: li.item.title, size: li.cart.size, quantity: li.cart.quantity, lineTotal: li.lineTotal })),
          total: grandTotal,
          discountPct,
        });
      } catch (e) {
        console.error("Shop order notification failed:", e);
      }

      return res.status(200).json({
        success: true,
        total: grandTotal,
        credits_used: creditsUsed,
        card_charged: cardCharge,
        item_count: lineItems.length,
        stripe_payment_intent_id: pi?.id || null,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("member-shop error:", e);
    return res.status(500).json({ error: e.message });
  }
}
