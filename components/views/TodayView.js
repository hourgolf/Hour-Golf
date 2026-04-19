import { useEffect, useMemo, useState } from "react";
import { TZ } from "../../lib/constants";
import { fT, fDL, lds, tds, hrs } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays, resolveBayLabel } from "../../lib/branding";
import Badge from "../ui/Badge";

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
}) {
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

  const displayBays = bayFilter === "all" ? BAYS : [bayFilter];

  // Show callouts only when there's something live or imminent — empty
  // state is just the regular bay lanes (no value in showing an empty
  // "right now" panel at 5am).
  const showCallouts = isToday && (liveBookings.length > 0 || upNext);

  return (
    <div className="content">
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

      <div className="summary">
        <div className="sum-item"><span className="sum-val">{todayBk.length}</span><span className="sum-lbl">Bookings</span></div>
        <div className="sum-item"><span className="sum-val">{todayHrs.toFixed(1)}h</span><span className="sum-lbl">{bayLabel} Hours</span></div>
        <div className="sum-item"><span className="sum-val">${todayRev.toFixed(0)}</span><span className="sum-lbl">Est Revenue</span></div>
        <div className="sum-item"><span className="sum-val">{todayBk.filter((b) => bkStatus(b) === "upcoming").length}</span><span className="sum-lbl">Upcoming</span></div>
      </div>

      {displayBays.map((bay) => (
        <div key={bay} className="bay-lane">
          <div className="bay-label">{bay} &mdash; {fDL(new Date(viewDate + "T12:00:00"))}</div>
          {(todayByBay[bay] || []).length === 0 && (
            <div className="slot">
              <div className="slot-t">&mdash;</div>
              <div className="slot-i"><span className="muted">No bookings</span></div>
            </div>
          )}
          {(todayByBay[bay] || []).map((b) => {
            const s = new Date(b.booking_start);
            const e = new Date(b.booking_end);
            const st = bkStatus(b);
            const mem = members.find((x) => x.email === b.customer_email);
            const accessCode = codesByBooking.get(b.booking_id);
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
              <div key={b.booking_id} className={`slot ${st}`}>
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
                    {st === "now" && <span className="badge" style={{ background: "var(--primary)", fontSize: 9 }}>NOW</span>}
                    {st === "upcoming" && (
                      <span className="badge badge-sm" style={{ background: "var(--blue)" }}>
                        {countdown ? `IN ${countdown.toUpperCase()}` : "NEXT"}
                      </span>
                    )}
                    <button className="btn" style={{ fontSize: 10 }} onClick={() => onEdit(b)}>Edit</button>
                    <button className="btn danger" style={{ fontSize: 10 }} onClick={() => onCancel(b)}>Cancel</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
