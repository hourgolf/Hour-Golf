import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

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

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Verify session and get member info
    const mResp = await sb(key, `members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=email,name,tier`);
    if (!mResp.ok) throw new Error("Session lookup failed");
    const members = await mResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });
    const member = members[0];

    // Get tier discount
    let discountPct = 0;
    if (member.tier) {
      const tcResp = await sb(key, `tier_config?tier=eq.${encodeURIComponent(member.tier)}&select=pro_shop_discount`);
      const tc = tcResp.ok ? await tcResp.json() : [];
      if (tc.length > 0) discountPct = Number(tc[0].pro_shop_discount || 0);
    }

    const action = req.query.action || "browse";

    // ── GET: browse items ──
    if (req.method === "GET" && action === "browse") {
      const itResp = await sb(key, "shop_items?is_published=eq.true&order=display_order.asc,created_at.desc");
      const items = itResp.ok ? await itResp.json() : [];
      const now = new Date().toISOString();

      const visible = items.filter((it) => {
        // Hide limited items before their drop date
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
      const ordResp = await sb(key, `shop_orders?member_email=eq.${encodeURIComponent(member.email)}&order=created_at.desc`);
      const orders = ordResp.ok ? await ordResp.json() : [];

      // Enrich with item details
      const itemIds = [...new Set(orders.map((o) => o.item_id))];
      let items = [];
      if (itemIds.length > 0) {
        const itResp = await sb(key, `shop_items?id=in.(${itemIds.join(",")})`);
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

    // ── POST: place order ──
    if (req.method === "POST" && action === "order") {
      const { item_id, size, quantity, notes } = req.body || {};
      if (!item_id) return res.status(400).json({ error: "Item ID required" });

      // Fetch item
      const itResp = await sb(key, `shop_items?id=eq.${item_id}&is_published=eq.true`);
      const items = itResp.ok ? await itResp.json() : [];
      if (!items.length) return res.status(404).json({ error: "Item not found" });
      const item = items[0];

      // Check stock
      const qty = Number(quantity || 1);
      if (item.quantity_available != null) {
        const remaining = item.quantity_available - (item.quantity_claimed || 0);
        if (remaining < qty) return res.status(400).json({ error: "Not enough stock" });
      }

      // Validate size
      if (item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0) {
        if (!size || !item.sizes.includes(size)) {
          return res.status(400).json({ error: "Please select a valid size" });
        }
      }

      // Calculate price
      const unitPrice = Number(item.price);
      const total = Math.round(unitPrice * qty * (1 - discountPct / 100) * 100) / 100;

      // Create order
      const ordResp = await sb(key, "shop_orders", {
        method: "POST",
        body: JSON.stringify({
          member_email: member.email,
          member_name: member.name,
          item_id,
          size: size || null,
          quantity: qty,
          unit_price: unitPrice,
          discount_pct: discountPct,
          total,
          notes: notes || null,
        }),
      });
      if (!ordResp.ok) throw new Error(await ordResp.text());

      // Increment quantity_claimed
      await sb(key, `shop_items?id=eq.${item_id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity_claimed: (item.quantity_claimed || 0) + qty }),
      });

      const rows = await ordResp.json();
      return res.status(201).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("member-shop error:", e);
    return res.status(500).json({ error: e.message });
  }
}
