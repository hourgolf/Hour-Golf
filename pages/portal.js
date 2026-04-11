import { useState, useEffect, useMemo } from "react";

function getApiKey() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("hg-key") || "";
}
function apiHeaders(extra = {}) {
  return { "Content-Type": "application/json", "x-api-key": getApiKey(), ...extra };
}

const BAYS = ["Bay 1", "Bay 2"];
const TZ = "America/Los_Angeles";
const HOURS = [];
for (let h = 7; h <= 21; h++) {
  for (let m = 0; m < 60; m += 30) {
    HOURS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function fT(d) { return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }); }
function fD(d) { return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }); }
function fDL(d) { return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ }); }

function formatHours(n) { return Number(n || 0).toFixed(1); }

// Credit purchase options
const CREDIT_OPTIONS = [1, 2, 5, 10];

export default function CustomerPortal() {
  // Auth state
  const [email, setEmail] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Data
  const [member, setMember] = useState(null);
  const [tierConfig, setTierConfig] = useState(null);
  const [usageData, setUsage] = useState(null);
  const [upcomingBookings, setUpcoming] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
  const [billingMonth, setBillingMonth] = useState("");

  // Booking state
  const [bookView, setBookView] = useState("dashboard"); // dashboard | book
  const [bookDate, setBookDate] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString("en-CA", { timeZone: TZ });
  });
  const [bookStart, setBookStart] = useState("10:00");
  const [bookEnd, setBookEnd] = useState("11:00");
  const [bookBay, setBookBay] = useState("Bay 1");
  const [availability, setAvailability] = useState([]);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState("");

  // Purchase state
  const [purchasing, setPurchasing] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Check URL for purchase success
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("purchased")) {
        showToast(`Successfully purchased ${params.get("purchased")} hour credit(s)!`);
        window.history.replaceState({}, "", "/portal");
      }
      // Auto-login if email in localStorage
      const saved = localStorage.getItem("hg-portal-email");
      if (saved) {
        setEmail(saved);
        login(saved);
      }
    }
  }, []);

  async function login(em) {
    const e = (em || email).toLowerCase().trim();
    if (!e) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/customer-auth", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ email: e }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Login failed");
      setMember(d.member);
      setTierConfig(d.tierConfig);
      setUsage(d.usage);
      setUpcoming(d.upcomingBookings);
      setMonthBookings(d.monthBookings);
      setBillingMonth(d.billingMonth);
      setLoggedIn(true);
      localStorage.setItem("hg-portal-email", e);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function refreshData() {
    if (!member) return;
    await login(member.email);
  }

  function logout() {
    setLoggedIn(false);
    setMember(null);
    localStorage.removeItem("hg-portal-email");
  }

  // Load availability when date changes
  useEffect(() => {
    if (!loggedIn || !bookDate) return;
    fetch(`/api/customer-availability?date=${bookDate}`, { headers: { "x-api-key": getApiKey() } })
      .then((r) => r.json())
      .then((d) => setAvailability(d.bookings || []))
      .catch(() => setAvailability([]));
  }, [bookDate, loggedIn]);

  // Check if a slot is taken
  function isSlotTaken(bay, startStr, endStr) {
    const s = new Date(`${bookDate}T${startStr}:00`);
    const e = new Date(`${bookDate}T${endStr}:00`);
    return availability.some(
      (b) => b.bay === bay && new Date(b.booking_start) < e && new Date(b.booking_end) > s
    );
  }

  async function handleBook() {
    setBooking(true);
    setBookMsg("");
    try {
      const r = await fetch("/api/customer-book", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          email: member.email,
          name: member.name,
          date: bookDate,
          startTime: bookStart,
          endTime: bookEnd,
          bay: bookBay,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "Booking failed");
      showToast("Booking confirmed!");
      setBookView("dashboard");
      await refreshData();
    } catch (err) {
      setBookMsg(err.message);
    }
    setBooking(false);
  }

  async function handleBuyCredits(hours) {
    setPurchasing(true);
    try {
      const r = await fetch("/api/customer-buy-credits", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ email: member.email, hours }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      window.location.href = d.url;
    } catch (err) {
      showToast(err.message, "error");
      setPurchasing(false);
    }
  }

  // Computed
  const totalHours = Number(usageData?.total_hours || 0);
  const includedHours = Number(usageData?.included_hours || tierConfig?.included_hours || 0);
  const isUnlimited = includedHours >= 99999;
  const remaining = isUnlimited ? Infinity : Math.max(0, includedHours - totalHours);
  const overageHours = Number(usageData?.overage_hours || 0);
  const overageRate = Number(tierConfig?.overage_rate || 60);

  const bookDuration = bookStart && bookEnd
    ? Math.max(0, (new Date(`${bookDate}T${bookEnd}:00`) - new Date(`${bookDate}T${bookStart}:00`)) / 3600000)
    : 0;

  const slotConflict = bookStart && bookEnd && isSlotTaken(bookBay, bookStart, bookEnd);

  // ---- RENDER ----

  if (!loggedIn) {
    return (
      <div className="portal">
        <div className="portal-login">
          <div className="portal-brand">HOUR GOLF</div>
          <div className="portal-brand-sub">Member Portal</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") login(); }}
            placeholder="Enter your email"
          />
          {error && <p className="portal-err">{error}</p>}
          <button onClick={() => login()} disabled={!email || loading}>
            {loading ? "..." : "Sign In"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="portal">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-header-inner">
          <div>
            <div className="portal-brand" style={{ fontSize: 16 }}>HOUR GOLF</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13 }}>{member.name}</span>
            <span className="portal-tier-badge">{member.tier}</span>
            <button className="portal-btn-sm" onClick={logout}>Sign Out</button>
          </div>
        </div>
      </header>

      {/* Nav */}
      <div className="portal-nav">
        <button className={`portal-nav-btn ${bookView === "dashboard" ? "active" : ""}`} onClick={() => setBookView("dashboard")}>Dashboard</button>
        <button className={`portal-nav-btn ${bookView === "book" ? "active" : ""}`} onClick={() => setBookView("book")}>Book a Bay</button>
      </div>

      {/* Dashboard */}
      {bookView === "dashboard" && (
        <div className="portal-content">
          {/* Usage Cards */}
          <div className="portal-cards">
            <div className="portal-card">
              <div className="portal-card-val">{formatHours(totalHours)}h</div>
              <div className="portal-card-lbl">Used This Month</div>
            </div>
            <div className="portal-card">
              <div className="portal-card-val" style={{ color: isUnlimited ? "#a67c00" : remaining <= 2 ? "#cc4455" : "#4a7c59" }}>
                {isUnlimited ? "\u221E" : `${formatHours(remaining)}h`}
              </div>
              <div className="portal-card-lbl">Remaining</div>
            </div>
            <div className="portal-card">
              <div className="portal-card-val">{isUnlimited ? "\u221E" : `${includedHours}h`}</div>
              <div className="portal-card-lbl">Monthly Allowance</div>
            </div>
            {overageHours > 0 && (
              <div className="portal-card" style={{ borderColor: "#cc4455" }}>
                <div className="portal-card-val" style={{ color: "#cc4455" }}>{formatHours(overageHours)}h</div>
                <div className="portal-card-lbl">Overage (${(overageHours * overageRate).toFixed(2)})</div>
              </div>
            )}
          </div>

          {/* Upcoming Bookings */}
          <div className="portal-section">
            <div className="portal-section-head">
              <span>Upcoming Bookings</span>
              <button className="portal-btn-sm" onClick={() => setBookView("book")}>+ Book a Bay</button>
            </div>
            {upcomingBookings.length === 0 ? (
              <div className="portal-empty">No upcoming bookings</div>
            ) : (
              <div className="portal-list">
                {upcomingBookings.map((b) => {
                  const s = new Date(b.booking_start);
                  const e = new Date(b.booking_end);
                  return (
                    <div key={b.booking_id} className="portal-list-item">
                      <div>
                        <strong>{fDL(s)}</strong>
                        <div style={{ fontSize: 13, opacity: 0.7 }}>{fT(s)} &ndash; {fT(e)} &middot; {b.bay}</div>
                      </div>
                      <div className="portal-dur">{Number(b.duration_hours).toFixed(1)}h</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* This Month Activity */}
          <div className="portal-section">
            <div className="portal-section-head">This Month&rsquo;s Activity</div>
            {monthBookings.length === 0 ? (
              <div className="portal-empty">No bookings this month</div>
            ) : (
              <div className="portal-list">
                {monthBookings.map((b) => {
                  const s = new Date(b.booking_start);
                  const e = new Date(b.booking_end);
                  return (
                    <div key={b.booking_id} className="portal-list-item">
                      <div>
                        <span>{fD(s)}</span>
                        <span style={{ opacity: 0.6, marginLeft: 8 }}>{fT(s)}&ndash;{fT(e)}</span>
                        <span style={{ opacity: 0.6, marginLeft: 8 }}>{b.bay}</span>
                      </div>
                      <div className="portal-dur">{Number(b.duration_hours).toFixed(1)}h</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Buy Credits */}
          <div className="portal-section">
            <div className="portal-section-head">Buy Hour Credits</div>
            <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
              Purchase additional bay hours at ${overageRate}/hr.
            </p>
            <div className="portal-credit-grid">
              {CREDIT_OPTIONS.map((h) => (
                <button
                  key={h}
                  className="portal-credit-btn"
                  onClick={() => handleBuyCredits(h)}
                  disabled={purchasing}
                >
                  <div className="portal-credit-hrs">{h}h</div>
                  <div className="portal-credit-price">${(h * overageRate).toFixed(0)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Book a Bay */}
      {bookView === "book" && (
        <div className="portal-content">
          <div className="portal-section">
            <div className="portal-section-head">Book a Bay</div>

            <div className="portal-book-form">
              <div className="portal-book-row">
                <label>Date</label>
                <input
                  type="date"
                  value={bookDate}
                  min={new Date().toLocaleDateString("en-CA", { timeZone: TZ })}
                  onChange={(e) => setBookDate(e.target.value)}
                />
              </div>
              <div className="portal-book-row">
                <label>Bay</label>
                <select value={bookBay} onChange={(e) => setBookBay(e.target.value)}>
                  {BAYS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="portal-book-row" style={{ flex: 1 }}>
                  <label>Start</label>
                  <select value={bookStart} onChange={(e) => setBookStart(e.target.value)}>
                    {HOURS.map((h) => <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>)}
                  </select>
                </div>
                <div className="portal-book-row" style={{ flex: 1 }}>
                  <label>End</label>
                  <select value={bookEnd} onChange={(e) => setBookEnd(e.target.value)}>
                    {HOURS.filter((h) => h > bookStart).map((h) => <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>)}
                  </select>
                </div>
              </div>

              {bookDuration > 0 && (
                <div style={{ fontSize: 13, opacity: 0.7, margin: "8px 0" }}>
                  Duration: {bookDuration.toFixed(1)} hours
                </div>
              )}

              {slotConflict && (
                <div className="portal-err" style={{ marginTop: 8 }}>
                  This time slot is already booked on {bookBay}. Please select a different time.
                </div>
              )}

              {bookMsg && <div className="portal-err" style={{ marginTop: 8 }}>{bookMsg}</div>}

              <button
                className="portal-book-btn"
                onClick={handleBook}
                disabled={booking || slotConflict || bookDuration <= 0}
              >
                {booking ? "Booking..." : "Confirm Booking"}
              </button>
            </div>
          </div>

          {/* Availability Grid */}
          <div className="portal-section">
            <div className="portal-section-head">Availability &mdash; {fDL(new Date(bookDate + "T12:00:00"))}</div>
            <div className="portal-avail-grid">
              <div className="portal-avail-hdr">Time</div>
              {BAYS.map((b) => <div key={b} className="portal-avail-hdr">{b}</div>)}
              {HOURS.filter((_, i) => i < HOURS.length - 1).map((h, i) => {
                const nextH = HOURS[i + 1];
                return (
                  <div key={h} style={{ display: "contents" }}>
                    <div className="portal-avail-time">{fT(new Date(`2026-01-01T${h}:00`))}</div>
                    {BAYS.map((bay) => {
                      const taken = isSlotTaken(bay, h, nextH);
                      return (
                        <div
                          key={bay}
                          className={`portal-avail-cell ${taken ? "taken" : "open"}`}
                          onClick={() => {
                            if (!taken) {
                              setBookBay(bay);
                              setBookStart(h);
                              setBookEnd(nextH);
                            }
                          }}
                        >
                          {taken ? "Booked" : "Open"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`portal-toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
