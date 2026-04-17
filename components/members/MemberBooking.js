import { useState, useEffect, useMemo } from "react";
import { BAYS, TZ } from "../../lib/constants";
import { fT, fDL } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";

function buildHours(startHour, endHour) {
  const hours = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      hours.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  hours.push(`${String(endHour).padStart(2, "0")}:00`);
  return hours;
}

// Get current time in Pacific as "HH:MM"
function nowPacific() {
  const d = new Date();
  const parts = d.toLocaleString("en-US", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" }).split(":");
  return `${parts[0].padStart(2, "0")}:${parts[1]}`;
}

export default function MemberBooking({ member, tierConfig, refresh, showToast }) {
  const isNonMember = member.tier === "Non-Member";
  const hasCard = member.hasPaymentMethod;
  const branding = useBranding();

  const bookStart = Number(tierConfig?.booking_hours_start ?? (isNonMember ? 10 : 0));
  const bookEnd = Number(tierConfig?.booking_hours_end ?? (isNonMember ? 20 : 24));

  const ALL_HOURS = useMemo(() => {
    return buildHours(bookStart, Math.min(bookEnd, 24));
  }, [bookStart, bookEnd]);

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 7);
  const maxDateStr = maxDate.toLocaleDateString("en-CA", { timeZone: TZ });

  const [bookDate, setBookDate] = useState(todayStr);
  const defaultStart = ALL_HOURS.length > 0 ? ALL_HOURS[0] : "10:00";
  const defaultEnd = ALL_HOURS.length > 4 ? ALL_HOURS[4] : ALL_HOURS[ALL_HOURS.length - 1] || "11:00";
  const [bookStartTime, setBookStartTime] = useState(defaultStart);
  const [bookEndTime, setBookEndTime] = useState(defaultEnd);
  const [bookBay, setBookBay] = useState("Bay 1");
  const [availability, setAvailability] = useState([]);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Filter hours: if booking today, hide times that have already passed
  const isToday = bookDate === todayStr;
  const currentTime = nowPacific();
  const HOURS = useMemo(() => {
    if (!isToday) return ALL_HOURS;
    return ALL_HOURS.filter((h) => h >= currentTime);
  }, [ALL_HOURS, isToday, currentTime]);

  // Load availability when date changes
  useEffect(() => {
    if (!bookDate) return;
    fetch(`/api/customer-availability?date=${bookDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAvailability(d.bookings || []))
      .catch(() => setAvailability([]));
  }, [bookDate]);

  // When date changes to today and start time is in the past, auto-advance
  useEffect(() => {
    if (isToday && bookStartTime < currentTime && HOURS.length > 0) {
      setBookStartTime(HOURS[0]);
      if (HOURS.length > 4) setBookEndTime(HOURS[4]);
      else setBookEndTime(HOURS[HOURS.length - 1]);
    }
  }, [bookDate]);

  function isSlotTaken(bay, startStr, endStr) {
    const s = new Date(`${bookDate}T${startStr}:00`);
    const e = new Date(`${bookDate}T${endStr}:00`);
    return availability.some(
      (b) => b.bay === bay && new Date(b.booking_start) < e && new Date(b.booking_end) > s
    );
  }

  const bookDuration = bookStartTime && bookEndTime
    ? Math.max(0, (new Date(`${bookDate}T${bookEndTime}:00`) - new Date(`${bookDate}T${bookStartTime}:00`)) / 3600000)
    : 0;

  const slotConflict = bookStartTime && bookEndTime && isSlotTaken(bookBay, bookStartTime, bookEndTime);

  // Check if selected date is valid (not past, not > 7 days out)
  const dateInPast = bookDate < todayStr;
  const dateTooFar = bookDate > maxDateStr;
  const timeInPast = isToday && bookStartTime < currentTime;

  async function handleBook() {
    // Client-side validation
    if (dateInPast) { setBookMsg("Cannot book in the past."); return; }
    if (dateTooFar) { setBookMsg("Bookings can only be made up to 7 days in advance."); return; }
    if (timeInPast) { setBookMsg("This time has already passed. Please select a later time."); return; }

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
          startTime: bookStartTime,
          endTime: bookEndTime,
          bay: bookBay,
          terms_accepted: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "Booking failed");
      showToast("Booking confirmed!");
      setBookStartTime(HOURS.length > 0 ? HOURS[0] : defaultStart);
      setBookEndTime(HOURS.length > 4 ? HOURS[4] : HOURS[HOURS.length - 1] || defaultEnd);
      setBookBay("Bay 1");
      setTermsAccepted(false);
      fetch(`/api/customer-availability?date=${bookDate}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setAvailability(d.bookings || []))
        .catch(() => {});
    } catch (err) {
      setBookMsg(err.message);
    }
    setBooking(false);
  }

  // Clamp date when user selects via calendar
  function handleDateChange(e) {
    let val = e.target.value;
    if (val < todayStr) val = todayStr;
    if (val > maxDateStr) val = maxDateStr;
    setBookDate(val);
  }

  return (
    <>
      {!hasCard && (
        <div className="mem-info-banner" style={{ background: "rgba(201,47,31,0.07)", borderColor: "rgba(201,47,31,0.2)", color: "#C92F1F" }}>
          {"\u26a0\ufe0f"} A payment method is required before booking.{" "}
          <a href="/members/billing" style={{ color: "#C92F1F" }}>Add a card on the Billing page</a> to get started.
        </div>
      )}

      {isNonMember && hasCard && (
        <div className="mem-info-banner">
          {"\u23f0"} Non-member bookings available <strong>{bookStart === 0 ? "12 AM" : bookStart < 12 ? `${bookStart} AM` : bookStart === 12 ? "12 PM" : `${bookStart - 12} PM`} {"\u2013"} {bookEnd === 24 ? "12 AM" : bookEnd < 12 ? `${bookEnd} AM` : bookEnd === 12 ? "12 PM" : `${bookEnd - 12} PM`}</strong>.{" "}
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
              max={maxDateStr}
              onChange={handleDateChange}
            />
          </div>
          {(dateInPast || dateTooFar) && (
            <div className="mem-err" style={{ marginTop: 4, fontSize: 12 }}>
              {dateInPast ? "Cannot book in the past." : "Bookings limited to 7 days out."}
            </div>
          )}
          <div className="mem-form-row">
            <label>Bay</label>
            <select value={bookBay} onChange={(e) => setBookBay(e.target.value)}>
              {BAYS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="mem-time-row" style={{ display: "flex", gap: 12 }}>
            <div className="mem-form-row" style={{ flex: 1 }}>
              <label>Start</label>
              <select value={bookStartTime} onChange={(e) => setBookStartTime(e.target.value)}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>
                ))}
              </select>
            </div>
            <div className="mem-form-row" style={{ flex: 1 }}>
              <label>End</label>
              <select value={bookEndTime} onChange={(e) => setBookEndTime(e.target.value)}>
                {HOURS.filter((h) => h > bookStartTime).map((h) => (
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

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-muted)", marginTop: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#4C8D73" }}
            />
            <span>
              I agree to the {branding?.legal_url ? <a href={branding.legal_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>Terms &amp; Conditions</a> : <span style={{ fontWeight: 600 }}>Terms &amp; Conditions</span>} and {branding?.terms_url ? <a href={branding.terms_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>Club Policies</a> : <span style={{ fontWeight: 600 }}>Club Policies</span>}
            </span>
          </label>

          <button
            className="mem-book-btn"
            onClick={handleBook}
            disabled={booking || slotConflict || bookDuration <= 0 || !termsAccepted || !hasCard || dateInPast || dateTooFar}
          >
            {booking ? "Booking..." : "Confirm Booking."}
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
          {ALL_HOURS.filter((h, i) => i < ALL_HOURS.length - 1 && !(isToday && h < currentTime)).map((h) => {
  const nextH = ALL_HOURS[ALL_HOURS.indexOf(h) + 1];
            const isPast = isToday && h < currentTime;
            return (
              <div key={h} style={{ display: "contents", opacity: isPast ? 0.35 : 1 }}>
                <div className="mem-avail-time">{fT(new Date(`2026-01-01T${h}:00`))}</div>
                {BAYS.map((bay) => {
                  const taken = isSlotTaken(bay, h, nextH);
                  return (
                    <div
                      key={bay}
                      className={`mem-avail-cell ${taken ? "taken" : isPast ? "taken" : "open"}`}
                      onClick={() => {
                        if (!taken && !isPast) {
                          setBookBay(bay);
                          setBookStartTime(h);
                          setBookEndTime(nextH);
                        }
                      }}
                    >
                      {taken ? "Booked" : isPast ? "Past" : "Open"}
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
