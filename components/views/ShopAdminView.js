import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";
import Confirm from "../ui/Confirm";

const CATEGORIES = ["Apparel", "Accessories", "Equipment", "Other"];

const STATUS_COLORS = {
  pending: "#E8A838",
  confirmed: "#4C8D73",
  ready: "#35443B",
  picked_up: "#8BB5A0",
  cancelled: "#C92F1F",
};

function ShopItemFormModal({ open, onClose, item, onSave, apiKey }) {
  const [form, setForm] = useState({
    title: "", subtitle: "", description: "", image_url: "",
    price: 0, category: "Apparel", brand: "", is_limited: false,
    drop_date: "", quantity_available: "", sizes: "",
    is_published: true, display_order: 0,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isNew = !item;

  useEffect(() => {
    if (item) {
      setForm({
        title: item.title || "",
        subtitle: item.subtitle || "",
        description: item.description || "",
        image_url: item.image_url || "",
        price: Number(item.price || 0),
        category: item.category || "Apparel",
        brand: item.brand || "",
        is_limited: !!item.is_limited,
        drop_date: item.drop_date ? item.drop_date.slice(0, 16) : "",
        quantity_available: item.quantity_available != null ? item.quantity_available : "",
        sizes: Array.isArray(item.sizes) ? item.sizes.join(", ") : "",
        is_published: item.is_published !== false,
        display_order: Number(item.display_order || 0),
      });
    } else {
      setForm({
        title: "", subtitle: "", description: "", image_url: "",
        price: 0, category: "Apparel", brand: "", is_limited: false,
        drop_date: "", quantity_available: "", sizes: "",
        is_published: true, display_order: 0,
      });
    }
  }, [item, open]);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Max 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const name = `shop_${Date.now()}.${ext}`;
      const r = await fetch(`/api/upload-shop-image?filename=${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": file.type },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      update("image_url", d.url);
    } catch (err) {
      alert("Upload failed: " + err.message);
    }
    setUploading(false);
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    const sizesArr = form.sizes.trim()
      ? form.sizes.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    await onSave({
      ...form,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      description: form.description.trim() || null,
      price: Number(form.price || 0),
      quantity_available: form.quantity_available !== "" ? Number(form.quantity_available) : null,
      sizes: sizesArr,
      drop_date: form.drop_date ? new Date(form.drop_date).toISOString() : null,
    }, !!item);
    setSaving(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{isNew ? "Add Item" : "Edit Item"}</h2>
      <div className="mf">
        <label>Product Image</label>
        {form.image_url && (
          <img src={form.image_url} alt="" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
        )}
        <input type="file" accept="image/*" onChange={handleImage} disabled={uploading} />
        {uploading && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Uploading...</span>}
      </div>
      <div className="mf">
        <label>Title *</label>
        <input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Travis Mathew Polo" />
      </div>
      <div className="mf">
        <label>Subtitle</label>
        <input value={form.subtitle} onChange={(e) => update("subtitle", e.target.value)} placeholder="Limited edition colorway" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="mf">
          <label>Price ($) *</label>
          <input type="number" min={0} step="0.01" value={form.price} onChange={(e) => update("price", e.target.value)} />
        </div>
        <div className="mf">
          <label>Category</label>
          <select value={form.category} onChange={(e) => update("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="mf">
          <label>Brand</label>
          <input value={form.brand} onChange={(e) => update("brand", e.target.value)} placeholder="Travis Mathew" />
        </div>
        <div className="mf">
          <label>Stock (blank = unlimited)</label>
          <input type="number" min={0} value={form.quantity_available} onChange={(e) => update("quantity_available", e.target.value)} placeholder="Unlimited" />
        </div>
        <div className="mf">
          <label>Sizes (comma-separated)</label>
          <input value={form.sizes} onChange={(e) => update("sizes", e.target.value)} placeholder="S, M, L, XL" />
        </div>
        <div className="mf">
          <label>Display Order</label>
          <input type="number" min={0} value={form.display_order} onChange={(e) => update("display_order", e.target.value)} />
        </div>
      </div>
      <div className="mf">
        <label>Description</label>
        <textarea rows={3} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Product details..." style={{ width: "100%", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 24, margin: "12px 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.is_published} onChange={(e) => update("is_published", e.target.checked)} />
          Published
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
          <input type="checkbox" checked={form.is_limited} onChange={(e) => update("is_limited", e.target.checked)} />
          Limited Drop
        </label>
      </div>
      {form.is_limited && (
        <div className="mf">
          <label>Drop Date (leave blank = available now)</label>
          <input type="datetime-local" value={form.drop_date} onChange={(e) => update("drop_date", e.target.value)} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !form.title.trim()}>
          {saving ? "Saving..." : isNew ? "Add Item" : "Update"}
        </button>
      </div>
    </Modal>
  );
}

export default function ShopAdminView({ apiKey }) {
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("items");
  const [editItem, setEditItem] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");

  const fetchItems = useCallback(async () => {
    try {
      const r = await fetch("/api/admin-shop", { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) setItems(await r.json());
    } catch {}
  }, [apiKey]);

  const fetchOrders = useCallback(async () => {
    try {
      const url = orderFilter !== "all" ? `/api/admin-shop?action=orders&status=${orderFilter}` : "/api/admin-shop?action=orders";
      const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (r.ok) setOrders(await r.json());
    } catch {}
  }, [apiKey, orderFilter]);

  useEffect(() => { fetchItems().then(() => setLoading(false)); }, [fetchItems]);
  useEffect(() => { if (tab === "orders") fetchOrders(); }, [tab, fetchOrders]);

  async function handleSave(data, isEdit) {
    try {
      const url = isEdit ? `/api/admin-shop?id=${editItem.id}` : "/api/admin-shop";
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      setEditItem(null);
      await fetchItems();
    } catch (e) {
      alert("Save failed: " + e.message);
    }
  }

  async function handleDelete() {
    if (!delTarget) return;
    try {
      await fetch(`/api/admin-shop?id=${delTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      setDelTarget(null);
      await fetchItems();
    } catch {}
  }

  async function updateOrderStatus(orderId, status) {
    try {
      await fetch(`/api/admin-shop?id=${orderId}&action=orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
      await fetchItems();
    } catch {}
  }

  const pendingCount = orders.filter((o) => o.status === "pending").length;

  if (loading) return <div className="content"><p className="muted">Loading shop...</p></div>;

  return (
    <div className="content">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`rpt-tab ${tab === "items" ? "active" : ""}`} onClick={() => setTab("items")}>Items</button>
          <button className={`rpt-tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
            Orders {pendingCount > 0 && <span className="cnt" style={{ marginLeft: 4 }}>{pendingCount}</span>}
          </button>
        </div>
        {tab === "items" && (
          <button className="btn primary" onClick={() => setEditItem({})}>+ New Item</button>
        )}
      </div>

      {tab === "items" && (
        <>
          {items.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 32 }}>No items yet. Add your first product!</p>}

          {/* Desktop table */}
          <div className="tbl usage-desktop">
            {items.length > 0 && (
              <div className="th">
                <span style={{ flex: 0.5 }}></span>
                <span style={{ flex: 2 }}>Item</span>
                <span style={{ flex: 1 }}>Category</span>
                <span style={{ flex: 0.7 }} className="text-r">Price</span>
                <span style={{ flex: 0.7 }} className="text-c">Stock</span>
                <span style={{ flex: 0.7 }} className="text-c">Orders</span>
                <span style={{ flex: 1 }} className="text-r">Actions</span>
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className="tr">
                <span style={{ flex: 0.5 }}>
                  {it.image_url ? (
                    <img src={it.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-muted)" }}>&#9670;</div>
                  )}
                </span>
                <span style={{ flex: 2 }}>
                  <strong>{it.title}</strong>
                  {it.brand && <><br /><span className="email-sm">{it.brand}</span></>}
                  {it.is_limited && <span className="badge" style={{ background: "#C92F1F", color: "#EDF3E3", fontSize: 8, marginLeft: 6 }}>DROP</span>}
                  {!it.is_published && <span className="badge" style={{ background: "var(--text-muted)", color: "#EDF3E3", fontSize: 8, marginLeft: 6 }}>DRAFT</span>}
                </span>
                <span style={{ flex: 1 }} className="email-sm">{it.category}</span>
                <span style={{ flex: 0.7 }} className="text-r tab-num">${Number(it.price).toFixed(0)}</span>
                <span style={{ flex: 0.7 }} className="text-c tab-num">
                  {it.quantity_available != null ? `${it.quantity_available - (it.quantity_claimed || 0)}/${it.quantity_available}` : "\u221E"}
                </span>
                <span style={{ flex: 0.7 }} className="text-c tab-num">{it.order_count || 0}</span>
                <span style={{ flex: 1 }} className="text-r">
                  <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => setEditItem(it)}>Edit</button>
                  <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => setDelTarget(it)}>Delete</button>
                </span>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="usage-mobile">
            {items.map((it) => (
              <div key={it.id} className="usage-card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", gap: 12, padding: "12px 14px", alignItems: "flex-start" }}>
                  {it.image_url ? (
                    <img src={it.image_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--text-muted)", flexShrink: 0 }}>&#9670;</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 15 }}>{it.title}</strong>
                      {it.is_limited && <span className="badge" style={{ background: "#C92F1F", color: "#EDF3E3", fontSize: 8 }}>DROP</span>}
                      {!it.is_published && <span className="badge" style={{ background: "var(--text-muted)", color: "#EDF3E3", fontSize: 8 }}>DRAFT</span>}
                    </div>
                    {it.brand && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.brand}</div>}
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      <span className="tab-num" style={{ fontWeight: 600 }}>${Number(it.price).toFixed(0)}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>{it.category}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        Stock: {it.quantity_available != null ? `${it.quantity_available - (it.quantity_claimed || 0)}` : "\u221E"}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderTop: "0.5px solid var(--border)" }}>
                  <span className="muted">{it.order_count || 0} orders</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => setEditItem(it)}>Edit</button>
                    <button className="btn" style={{ fontSize: 11, padding: "4px 12px", color: "var(--red)" }} onClick={() => setDelTarget(it)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "orders" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {["all", "pending", "confirmed", "ready", "picked_up", "cancelled"].map((s) => (
              <button
                key={s}
                className={`mo-btn ${orderFilter === s ? "active" : ""}`}
                onClick={() => setOrderFilter(s)}
                style={{ textTransform: "capitalize" }}
              >
                {s === "picked_up" ? "Picked Up" : s}
              </button>
            ))}
          </div>

          {orders.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 32 }}>No orders{orderFilter !== "all" ? ` with status "${orderFilter}"` : ""}.</p>}

          {/* Desktop table */}
          <div className="tbl usage-desktop">
            {orders.length > 0 && (
              <div className="th">
                <span style={{ flex: 2 }}>Member</span>
                <span style={{ flex: 2 }}>Item</span>
                <span style={{ flex: 0.7 }}>Size</span>
                <span style={{ flex: 0.7 }} className="text-r">Total</span>
                <span style={{ flex: 1 }} className="text-c">Status</span>
                <span style={{ flex: 1.5 }} className="text-r">Actions</span>
              </div>
            )}
            {orders.map((o) => (
              <div key={o.id} className="tr">
                <span style={{ flex: 2 }}>
                  <strong>{o.member_name}</strong><br />
                  <span className="email-sm">{o.member_email}</span>
                </span>
                <span style={{ flex: 2 }}>
                  {o.item_title}
                  {o.quantity > 1 && <span className="muted"> x{o.quantity}</span>}
                </span>
                <span style={{ flex: 0.7 }}>{o.size || "\u2014"}</span>
                <span style={{ flex: 0.7 }} className="text-r tab-num">${Number(o.total).toFixed(2)}</span>
                <span style={{ flex: 1 }} className="text-c">
                  <span className="badge" style={{ background: STATUS_COLORS[o.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                    {o.status === "picked_up" ? "PICKED UP" : o.status.toUpperCase()}
                  </span>
                </span>
                <span style={{ flex: 1.5 }} className="text-r">
                  {o.status === "pending" && (
                    <>
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => updateOrderStatus(o.id, "confirmed")}>Confirm</button>
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                    </>
                  )}
                  {o.status === "confirmed" && (
                    <>
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => updateOrderStatus(o.id, "ready")}>Ready</button>
                      <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                    </>
                  )}
                  {o.status === "ready" && (
                    <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "picked_up")}>Picked Up</button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Mobile cards */}
          <div className="usage-mobile">
            {orders.map((o) => (
              <div key={o.id} className="usage-card">
                <div className="usage-card-top">
                  <div>
                    <strong>{o.member_name}</strong>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{o.item_title}{o.size ? ` — ${o.size}` : ""}</div>
                  </div>
                  <span className="badge" style={{ background: STATUS_COLORS[o.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                    {o.status === "picked_up" ? "PICKED UP" : o.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <span className="tab-num" style={{ fontWeight: 600 }}>${Number(o.total).toFixed(2)}{o.discount_pct > 0 ? ` (${o.discount_pct}% off)` : ""}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {o.status === "pending" && (
                      <>
                        <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "confirmed")}>Confirm</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                      </>
                    )}
                    {o.status === "confirmed" && (
                      <>
                        <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "ready")}>Ready</button>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => updateOrderStatus(o.id, "cancelled")}>Cancel</button>
                      </>
                    )}
                    {o.status === "ready" && (
                      <button className="btn primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => updateOrderStatus(o.id, "picked_up")}>Picked Up</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ShopItemFormModal
        open={editItem !== null}
        onClose={() => setEditItem(null)}
        item={editItem?.id ? editItem : null}
        onSave={handleSave}
        apiKey={apiKey}
      />

      <Confirm
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onOk={handleDelete}
        title="Delete Item"
        msg={delTarget ? `Delete "${delTarget.title}"? This also removes all orders for this item.` : ""}
        label="Delete"
        danger
      />
    </div>
  );
}
