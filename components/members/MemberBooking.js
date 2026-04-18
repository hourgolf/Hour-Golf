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

  // Quick-book sheet state — opened by tapping an availability cell.
  // Keeps its own bay/start/end/terms so the top form isn't clobbered.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBay, setSheetBay] = useState("Bay 1");
  const [sheetStart, setSheetStart] = useState(defaultStart);
  const [sheetEnd, setSheetEnd] = useState(defaultEnd);
  const [sheetTerms, setSheetTerms] = useState(false);
  const [sheetBooking, setSheetBooking] = useState(false);
  const [sheetMsg, setSheetMsg] = useState("");

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

  // Shared POST to /api/customer-book. Callers handle their own UI reset.
  async function postBooking({ date, startTime, endTime, bay }) {
    const r = await fetch("/api/customer-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: member.email,
        name: member.name,
        date,
        startTime,
        endTime,
        bay,
        terms_accepted: true,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || d.detail || "Booking failed");
    return d;
  }

  function refetchAvailability() {
    fetch(`/api/customer-availability?date=${bookDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAvailability(d.bookings || []))
      .catch(() => {});
  }

  async function handleBook() {
    // Client-side validation
    if (dateInPast) { setBookMsg("Cannot book in the past."); return; }
    if (dateTooFar) { setBookMsg("Bookings can only be made up to 7 days in advance."); return; }
    if (timeInPast) { setBookMsg("This time has already passed. Please select a later time."); return; }

    setBooking(true);
    setBookMsg("");
    try {
      await postBooking({ date: bookDate, startTime: bookStartTime, endTime: bookEndTime, bay: bookBay });
      showToast("\u2713 Booking confirmed! Check your email.");
      // Advance to the slot right after what was just booked so the form
      // doesn't immediately show a red conflict against the new booking.
      const justBookedDurationSlots = Math.max(
        1,
        HOURS.indexOf(bookEndTime) - HOURS.indexOf(bookStartTime)
      );
      const advancedStartIdx = HOURS.indexOf(bookEndTime);
      if (advancedStartIdx >= 0 && advancedStartIdx + 1 < HOURS.length) {
        setBookStartTime(HOURS[advancedStartIdx]);
        const advancedEndIdx = Math.min(
          advancedStartIdx + justBookedDurationSlots,
          HOURS.length - 1
        );
        setBookEndTime(HOURS[advancedEndIdx]);
      } else {
        setBookStartTime(HOURS.length > 0 ? HOURS[0] : defaultStart);
        setBookEndTime(HOURS.length > 4 ? HOURS[4] : HOURS[HOURS.length - 1] || defaultEnd);
      }
      setBookBay("Bay 1");
      setTermsAccepted(false);
      refetchAvailability();
    } catch (err) {
      setBookMsg(err.message);
    }
    setBooking(false);
  }

  // ---- Quick-book sheet ---------------------------------------------------

  function openSheet(bay, h) {
    setSheetBay(bay);
    setSheetStart(h);
    // Default to a 1-hour booking (4 x 15-min slots) when possible.
    const idx = ALL_HOURS.indexOf(h);
    const endIdx = idx >= 0 ? Math.min(idx + 4, ALL_HOURS.length - 1) : -1;
    setSheetEnd(endIdx > idx ? ALL_HOURS[endIdx] : (idx + 1 < ALL_HOURS.length ? ALL_HOURS[idx + 1] : h));
    setSheetTerms(false);
    setSheetMsg("");
    setSheetOpen(true);
  }

  function closeSheet() {
    if (sheetBooking) return;
    setSheetOpen(false);
    setSheetMsg("");
  }

  const sheetDurationHrs = sheetStart && sheetEnd
    ? Math.max(0, (new Date(`${bookDate}T${sheetEnd}:00`) - new Date(`${bookDate}T${sheetStart}:00`)) / 3600000)
    : 0;

  const sheetConflict = sheetStart && sheetEnd && isSlotTaken(sheetBay, sheetStart, sheetEnd);

  // Preset durations offered as chips (in hours).
  const DURATION_PRESETS = [0.5, 1, 1.5, 2];

  function applyDuration(hours) {
    const startIdx = ALL_HOURS.indexOf(sheetStart);
    if (startIdx < 0) return;
    const slotsNeeded = Math.round(hours * 4); // 15-min slots per hour
    const endIdx = Math.min(startIdx + slotsNeeded, ALL_HOURS.length - 1);
    setSheetEnd(ALL_HOURS[endIdx]);
  }

  function setSheetStartClamped(newStart) {
    setSheetStart(newStart);
    // If new start >= current end, push end to start + 15min.
    const startIdx = ALL_HOURS.indexOf(newStart);
    const endIdx = ALL_HOURS.indexOf(sheetEnd);
    if (endIdx <= startIdx) {
      setSheetEnd(ALL_HOURS[Math.min(startIdx + 1, ALL_HOURS.length - 1)]);
    }
  }

  async function submitSheet() {
    setSheetMsg("");
    if (dateInPast) { setSheetMsg("Cannot book in the past."); return; }
    if (dateTooFar) { setSheetMsg("Bookings are limited to 7 days in advance."); return; }
    if (isToday && sheetStart < currentTime) { setSheetMsg("That time has already passed."); return; }
    setSheetBooking(true);
    try {
      await postBooking({ date: bookDate, startTime: sheetStart, endTime: sheetEnd, bay: sheetBay });
      showToast("\u2713 Booking confirmed! Check your email.");
      setSheetOpen(false);
      refetchAvailability();
    } catch (err) {
      setSheetMsg(err.message);
    }
    setSheetBooking(false);
  }

  // Lock body scroll while sheet is open.
  useEffect(() => {
    if (!sheetOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, [sheetOpen]);

  const canSubmitSheet = hasCard
    && !sheetBooking
    && !sheetConflict
    && sheetDurationHrs > 0
    && sheetTerms
    && !dateInPast
    && !dateTooFar;

  const supportContact = branding?.support_email
    ? branding.support_email
    : (branding?.support_phone || null);

  // Accept the user's raw selection so out-of-range dates surface the
  // existing error message instead of silently snapping to day 7.
  function handleDateChange(e) {
    const val = e.target.value;
    if (!val) return;
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
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Book up to 7 days in advance.
            </div>
          </div>
          {(dateInPast || dateTooFar) && (
            <div className="mem-err" style={{ marginTop: 4, fontSize: 12 }}>
              {dateInPast ? "Cannot book in the past." : "Bookings are limited to 7 days in advance. Please pick an earlier date."}
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
                        if (!taken && !isPast && hasCard) openSheet(bay, h);
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

      {sheetOpen && (
        <div className="mem-sheet-backdrop" onClick={closeSheet}>
          <div className="mem-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="mem-sheet-head">
              <div className="mem-sheet-title">Confirm booking</div>
              <button type="button" className="mem-sheet-close" onClick={closeSheet} aria-label="Close">&times;</button>
            </div>
            <div className="mem-sheet-body">
              <div className="mem-sheet-summary">
                <div className="mem-sheet-summary-bay">{sheetBay}</div>
                <div className="mem-sheet-summary-date">{fDL(new Date(bookDate + "T12:00:00"))}</div>
                <div className="mem-sheet-summary-time">
                  {fT(new Date(`2026-01-01T${sheetStart}:00`))} &ndash; {fT(new Date(`2026-01-01T${sheetEnd}:00`))}
                  <span className="mem-sheet-summary-dur">&nbsp;&middot; {sheetDurationHrs.toFixed(sheetDurationHrs % 1 === 0 ? 0 : 1)} hr</span>
                </div>
              </div>

              <div className="mem-sheet-section">
                <div className="mem-sheet-label">Bay</div>
                <div className="mem-sheet-chips">
                  {BAYS.map((b) => (
                    <button
                      type="button"
                      key={b}
                      className={`mem-sheet-chip ${sheetBay === b ? "active" : ""}`}
                      onClick={() => setSheetBay(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mem-sheet-section">
                <div className="mem-sheet-label">Duration</div>
                <div className="mem-sheet-chips">
                  {DURATION_PRESETS.map((hrs) => (
                    <button
                      type="button"
                      key={hrs}
                      className={`mem-sheet-chip ${Math.abs(sheetDurationHrs - hrs) < 0.01 ? "active" : ""}`}
                      onClick={() => applyDuration(hrs)}
                    >
                      {hrs === 0.5 ? "30m" : `${hrs}h`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mem-sheet-section">
                <div className="mem-sheet-label">Fine-tune (15-min increments)</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div className="mem-form-row" style={{ flex: 1, margin: 0 }}>
                    <label>Start</label>
                    <select value={sheetStart} onChange={(e) => setSheetStartClamped(e.target.value)}>
                      {HOURS.map((h) => (
                        <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mem-form-row" style={{ flex: 1, margin: 0 }}>
                    <label>End</label>
                    <select value={sheetEnd} onChange={(e) => setSheetEnd(e.target.value)}>
                      {ALL_HOURS.filter((h) => h > sheetStart).map((h) => (
                        <option key={h} value={h}>{fT(new Date(`2026-01-01T${h}:00`))}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {sheetConflict && (
                <div className="mem-err" style={{ marginTop: 4 }}>
                  That time on {sheetBay} is already booked. Pick another slot.
                </div>
              )}

              <div className="mem-sheet-policy">
                <div><strong>Cancellation:</strong> Cancellations within 3 hours of your booking may be charged a fee.</div>
                <div><strong>Access code:</strong> A door code will be emailed to you about 10 minutes before your start time.</div>
                {supportContact && (
                  <div><strong>Need to change something?</strong> Reach out at {supportContact}.</div>
                )}
              </div>

              <label className="mem-sheet-terms">
                <input
                  type="checkbox"
                  checked={sheetTerms}
                  onChange={(e) => setSheetTerms(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#4C8D73" }}
                />
                <span>
                  I agree to the {branding?.legal_url ? <a href={branding.legal_url} target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a> : <strong>Terms &amp; Conditions</strong>} and {branding?.terms_url ? <a href={branding.terms_url} target="_blank" rel="noopener noreferrer">Club Policies</a> : <strong>Club Policies</strong>}.
                </span>
              </label>

              {sheetMsg && <div className="mem-err" style={{ marginTop: 4 }}>{sheetMsg}</div>}
            </div>

            <div className="mem-sheet-actions">
              <button type="button" className="mem-sheet-cancel" onClick={closeSheet} disabled={sheetBooking}>
                Cancel
              </button>
              <button
                type="button"
                className="mem-book-btn"
                onClick={submitSheet}
                disabled={!canSubmitSheet}
                style={{ flex: 2, margin: 0 }}
              >
                {sheetBooking ? "Booking\u2026" : "Confirm booking"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
