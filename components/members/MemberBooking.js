import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { TZ } from "../../lib/constants";
import { fT, fDL } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays, resolveBayLabel } from "../../lib/branding";
import DatePicker from "../DatePicker";

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
  const router = useRouter();
  const isNonMember = member.tier === "Non-Member";
  const hasCard = member.hasPaymentMethod;
  const branding = useBranding();
  // Per-tenant bay list + label noun. Default to "Bay" so the existing
  // copy ("Book a Bay", "Confirm booking") reads correctly for HG. New
  // tenants using "Court", "Sim", etc. get their noun in the section
  // headers below.
  const BAYS = useMemo(() => resolveBays(branding), [branding]);
  const bayLabel = resolveBayLabel(branding);
  const bayLabelLower = bayLabel.toLowerCase();

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
  const [bookBay, setBookBay] = useState(BAYS[0] || "Bay 1");
  const [availability, setAvailability] = useState([]);
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Quick-book sheet state — opened by tapping an availability cell.
  // Keeps its own bay/start/end/terms so the top form isn't clobbered.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBay, setSheetBay] = useState(BAYS[0] || "Bay 1");
  const [sheetStart, setSheetStart] = useState(defaultStart);
  const [sheetEnd, setSheetEnd] = useState(defaultEnd);
  const [sheetTerms, setSheetTerms] = useState(false);
  const [sheetBooking, setSheetBooking] = useState(false);
  const [sheetMsg, setSheetMsg] = useState("");

  // Post-booking success panel — replaces the inline form after a
  // successful submit so the form can't redraw a stale "slot conflict"
  // red error against the booking the member just made (the previous
  // auto-advance reset sometimes landed on a slot that conflicted with
  // an unrelated existing booking, flashing red right after a success
  // toast — confusing).
  const [bookSuccess, setBookSuccess] = useState(null);


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
  // 30s AbortController so a hung network (e.g. flaky webview in
  // Google's in-app browser) surfaces a clear error instead of an
  // infinite spinner. Server has a 30s maxDuration so the actual
  // backend timeout shows up before this client one.
  async function postBooking({ date, startTime, endTime, bay }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch("/api/customer-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
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
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || d.detail || `Booking failed (HTTP ${r.status})`);
      return d;
    } catch (e) {
      if (e?.name === "AbortError") {
        throw new Error("Booking is taking longer than expected. Check your connection and try again — your browser's in-app webview may be slowing things down. Try opening hour.golf in your full browser if this keeps happening.");
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
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
      // Swap the form for a success panel. Holding the booking details
      // here (date / start / end / bay) lets the panel show what was
      // booked without depending on form state that we'd otherwise reset.
      setBookSuccess({
        date: bookDate,
        startTime: bookStartTime,
        endTime: bookEndTime,
        bay: bookBay,
      });
      setTermsAccepted(false);
      refetchAvailability();
    } catch (err) {
      setBookMsg(err.message);
    }
    setBooking(false);
  }

  // "Book another" — clears the success panel and resets the form to a
  // sensible non-conflicting starting point (the slot right after the
  // one just booked). Falls back to first bookable hour when the just-
  // booked end was the last slot of the day.
  function resetForBookAnother() {
    if (!bookSuccess) { setBookSuccess(null); return; }
    const advancedStartIdx = HOURS.indexOf(bookSuccess.endTime);
    if (advancedStartIdx >= 0 && advancedStartIdx + 1 < HOURS.length) {
      setBookStartTime(HOURS[advancedStartIdx]);
      const dur = Math.max(1, HOURS.indexOf(bookSuccess.endTime) - HOURS.indexOf(bookSuccess.startTime));
      const advancedEndIdx = Math.min(advancedStartIdx + dur, HOURS.length - 1);
      setBookEndTime(HOURS[advancedEndIdx]);
    } else {
      setBookStartTime(HOURS[0] || defaultStart);
      setBookEndTime(HOURS[4] || HOURS[HOURS.length - 1] || defaultEnd);
    }
    setBookBay(BAYS[0] || "Bay 1");
    setBookSuccess(null);
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

  // Open the sheet with sensible defaults instead of a grid-cell context.
  // Used by the global "+" Book FAB via ?new=1. Picks Bay 1 + the first
  // bookable slot (which HOURS already filters to "now" for today).
  function openSheetFresh() {
    const firstHour = HOURS.length > 0 ? HOURS[0] : defaultStart;
    openSheet(BAYS[0] || "Bay 1", firstHour);
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

  // Auto-open the sheet when the "+" Book FAB pushes /members/book?new=1.
  // Strip the query param afterward so tabbing away and back doesn't
  // keep re-triggering. Guarded by !sheetOpen so we don't reset a
  // user-in-progress sheet.
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.new && !sheetOpen && hasCard) {
      openSheetFresh();
      const { new: _drop, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query.new, hasCard]);

  // Public-book funnel: /book?bay=...&date=...&start=... → sign up →
  // /members/book?bay=...&date=...&start=... lands here. Pre-select
  // the slot so the member sees "your slot is ready" instead of a
  // blank form. Falls back to sessionStorage so a billing round-trip
  // (add a card first) doesn't drop the intent.
  //
  // Order of operations:
  //   1. Prefer URL params (fresh from the funnel).
  //   2. Else read sessionStorage (set at signup redirect + kept
  //      until consumed OR 30 min elapsed).
  //   3. Set bookDate (re-fetches availability), then open the sheet
  //      pre-filled. openSheet picks end = start + 1h.
  //   4. Without a card on file: leave the slot in sessionStorage and
  //      DON'T open the sheet — the existing "Add a card" banner takes
  //      over. After adding the card the member comes back and the
  //      effect re-fires from storage.
  useEffect(() => {
    if (!router.isReady || sheetOpen) return;

    let intent = null;
    const { bay: qBay, date: qDate, start: qStart } = router.query;
    if (qBay && qDate && qStart) {
      intent = { bay: String(qBay), date: String(qDate), start: String(qStart) };
    } else if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("hg-intended-slot");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            parsed?.bay && parsed?.date && parsed?.start &&
            Date.now() - (parsed.stashedAt || 0) < 30 * 60 * 1000
          ) {
            intent = { bay: parsed.bay, date: parsed.date, start: parsed.start };
          } else {
            sessionStorage.removeItem("hg-intended-slot");
          }
        }
      } catch { /* non-fatal */ }
    }

    if (!intent) return;
    // Reject unknown bays (tenant bay list may have changed since the
    // intent was stashed) and unknown start times (falls outside the
    // current day's HOURS window).
    if (!BAYS.includes(intent.bay)) return;

    // Set the date first so availability reloads for the right day.
    setBookDate(intent.date);

    if (!hasCard) {
      // Keep storage so they come back after adding a card.
      try {
        sessionStorage.setItem(
          "hg-intended-slot",
          JSON.stringify({ ...intent, stashedAt: Date.now() })
        );
      } catch { /* non-fatal */ }
      // Strip URL query to avoid re-triggering on every re-render,
      // but DON'T open the sheet since they can't submit it yet.
      if (router.query.bay) {
        const { bay: _b, date: _d, start: _s, ...rest } = router.query;
        router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
      }
      return;
    }

    // Happy path — open the sheet with the slot pre-filled.
    openSheet(intent.bay, intent.start);
    try { sessionStorage.removeItem("hg-intended-slot"); } catch { /* ignore */ }
    if (router.query.bay) {
      const { bay: _b, date: _d, start: _s, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query.bay, router.query.date, router.query.start, hasCard, BAYS]);

  // If the member changes the date while the sheet is open, the previous
  // sheetStart / sheetEnd can fall outside the new day's HOURS window
  // (most obvious when flipping today <-> a future date: today's HOURS
  // strips past times). Reset to the first bookable slot so the select
  // dropdowns always render a valid selection.
  useEffect(() => {
    if (!sheetOpen) return;
    if (!HOURS.includes(sheetStart)) {
      const first = HOURS[0] || defaultStart;
      setSheetStart(first);
      const fallbackEnd = HOURS[4] || HOURS[HOURS.length - 1] || defaultEnd;
      setSheetEnd(fallbackEnd);
    }
  }, [bookDate]);

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
  // Tap-to-contact helper for the sheet's policy line. Mirrors the
  // pattern used on the dashboard: prefer email so members get a written
  // paper trail; fall back to phone; renders as plain text if neither
  // is configured for the tenant.
  const supportLink = branding?.support_email
    ? `mailto:${branding.support_email}`
    : branding?.support_phone
    ? `tel:${branding.support_phone.replace(/[^0-9+]/g, "")}`
    : null;


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

      {/* Inline form — desktop-only after mobile polish; mobile users
          drive everything from the availability grid + sheet, which has
          presets, chips, and a clearer summary. */}
      <div className="mem-section mem-book-inline">
        <div className="mem-section-head">Book a {bayLabel}</div>

        {bookSuccess ? (
          (() => {
            const s = new Date(`${bookSuccess.date}T${bookSuccess.startTime}:00`);
            const e = new Date(`${bookSuccess.date}T${bookSuccess.endTime}:00`);
            return (
              <div className="mem-book-success">
                <div className="mem-book-success-icon" aria-hidden="true">✓</div>
                <div className="mem-book-success-title">Booked.</div>
                <div className="mem-book-success-when">
                  {fT(s)} – {fT(e)} <span className="mem-book-success-bay">· {bookSuccess.bay}</span>
                </div>
                <div className="mem-book-success-date">{fDL(new Date(`${bookSuccess.date}T12:00:00`))}</div>
                <div className="mem-book-success-meta">
                  🔑 We'll email your access code about 10 min before start.
                </div>
                <div className="mem-book-success-actions">
                  <button className="mem-book-btn" style={{ marginTop: 0, flex: 1 }} onClick={resetForBookAnother}>
                    Book another
                  </button>
                  <button
                    className="mem-btn"
                    style={{ flex: 1, marginTop: 0 }}
                    onClick={() => router.push("/members/dashboard")}
                  >
                    View dashboard
                  </button>
                </div>
              </div>
            );
          })()
        ) : (
        <div className="mem-book-form">
          <div className="mem-form-row">
            <label>Date</label>
            <DatePicker
              value={bookDate}
              onChange={setBookDate}
              min={todayStr}
              max={maxDateStr}
              timezone={TZ}
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
            <label>{bayLabel}</label>
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
        )}
      </div>

      {/* Availability Grid */}
      <div className="mem-section">
        {/* Sticky day-bar — keeps the date + a quick picker visible while
            the member scrolls the long availability grid. On mobile this
            replaces the inline form's date picker entirely. */}
        <div className="mem-grid-date-bar">
          <div className="mem-grid-date-bar-label">{fDL(new Date(bookDate + "T12:00:00"))}</div>
          <div className="mem-grid-date-bar-picker">
            <DatePicker
              value={bookDate}
              onChange={setBookDate}
              min={todayStr}
              max={maxDateStr}
              timezone={TZ}
            />
          </div>
        </div>
        <div className="mem-section-head" style={{ marginTop: 4 }}>
          Availability
        </div>
        {/* gridTemplateColumns inlined so the grid adapts to whatever
            bays the tenant has configured. Default CSS rule assumes 2
            bays (80px + 1fr + 1fr); this lets a 4-bay tenant render
            cleanly without a second media-query block. The 80/60/50
            time-column widths from globals.css still apply at
            different breakpoints because we don't override the column
            type, only the count. */}
        <div
          className="mem-avail-grid"
          style={{ gridTemplateColumns: `80px ${BAYS.map(() => "1fr").join(" ")}` }}
        >
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
                <div className="mem-sheet-label">Date</div>
                <DatePicker
                  value={bookDate}
                  onChange={setBookDate}
                  min={todayStr}
                  max={maxDateStr}
                  timezone={TZ}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Book up to 7 days in advance.
                </div>
              </div>

              <div className="mem-sheet-section">
                <div className="mem-sheet-label">{bayLabel}</div>
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
                  <div>
                    <strong>Need to change something?</strong>{" "}
                    {supportLink ? (
                      <a href={supportLink} style={{ color: "var(--primary)", fontWeight: 600 }}>
                        {supportContact}
                      </a>
                    ) : (
                      <>Reach out at {supportContact}.</>
                    )}
                  </div>
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
