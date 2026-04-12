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

  const totalHours = Number(usage?.total_hours || 0);
  const includedHours = Number(usage?.included_hours || tierConfig?.included_hours || 0);
  const isUnlimited = includedHours >= 99999;
  const remaining = isUnlimited ? Infinity : Math.max(0, includedHours - totalHours);
  const overageHours = Number(usage?.overage_hours || 0);
  const overageRate = Number(tierConfig?.overage_rate || 60);

  function fmt(n) { return Number(n || 0).toFixed(1); }

  if (loading) {
    return <div className="mem-loading">Loading dashboard...</div>;
  }

  return (
    <>
      {/* Usage Cards */}
      <div className="mem-cards">
        <div className="mem-card">
          <div className="mem-card-val">{fmt(totalHours)}h</div>
          <div className="mem-card-lbl">Used This Month</div>
        </div>
        <div className="mem-card">
          <div className="mem-card-val" style={{ color: isUnlimited ? "#a67c00" : remaining <= 2 ? "#cc4455" : "#4a7c59" }}>
            {isUnlimited ? "\u221E" : `${fmt(remaining)}h`}
          </div>
          <div className="mem-card-lbl">Remaining</div>
        </div>
        <div className="mem-card">
          <div className="mem-card-val">{isUnlimited ? "\u221E" : `${includedHours}h`}</div>
          <div className="mem-card-lbl">Monthly Allowance</div>
        </div>
        {overageHours > 0 && (
          <div className="mem-card" style={{ borderColor: "#cc4455" }}>
            <div className="mem-card-val" style={{ color: "#cc4455" }}>{fmt(overageHours)}h</div>
            <div className="mem-card-lbl">Overage (${(overageHours * overageRate).toFixed(2)})</div>
          </div>
        )}
      </div>

      {/* Upcoming Bookings */}
      <div className="mem-section">
        <div className="mem-section-head">
          <span>Upcoming Bookings</span>
          <button className="mem-btn-sm mem-btn-accent" onClick={() => router.push("/members/book")}>
            + Book a Bay
          </button>
        </div>
        {upcoming.length === 0 ? (
          <div className="mem-empty">No upcoming bookings</div>
        ) : (
          <div className="mem-list">
            {upcoming.map((b) => {
              const s = new Date(b.booking_start);
              const e = new Date(b.booking_end);
              return (
                <div key={b.booking_id} className="mem-list-item">
                  <div>
                    <strong>{fDL(s)}</strong>
                    <div className="mem-list-sub">{fT(s)} &ndash; {fT(e)} &middot; {b.bay}</div>
                  </div>
                  <div className="mem-dur">{Number(b.duration_hours).toFixed(1)}h</div>
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
