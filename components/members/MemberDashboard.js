import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { TZ } from "../../lib/constants";
import Modal from "../ui/Modal";
import InstallPrompt from "./InstallPrompt";
import { fT, fD, fDL } from "../../lib/format";

// What the QR encodes:
//   - If the member has a Square customer record linked, encode the member
//     UUID. That same UUID is also written to Square's `reference_id`, so
//     Square Register scans the QR and loads the customer profile natively.
//   - Otherwise fall back to the legacy /verify?token=... URL so staff
//     using a plain phone camera still land on the member-lookup page.
function qrPayload(member) {
  if (member.square_customer_id && member.id) return member.id;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://hourgolf.vercel.app";
  return `${origin}/verify?token=${member.verify_token}`;
}

// Pretty payment-method line for the in-store purchase card. Card with
// last 4 becomes "Visa •••• 4242", card without last 4 is just the brand,
// non-card payment types (CASH, EXTERNAL, ...) capitalize the first
// letter. Returns empty string when nothing useful is known.
function formatPaymentMethod(p) {
  const method = (p.payment_method || "").toLowerCase();
  if (method === "card") {
    const brand = p.card_brand ? formatCardBrand(p.card_brand) : "Card";
    if (p.card_last_4) return `${brand} \u2022\u2022\u2022\u2022 ${p.card_last_4}`;
    return brand;
  }
  if (!method) return "";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function formatCardBrand(b) {
  const up = String(b || "").toUpperCase();
  const map = {
    VISA: "Visa",
    MASTERCARD: "Mastercard",
    AMERICAN_EXPRESS: "Amex",
    DISCOVER: "Discover",
    JCB: "JCB",
    DISCOVER_DINERS: "Diners",
  };
  return map[up] || "Card";
}

export default function MemberDashboard({ member, tierConfig, refresh, showToast }) {
  const router = useRouter();
  const [usage, setUsage] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [loyalty, setLoyalty] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
  const [inStorePurchases, setInStorePurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelConfirm, setCancelConfirm] = useState(null); // booking_id being confirmed
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    loadData();

    // Check for purchase success
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("purchased")) {
        showToast(`Successfully purchased ${params.get("purchased")} hour credit(s)!`);
        window.history.replaceState({}, "", "/members/dashboard");
      }
    }
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-data", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load data");
      const d = await r.json();
      setUsage(d.usage);
      setUpcoming(d.upcomingBookings || []);
      setMonthBookings(d.monthBookings || []);
      // Load loyalty progress
      fetch("/api/member-shop?action=loyalty", { credentials: "include" })
        .then((lr) => lr.ok ? lr.json() : null)
        .then((ld) => { if (ld) setLoyalty(ld); })
        .catch(() => {});
      // Load recent in-store purchases (Square POS). Empty array if the
      // tenant isn't Square-enabled or the member hasn't bought anything.
      fetch("/api/member-in-store-purchases?limit=5", { credentials: "include" })
        .then((ir) => ir.ok ? ir.json() : null)
        .then((id) => { if (id?.purchases) setInStorePurchases(id.purchases); })
        .catch(() => {});
    } catch (e) {
      showToast("Failed to load dashboard data", "error");
    }
    setLoading(false);
  }

  async function handleCancel(bookingId) {
    setCancelling(true);
    try {
      const r = await fetch("/api/member-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Cancellation failed");
      showToast("Booking cancelled");
      setCancelConfirm(null);
      await loadData();
    } catch (e) {
      showToast(e.message, "error");
    }
    setCancelling(false);
  }

  const totalHours = Number(usage?.total_hours || 0);
  const includedHours = Number(usage?.included_hours || tierConfig?.included_hours || 0);
  const isUnlimited = includedHours >= 99999;
  const bonusRemaining = Number(usage?.effective_bonus_remaining || 0);
  const monthlyRemaining = isUnlimited ? Infinity : Math.max(0, includedHours - totalHours);
  const remaining = isUnlimited ? Infinity : monthlyRemaining + bonusRemaining;
  const overageHours = Number(usage?.overage_hours || 0);
  const overageRate = Number(tierConfig?.overage_rate || 60);

  function fmt(n) { return Number(n || 0).toFixed(1); }

  if (loading) {
    return <div className="mem-loading">Loading dashboard...</div>;
  }

  const firstName = (member?.name || "").split(" ")[0] || "there";

  return (
    <>
      {/* Greeting */}
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, marginBottom: 20, color: "var(--text)" }}>
        Hey, {firstName}.
      </h1>

      <InstallPrompt variant="banner" />

      {/* Usage Cards */}
      <div className="mem-cards">
        <div className="mem-card">
          <div className="mem-card-val">{fmt(totalHours)}h</div>
          <div className="mem-card-lbl">Used This Month</div>
        </div>
        <div className="mem-card">
          <div className="mem-card-val" style={{ color: isUnlimited ? "#8BB5A0" : remaining <= 2 ? "#C92F1F" : "#4C8D73" }}>
            {isUnlimited ? "\u221E" : `${fmt(remaining)}h`}
          </div>
          <div className="mem-card-lbl">Remaining</div>
        </div>
        <div className="mem-card">
          <div className="mem-card-val">{isUnlimited ? "\u221E" : `${includedHours}h`}</div>
          <div className="mem-card-lbl">Monthly Allowance</div>
        </div>
        {bonusRemaining > 0 && (
          <div className="mem-card" style={{ borderColor: "#8BB5A0" }}>
            <div className="mem-card-val" style={{ color: "#8BB5A0" }}>{fmt(bonusRemaining)}h</div>
            <div className="mem-card-lbl">Bonus Hours</div>
          </div>
        )}
        {overageHours > 0 && (
          <div className="mem-card" style={{ borderColor: "#C92F1F" }}>
            <div className="mem-card-val" style={{ color: "#C92F1F" }}>{fmt(overageHours)}h</div>
            <div className="mem-card-lbl">Overage (${(overageHours * overageRate).toFixed(2)})</div>
          </div>
        )}
        <div className="mem-card" style={{ borderColor: "#ddd480" }}>
          <div className="mem-card-val" style={{ color: Number(member.shop_credit_balance || 0) > 0 ? "#ddd480" : "var(--text-muted)" }}>${Number(member.shop_credit_balance || 0).toFixed(2)}</div>
          <div className="mem-card-lbl">Pro Shop Credits</div>
        </div>
        {member.verify_token && (
          <div className="mem-card" style={{ borderColor: "var(--primary)", cursor: "pointer" }} onClick={() => setShowQR(true)}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(qrPayload(member))}&color=35443B&bgcolor=FFFFFF`}
              alt="QR"
              style={{ width: 48, height: 48, borderRadius: 4 }}
            />
            <div className="mem-card-lbl" style={{ marginTop: 4 }}>In-Store Code</div>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      <Modal open={showQR} onClose={() => setShowQR(false)}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 4 }}>In-Store Discount</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px 0" }}>
            Show this code at the register to apply your member discount.
          </p>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrPayload(member))}&color=35443B&bgcolor=FFFFFF`}
            alt="Member QR Code"
            style={{ width: 240, height: 240, borderRadius: 8, border: "1px solid var(--border)" }}
          />
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
            {member.tier} &mdash; {tierConfig?.pro_shop_discount || 0}% discount
          </div>
          {Number(member.shop_credit_balance || 0) > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#ddd480", fontWeight: 600 }}>
              ${Number(member.shop_credit_balance).toFixed(2)} store credit available
            </div>
          )}
        </div>
      </Modal>

      {/* Loyalty Progress */}
      {loyalty && loyalty.progress && loyalty.progress.length > 0 && (
        <div className="mem-section" style={{ marginBottom: 20, padding: "16px" }}>
          <div className="mem-section-head">Rewards Progress</div>

          {loyalty.is_member === false && (
            <div style={{ background: "var(--primary-bg)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text)" }}>
                <strong style={{ color: "var(--primary)" }}>Members only</strong> — become a member to start earning.
              </span>
              <button
                onClick={() => router.push("/members/billing")}
                className="mem-btn mem-btn-primary"
                style={{ fontSize: 11, padding: "6px 14px" }}
              >
                Join Now
              </button>
            </div>
          )}

          <div style={{ opacity: loyalty.is_member === false ? 0.45 : 1 }}>
            {loyalty.progress.map((p) => {
              const label = p.rule_type === "hours" ? `${p.current.toFixed(1)}/${p.threshold}h booked`
                : p.rule_type === "bookings" ? `${p.current}/${p.threshold} bookings`
                : `$${p.current.toFixed(0)}/$${p.threshold} spent`;
              return (
                <div key={p.rule_type} style={{ marginBottom: p === loyalty.progress[loyalty.progress.length - 1] ? 0 : 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
                    <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>Earn ${p.reward}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.pct}%`, background: p.pct >= 100 ? "#ddd480" : "var(--primary)", borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                  {loyalty.is_member !== false && p.pct >= 100 && (
                    <div style={{ fontSize: 11, color: "#ddd480", fontWeight: 600, marginTop: 2 }}>Threshold reached! Credit issued at month end.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming Bookings */}
      <div className="mem-section">
        <div className="mem-section-head">
          <span>Upcoming Bookings</span>
          <button className="mem-btn-sm mem-btn-accent" onClick={() => router.push("/members/book")}>
            Book a Bay.
          </button>
        </div>
        {upcoming.length === 0 ? (
          <div className="mem-empty">No upcoming bookings</div>
        ) : (
          <div className="mem-list">
            {upcoming.map((b) => {
              const s = new Date(b.booking_start);
              const e = new Date(b.booking_end);
              const hoursUntil = (s - new Date()) / 3600000;
              const canCancel = hoursUntil > 6;

              return (
                <div key={b.booking_id} className="mem-list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{fDL(s)}</strong>
                      <div className="mem-list-sub">{fT(s)} &ndash; {fT(e)} &middot; {b.bay}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mem-dur">{Number(b.duration_hours).toFixed(1)}h</span>
                      {canCancel ? (
                        <button
                          className="mem-cancel-btn"
                          onClick={() => setCancelConfirm(b.booking_id)}
                          disabled={cancelling}
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="mem-list-sub" style={{ fontSize: 11 }}>Contact us to cancel</span>
                      )}
                    </div>
                  </div>

                  {cancelConfirm === b.booking_id && (
                    <div className="mem-cancel-confirm">
                      <span>Cancel this booking?</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="mem-cancel-btn mem-cancel-yes"
                          onClick={() => handleCancel(b.booking_id)}
                          disabled={cancelling}
                        >
                          {cancelling ? "..." : "Yes, cancel"}
                        </button>
                        <button
                          className="mem-btn-sm"
                          style={{ color: "var(--text)", border: "1px solid var(--border)" }}
                          onClick={() => setCancelConfirm(null)}
                        >
                          No, keep it
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent in-store purchases (Square POS). Hidden when empty so
          the section doesn't dominate the dashboard for members who
          haven't bought anything at the counter yet. */}
      {inStorePurchases.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Recent In-Store Purchases</div>
          <div className="mem-list">
            {inStorePurchases.map((p) => {
              const when = new Date(p.occurred_at);
              const paymentLine = formatPaymentMethod(p);
              return (
                <div key={p.id} className="mem-list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <span>{fD(when)}</span>
                      <span className="mem-list-sub" style={{ marginLeft: 8 }}>
                        {p.description || "In-store purchase"}
                      </span>
                    </div>
                    <div className="mem-dur">${(Number(p.amount_cents) / 100).toFixed(2)}</div>
                  </div>
                  {(paymentLine || p.receipt_url) && (
                    <div className="mem-list-sub" style={{ fontSize: 11, display: "flex", gap: 10, alignItems: "center" }}>
                      {paymentLine && <span>{paymentLine}</span>}
                      {p.receipt_url && (
                        <a
                          href={p.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}
                        >
                          View receipt &rarr;
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* This Month Activity */}
      <div className="mem-section">
        <div className="mem-section-head">This Month&rsquo;s Activity</div>
        {monthBookings.length === 0 ? (
          <div className="mem-empty">No bookings this month</div>
        ) : (
          <div className="mem-list">
            {monthBookings.map((b) => {
              const s = new Date(b.booking_start);
              const e = new Date(b.booking_end);
              return (
                <div key={b.booking_id} className="mem-list-item">
                  <div>
                    <span>{fD(s)}</span>
                    <span className="mem-list-sub" style={{ marginLeft: 8 }}>{fT(s)}&ndash;{fT(e)}</span>
                    <span className="mem-list-sub" style={{ marginLeft: 8 }}>{b.bay}</span>
                  </div>
                  <div className="mem-dur">{Number(b.duration_hours).toFixed(1)}h</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
