import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { TZ } from "../../lib/constants";
import { fT, fD, fDL } from "../../lib/format";

export default function MemberDashboard({ member, tierConfig, refresh, showToast }) {
  const router = useRouter();
  const [usage, setUsage] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
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
      </div>

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
