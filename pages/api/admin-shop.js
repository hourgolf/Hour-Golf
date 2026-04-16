import { verifyAdmin, getServiceKey, SUPABASE_URL } from "../../lib/api-helpers";

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
  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const action = req.query.action || "items";

  try {
    // ── GET ──
    if (req.method === "GET") {
      if (action === "orders") {
        const statusFilter = req.query.status ? `&status=eq.${req.query.status}` : "";
        const ordResp = await sb(key, `shop_orders?tenant_id=eq.${tenantId}&order=created_at.desc${statusFilter}`);
        if (!ordResp.ok) throw new Error(`Orders fetch: ${ordResp.status}`);
        const orders = await ordResp.json();

        // Enrich with item details
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

      // Default: list items with order counts
      const itResp = await sb(key, `shop_items?tenant_id=eq.${tenantId}&order=display_order.asc,created_at.desc`);
      if (!itResp.ok) throw new Error(`Items fetch: ${itResp.status}`);
      const items = await itResp.json();

      const ordResp = await sb(key, `shop_orders?tenant_id=eq.${tenantId}&select=item_id,status`);
      const orders = ordResp.ok ? await ordResp.json() : [];
      const countByItem = {};
      const pendingByItem = {};
      orders.forEach((o) => {
        countByItem[o.item_id] = (countByItem[o.item_id] || 0) + 1;
        if (o.status === "pending") pendingByItem[o.item_id] = (pendingByItem[o.item_id] || 0) + 1;
      });

      const enriched = items.map((i) => ({
        ...i,
        order_count: countByItem[i.id] || 0,
        pending_count: pendingByItem[i.id] || 0,
      }));
      return res.status(200).json(enriched);
    }

    // ── POST — create item ──
    if (req.method === "POST") {
      const { title, subtitle, description, image_url, image_urls, price, category, brand,
              is_limited, drop_date, quantity_available, sizes, is_published, display_order } = req.body;
      if (!title || price === undefined) return res.status(400).json({ error: "Title and price required" });

      const urls = Array.isArray(image_urls) ? image_urls.filter(Boolean).slice(0, 5) : [];
      const primaryImage = urls[0] || image_url || null;

      const r = await sb(key, "shop_items", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: tenantId,
          title, subtitle: subtitle || null, description: description || null,
          image_url: primaryImage, image_urls: urls.length > 0 ? urls : null,
          price: Number(price),
          category: category || null, brand: brand || null,
          is_limited: !!is_limited, drop_date: drop_date || null,
          quantity_available: quantity_available != null ? Number(quantity_available) : null,
          sizes: sizes || null, is_published: is_published !== false,
          display_order: Number(display_order || 0),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(201).json(rows[0]);
    }

    // ── PATCH ──
    if (req.method === "PATCH") {
      const id = req.query.id || req.body.id;
      if (!id) return res.status(400).json({ error: "Missing id" });

      if (action === "orders") {
        // Update order status
        const { status, notes } = req.body;
        const update = {};
        if (status) update.status = status;
        if (notes !== undefined) update.notes = notes;

        // If cancelling, decrement quantity_claimed on the item
        if (status === "cancelled") {
          const ordResp = await sb(key, `shop_orders?id=eq.${id}&tenant_id=eq.${tenantId}`);
          const ords = ordResp.ok ? await ordResp.json() : [];
          if (ords.length > 0) {
            const ord = ords[0];
            const itResp = await sb(key, `shop_items?id=eq.${ord.item_id}&tenant_id=eq.${tenantId}`);
            const its = itResp.ok ? await itResp.json() : [];
            if (its.length > 0) {
              const newClaimed = Math.max(0, (its[0].quantity_claimed || 0) - (ord.quantity || 1));
              await sb(key, `shop_items?id=eq.${ord.item_id}&tenant_id=eq.${tenantId}`, {
                method: "PATCH",
                body: JSON.stringify({ quantity_claimed: newClaimed }),
              });
            }
          }
        }

        const r = await sb(key, `shop_orders?id=eq.${id}&tenant_id=eq.${tenantId}`, {
          method: "PATCH",
          body: JSON.stringify(update),
        });
        if (!r.ok) throw new Error(await r.text());
        const rows = await r.json();
        return res.status(200).json(rows[0]);
      }

      // Update item
      const data = { ...req.body };
      delete data.id;
      delete data.action;
      if (data.price !== undefined) data.price = Number(data.price);
      if (data.quantity_available !== undefined) data.quantity_available = data.quantity_available != null ? Number(data.quantity_available) : null;
      if (data.display_order !== undefined) data.display_order = Number(data.display_order);
      if (data.image_urls !== undefined) {
        const urls = Array.isArray(data.image_urls) ? data.image_urls.filter(Boolean).slice(0, 5) : [];
        data.image_urls = urls.length > 0 ? urls : null;
        data.image_url = urls[0] || null;
      }

      const r = await sb(key, `shop_items?id=eq.${id}&tenant_id=eq.${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return res.status(200).json(rows[0]);
    }

    // ── DELETE ──
    if (req.method === "DELETE") {
      const id = req.query.id || req.body.id;
      if (!id) return res.status(400).json({ error: "Missing id" });

      // Cascade delete all FK references before dropping the item itself.
      // shop_cart.item_id → shop_items.id (added 2026-04-16 with shop_cart table).
      // Without this, deletion fails with FK constraint when any member has
      // this item in their cart.
      await sb(key, `shop_cart?item_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      await sb(key, `shop_orders?item_id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      const r = await sb(key, `shop_items?id=eq.${id}&tenant_id=eq.${tenantId}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("admin-shop error:", e);
    return res.status(500).json({ error: e.message });
  }
}
