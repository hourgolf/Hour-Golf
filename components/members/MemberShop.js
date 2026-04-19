import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";

const STATUS_COLORS = {
  pending: "#E8A838",
  confirmed: "#4C8D73",
  ready: "#35443B",
  picked_up: "#8BB5A0",
  cancelled: "#C92F1F",
};

const CARD_BRAND_MAP = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMERICAN_EXPRESS: "Amex",
  AMEX: "Amex",
  DISCOVER: "Discover",
  JCB: "JCB",
  DINERS: "Diners",
  DISCOVER_DINERS: "Diners",
  UNIONPAY: "UnionPay",
};

// Human-readable "Visa •••• 4242" / "Cash" / "External" for the Orders
// tab footer. Empty string means no line should render at all.
function formatPaymentMethodLine(p) {
  const method = (p.payment_method || "").toLowerCase();
  if (method === "card") {
    const brandKey = String(p.card_brand || "").toUpperCase();
    const brand = CARD_BRAND_MAP[brandKey] || "Card";
    if (p.card_last_4) return `${brand} \u2022\u2022\u2022\u2022 ${p.card_last_4}`;
    return brand;
  }
  if (!method) return "";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export default function MemberShop({ member, tierConfig, showToast }) {
  const [items, setItems] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [cartTotal, setCartTotal] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("browse");

  // Product modal
  const [selectedItem, setSelectedItem] = useState(null);
  const [orderSize, setOrderSize] = useState("");
  const [orderQty, setOrderQty] = useState(1);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [adding, setAdding] = useState(false);

  // Checkout
  const [showCheckout, setShowCheckout] = useState(false);
  // Shipping state. Customer-facing pricing is flat ($10 unless
  // subtotal >= $100, then free) — server picks the cheapest carrier
  // rate at checkout, customer never sees per-carrier options.
  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [shipAddr, setShipAddr] = useState({
    street1: "", street2: "", city: "", state: "", zip: "", country: "US",
  });
  const [checking, setChecking] = useState(false);

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

  const loadCart = useCallback(async () => {
    try {
      const r = await fetch("/api/member-shop?action=cart", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setCart(data.cart || []);
        setCartTotal(data.cart_total || 0);
        setCartCount((data.cart || []).reduce((s, c) => s + c.quantity, 0));
        setCreditBalance(data.credit_balance || 0);
      }
    } catch {}
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/member-purchases?limit=100", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setMyOrders(d.purchases || []);
      }
    } catch {}
  }, []);

  useEffect(() => { Promise.all([loadItems(), loadCart()]).then(() => setLoading(false)); }, [loadItems, loadCart]);
  useEffect(() => { if (tab === "orders") loadOrders(); }, [tab, loadOrders]);

  async function addToCart() {
    if (!selectedItem) return;
    setAdding(true);
    try {
      const r = await fetch("/api/member-shop?action=add-to-cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ item_id: selectedItem.id, size: orderSize || null, quantity: orderQty }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCartCount(data.cart_count || 0);
      showToast("Added to cart!");
      setSelectedItem(null);
      await loadCart();
    } catch (e) {
      showToast(e.message, "error");
    }
    setAdding(false);
  }

  async function updateCartQty(cartId, qty) {
    try {
      await fetch("/api/member-shop?action=update-cart", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cart_id: cartId, quantity: qty }),
      });
      await loadCart();
    } catch {}
  }

  async function removeFromCart(cartId) {
    try {
      await fetch(`/api/member-shop?action=remove-from-cart&cart_id=${cartId}`, {
        method: "DELETE",
        credentials: "include",
      });
      await loadCart();
    } catch {}
  }

  function setShipField(field, value) {
    setShipAddr((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCheckout() {
    if (deliveryMethod === "ship") {
      if (!shipAddr.street1.trim() || !shipAddr.city.trim() || !shipAddr.state.trim() || !shipAddr.zip.trim()) {
        showToast("Please complete your shipping address.", "error");
        return;
      }
    }
    setChecking(true);
    try {
      const payload = { delivery_method: deliveryMethod };
      if (deliveryMethod === "ship") {
        payload.shipping = {
          address: {
            street1: shipAddr.street1.trim(),
            street2: shipAddr.street2.trim() || null,
            city: shipAddr.city.trim(),
            state: shipAddr.state.trim().toUpperCase(),
            zip: shipAddr.zip.trim(),
            country: (shipAddr.country || "US").toUpperCase(),
          },
        };
      }
      const r = await fetch("/api/member-shop?action=checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      const tail = deliveryMethod === "ship"
        ? (data.tracking_number ? ` Tracking #${data.tracking_number}.` : " We'll ship it shortly.")
        : " Pick up at your next visit.";
      const msg = data.credits_used > 0
        ? `Purchase complete! $${data.credits_used.toFixed(2)} in credits used${data.card_charged > 0 ? `, $${data.card_charged.toFixed(2)} charged to card` : ""}.${tail}`
        : `Purchase complete! $${data.total.toFixed(2)} charged.${tail}`;
      showToast(msg);
      setShowCheckout(false);
      setCart([]);
      setCartCount(0);
      setCartTotal(0);
      setDeliveryMethod("pickup");
      setShipAddr({ street1: "", street2: "", city: "", state: "", zip: "", country: "US" });
      setTab("orders");
      await loadOrders();
      await loadItems();
    } catch (e) {
      showToast(e.message, "error");
    }
    setChecking(false);
  }

  function openItem(it) {
    setSelectedItem(it);
    setOrderSize("");
    setOrderQty(1);
    setGalleryIdx(0);
  }

  if (loading) return <div className="mem-loading">Loading shop...</div>;

  const limitedItems = items.filter((it) => it.is_limited);
  const regularItems = items.filter((it) => !it.is_limited);
  const creditsApplied = Math.min(creditBalance, cartTotal);
  const cardChargeAmt = Math.round((cartTotal - creditsApplied) * 100) / 100;
  const modalImages = selectedItem?.image_urls?.length > 0 ? selectedItem.image_urls : (selectedItem?.image_url ? [selectedItem.image_url] : []);

  return (
    <>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`mem-btn ${tab === "browse" ? "mem-btn-primary" : ""}`} onClick={() => setTab("browse")} style={{ flex: 1 }}>Browse</button>
        <button className={`mem-btn ${tab === "cart" ? "mem-btn-primary" : ""}`} onClick={() => { setTab("cart"); loadCart(); }} style={{ flex: 1, position: "relative" }}>
          Cart{cartCount > 0 && <span style={{ background: "#C92F1F", color: "#EDF3E3", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, marginLeft: 6 }}>{cartCount}</span>}
        </button>
        <button className={`mem-btn ${tab === "orders" ? "mem-btn-primary" : ""}`} onClick={() => setTab("orders")} style={{ flex: 1 }}>Orders</button>
      </div>

      {/* ── BROWSE ── */}
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
                {limitedItems.map((it) => <ItemCard key={it.id} item={it} discountPct={discountPct} onClick={() => openItem(it)} />)}
              </div>
            </>
          )}

          {regularItems.length > 0 && (
            <>
              {limitedItems.length > 0 && <h3 className="mem-section-head">Shop</h3>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16 }}>
                {regularItems.map((it) => <ItemCard key={it.id} item={it} discountPct={discountPct} onClick={() => openItem(it)} />)}
              </div>
            </>
          )}

          {items.length === 0 && (
            <div className="mem-section" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No items available right now. Check back soon!</div>
          )}

          {/* Floating cart badge */}
          {cartCount > 0 && tab === "browse" && (
            <button
              onClick={() => { setTab("cart"); loadCart(); }}
              style={{
                position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 800,
                background: "var(--primary)", color: "#EDF3E3", border: "none", borderRadius: 30,
                padding: "12px 24px", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-display)",
                cursor: "pointer", boxShadow: "0 4px 16px rgba(53,68,59,0.3)",
                display: "flex", alignItems: "center", gap: 8, letterSpacing: 1, textTransform: "uppercase",
              }}
            >
              View Cart ({cartCount}) &mdash; ${cartTotal.toFixed(2)}
            </button>
          )}
        </>
      )}

      {/* ── CART ── */}
      {tab === "cart" && (
        <>
          {cart.length === 0 ? (
            <div className="mem-section" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              Your cart is empty. <button onClick={() => setTab("browse")} style={{ background: "none", border: "none", color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>Browse the shop</button>
            </div>
          ) : (
            <>
              {cart.map((c) => (
                <div key={c.cart_id} className="mem-section" style={{ marginBottom: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    {c.image_url ? (
                      <img src={c.image_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 64, height: 64, borderRadius: 8, background: "var(--border)", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <strong style={{ fontSize: 14 }}>{c.title}</strong>
                          {c.size && <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 6 }}>Size: {c.size}</span>}
                        </div>
                        <button onClick={() => removeFromCart(c.cart_id)} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>&times;</button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            onClick={() => c.quantity > 1 && updateCartQty(c.cart_id, c.quantity - 1)}
                            style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid var(--primary)", background: "var(--surface)", color: "var(--primary)", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >&minus;</button>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, minWidth: 20, textAlign: "center" }}>{c.quantity}</span>
                          <button
                            onClick={() => updateCartQty(c.cart_id, c.quantity + 1)}
                            style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid var(--primary)", background: "var(--surface)", color: "var(--primary)", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >+</button>
                        </div>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15 }}>${c.line_total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Order summary + pickup + checkout — single card */}
              <div className="mem-section" style={{ padding: "16px", marginTop: 8 }}>
                {discountPct > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--primary)", marginBottom: 6 }}>
                    <span>Member Discount</span>
                    <span>&minus;{discountPct}%</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, borderTop: discountPct > 0 ? "1px solid var(--border)" : "none", paddingTop: discountPct > 0 ? 8 : 0, marginBottom: creditsApplied > 0 ? 6 : 0 }}>
                  <span>Subtotal</span>
                  <span className="tab-num" style={{ fontWeight: 600 }}>${cartTotal.toFixed(2)}</span>
                </div>
                {creditsApplied > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#ddd480", marginBottom: 6 }}>
                    <span>Pro Shop Credits</span>
                    <span>&minus;${creditsApplied.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", borderTop: "1px solid var(--border)", paddingTop: 8, marginBottom: 16 }}>
                  <span>{cardChargeAmt > 0 ? "Card Charge" : "Total"}</span>
                  <span>{cardChargeAmt > 0 ? `$${cardChargeAmt.toFixed(2)}` : "$0.00"}</span>
                </div>
                {creditsApplied > 0 && cardChargeAmt <= 0 && (
                  <div style={{ background: "#ddd480", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 16, fontSize: 13, textAlign: "center", color: "#35443B", fontWeight: 600 }}>
                    Fully covered by Pro Shop Credits!
                  </div>
                )}

                <div style={{ background: "var(--primary-bg)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
                  <strong style={{ color: "var(--primary)" }}>Pickup at your next visit</strong>
                  <p style={{ margin: "4px 0 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                    Your items will be held at the front desk. Just let us know your name when you arrive.
                  </p>
                </div>

                <button
                  className="mem-btn mem-btn-primary mem-btn-full"
                  onClick={() => setShowCheckout(true)}
                >
                  Checkout &mdash; {cardChargeAmt > 0 ? `$${cardChargeAmt.toFixed(2)}` : "Free"}
                </button>
                <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8, marginBottom: 0 }}>
                  {cardChargeAmt > 0 ? "Your card on file will be charged." : "No card charge — covered by credits."}
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* ── MY ORDERS ──
          Unified: in-app shop checkouts (one card per checkout, grouped
          by stripe_payment_intent_id, all line items listed) + in-store
          Square POS purchases (one card each with receipt link). */}
      {tab === "orders" && (
        <>
          {myOrders.length === 0 && (
            <div className="mem-section" style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No orders yet.</div>
          )}
          {myOrders.map((o) => {
            const paymentLine = formatPaymentMethodLine(o);
            const dateStr = o.created_at
              ? new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "";
            if (o.kind === "in_store") {
              return (
                <div key={o.id} className="mem-section" style={{ marginBottom: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <span className="mem-purchase-tag">In-store</span>
                      <strong style={{ marginLeft: 8 }}>{o.description || "In-store purchase"}</strong>
                    </div>
                    <span className="badge" style={{ background: "var(--primary)", color: "#EDF3E3", fontSize: 9 }}>
                      {(o.status || "COMPLETED").toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                      ${(Number(o.total_cents) / 100).toFixed(2)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{dateStr}</span>
                  </div>
                  {(paymentLine || o.receipt_url) && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 10, alignItems: "center" }}>
                      {paymentLine && <span>{paymentLine}</span>}
                      {o.receipt_url && (
                        <a href={o.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
                          View receipt &rarr;
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            // kind === "in_app"
            const items = o.items || [];
            const discountPct = items.find((it) => Number(it.discount_pct || 0) > 0)?.discount_pct || 0;
            const statusLabel = (items[0]?.status || "confirmed").toUpperCase().replace("_", " ");
            return (
              <div key={o.id} className="mem-section" style={{ marginBottom: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <span className="mem-purchase-tag">In-app</span>
                  </div>
                  <span className="badge" style={{ background: STATUS_COLORS[items[0]?.status] || "var(--text-muted)", color: "#EDF3E3", fontSize: 9 }}>
                    {statusLabel}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  {items.map((it, idx) => (
                    <div key={it.order_id || idx} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", fontSize: 14 }}>
                      <div style={{ minWidth: 0 }}>
                        {it.quantity > 1 && <span style={{ color: "var(--text-muted)", marginRight: 6 }}>{it.quantity}\u00d7</span>}
                        <strong>{it.item_title}</strong>
                        {it.size && <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>Size {it.size}</span>}
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        ${((Number(it.unit_price_cents) / 100) * (Number(it.quantity) || 1)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                    ${(Number(o.total_cents) / 100).toFixed(2)}
                    {discountPct > 0 && <span style={{ fontSize: 11, color: "var(--primary)", marginLeft: 6 }}>({discountPct}% off)</span>}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{dateStr}</span>
                </div>
                {(paymentLine || o.receipt_url) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 10, alignItems: "center" }}>
                    {paymentLine && <span>{paymentLine}</span>}
                    {o.receipt_url && (
                      <a href={o.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
                        View receipt &rarr;
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── PRODUCT MODAL ── */}
      <Modal open={!!selectedItem} onClose={() => setSelectedItem(null)}>
        {selectedItem && (
          <>
            {modalImages.length > 0 && (
              <div style={{ position: "relative", marginBottom: 16 }}>
                <img src={modalImages[galleryIdx]} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
                {modalImages.length > 1 && (
                  <>
                    <button onClick={() => setGalleryIdx((i) => (i - 1 + modalImages.length) % modalImages.length)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 16, cursor: "pointer" }}>&lsaquo;</button>
                    <button onClick={() => setGalleryIdx((i) => (i + 1) % modalImages.length)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 16, cursor: "pointer" }}>&rsaquo;</button>
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
                      {modalImages.map((_, i) => (
                        <button key={i} onClick={() => setGalleryIdx(i)} style={{ width: 8, height: 8, borderRadius: "50%", border: "none", background: i === galleryIdx ? "var(--primary)" : "var(--border)", cursor: "pointer", padding: 0 }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <h2 style={{ marginBottom: 4 }}>{selectedItem.title}</h2>
            {selectedItem.brand && <p style={{ color: "var(--text-muted)", margin: "0 0 8px 0", fontSize: 13 }}>{selectedItem.brand}</p>}
            {selectedItem.description && <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 16px 0" }}>{selectedItem.description}</p>}

            <div style={{ marginBottom: 16 }}>
              {discountPct > 0 ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--primary)" }}>${selectedItem.member_price.toFixed(2)}</span>
                  <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 14 }}>${selectedItem.price.toFixed(2)}</span>
                  <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>{discountPct}% off</span>
                </div>
              ) : (
                <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700 }}>${selectedItem.price.toFixed(2)}</span>
              )}
            </div>

            {selectedItem.sizes && selectedItem.sizes.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>Size</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {selectedItem.sizes.map((s) => (
                    <button key={s} onClick={() => setOrderSize(s)} style={{
                      padding: "8px 16px", borderRadius: "var(--radius)",
                      border: orderSize === s ? "2px solid var(--primary)" : "1.5px solid var(--border)",
                      background: orderSize === s ? "var(--primary-bg)" : "var(--surface)",
                      color: orderSize === s ? "var(--primary)" : "var(--text)",
                      fontWeight: orderSize === s ? 700 : 500,
                      cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 13,
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {selectedItem.quantity_remaining !== null && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{selectedItem.quantity_remaining} remaining</p>
            )}

            {selectedItem.sold_out ? (
              <button className="mem-btn mem-btn-full" disabled style={{ opacity: 0.5 }}>Sold Out</button>
            ) : (
              <button
                className="mem-btn mem-btn-primary mem-btn-full"
                onClick={addToCart}
                disabled={adding || (selectedItem.sizes?.length > 0 && !orderSize)}
              >
                {adding ? "Adding..." : "Add to Cart"}
              </button>
            )}
          </>
        )}
      </Modal>

      {/* ── CHECKOUT CONFIRMATION MODAL ── */}
      <Modal open={showCheckout} onClose={() => setShowCheckout(false)}>
        <h2 style={{ marginBottom: 16 }}>Confirm Purchase</h2>

        <div style={{ marginBottom: 16 }}>
          {cart.map((c) => (
            <div key={c.cart_id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid var(--border)", fontSize: 13 }}>
              <span>
                {c.title}{c.size ? ` (${c.size})` : ""}{c.quantity > 1 ? ` x${c.quantity}` : ""}
              </span>
              <span className="tab-num" style={{ fontWeight: 600 }}>${c.line_total.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {discountPct > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--primary)", marginBottom: 4 }}>
            <span>Member Discount</span>
            <span>&minus;{discountPct}%</span>
          </div>
        )}
        {creditsApplied > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#ddd480", marginBottom: 4 }}>
            <span>Pro Shop Credits</span>
            <span>&minus;${creditsApplied.toFixed(2)}</span>
          </div>
        )}

        {/* Delivery method selector */}
        <div style={{ margin: "16px 0 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Delivery</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["pickup", "ship"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDeliveryMethod(m)}
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: 10,
                  border: deliveryMethod === m ? "2px solid var(--primary)" : "1.5px solid var(--border)",
                  background: deliveryMethod === m ? "var(--primary-bg)" : "var(--surface)",
                  color: deliveryMethod === m ? "var(--primary)" : "var(--text)",
                  fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textAlign: "center",
                }}
              >
                {m === "pickup" ? "Pick up at club" : "Ship to me"}
              </button>
            ))}
          </div>
        </div>

        {/* Shipping address + rate selection (only when shipping) */}
        {deliveryMethod === "ship" && (
          <div style={{ marginBottom: 12, padding: 12, background: "var(--primary-bg)", borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Ship to</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input type="text" placeholder="Street address" value={shipAddr.street1} onChange={(e) => setShipField("street1", e.target.value)} style={{ gridColumn: "1 / -1", padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
              <input type="text" placeholder="Apt, suite, etc. (optional)" value={shipAddr.street2} onChange={(e) => setShipField("street2", e.target.value)} style={{ gridColumn: "1 / -1", padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
              <input type="text" placeholder="City" value={shipAddr.city} onChange={(e) => setShipField("city", e.target.value)} style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
              <input type="text" placeholder="State" value={shipAddr.state} onChange={(e) => setShipField("state", e.target.value)} maxLength={2} style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
              <input type="text" placeholder="ZIP" value={shipAddr.zip} onChange={(e) => setShipField("zip", e.target.value)} style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
              <input type="text" placeholder="Country" value={shipAddr.country} onChange={(e) => setShipField("country", e.target.value)} maxLength={2} style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", width: "100%" }} />
            </div>

            {/* Flat shipping cost: $10 unless cart subtotal hits $100,
                then free. Server picks the cheapest carrier rate at
                checkout + buys the label after payment. */}
            {(() => {
              const subtotal = cartTotal; // post-discount, pre-credits
              const free = subtotal >= 100;
              return (
                <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 10, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600 }}>Standard Shipping</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: free ? "#4C8D73" : "var(--primary)" }}>
                      {free ? "Free" : "$10.00"}
                    </span>
                  </div>
                  {!free && (
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                      Free shipping on orders ${(100 - subtotal).toFixed(2)} away.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {(() => {
          const shipCost = deliveryMethod === "ship"
            ? (cartTotal >= 100 ? 0 : 10)
            : 0;
          const grand = (cardChargeAmt || 0) + shipCost;
          return (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", padding: "8px 0", borderTop: "1.5px solid var(--border)" }}>
              <span>{grand > 0 ? "Card Charge" : "Total"}</span>
              <span>${grand.toFixed(2)}</span>
            </div>
          );
        })()}

        {creditsApplied > 0 && cardChargeAmt <= 0 && (
          <div style={{ background: "#ddd480", borderRadius: "var(--radius)", padding: "10px 14px", margin: "8px 0 16px", fontSize: 13, textAlign: "center", color: "#35443B", fontWeight: 600 }}>
            Fully covered by Pro Shop Credits!
          </div>
        )}

        {deliveryMethod === "pickup" && (
          <div style={{ background: "var(--primary-bg)", borderRadius: "var(--radius)", padding: "12px 16px", margin: "16px 0", fontSize: 13 }}>
            <strong style={{ color: "var(--primary)" }}>Pickup at your next visit</strong>
            <p style={{ margin: "4px 0 0 0", color: "var(--text-muted)", fontSize: 12 }}>
              Your items will be held at the front desk. Just let us know your name when you arrive.
            </p>
          </div>
        )}

        {(() => {
          const shipCost = deliveryMethod === "ship"
            ? (cartTotal >= 100 ? 0 : 10)
            : 0;
          const grand = (cardChargeAmt || 0) + shipCost;
          const disabled = checking;
          return (
            <button
              className="mem-btn mem-btn-primary mem-btn-full"
              onClick={handleCheckout}
              disabled={disabled}
              style={disabled ? { opacity: 0.6, cursor: "default" } : undefined}
            >
              {checking
                ? "Processing..."
                : grand > 0
                  ? `Confirm Purchase — $${grand.toFixed(2)}`
                  : "Confirm Purchase — Free"}
            </button>
          );
        })()}
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
          {cardChargeAmt > 0 || deliveryMethod === "ship" ? "Your card on file will be charged. This is a final sale." : "No card charge — covered by credits. This is a final sale."}
        </p>
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
        transition: "box-shadow 0.15s",
        display: "flex", flexDirection: "column",
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
            <span style={{ position: "absolute", top: 8, left: 8, background: "#C92F1F", color: "#EDF3E3", fontSize: 9, fontFamily: "var(--font-display)", fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius)", textTransform: "uppercase", letterSpacing: 1 }}>Limited</span>
          )}
          {item.image_urls?.length > 1 && (
            <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 9, padding: "2px 6px", borderRadius: 4 }}>1/{item.image_urls.length}</span>
          )}
        </div>
      ) : (
        <div style={{ width: "100%", aspectRatio: "1", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "var(--text-muted)" }}>&#9670;</div>
      )}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", flex: 1 }}>
        {item.brand && <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{item.brand}</div>}
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
        {item.subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{item.subtitle}</div>}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "baseline", gap: 6 }}>
          {discountPct > 0 ? (
            <>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>${item.member_price.toFixed(0)}</span>
              <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 12 }}>${item.price.toFixed(0)}</span>
            </>
          ) : (
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>${item.price.toFixed(0)}</span>
          )}
          {item.quantity_remaining !== null && !item.sold_out && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{item.quantity_remaining} left</span>
          )}
        </div>
      </div>
    </div>
  );
}
