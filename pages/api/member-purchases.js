// GET /api/member-purchases
//
// Unified purchase feed for the authed member:
//   - In-app pro-shop checkouts from shop_orders (grouped by
//     stripe_payment_intent_id so each "purchase" is one row on the UI
//     even when the checkout contained multiple line items).
//   - In-store Square POS payments from the payments table filtered to
//     source='square_pos'.
//
// Both sources are merged into a single shape, sorted by date desc,
// and sliced to `limit` (default 20, max 100). The dashboard "Recent
// Purchases" card uses limit=5; the Shop > Orders tab uses a higher
// limit and shows the full list.

import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

// Rows with the same stripe_payment_intent_id belong to one checkout.
// Rows without a PI (fully credit-covered) fall back to second-
// granularity created_at so a simultaneous multi-item credit checkout
// still groups correctly.
function groupKeyForOrder(o) {
  if (o.stripe_payment_intent_id) return `pi:${o.stripe_payment_intent_id}`;
  const ts = o.created_at ? String(o.created_at).slice(0, 19) : "unknown";
  return `ts:${ts}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const session = await getSessionWithMember({ token, tenantId, touch: false });
    if (!session) return res.status(401).json({ error: "Session expired or invalid" });
    const member = session.member;

    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));

    // 1. In-app shop orders.
    const soResp = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(member.email)}&order=created_at.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const shopOrders = soResp.ok ? await soResp.json() : [];

    // Enrich line items with title + image via one items fetch.
    const itemIds = [...new Set(shopOrders.map((o) => o.item_id).filter(Boolean))];
    const itemMap = {};
    if (itemIds.length > 0) {
      const itResp = await fetch(
        `${SUPABASE_URL}/rest/v1/shop_items?id=in.(${itemIds.join(",")})&tenant_id=eq.${tenantId}&select=id,title,image_url`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (itResp.ok) {
        const items = await itResp.json();
        for (const it of items) itemMap[it.id] = it;
      }
    }

    // Group shop_orders rows into purchases.
    const groups = new Map();
    for (const o of shopOrders) {
      const k = groupKeyForOrder(o);
      let g = groups.get(k);
      if (!g) {
        g = {
          kind: "in_app",
          id: k,
          created_at: o.created_at,
          total_cents: 0,
          status: o.status || null,
          items: [],
          receipt_url: o.receipt_url || null,
          receipt_number: o.receipt_number || null,
          payment_method: o.payment_method || null,
          card_last_4: o.card_last_4 || null,
          card_brand: o.card_brand || null,
          stripe_payment_intent_id: o.stripe_payment_intent_id || null,
          // Shipping context — set on the first row of the order; we
          // promote any non-null shipping/tracking fields onto the
          // group below so the order UI can render them once.
          delivery_method: o.delivery_method || "pickup",
          shipping_address: o.shipping_address || null,
          shipping_amount: o.shipping_amount || null,
          shipping_carrier: o.shipping_carrier || null,
          shipping_service: o.shipping_service || null,
          tracking_number: o.tracking_number || null,
          tracking_url: o.tracking_url || null,
          label_url: o.label_url || null,
          shipping_status: o.shipping_status || null,
          shipping_status_detail: o.shipping_status_detail || null,
          shipping_status_updated_at: o.shipping_status_updated_at || null,
        };
        groups.set(k, g);
      }
      g.total_cents += Math.round(Number(o.total || 0) * 100);
      g.items.push({
        order_id: o.id,
        item_id: o.item_id,
        item_title: itemMap[o.item_id]?.title || "Item",
        item_image: itemMap[o.item_id]?.image_url || null,
        size: o.size || null,
        quantity: Number(o.quantity || 1),
        unit_price_cents: Math.round(Number(o.unit_price || 0) * 100),
        discount_pct: Number(o.discount_pct || 0),
        status: o.status || null,
      });
      // Keep the earliest (min) created_at in the group so the merged
      // sort sees the actual purchase time, not a late-arriving row.
      if (o.created_at && (!g.created_at || o.created_at < g.created_at)) {
        g.created_at = o.created_at;
      }
      // Promote any receipt or shipping fields the first row didn't
      // have but a later row in the same group carries. shipping_*
      // and label/tracking are normally only on row[0] but covering
      // both is robust against schema drift.
      for (const field of [
        "receipt_url", "receipt_number", "payment_method", "card_last_4", "card_brand",
        "shipping_address", "shipping_amount", "shipping_carrier", "shipping_service",
        "tracking_number", "tracking_url", "label_url",
        "shipping_status", "shipping_status_detail", "shipping_status_updated_at",
      ]) {
        if (!g[field] && o[field]) g[field] = o[field];
      }
    }

    // 2. In-store Square POS payments.
    const payResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(member.email)}&source=eq.square_pos&select=id,amount_cents,billing_month,description,status,receipt_url,receipt_number,payment_method,card_last_4,card_brand,square_payment_id&order=billing_month.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const squareRows = payResp.ok ? await payResp.json() : [];

    const squarePurchases = squareRows.map((r) => ({
      kind: "in_store",
      id: r.square_payment_id ? `sq:${r.square_payment_id}` : `pay:${r.id}`,
      created_at: r.billing_month,
      total_cents: Number(r.amount_cents || 0),
      status: r.status || null,
      description: r.description || "In-store purchase",
      items: null,
      receipt_url: r.receipt_url || null,
      receipt_number: r.receipt_number || null,
      payment_method: r.payment_method || null,
      card_last_4: r.card_last_4 || null,
      card_brand: r.card_brand || null,
    }));

    // 3. Merge + sort + slice.
    const merged = [...groups.values(), ...squarePurchases];
    merged.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    return res.status(200).json({ purchases: merged.slice(0, limit) });
  } catch (e) {
    console.error("member-purchases error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
