import { useEffect, useMemo, useRef, useState } from "react";
import { TZ } from "../../lib/constants";
import { fT, fDL, lds, tds, hrs } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { useIsMobile } from "../../hooks/useIsMobile";
import { resolveBays, resolveBayLabel } from "../../lib/branding";
import Badge from "../ui/Badge";
import KPIStrip from "../ui/KPIStrip";
import StatusBadge from "../ui/StatusBadge";
import DayTimeline from "./DayTimeline";

// Tight countdown helper used by the "Right now" + "Up next" callouts.
// Stays terse (no padding, no leading words) because it sits inside
// chips with limited horizontal space.
function fmtCountdown(ms) {
  if (ms <= 0) return "starts now";
  const totalMin = Math.floor(ms / 60000);
  const hrsPart = Math.floor(totalMin / 60);
  const minsPart = totalMin % 60;
  if (hrsPart === 0) return `${minsPart}m`;
  return `${hrsPart}h ${minsPart}m`;
}

function fmtRemaining(ms) {
  if (ms <= 0) return "wrapping up";
  const totalMin = Math.floor(ms / 60000);
  const hrsPart = Math.floor(totalMin / 60);
  const minsPart = totalMin % 60;
  if (hrsPart === 0) return `${minsPart}m left`;
  return `${hrsPart}h ${minsPart}m left`;
}

export default function TodayView({
  bookings, members, accessCodes,
  bayFilter, setBayFilter,
  onEdit, onCancel, onSelectMember, targetDate,
  onPrevDay, onNextDay, onJumpToday,
  onBulkCancel, onRefresh,
}) {
  const isMobile = useIsMobile();
  const branding = useBranding();
  const BAYS = useMemo(() => resolveBays(branding), [branding]);
  const bayLabel = resolveBayLabel(branding);

  // Door-code lookup: build a Map keyed by booking_id from the latest
  // useData refresh (which pulls access_code_jobs status='sent'). Lets
  // each row show the actual code the member got — saves the operator
  // a Seam-dashboard trip when a member calls about their code.
  const codesByBooking = useMemo(() => {
    const m = new Map();
    for (const job of accessCodes || []) {
      if (job?.booking_id && job?.access_code) m.set(job.booking_id, job.access_code);
    }
    return m;
  }, [accessCodes]);

  // Tick the clock once a minute so the "Right now" remaining-time and
  // "Up next" countdown chips stay accurate without a full data
  // refresh. Cheaper than refreshing every booking row.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // Multi-select state for bulk actions. Stored as a Set of booking_id
  // strings so toggle/clear stay O(1). Cleared whenever the underlying
  // booking set or filter changes so a stale selection from yesterday
  // can't accidentally land on today's rows.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  // Clear when the date or bay filter shifts — selections never travel
  // across day/bay boundaries.
  useEffect(() => { clearSelection(); }, [targetDate, bayFilter]);

  const today = tds();
  const viewDate = targetDate || today;
  const isToday = viewDate === today;

  const todayBk = useMemo(() => {
    let bks = bookings.filter((b) => b.booking_status !== "Cancelled" && lds(new Date(b.booking_start)) === viewDate);

    if (bayFilter !== "all") bks = bks.filter((b) => b.bay === bayFilter);
    return bks.sort((a, b) => new Date(a.booking_start) - new Date(b.booking_start));
  }, [bookings, bayFilter, viewDate]);

  const todayByBay = useMemo(() => {
    const r = {};
    BAYS.forEach((bay) => { r[bay] = todayBk.filter((b) => b.bay === bay); });
    return r;
  }, [todayBk, BAYS]);

  // Conflicting bookings on the viewed day. Detected upstream by the
  // booking-webhook when Skedda-originated bookings overlap existing
  // same-bay bookings. Surfacing them prominently here is the whole
  // point — an operator who just walked in should see "2 bookings
  // conflict" before they see anything else on the schedule.
  const conflictedToday = useMemo(
    () => todayBk.filter((b) => b.conflict_detected_at || b.conflict_with),
    [todayBk]
  );

  const todayHrs = todayBk.reduce((s, b) => s + Number(b.duration_hours || 0), 0);
  const todayRev = todayBk.reduce((s, b) => {
    const m = members.find((x) => x.email === b.customer_email);
    if (m && m.tier !== "Non-Member") return s;
    return s + Number(b.duration_hours || 0) * 60;
  }, 0);

  function bkStatus(b) {
    if (!isToday) return "upcoming";
    const s = new Date(b.booking_start);
    const e = new Date(b.booking_end);
    if (now >= s && now <= e) return "now";
    if (now < s) return "upcoming";
    return "past";
  }

  // "Right now" — every booking currently in flight. Operator's most
  // important glance: who's on the clock, time left, what code did
  // they get. Sorted by end-time so the soonest wrap-up is on top.
  const liveBookings = useMemo(() => {
    if (!isToday) return [];
    return todayBk
      .filter((b) => {
        const s = new Date(b.booking_start);
        const e = new Date(b.booking_end);
        return now >= s && now <= e;
      })
      .sort((a, b) => new Date(a.booking_end) - new Date(b.booking_end));
  }, [todayBk, now, isToday]);

  // "Up next" — the next imminent booking starting within ~90 min,
  // not already in the live list. Single row to keep the callout tight.
  const upNext = useMemo(() => {
    if (!isToday) return null;
    const threshold = 90 * 60 * 1000;
    return todayBk.find((b) => {
      const s = new Date(b.booking_start);
      const ms = s - now;
      return ms > 0 && ms <= threshold;
    }) || null;
  }, [todayBk, now, isToday]);

  // Pull-to-refresh — mobile-only, scoped to this view. Activates only
  // when the page is already at scrollTop === 0 (so a mid-list pull
  // doesn't fight the browser's scroll). Below 60px the pull is just
  // visual; ≥100px on release fires onRefresh. Debounced 2s after a
  // refresh so the operator can't spam the network.
  const ptrRef = useRef(null);
  const ptrStateRef = useRef({ startY: 0, startX: 0, active: false, dragging: false });
  const lastRefreshRef = useRef(0);
  const [ptrPull, setPtrPull] = useState(0); // px pulled (0 if idle)
  const [ptrRefreshing, setPtrRefreshing] = useState(false);

  useEffect(() => {
    if (!isMobile || !onRefresh) return;
    const el = ptrRef.current;
    if (!el) return;

    const TRIGGER = 100;
    const MAX = 140;

    function getScrollTop() {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    function onTouchStart(e) {
      if (getScrollTop() > 0) return;
      if (Date.now() - lastRefreshRef.current < 2000) return;
      const t = e.touches[0];
      ptrStateRef.current = { startY: t.clientY, startX: t.clientX, active: true, dragging: false };
    }

    function onTouchMove(e) {
      const st = ptrStateRef.current;
      if (!st.active) return;
      const t = e.touches[0];
      const dy = t.clientY - st.startY;
      const dx = t.clientX - st.startX;
      // Only hijack a clear vertical-down pull. Any horizontal lean or
      // upward motion = release to the browser.
      if (!st.dragging) {
        if (dy <= 6) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          ptrStateRef.current.active = false;
          return;
        }
        if (getScrollTop() > 0) {
          ptrStateRef.current.active = false;
          return;
        }
        ptrStateRef.current.dragging = true;
      }
      // Resistance curve: 1:1 up to 60px, half-rate beyond.
      const raw = dy;
      const eased = raw <= 60 ? raw : 60 + (raw - 60) * 0.5;
      const clamped = Math.min(MAX, Math.max(0, eased));
      setPtrPull(clamped);
    }

    function onTouchEnd() {
      const st = ptrStateRef.current;
      if (!st.active || !st.dragging) {
        ptrStateRef.current = { startY: 0, startX: 0, active: false, dragging: false };
        setPtrPull(0);
        return;
      }
      const pulled = ptrPullRef.current;
      ptrStateRef.current = { startY: 0, startX: 0, active: false, dragging: false };
      if (pulled >= TRIGGER) {
        setPtrPull(0);
        setPtrRefreshing(true);
        lastRefreshRef.current = Date.now();
        Promise.resolve(onRefresh())
          .catch(() => {})
          .finally(() => setPtrRefreshing(false));
      } else {
        setPtrPull(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isMobile, onRefresh]);

  // Mirror the pull value in a ref so the touchend handler reads the
  // current value (the closure captures the initial 0 otherwise).
  const ptrPullRef = useRef(0);
  useEffect(() => { ptrPullRef.current = ptrPull; }, [ptrPull]);

  const ptrTriggered = ptrPull >= 100;

  const displayBays = bayFilter === "all" ? BAYS : [bayFilter];

  // Show callouts only when there's something live or imminent — empty
  // state is just the regular bay lanes (no value in showing an empty
  // "right now" panel at 5am).
  const showCallouts = isToday && (liveBookings.length > 0 || upNext);

  // Day-label for the date-nav strip. "Today" stays explicit when
  // viewing today even if the operator just navigated back from a
  // historic day — clearer than just "Sunday, April 19, 2026".
  const dayLabel = isToday
    ? "Today"
    : new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ,
      });

  const ptrLabel = ptrRefreshing
    ? "Refreshing…"
    : ptrTriggered
      ? "Release to refresh"
      : "Pull to refresh";
  const ptrVisible = ptrPull > 0 || ptrRefreshing;

  return (
    <div
      className="content today-ptr-wrap"
      ref={ptrRef}
      style={
        isMobile && ptrPull > 0
          ? { transform: `translateY(${Math.min(ptrPull, 80)}px)`, transition: "none" }
          : isMobile
            ? { transform: "translateY(0)", transition: "transform 220ms ease" }
            : undefined
      }
    >
      {isMobile && onRefresh && (
        <div
          className={`ptr-indicator${ptrTriggered ? " triggered" : ""}${ptrRefreshing ? " refreshing" : ""}`}
          aria-hidden={!ptrVisible}
          style={{ opacity: ptrVisible ? 1 : 0 }}
        >
          <span className="ptr-spinner" />
          <span className="ptr-label">{ptrLabel}</span>
        </div>
      )}

      {/* Date nav — always rendered so the operator has a single place
          to step through days and jump back to today. Mirrored by
          keyboard shortcuts ( [ = prev, ] = next, t = today ). */}
      {(onPrevDay || onNextDay || onJumpToday) && (
        <div className="today-datenav" role="group" aria-label="Day navigation">
          <button
            type="button"
            className="btn"
            onClick={onPrevDay}
            disabled={!onPrevDay}
            title="Previous day · [ "
          >
            &larr;
          </button>
          <div className="today-datenav-label" aria-live="polite">
            <span className="today-datenav-day">{dayLabel}</span>
            {!isToday && (
              <span className="today-datenav-date">
                {new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}
                {" · "}
                {new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn"
            onClick={onNextDay}
            disabled={!onNextDay}
            title="Next day · ] "
          >
            &rarr;
          </button>
          {!isToday && onJumpToday && (
            <button
              type="button"
              className="btn primary"
              onClick={onJumpToday}
              title="Jump to today · t"
              style={{ marginLeft: 6 }}
            >
              Today
            </button>
          )}
        </div>
      )}

      {/* Conflict banner — loud, unmissable. One row per conflicted
          booking; each row links to the Edit sheet (same onEdit hook
          as the list/timeline) so the operator can jump straight to
          resolution. Only renders when there's at least one — zero
          state is silent. */}
      {conflictedToday.length > 0 && (
        <div className="today-conflict-banner" role="alert">
          <div className="today-conflict-banner-head">
            <span className="today-conflict-banner-eyebrow">⚠ Double-booked</span>
            <span className="today-conflict-banner-count">
              {conflictedToday.length} {conflictedToday.length === 1 ? "booking overlaps" : "bookings overlap"} another on the same {bayLabel.toLowerCase()}
            </span>
          </div>
          <div className="today-conflict-banner-list">
            {conflictedToday.map((b) => (
              <button
                key={b.booking_id}
                type="button"
                className="today-conflict-banner-row"
                onClick={() => onEdit(b)}
                title="Open to edit or cancel"
              >
                <span className="today-conflict-banner-row-name">{b.customer_name || b.customer_email}</span>
                <span className="today-conflict-banner-row-meta">
                  {fT(new Date(b.booking_start))}&ndash;{fT(new Date(b.booking_end))} · {b.bay}
                </span>
              </button>
            ))}
          </div>
          <p className="today-conflict-banner-hint">
            Likely a Skedda-era booking landing on top of a new-portal booking. Call one member to reschedule — both bookings are in the DB so their members expect to show up.
          </p>
        </div>
      )}

      {showCallouts && (
        <div className="today-callouts">
          {liveBookings.length > 0 && (
            <div className="today-callout today-callout-live">
              <div className="today-callout-head">
                <span className="today-callout-eyebrow">Right now</span>
                <span className="today-callout-count">{liveBookings.length} on the clock</span>
              </div>
              <div className="today-callout-list">
                {liveBookings.map((b) => {
                  const e = new Date(b.booking_end);
                  const remaining = e - now;
                  const code = codesByBooking.get(b.booking_id);
                  const mem = members.find((x) => x.email === b.customer_email);
                  return (
                    <div key={b.booking_id} className="today-callout-row">
                      <div className="today-callout-row-main">
                        <button
                          type="button"
                          className="today-callout-name"
                          onClick={() => onSelectMember(b.customer_email)}
                          title="Open customer detail"
                        >
                          {b.customer_name || b.customer_email}
                        </button>
                        <div className="today-callout-meta">
                          {b.bay} · {fT(new Date(b.booking_start))}–{fT(e)}
                          {mem && mem.tier !== "Non-Member" && <> · <Badge tier={mem.tier} /></>}
                        </div>
                      </div>
                      <div className="today-callout-row-side">
                        {code && <span className="today-callout-code">🔑 {code}</span>}
                        <span className="today-callout-chip">{fmtRemaining(remaining)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {upNext && (
            <div className="today-callout today-callout-next">
              <div className="today-callout-head">
                <span className="today-callout-eyebrow">Up next</span>
                <span className="today-callout-count">in {fmtCountdown(new Date(upNext.booking_start) - now)}</span>
              </div>
              <div className="today-callout-row">
                <div className="today-callout-row-main">
                  <button
                    type="button"
                    className="today-callout-name"
                    onClick={() => onSelectMember(upNext.customer_email)}
                    title="Open customer detail"
                  >
                    {upNext.customer_name || upNext.customer_email}
                  </button>
                  <div className="today-callout-meta">
                    {upNext.bay} · {fT(new Date(upNext.booking_start))}–{fT(new Date(upNext.booking_end))}
                  </div>
                </div>
                <div className="today-callout-row-side">
                  {(() => {
                    const code = codesByBooking.get(upNext.booking_id);
                    return code ? <span className="today-callout-code">🔑 {code}</span> : null;
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="fbar">
        <label>{bayLabel}:</label>
        <select value={bayFilter} onChange={(e) => setBayFilter(e.target.value)}>
          <option value="all">All {bayLabel}s</option>
          {BAYS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Horizontal day timeline — at-a-glance bay utilization across
          the whole day. Lives above the list because "who's where
          when" is the operator's primary question; the list below
          keeps the edit/cancel/bulk-select actions. Respects the bay
          filter so "Bay 2 only" narrows the timeline the same way. */}
      <DayTimeline
        bookings={todayBk}
        bays={displayBays}
        members={members}
        codesByBooking={codesByBooking}
        now={now}
        viewDate={viewDate}
        isToday={isToday}
        onEdit={onEdit}
        onSelectMember={onSelectMember}
      />

      <KPIStrip items={[
        { label: "Bookings", value: todayBk.length },
        { label: `${bayLabel} Hours`, value: `${todayHrs.toFixed(1)}h` },
        { label: "Est Revenue", value: `$${todayRev.toFixed(0)}` },
        { label: "Upcoming", value: todayBk.filter((b) => bkStatus(b) === "upcoming").length },
      ]} />

      {displayBays.map((bay) => {
        const laneBks = todayByBay[bay] || [];
        const laneIds = laneBks.map((b) => b.booking_id);
        const allLaneSelected = laneIds.length > 0 && laneIds.every((id) => selectedIds.has(id));
        return (
          <div key={bay} className="bay-lane">
            <div className="bay-label" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {laneBks.length > 0 && (
                <input
                  type="checkbox"
                  className="slot-check"
                  checked={allLaneSelected}
                  onChange={() => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (allLaneSelected) laneIds.forEach((id) => next.delete(id));
                      else laneIds.forEach((id) => next.add(id));
                      return next;
                    });
                  }}
                  title={allLaneSelected ? `Deselect all in ${bay}` : `Select all in ${bay}`}
                  aria-label={allLaneSelected ? `Deselect all in ${bay}` : `Select all in ${bay}`}
                />
              )}
              <span>{bay} &mdash; {fDL(new Date(viewDate + "T12:00:00"))}</span>
            </div>
            {laneBks.length === 0 && (
              <div className="slot">
                <div className="slot-t">&mdash;</div>
                <div className="slot-i"><span className="muted">No bookings</span></div>
              </div>
            )}
            {laneBks.map((b) => {
              const s = new Date(b.booking_start);
              const e = new Date(b.booking_end);
              const st = bkStatus(b);
              const mem = members.find((x) => x.email === b.customer_email);
              const accessCode = codesByBooking.get(b.booking_id);
              const isSelected = selectedIds.has(b.booking_id);
              // Seconds-until-start countdown for upcoming-today bookings.
              // Skip for non-today views (no useful "in 3 days" copy in
              // a per-day list) and for past/now (different status chip
              // conveys it).
              let countdown = null;
              if (isToday && st === "upcoming") {
                const ms = s - now;
                if (ms > 0 && ms <= 6 * 60 * 60 * 1000) countdown = fmtCountdown(ms);
              }
              return (
                <div key={b.booking_id} className={`slot ${st} ${isSelected ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    className="slot-check"
                    checked={isSelected}
                    onChange={() => toggleSelected(b.booking_id)}
                    aria-label={`Select booking for ${b.customer_name}`}
                  />
                  <div className="slot-t">{fT(s)}&ndash;{fT(e)}</div>
                  <div className="slot-i">
                    <div>
                      <div className="slot-c" style={{ cursor: "pointer" }} onClick={() => onSelectMember(b.customer_email)}>
                        {b.customer_name}
                      </div>
                      <div className="slot-m">
                        {hrs(b.duration_hours)}{" "}
                        {mem && mem.tier !== "Non-Member" && <Badge tier={mem.tier} />}
                        {accessCode && (
                          <span
                            className="slot-code"
                            title="Door code (Seam-issued, status='sent')"
                          >
                            🔑 {accessCode}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {(b.conflict_detected_at || b.conflict_with) && (
                        <StatusBadge intent="danger" title="This booking overlaps another on the same bay. Call to resolve.">
                          ⚠ CONFLICT
                        </StatusBadge>
                      )}
                      {st === "now" && <StatusBadge intent="info">NOW</StatusBadge>}
                      {st === "upcoming" && (
                        <StatusBadge intent="info">
                          {countdown ? `IN ${countdown.toUpperCase()}` : "NEXT"}
                        </StatusBadge>
                      )}
                      <button className="btn" style={{ fontSize: 10 }} onClick={() => onEdit(b)}>Edit</button>
                      <button className="btn danger" style={{ fontSize: 10 }} onClick={() => onCancel(b)}>Cancel</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Sticky bulk action bar — shows whenever at least one booking
          is selected. Cancel-only for now (matches the existing
          per-row Cancel action; bulk-delete reserved for the customer
          DetailView where it already lives). Keeps the operator's
          most common batch action one tap away. */}
      {selectedIds.size > 0 && onBulkCancel && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <span className="bulkbar-count">
            {selectedIds.size} selected
          </span>
          <div className="bulkbar-actions">
            <button
              type="button"
              className="btn"
              onClick={clearSelection}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (window.confirm(`Cancel ${selectedIds.size} booking${selectedIds.size === 1 ? "" : "s"}? This cannot be undone from here.`)) {
                  onBulkCancel(Array.from(selectedIds));
                  clearSelection();
                }
              }}
            >
              Cancel selected
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
