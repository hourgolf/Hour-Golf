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

// Per-request render so tenant branding is fresh on every load and
// Vercel's Edge CDN doesn't cache the wrong tenant's HTML.
export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";

const CART_KEY = "hg-public-shop-cart-v1";

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
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedSize, setSelectedSize] = useState("");

  // Buyer details
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");

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

  async function checkout() {
    setError("");
    if (cart.length === 0) { setError("Your cart is empty."); return; }
    if (!buyerName.trim()) { setError("Please enter your name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/public-shop?action=checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart,
          buyer: {
            name: buyerName.trim(),
            email: buyerEmail.trim(),
            phone: buyerPhone.trim() || null,
          },
        }),
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {items.map((it) => (
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
                  <img src={it.image_url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ aspectRatio: "1", background: "var(--primary-bg)" }} />
                )}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2, lineHeight: 1.3 }}>{it.title}</div>
                  {it.brand && <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{it.brand}</div>}
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--primary)" }}>
                    ${Number(it.price).toFixed(2)}
                  </div>
                </div>
              </button>
            ))}
          </div>
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
              <img src={selected.image_url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12, marginBottom: 14 }} />
            )}
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 4 }}>{selected.title}</h2>
            {selected.brand && <p style={{ color: "var(--text-muted)", margin: "0 0 8px 0", fontSize: 13 }}>{selected.brand}</p>}
            {selected.description && <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 14px 0" }}>{selected.description}</p>}
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--primary)", marginBottom: 14 }}>
              ${Number(selected.price).toFixed(2)}
            </div>
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
                          <img src={it.image_url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
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

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: "1px solid var(--border)", marginBottom: 14 }}>
                  <strong style={{ fontFamily: "var(--font-display)" }}>Subtotal</strong>
                  <strong style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--primary)" }}>${cartTotal.toFixed(2)}</strong>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>
                  Pickup at {venueName}. Shipping coming soon.
                </div>

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

                {error && (
                  <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={checkout}
                  disabled={submitting}
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
                    cursor: submitting ? "default" : "pointer",
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting ? "Redirecting to checkout\u2026" : `Checkout \u2014 $${cartTotal.toFixed(2)}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
