import { useState, useEffect, useMemo } from "react";
import { BAYS, TZ } from "../../lib/constants";
import { fT, fDL } from "../../lib/format";

const ALL_HOURS = [];
for (let h = 7; h <= 21; h++) {
  for (let m = 0; m < 60; m += 30) {
    ALL_HOURS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

export default function MemberBooking({ member, tierConfig, refresh, showToast }) {
  const isNonMember = member.tier === "Non-Member";

  // Non-members: 10:00 AM - 8:00 PM only. Members: full range.
  const HOURS = useMemo(() => {
    if (isNonMember) return ALL_HOURS.filter((h) => h >= "10:00" && h <= "20:00");
    return ALL_HOURS;
  }, [isNonMember]);

  const [bookDate, setBookDate] = useState(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  });
  const [bookStart, setBookStart] = useState(isNonMember ? "10:00" : "10:00");
  const [bookEnd, setBookEnd] = useState(isNonMember ? "11:00" : "11:00");
  const [bookBay, setBookBay] = useState("Bay 1");
  const [availability, setAvailability] = useState([]);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState("");

  // Load availability when date changes
  useEffect(() => {
    if (!bookDate) return;
    fetch(`/api/customer-availability?date=${bookDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAvailability(d.bookings || []))
      .catch(() => setAvailability([]));
  }, [bookDate]);

  function isSlotTaken(bay, startStr, endStr) {
    const s = new Date(`${bookDate}T${startStr}:00`);
    const e = new Date(`${bookDate}T${endStr}:00`);
    return availability.some(
      (b) => b.bay === bay && new Date(b.booking_start) < e && new Date(b.booking_end) > s
    );
  }

  const bookDuration = bookStart && bookEnd
    ? Math.max(0, (new Date(`${bookDate}T${bookEnd}:00`) - new Date(`${bookDate}T${bookStart}:00`)) / 3600000)
    : 0;

  const slotConflict = bookStart && bookEnd && isSlotTaken(bookBay, bookStart, bookEnd);

  async function handleBook() {
    setBooking(true);
    setBookMsg("");
    try {
      const r = await fetch("/api/customer-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
      // Reset form so the just-booked slot doesn't trigger a conflict error
      setBookStart(isNonMember ? "10:00" : "10:00");
      setBookEnd(isNonMember ? "11:00" : "11:00");
      setBookBay("Bay 1");
      // Refresh availability
      fetch(`/api/customer-availability?date=${bookDate}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setAvailability(d.bookings || []))
        .catch(() => {});
    } catch (err) {
      setBookMsg(err.message);
    }
    setBooking(false);
  }

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

  return (
    <>
      {isNonMember && (
        <div className="mem-info-banner">
          \u23f0 Non-member bookings available <strong>10 AM \u2013 8 PM</strong>.{" "}
          <a href="/members/billing">Upgrade your membership</a> for 24/7 access.
        </div>
      )}

      <div className="mem-section">
        <div className="mem-section-head">Book a Bay</div>

        <div className="mem-book-form">
          <div className="mem-form-row">
            <label>Date</label>
            <input
              type="date"
              value={bookDate}
              min={todayStr}
              onChange={(e) => setBookDate(e.target.value)}
            />
          </div>
          <div className="mem-form-row">
            <label>Bay</label>
            <select value={bookBay} onChange={(e) => setBookBay(e.target.value)}>
              {BAYS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="mem-form-row" style={{ flex: 1 }}>
              <label>Start</label>
              <select value={bookStart} onChange={(e) => setBookStart(e.target.value)}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>
                ))}
              </select>
            </div>
            <div className="mem-form-row" style={{ flex: 1 }}>
              <label>End</label>
              <select value={bookEnd} onChange={(e) => setBookEnd(e.target.value)}>
                {HOURS.filter((h) => h > bookStart).map((h) => (
                  <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>
                ))}
              </select>
            </div>
          </div>

          {bookDuration > 0 && (
            <div style={{ fontSize: 13, opacity: 0.7, margin: "8px 0" }}>
              Duration: {bookDuration.toFixed(1)} hours
            </div>
          )}

          {slotConflict && (
            <div className="mem-err" style={{ marginTop: 8 }}>
              This time slot is already booked on {bookBay}. Please select a different time.
            </div>
          )}

          {bookMsg && <div className="mem-err" style={{ marginTop: 8 }}>{bookMsg}</div>}

          <button
            className="mem-book-btn"
            onClick={handleBook}
            disabled={booking || slotConflict || bookDuration <= 0}
          >
            {booking ? "Booking..." : "Confirm Booking"}
          </button>
        </div>
      </div>

      {/* Availability Grid */}
      <div className="mem-section">
        <div className="mem-section-head">
          Availability &mdash; {fDL(new Date(bookDate + "T12:00:00"))}
        </div>
        <div className="mem-avail-grid">
          <div className="mem-avail-hdr">Time</div>
          {BAYS.map((b) => <div key={b} className="mem-avail-hdr">{b}</div>)}
          {HOURS.filter((_, i) => i < HOURS.length - 1).map((h, i) => {
            const nextH = HOURS[i + 1];
            return (
              <div key={h} style={{ display: "contents" }}>
                <div className="mem-avail-time">{fT(new Date(`2026-01-01T${h}:00`))}</div>
                {BAYS.map((bay) => {
                  const taken = isSlotTaken(bay, h, nextH);
                  return (
                    <div
                      key={bay}
                      className={`mem-avail-cell ${taken ? "taken" : "open"}`}
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
    </>
  );
}
