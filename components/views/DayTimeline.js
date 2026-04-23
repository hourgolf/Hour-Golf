// Horizontal Gantt-style timeline of a day's bookings. Time axis runs
// left-to-right across the top; each bay is a row below; each booking
// is a positioned block sized by duration. Complements the list view
// below — the list keeps edit/cancel/bulk-select actions, the timeline
// gives an at-a-glance answer to "who's in what bay when".
//
// Interaction:
//   - Click a booking block → opens the edit sheet (same onEdit hook
//     the list rows use).
//   - Click a member name → opens that member's DetailView (same
//     onSelectMember hook).
//   - Current-time vertical line draws when viewDate === today.
//
// Layout:
//   - Fixed time window 6 AM → 11 PM (17 hours) covers every tenant we
//     know about today. Anything outside that range gets clamped to
//     the edges so it still shows up rather than disappearing.
//   - Min-width 900px on the scroller so mobile horizontally scrolls
//     instead of squishing the hour marks unreadable.
//   - Height per bay row is fixed at 56px; height scales with number
//     of bays so the whole thing is predictable.

import { useMemo } from "react";
import { fT } from "../../lib/format";
import Badge from "../ui/Badge";

// Window edges (hour of day). Adjust here if a tenant opens before 6
// or operates past 11pm; we clamp off-window bookings to the edges so
// this change is safe regardless.
const WINDOW_START_H = 6;
const WINDOW_END_H = 23;
const WINDOW_MINUTES = (WINDOW_END_H - WINDOW_START_H) * 60;

function minutesIntoWindow(date, dayAnchor) {
  // `date` is a Date object for the booking boundary.
  // `dayAnchor` is midnight of the viewing day (local/Pacific).
  const minutesFromMidnight = (date - dayAnchor) / 60000;
  return Math.max(
    0,
    Math.min(WINDOW_MINUTES, minutesFromMidnight - WINDOW_START_H * 60)
  );
}

function pctFromMinutes(m) {
  return (m / WINDOW_MINUTES) * 100;
}

function hourLabel(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export default function DayTimeline({
  bookings,     // bookings scoped to the viewed day (already filtered)
  bays,         // array of bay names in display order
  members,      // full members list — used to lookup tier for color
  codesByBooking, // Map<booking_id, access_code>
  now,          // Date — current wallclock
  viewDate,     // "YYYY-MM-DD"
  isToday,      // boolean
  onEdit,       // (booking) => void
  onSelectMember, // (email) => void
}) {
  // Midnight Pacific on the viewed day as a Date. Local-ish (we avoid
  // computing DST math inline; the bookings already carry UTC offsets
  // and we just subtract dates to get minutes).
  const dayAnchor = useMemo(() => {
    const [y, m, d] = viewDate.split("-").map(Number);
    // Construct in the tenant's local-by-convention (Pacific-rendered).
    // The minutes math below compares Dates so the absolute offset
    // doesn't matter as long as dayAnchor is the same-ish "midnight"
    // the booking_start is measured against.
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }, [viewDate]);

  const hourTicks = useMemo(() => {
    const ticks = [];
    for (let h = WINDOW_START_H; h <= WINDOW_END_H; h++) ticks.push(h);
    return ticks;
  }, []);

  const nowPct = useMemo(() => {
    if (!isToday) return null;
    const m = minutesIntoWindow(now, dayAnchor);
    if (m <= 0 || m >= WINDOW_MINUTES) return null;
    return pctFromMinutes(m);
  }, [now, isToday, dayAnchor]);

  // Precompute block layout per bay so render is cheap. Blocks are
  // plain objects with left%, width%, a status tag, and the raw
  // booking for the click handler.
  const blocksByBay = useMemo(() => {
    const result = {};
    for (const bay of bays) result[bay] = [];
    for (const b of bookings) {
      if (!result[b.bay]) continue; // unknown bay (schema drift); skip
      const s = new Date(b.booking_start);
      const e = new Date(b.booking_end);
      const startM = minutesIntoWindow(s, dayAnchor);
      const endM = minutesIntoWindow(e, dayAnchor);
      // Skip bookings entirely outside the window.
      if (endM <= 0 || startM >= WINDOW_MINUTES) continue;
      const widthM = Math.max(15, endM - startM); // clamp tiny blocks so they're tappable
      const status = isToday
        ? now > e ? "past" : now >= s ? "now" : "upcoming"
        : "upcoming";
      const mem = members.find((x) => x.email === b.customer_email);
      const tier = mem?.tier || "Non-Member";
      result[b.bay].push({
        id: b.booking_id,
        booking: b,
        tier,
        memberName: b.customer_name || b.customer_email,
        leftPct: pctFromMinutes(startM),
        widthPct: pctFromMinutes(widthM),
        status,
        start: s,
        end: e,
        code: codesByBooking?.get(b.booking_id) || null,
      });
    }
    return result;
  }, [bookings, bays, dayAnchor, isToday, now, members, codesByBooking]);

  return (
    <div className="day-timeline" aria-label="Day timeline">
      <div className="day-timeline-scroll">
        {/* Time axis */}
        <div className="day-timeline-axis">
          <div className="day-timeline-baycol" />
          <div className="day-timeline-track-head">
            {hourTicks.map((h) => (
              <div
                key={h}
                className="day-timeline-tick"
                style={{ left: `${pctFromMinutes((h - WINDOW_START_H) * 60)}%` }}
              >
                <span className="day-timeline-tick-label">{hourLabel(h)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bay rows */}
        {bays.map((bay) => {
          const blocks = blocksByBay[bay] || [];
          return (
            <div key={bay} className="day-timeline-row">
              <div className="day-timeline-baycol">
                <span className="day-timeline-bay-label">{bay}</span>
                <span className="day-timeline-bay-count">
                  {blocks.length} {blocks.length === 1 ? "booking" : "bookings"}
                </span>
              </div>
              <div className="day-timeline-track">
                {/* Hour gridlines */}
                {hourTicks.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="day-timeline-gridline"
                    style={{ left: `${pctFromMinutes((h - WINDOW_START_H + 1) * 60)}%` }}
                  />
                ))}

                {/* Booking blocks */}
                {blocks.map((bk) => {
                  const isNonMember = bk.tier === "Non-Member";
                  return (
                    <button
                      type="button"
                      key={bk.id}
                      onClick={() => onEdit && onEdit(bk.booking)}
                      className={`day-timeline-block status-${bk.status} ${isNonMember ? "non-member" : ""}`}
                      style={{
                        left: `${bk.leftPct}%`,
                        width: `${bk.widthPct}%`,
                      }}
                      title={`${bk.memberName} · ${fT(bk.start)}–${fT(bk.end)} · ${bk.tier}${bk.code ? ` · code ${bk.code}` : ""}`}
                    >
                      <span className="day-timeline-block-name">{bk.memberName}</span>
                      <span className="day-timeline-block-time">
                        {fT(bk.start)}–{fT(bk.end)}
                      </span>
                    </button>
                  );
                })}

                {/* Current-time indicator */}
                {nowPct !== null && (
                  <div
                    className="day-timeline-nowline"
                    style={{ left: `${nowPct}%` }}
                    aria-label="Current time"
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Legend row */}
        <div className="day-timeline-legend">
          <div className="day-timeline-baycol" />
          <div className="day-timeline-legend-items">
            <LegendSwatch label="Live" className="status-now" />
            <LegendSwatch label="Upcoming" className="status-upcoming" />
            <LegendSwatch label="Past" className="status-past" />
            <LegendSwatch label="Non-member" className="non-member" />
            {isToday && (
              <span className="day-timeline-legend-now">
                <span className="day-timeline-legend-nowdot" /> Now
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({ label, className }) {
  return (
    <span className="day-timeline-legend-item">
      <span className={`day-timeline-legend-swatch ${className}`} />
      {label}
    </span>
  );
}
