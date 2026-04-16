import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";

const STATUS_COLORS = {
  pending: "#E8A838",
  confirmed: "#4C8D73",
  ready: "#35443B",
  picked_up: "#8BB5A0",
  cancelled: "#C92F1F",
};

export default function MemberShop({ member, tierConfig, showToast }) {
  const [items, setItems] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("browse");
  const [selectedItem, setSelectedItem] = useState(null);
  const [orderSize, setOrderSize] = useState("");
  const [orderQty, setOrderQty] = useState(1);
  const [orderNotes, setOrderNotes] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  const loadItems = useCallback(async () => {
    try {
      const r = await fetch("/api/member-shop?action=browse", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setItems(data.items || []);
        setDiscountPct(data.discount_pct || 0);
      }
    } catch {}
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/member-shop?action=my-orders", { credentials: "include" });
      if (r.ok) setMyOrders(await r.json());
    } catch {}
  }, []);

  useEffect(() => { loadItems().then(() => setLoading(false)); }, [loadItems]);
  useEffect(() => { if (tab === "orders") loadOrders(); }, [tab, loadOrders]);

  async function handleOrder() {
    if (!selectedItem) return;
    setOrdering(true);
    try {
      const r = await fetch("/api/member-shop?action=order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          item_id: selectedItem.id,
          size: orderSize || null,
          quantity: orderQty,
          notes: orderNotes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Order failed");
      showToast("Purchase complete! We'll have it ready for you.");
      setSelectedItem(null);
      setOrderSize("");
      setOrderQty(1);
      setOrderNotes("");
      await loadItems();
    } catch (e) {
      showToast(e.message, "error");
    }
    setOrdering(false);
  }

  function openItem(it) {
    setSelectedItem(it);
    setOrderSize("");
    setOrderQty(1);
    setOrderNotes("");
    setGalleryIdx(0);
  }

  if (loading) return <div className="mem-loading">Loading shop...</div>;

  const limitedItems = items.filter((it) => it.is_limited);
  const regularItems = items.filter((it) => !it.is_limited);
  const modalImages = selectedItem?.image_urls?.length > 0 ? selectedItem.image_urls : (selectedItem?.image_url ? [selectedItem.image_url] : []);

  return (
    <>
      <div className="mem-section" style={{ display: "flex", gap: 8, marginBottom: 0, background: "transparent", border: "none", padding: "0 0 16px 0" }}>
        <button className={`mem-btn ${tab === "browse" ? "mem-btn-primary" : ""}`} onClick={() => setTab("browse")} style={{ flex: 1 }}>Browse</button>
        <button className={`mem-btn ${tab === "orders" ? "mem-btn-primary" : ""}`} onClick={() => setTab("orders")} style={{ flex: 1 }}>My Orders</button>
      </div>

      {tab === "browse" && (
        <>
          {discountPct > 0 && (
            <div style={{ background: "var(--primary-bg)", borderRadius: "var(--radius)", padding: "10px 16px", marginBottom: 16, textAlign: "center", fontSize: 13 }}>
              <strong style={{ color: "var(--primary)" }}>{discountPct}% Member Discount</strong>
              <span style={{ color: "var(--text-muted)" }}> applied to all items</span>
            </div>
          )}

          {limitedItems.length > 0 && (
            <>
              <h3 className="mem-section-head" style={{ color: "#C92F1F" }}>Limited Drops</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
                {limitedItems.map((it) => (
                  <ItemCard key={it.id} item={it} discountPct={discountPct} onClick={() => openItem(it)} />
                ))}
              </div>
            </>
          )}

          {regularItems.length > 0 && (
            <>
              {limitedItems.length > 0 && <h3 className="mem-section-head">Shop</h3>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                {regularItems.map((it) => (
                  <ItemCard key={it.id} item={it} discountPct={discountPct} onClick={() => openItem(it)} />
                ))}
              </div>
            </>
          )}

          {items.length === 0 && (
            <div className="mem-section" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              No items available right now. Check back soon!
            </div>
          )}
        </>
      )}

      {tab === "orders" && (
        <>
          {myOrders.length === 0 && (
            <div className="mem-section" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              No orders yet. Browse the shop to place your first order!
            </div>
          )}
          {myOrders.map((o) => (
            <div key={o.id} className="mem-section" style={{ marginBottom: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong>{o.item_title}</strong>
                  {o.size && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>Size: {o.size}</span>}
                  {o.quantity > 1 && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>x{o.quantity}</span>}
                </div>
                <span className="badge" style={{ background: STATUS_COLORS[o.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                  {o.status === "picked_up" ? "PICKED UP" : o.status.toUpperCase()}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  ${Number(o.total).toFixed(2)}
                  {o.discount_pct > 0 && <span style={{ fontSize: 11, color: "var(--primary)", marginLeft: 6 }}>({o.discount_pct}% off)</span>}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Order Modal */}
      <Modal open={!!selectedItem} onClose={() => setSelectedItem(null)}>
        {selectedItem && (
          <>
            {/* Image gallery */}
            {modalImages.length > 0 && (
              <div style={{ position: "relative", marginBottom: 16 }}>
                <img
                  src={modalImages[galleryIdx]}
                  alt=""
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }}
                />
                {modalImages.length > 1 && (
                  <>
                    <button
                      onClick={() => setGalleryIdx((i) => (i - 1 + modalImages.length) % modalImages.length)}
                      style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 16, cursor: "pointer" }}
                    >&lsaquo;</button>
                    <button
                      onClick={() => setGalleryIdx((i) => (i + 1) % modalImages.length)}
                      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 16, cursor: "pointer" }}
                    >&rsaquo;</button>
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
                      {modalImages.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setGalleryIdx(i)}
                          style={{ width: 8, height: 8, borderRadius: "50%", border: "none", background: i === galleryIdx ? "var(--primary)" : "var(--border)", cursor: "pointer", padding: 0 }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <h2 style={{ marginBottom: 4 }}>{selectedItem.title}</h2>
            {selectedItem.brand && <p style={{ color: "var(--text-muted)", margin: "0 0 8px 0", fontSize: 13 }}>{selectedItem.brand}</p>}
            {selectedItem.description && <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 16px 0" }}>{selectedItem.description}</p>}

            {/* Price */}
            <div style={{ marginBottom: 16 }}>
              {discountPct > 0 ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--primary)" }}>
                    ${selectedItem.member_price.toFixed(2)}
                  </span>
                  <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 14 }}>
                    ${selectedItem.price.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>
                    {discountPct}% off
                  </span>
                </div>
              ) : (
                <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700 }}>
                  ${selectedItem.price.toFixed(2)}
                </span>
              )}
            </div>

            {/* Size selector */}
            {selectedItem.sizes && selectedItem.sizes.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Size</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {selectedItem.sizes.map((s) => (
                    <button
                      key={s}
                      onClick={() => setOrderSize(s)}
                      style={{
                        padding: "8px 16px", borderRadius: "var(--radius)",
                        border: orderSize === s ? "2px solid var(--primary)" : "1.5px solid var(--border)",
                        background: orderSize === s ? "var(--primary-bg)" : "var(--surface)",
                        color: orderSize === s ? "var(--primary)" : "var(--text)",
                        fontWeight: orderSize === s ? 700 : 500,
                        cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 13,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedItem.quantity_remaining !== null && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                {selectedItem.quantity_remaining} remaining
              </p>
            )}

            {/* Notes */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Notes (optional)</label>
              <input
                className="mem-input"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Any special requests..."
                style={{ marginBottom: 0 }}
              />
            </div>

            {selectedItem.sold_out ? (
              <button className="mem-btn mem-btn-full" disabled style={{ opacity: 0.5 }}>Sold Out</button>
            ) : (
              <button
                className="mem-btn mem-btn-primary mem-btn-full"
                onClick={handleOrder}
                disabled={ordering || (selectedItem.sizes?.length > 0 && !orderSize)}
              >
                {ordering ? "Processing..." : `Buy Now — $${(selectedItem.member_price * orderQty).toFixed(2)}`}
              </button>
            )}
            <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
              Your card on file will be charged immediately.
            </p>
          </>
        )}
      </Modal>
    </>
  );
}

function ItemCard({ item, discountPct, onClick }) {
  const imgUrl = item.image_urls?.length > 0 ? item.image_urls[0] : item.image_url;
  return (
    <div
      onClick={item.sold_out ? undefined : onClick}
      style={{
        background: "var(--surface)", border: "0.5px solid var(--border)",
        borderRadius: "var(--radius)", overflow: "hidden",
        cursor: item.sold_out ? "default" : "pointer",
        opacity: item.sold_out ? 0.6 : 1,
        transition: "box-shadow 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => { if (!item.sold_out) e.currentTarget.style.boxShadow = "0 4px 20px rgba(53,68,59,0.12)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
    >
      {imgUrl ? (
        <div style={{ position: "relative" }}>
          <img src={imgUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
          {item.sold_out && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(53,68,59,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "#EDF3E3", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Sold Out</span>
            </div>
          )}
          {item.is_limited && !item.sold_out && (
            <span style={{ position: "absolute", top: 8, left: 8, background: "#C92F1F", color: "#EDF3E3", fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius)", textTransform: "uppercase", letterSpacing: 1 }}>
              Limited
            </span>
          )}
          {item.image_urls?.length > 1 && (
            <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 9, padding: "2px 6px", borderRadius: 4 }}>
              1/{item.image_urls.length}
            </span>
          )}
        </div>
      ) : (
        <div style={{ width: "100%", aspectRatio: "1", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "var(--text-muted)" }}>
          &#9670;
        </div>
      )}
      <div style={{ padding: "12px 14px" }}>
        {item.brand && <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{item.brand}</div>}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
        {item.subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{item.subtitle}</div>}
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          {discountPct > 0 ? (
            <>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                ${item.member_price.toFixed(0)}
              </span>
              <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 12 }}>
                ${item.price.toFixed(0)}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>
              ${item.price.toFixed(0)}
            </span>
          )}
          {item.quantity_remaining !== null && !item.sold_out && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
              {item.quantity_remaining} left
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
