import { useMemo } from "react";
import { TZ } from "../../lib/constants";
import { fT, fDL, lds, tds, hrs } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays, resolveBayLabel } from "../../lib/branding";
import Badge from "../ui/Badge";

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

  const now = new Date();
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

  const displayBays = bayFilter === "all" ? BAYS : [bayFilter];

  return (
    <div className="content">
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
                    {st === "upcoming" && <span className="badge badge-sm" style={{ background: "var(--blue)" }}>NEXT</span>}
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
