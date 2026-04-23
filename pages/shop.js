// Public, unauthenticated /shop route. Shows the same shop_items as
// /members/shop but anyone can buy via guest checkout. Members can
// still log in and use /members/shop to get tier discount + credits.
//
// Phase 1: pickup-only. Stripe Checkout collects email; we collect
// name + phone. Phase 2 adds shipping (Shippo) + delivery method
// selection. Phase 3 adds Stripe Tax.

import { useEffect, useState, useMemo } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useBranding } from "../hooks/useBranding";
import { optimizedImageUrl } from "../lib/branding";
import { isOnSale } from "../lib/shop-pricing";

// Per-request render so tenant branding is fresh on every load and
// Vercel's Edge CDN doesn't cache the wrong tenant's HTML.
export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";

const CART_KEY = "hg-public-shop-cart-v1";

function shopInput(extra) {
  return {
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "var(--surface)",
    width: "100%",
    boxSizing: "border-box",
    ...(extra || {}),
  };
}

function loadCart() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCart(cart) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

export default function PublicShopPage() {
  const router = useRouter();
  const branding = useBranding();
  const venueName = branding?.venue_name || branding?.app_name || "Pro Shop";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("featured");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedSize, setSelectedSize] = useState("");

  // Buyer details
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");

  // Delivery method + shipping address. Server-side picks the carrier
  // rate at checkout; customer always pays our flat shipping price.
  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [shipAddr, setShipAddr] = useState({
    street1: "", street2: "", city: "", state: "", zip: "", country: "US",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setCart(loadCart());
    if (router.query.success === "1") {
      setSuccess(true);
      setCart([]);
      saveCart([]);
      // Strip the query so a refresh doesn't keep the success state.
      router.replace({ pathname: router.pathname, query: {} }, undefined, { shallow: true });
    }
    fetch("/api/public-shop?action=items")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.items) setItems(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { saveCart(cart); }, [cart]);

  const itemsById = useMemo(() => {
    const m = {};
    items.forEach((i) => { m[i.id] = i; });
    return m;
  }, [items]);

  const cartCount = cart.reduce((s, c) => s + (Number(c.quantity) || 0), 0);
  const cartTotal = cart.reduce((s, c) => {
    const it = itemsById[c.item_id];
    if (!it) return s;
    return s + Number(it.price) * (Number(c.quantity) || 0);
  }, 0);

  function addToCart(item, size) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item_id === item.id && c.size === (size || null));
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], quantity: (next[idx].quantity || 1) + 1 };
        return next;
      }
      return [...prev, { item_id: item.id, size: size || null, quantity: 1 }];
    });
    setSelected(null);
    setSelectedSize("");
    setCartOpen(true);
  }

  function updateQty(idx, delta) {
    setCart((prev) => {
      const next = prev.slice();
      const cur = Number(next[idx].quantity) || 1;
      const newQty = cur + delta;
      if (newQty <= 0) return next.filter((_, i) => i !== idx);
      next[idx] = { ...next[idx], quantity: newQty };
      return next;
    });
  }

  function removeFromCart(idx) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  async function applyPromo() {
    const code = promoCode.trim();
    if (!code) return;
    setPromoBusy(true);
    setPromoError("");
    try {
      const subtotalCents = cart.reduce((s, c) => {
        const item = items.find((it) => it.id === c.item_id);
        if (!item) return s;
        return s + Math.round(Number(item.price) * 100) * (Number(c.quantity) || 0);
      }, 0);
      const r = await fetch("/api/validate-discount-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal_cents: subtotalCents }),
      });
      const d = await r.json();
      if (!d.valid) throw new Error(d.message || "Code invalid");
      setAppliedPromo({ code: d.code, amount_cents: d.amount_cents });
      setPromoCode("");
    } catch (e) {
      setPromoError(e.message || "Apply failed");
    }
    setPromoBusy(false);
  }

  function removePromo() {
    setAppliedPromo(null);
    setPromoError("");
  }

  async function checkout() {
    setError("");
    if (cart.length === 0) { setError("Your cart is empty."); return; }
    if (!buyerName.trim()) { setError("Please enter your name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (deliveryMethod === "ship") {
      if (!shipAddr.street1.trim() || !shipAddr.city.trim() || !shipAddr.state.trim() || !shipAddr.zip.trim()) {
        setError("Please complete your shipping address.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        items: cart,
        buyer: {
          name: buyerName.trim(),
          email: buyerEmail.trim(),
          phone: buyerPhone.trim() || null,
        },
        delivery_method: deliveryMethod,
      };
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
      if (appliedPromo?.code) payload.discount_code = appliedPromo.code;
      const r = await fetch("/api/public-shop?action=checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Checkout failed");
      if (d.checkout_url) {
        window.location.href = d.checkout_url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  function setShipField(field, value) {
    setShipAddr((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <>
      <Head>
        <title>{venueName} Shop</title>
        <meta name="description" content={`Shop ${venueName} pro shop merchandise.`} />
      </Head>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 96px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, marginBottom: 6, color: "var(--text)" }}>
          {venueName} Shop
        </h1>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Member discounts and pro-shop credits apply when you sign in.
          {" "}
          <a href="/members/dashboard" style={{ color: "var(--primary)", fontWeight: 600 }}>Member sign in &rarr;</a>
        </p>

        {success && (
          <div style={{ background: "var(--primary-bg)", border: "1px solid var(--primary)", padding: 14, borderRadius: 12, marginBottom: 20 }}>
            <strong style={{ color: "var(--primary)" }}>Order received!</strong>
            <div style={{ fontSize: 13, marginTop: 4, color: "var(--text)" }}>
              Stripe sent a receipt to your email. Your items will be ready for pickup at {venueName} on your next visit.
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Loading shop&hellip;</div>
        ) : items.length === 0 ? (
          <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>
            No items available right now. Check back soon.
          </div>
        ) : (
          <>
            {(() => {
              const allBrands = [...new Set(items.map((it) => it.brand).filter(Boolean))].sort();
              const allCategories = [...new Set(items.map((it) => it.category).filter(Boolean))].sort();
              if (items.length < 4 || (allBrands.length <= 1 && allCategories.length <= 1)) return null;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {allCategories.length > 1 && (
                    <>
                      <button type="button" onClick={() => setCategoryFilter("all")} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: categoryFilter === "all" ? "var(--primary)" : "var(--surface)", color: categoryFilter === "all" ? "#EDF3E3" : "var(--text)", fontFamily: "inherit" }}>All</button>
                      {allCategories.map((c) => (
                        <button type="button" key={c} onClick={() => setCategoryFilter(c)} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: categoryFilter === c ? "var(--primary)" : "var(--surface)", color: categoryFilter === c ? "#EDF3E3" : "var(--text)", fontFamily: "inherit" }}>{c}</button>
                      ))}
                    </>
                  )}
                  {allBrands.length > 1 && (
                    <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit", marginLeft: "auto" }}>
                      <option value="">All brands</option>
                      {allBrands.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  )}
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontFamily: "inherit", marginLeft: allBrands.length > 1 ? 0 : "auto" }}>
                    <option value="featured">Featured</option>
                    <option value="newest">Newest</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                    <option value="sale">On sale first</option>
                  </select>
                </div>
              );
            })()}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {(() => {
                let filtered = items;
                if (brandFilter) filtered = filtered.filter((it) => it.brand === brandFilter);
                if (categoryFilter !== "all") filtered = filtered.filter((it) => it.category === categoryFilter);
                if (sortBy === "newest") filtered = [...filtered].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                else if (sortBy === "price_asc") filtered = [...filtered].sort((a, b) => Number(a.price) - Number(b.price));
                else if (sortBy === "price_desc") filtered = [...filtered].sort((a, b) => Number(b.price) - Number(a.price));
                else if (sortBy === "sale") filtered = [...filtered].sort((a, b) => (isOnSale(b) ? 1 : 0) - (isOnSale(a) ? 1 : 0));
                return filtered.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => { setSelected(it); setSelectedSize(""); }}
                style={{
                  textAlign: "left",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 0,
                  cursor: "pointer",
                  overflow: "hidden",
                  fontFamily: "inherit",
                }}
              >
                {it.image_url ? (
                  <img src={optimizedImageUrl(it.image_url, { width: 640 })} alt="" loading="lazy" decoding="async" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ aspectRatio: "1", background: "var(--primary-bg)" }} />
                )}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2, lineHeight: 1.3 }}>
                    {it.title}
                    {isOnSale(it) && (
                      <span style={{ marginLeft: 6, background: "#C77B3C", color: "#EDF3E3", fontSize: 8, padding: "2px 6px", borderRadius: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", verticalAlign: "middle" }}>SALE</span>
                    )}
                  </div>
                  {it.brand && <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{it.brand}</div>}
                  {isOnSale(it) ? (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--danger, #C92F1F)" }}>${Number(it.price).toFixed(2)}</span>
                      <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 12 }}>${Number(it.compare_at_price).toFixed(2)}</span>
                    </div>
                  ) : (
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--primary)" }}>
                      ${Number(it.price).toFixed(2)}
                    </div>
                  )}
                </div>
              </button>
                ));
              })()}
            </div>
          </>
        )}
      </div>

      {/* Floating cart button */}
      {cartCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background: "var(--primary)",
            color: "var(--bg)",
            border: "none",
            borderRadius: 999,
            padding: "14px 20px",
            fontFamily: "var(--font-display)",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
            zIndex: 100,
          }}
        >
          Cart ({cartCount}) &middot; ${cartTotal.toFixed(2)}
        </button>
      )}

      {/* Item modal — view + add to cart */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 480, background: "var(--surface)", borderRadius: "20px 20px 0 0",
              padding: 20, maxHeight: "90vh", overflowY: "auto",
            }}
          >
            {selected.image_url && (
              <img src={optimizedImageUrl(selected.image_url, { width: 1080 })} alt="" loading="lazy" decoding="async" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12, marginBottom: 14 }} />
            )}
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 4 }}>{selected.title}</h2>
            {selected.brand && <p style={{ color: "var(--text-muted)", margin: "0 0 8px 0", fontSize: 13 }}>{selected.brand}</p>}
            {selected.description && <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 14px 0" }}>{selected.description}</p>}
            {isOnSale(selected) ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--danger, #C92F1F)" }}>${Number(selected.price).toFixed(2)}</span>
                <span style={{ textDecoration: "line-through", color: "var(--text-muted)", fontSize: 14 }}>${Number(selected.compare_at_price).toFixed(2)}</span>
                <span style={{ background: "#C77B3C", color: "#EDF3E3", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>SALE</span>
              </div>
            ) : (
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--primary)", marginBottom: 14 }}>
                ${Number(selected.price).toFixed(2)}
              </div>
            )}
            {selected.sizes && selected.sizes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Size</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {selected.sizes.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setSelectedSize(s)}
                      style={{
                        padding: "8px 16px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                        border: selectedSize === s ? "2px solid var(--primary)" : "1.5px solid var(--border)",
                        background: selectedSize === s ? "var(--primary-bg)" : "var(--surface)",
                        color: selectedSize === s ? "var(--primary)" : "var(--text)",
                        fontWeight: selectedSize === s ? 600 : 500,
                      }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{ flex: 1, padding: 12, borderRadius: 12, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
              >Cancel</button>
              <button
                type="button"
                onClick={() => addToCart(selected, selectedSize)}
                disabled={selected.sizes?.length > 0 && !selectedSize}
                style={{
                  flex: 2, padding: 12, borderRadius: 12, background: "var(--primary)", color: "var(--bg)",
                  border: "none", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14,
                  opacity: (selected.sizes?.length > 0 && !selectedSize) ? 0.5 : 1,
                }}
              >Add to cart</button>
            </div>
          </div>
        </div>
      )}

      {/* Cart panel */}
      {cartOpen && (
        <div
          onClick={() => setCartOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 520, background: "var(--surface)", borderRadius: "20px 20px 0 0",
              maxHeight: "92vh", overflowY: "auto", padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, margin: 0 }}>Your cart</h2>
              <button type="button" onClick={() => setCartOpen(false)} style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: "var(--text-muted)" }}>&times;</button>
            </div>
            {cart.length === 0 ? (
              <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center" }}>Your cart is empty.</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  {cart.map((c, i) => {
                    const it = itemsById[c.item_id];
                    if (!it) return null;
                    return (
                      <div key={`${c.item_id}-${c.size || ""}-${i}`} style={{ display: "flex", gap: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 12 }}>
                        {it.image_url && (
                          <img src={optimizedImageUrl(it.image_url, { width: 128 })} alt="" loading="lazy" decoding="async" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{it.title}</div>
                          {c.size && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Size {c.size}</div>}
                          <div style={{ fontSize: 13, marginTop: 4, color: "var(--primary)", fontWeight: 600 }}>
                            ${(Number(it.price) * c.quantity).toFixed(2)}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <button type="button" onClick={() => removeFromCart(i)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>Remove</button>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button type="button" onClick={() => updateQty(i, -1)} style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>&minus;</button>
                            <span style={{ minWidth: 20, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 13 }}>{c.quantity}</span>
                            <button type="button" onClick={() => updateQty(i, 1)} style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>+</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <strong style={{ fontFamily: "var(--font-display)" }}>Subtotal</strong>
                  <strong style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--primary)" }}>${cartTotal.toFixed(2)}</strong>
                </div>
                {appliedPromo ? (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#C77B3C", marginBottom: 8, paddingTop: 6 }}>
                    <span>
                      Code <strong style={{ fontFamily: "var(--font-mono)", letterSpacing: 1 }}>{appliedPromo.code}</strong>
                      <button onClick={removePromo} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", marginLeft: 6, textDecoration: "underline" }}>remove</button>
                    </span>
                    <span>&minus;${(appliedPromo.amount_cents / 100).toFixed(2)}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, marginTop: 4 }}>
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => { setPromoCode(e.target.value); setPromoError(""); }}
                      placeholder="Promo code"
                      style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", textTransform: "uppercase", letterSpacing: 1 }}
                    />
                    <button
                      onClick={applyPromo}
                      disabled={promoBusy || !promoCode.trim()}
                      style={{ fontSize: 12, padding: "8px 14px", background: "var(--primary)", color: "#EDF3E3", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                    >
                      {promoBusy ? "…" : "Apply"}
                    </button>
                  </div>
                )}
                {promoError && <div style={{ fontSize: 11, color: "var(--danger, #C92F1F)", marginBottom: 6 }}>{promoError}</div>}
                <div style={{ marginBottom: 14 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, fontSize: 14, fontFamily: "inherit" }}
                  />
                  <input
                    type="email"
                    placeholder="Email (for receipt)"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, fontSize: 14, fontFamily: "inherit" }}
                  />
                  <input
                    type="tel"
                    placeholder="Phone (optional)"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10, fontSize: 14, fontFamily: "inherit" }}
                  />
                </div>

                {/* Delivery method */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Delivery</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["pickup", "ship"].map((m) => (
                      <button
                        type="button"
                        key={m}
                        onClick={() => setDeliveryMethod(m)}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: deliveryMethod === m ? "2px solid var(--primary)" : "1.5px solid var(--border)",
                          background: deliveryMethod === m ? "var(--primary-bg)" : "var(--surface)",
                          color: deliveryMethod === m ? "var(--primary)" : "var(--text)",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 13,
                          textAlign: "center",
                        }}
                      >
                        {m === "pickup" ? `Pick up at ${venueName}` : "Ship to me"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Shipping address + rate selection (only when shipping) */}
                {deliveryMethod === "ship" && (
                  <div style={{ marginBottom: 14, padding: 12, background: "var(--primary-bg)", borderRadius: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Ship to</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input type="text" placeholder="Street address" value={shipAddr.street1} onChange={(e) => setShipField("street1", e.target.value)} style={shopInput({ gridColumn: "1 / -1" })} />
                      <input type="text" placeholder="Apt, suite, etc. (optional)" value={shipAddr.street2} onChange={(e) => setShipField("street2", e.target.value)} style={shopInput({ gridColumn: "1 / -1" })} />
                      <input type="text" placeholder="City" value={shipAddr.city} onChange={(e) => setShipField("city", e.target.value)} style={shopInput({})} />
                      <input type="text" placeholder="State" value={shipAddr.state} onChange={(e) => setShipField("state", e.target.value)} style={shopInput({})} maxLength={2} />
                      <input type="text" placeholder="ZIP" value={shipAddr.zip} onChange={(e) => setShipField("zip", e.target.value)} style={shopInput({})} />
                      <input type="text" placeholder="Country" value={shipAddr.country} onChange={(e) => setShipField("country", e.target.value)} style={shopInput({})} maxLength={2} />
                    </div>

                    {/* Flat shipping cost: $10 unless cart subtotal is
                        $100+, then free. Server validates the address
                        + buys the carrier label after payment; the
                        customer never sees individual carrier rates. */}
                    {(() => {
                      const free = cartTotal >= 100;
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
                              Free shipping on orders ${(100 - cartTotal).toFixed(2)} away.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {deliveryMethod === "pickup" && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>
                    Your items will be ready at {venueName} on your next visit.
                  </div>
                )}

                {error && (
                  <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                    {error}
                  </div>
                )}

                {(() => {
                  const shipCost = deliveryMethod === "ship"
                    ? (cartTotal >= 100 ? 0 : 10)
                    : 0;
                  const grand = cartTotal + shipCost;
                  const disabled = submitting;
                  return (
                    <button
                      type="button"
                      onClick={checkout}
                      disabled={disabled}
                      style={{
                        width: "100%",
                        padding: 14,
                        background: "var(--primary)",
                        color: "var(--bg)",
                        border: "none",
                        borderRadius: 12,
                        fontFamily: "var(--font-display)",
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.6 : 1,
                      }}
                    >
                      {submitting
                        ? "Redirecting to checkout\u2026"
                        : `Checkout \u2014 $${grand.toFixed(2)}`}
                    </button>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
