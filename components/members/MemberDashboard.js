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

export default function MemberDashboard({ member, tierConfig, refresh, showToast }) {
  const router = useRouter();
  const [usage, setUsage] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [loyalty, setLoyalty] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
  const [myEvents, setMyEvents] = useState([]);
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
      // Upcoming events the member has registered for or expressed
      // interest in. /api/member-events returns every published event
      // flagged with is_interested + registration_status; we filter to
      // those the member cares about and that haven't happened yet.
      fetch("/api/member-events", { credentials: "include" })
        .then((er) => er.ok ? er.json() : null)
        .then((events) => {
          if (!Array.isArray(events)) return;
          const now = Date.now();
          const relevant = events
            .filter((ev) => {
              if (!ev.is_interested && !ev.registration_status) return false;
              const end = ev.end_date ? new Date(ev.end_date).getTime() : null;
              const start = ev.start_date ? new Date(ev.start_date).getTime() : null;
              // Hide events that have fully ended. Keep in-progress events.
              if (end && end < now) return false;
              if (!end && start && start < now - 24 * 3600 * 1000) return false;
              return true;
            })
            .sort((a, b) => new Date(a.start_date || 0) - new Date(b.start_date || 0));
          setMyEvents(relevant);
        })
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
              src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(qrPayload(member))}&color=4C8D73&bgcolor=FFFFFF`}
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
            src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrPayload(member))}&color=4C8D73&bgcolor=FFFFFF`}
            alt="Member QR Code"
            style={{ width: 240, height: 240, borderRadius: 8 }}
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

      {/* Your Events — only events the member registered for or
          flagged interest in, and that haven't already ended. Hidden
          when empty so the dashboard stays uncluttered for members
          not engaged with events. Tap a row to jump to the event
          detail page. */}
      {myEvents.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Your Events</div>
          <div className="mem-list">
            {myEvents.map((ev) => {
              const start = ev.start_date ? new Date(ev.start_date) : null;
              const status = ev.registration_status; // e.g. 'registered', 'waitlist'
              let tag = "Interested";
              let tagStyle = { background: "var(--primary-bg)", color: "var(--primary)" };
              if (status === "registered") {
                tag = "Registered";
                tagStyle = { background: "var(--primary)", color: "var(--bg)" };
              } else if (status === "waitlist") {
                tag = "Waitlist";
                tagStyle = { background: "#ddd480", color: "#35443B" };
              } else if (status) {
                tag = status.charAt(0).toUpperCase() + status.slice(1);
              }
              return (
                <div
                  key={ev.id}
                  className="mem-list-item"
                  style={{ alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                  onClick={() => router.push(`/members/events/${ev.id}`)}
                >
                  {/* Left column: title (top) + subtitle (below). */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", lineHeight: 1.25 }}>{ev.title}</strong>
                    {ev.subtitle && (
                      <div className="mem-list-sub" style={{ fontSize: 12, marginTop: 2 }}>
                        {ev.subtitle}
                      </div>
                    )}
                  </div>
                  {/* Right column: status badge (top) + date (below). */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span className="mem-purchase-tag" style={tagStyle}>{tag}</span>
                    {start && (
                      <span className="mem-list-sub" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                        {fD(start)} &middot; {fT(start)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, textAlign: "right" }}>
            <a href="/members/events" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
              Browse all events &rarr;
            </a>
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
