import { useMemo, Fragment } from "react";
import { TZ } from "../../lib/constants";
import { fT, lds, tds } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays } from "../../lib/branding";
import KPIStrip from "../ui/KPIStrip";

// Hours-per-day used for utilization math. 16 mirrors the same window
// ReportsView uses (6am–10pm operational range); good enough for a
// month-at-a-glance heatmap. Tenants who run 24/7 will see lower
// utilization numbers — ok, the heatmap is relative not absolute.
const OPERATING_HOURS_PER_DAY = 16;

export default function WeekView({ bookings, members, weekOff, setWeekOff, onSelectMember, onSelectDate }) {
  const branding = useBranding();
  const BAYS = useMemo(() => resolveBays(branding), [branding]);

  const activeBk = useMemo(
    () => bookings.filter((b) => b.booking_status !== "Cancelled"),
    [bookings]
  );

  // weekOff is reused as a month offset (0 = current month, -1 = prev, +1 = next)
  const monthDays = useMemo(() => {
    const today = new Date();
    const base = new Date(today.getFullYear(), today.getMonth() + weekOff, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    const out = [];
    for (let day = 1; day <= last; day++) {
      out.push(new Date(year, month, day));
    }
    return out;
  }, [weekOff]);

  const monthLabel = useMemo(() => {
    if (!monthDays.length) return "";
    return monthDays[0].toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: TZ,
    });
  }, [monthDays]);

  // Build the day-bay-keyed map of bookings + a flat per-day total
  // (used for the cell density chip + the KPI header). Two passes is
  // fine — the data set is bounded by month size.
  const monthBk = useMemo(() => {
    const r = {};
    monthDays.forEach((d) => {
      const ds = lds(d);
      BAYS.forEach((bay) => {
        r[`${ds}-${bay}`] = activeBk
          .filter(
            (b) => lds(new Date(b.booking_start)) === ds && b.bay === bay
          )
          .sort((a, b) => new Date(a.booking_start) - new Date(b.booking_start));
      });
    });
    return r;
  }, [monthDays, activeBk, BAYS]);

  // Per-day totals: { count, hours }. Reused by the day cell badge
  // and by the heatmap's per-bay-day intensity calculation.
  const perDayTotals = useMemo(() => {
    const r = {};
    monthDays.forEach((d) => {
      const ds = lds(d);
      let count = 0;
      let hrs = 0;
      BAYS.forEach((bay) => {
        const bks = monthBk[`${ds}-${bay}`] || [];
        for (const b of bks) {
          count++;
          hrs += Number(b.duration_hours || 0);
        }
      });
      r[ds] = { count, hours: hrs };
    });
    return r;
  }, [monthDays, monthBk, BAYS]);

  // Per-bay-day hours for the heatmap. Utilization = bay-hours-booked
  // divided by OPERATING_HOURS_PER_DAY. Capped at 1.0 so a bay running
  // overnight still shows max-saturation rather than going off the
  // color scale.
  const perBayDayHours = useMemo(() => {
    const r = {};
    monthDays.forEach((d) => {
      const ds = lds(d);
      BAYS.forEach((bay) => {
        const bks = monthBk[`${ds}-${bay}`] || [];
        r[`${ds}-${bay}`] = bks.reduce((s, b) => s + Number(b.duration_hours || 0), 0);
      });
    });
    return r;
  }, [monthDays, monthBk, BAYS]);

  // Month-level KPIs for the header.
  //
  // Revenue is approximate: counts non-member booking hours × $60 (the
  // default Non-Member rate). Members are excluded since their
  // membership fees are billed separately and would double-count if
  // mixed in here. Good enough for an at-a-glance "did this month
  // look busy" indicator; the Reports tab has the precise breakdown.
  const monthKpis = useMemo(() => {
    let count = 0;
    let hrs = 0;
    let revenue = 0;
    monthDays.forEach((d) => {
      const ds = lds(d);
      const t = perDayTotals[ds];
      if (!t) return;
      count += t.count;
      hrs += t.hours;
    });
    activeBk.forEach((b) => {
      // Only month-window bookings.
      const ds = lds(new Date(b.booking_start));
      if (!perDayTotals[ds]) return;
      const m = members?.find((x) => x.email === b.customer_email);
      if (!m || m.tier === "Non-Member") {
        revenue += Number(b.duration_hours || 0) * 60;
      }
    });
    const totalCapacity = monthDays.length * BAYS.length * OPERATING_HOURS_PER_DAY;
    const utilization = totalCapacity > 0 ? (hrs / totalCapacity) * 100 : 0;
    return { count, hrs, revenue, utilization };
  }, [monthDays, perDayTotals, activeBk, members, BAYS]);

  const today = tds();

  // Heatmap helper. Returns a CSS color with alpha tied to utilization
  // for a single bay-day cell. Uses the tenant primary color so each
  // tenant's heatmap stays on-brand. Falls back to HG green when
  // primary isn't defined.
  function heatColor(hrs) {
    if (!hrs || hrs <= 0) return null;
    const util = Math.min(1, hrs / OPERATING_HOURS_PER_DAY);
    // Floor at 0.08 so even a single 30-min booking is faintly tinted
    // (full transparent reads as "no booking" and undermines the cue).
    const alpha = Math.max(0.08, util * 0.55);
    const primary = branding?.primary_color || "#4C8D73";
    // Convert #RRGGBB to rgba(r,g,b,alpha). Bail to a neutral tint
    // if anything's off — better than rendering nothing.
    const m = /^#([0-9a-f]{6})$/i.exec(primary);
    if (!m) return `rgba(76, 141, 115, ${alpha})`;
    const num = parseInt(m[1], 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return (
    <div className="content">
      <div className="wk-nav" style={{ flexDirection: "column", alignItems: "center" }}>
        <span>{monthLabel}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setWeekOff((w) => w - 1)}>
            &larr; Prev
          </button>
          <button className="btn" onClick={() => setWeekOff(0)}>
            This Month
          </button>
          <button className="btn" onClick={() => setWeekOff((w) => w + 1)}>
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Month-level KPI strip — same shape as TodayView's summary so
          operators have one consistent at-a-glance bar across views. */}
      <KPIStrip items={[
        { label: "Bookings", value: monthKpis.count },
        { label: "Booked Hours", value: `${monthKpis.hrs.toFixed(1)}h` },
        { label: "Est Revenue", value: `$${monthKpis.revenue.toFixed(0)}` },
        { label: "Utilization", value: `${monthKpis.utilization.toFixed(0)}%` },
      ]} />

      {/* gridTemplateColumns is inlined so the calendar adapts to
          tenants with more (or fewer) bays than HG's 2 — the global
          .wk-grid CSS rule defaults to "112px 1fr 1fr" which only
          renders correctly for 2 bays. */}
      <div
        className="wk-grid"
        style={{ gridTemplateColumns: `112px ${BAYS.map(() => "1fr").join(" ")}` }}
      >
        <div className="wk-h">Day</div>
        {BAYS.map((b) => (
          <div key={b} className="wk-h">{b}</div>
        ))}

        {monthDays.map((d) => {
          const ds = lds(d);
          const isToday = ds === today;
          const dayTotals = perDayTotals[ds] || { count: 0, hours: 0 };
          return (
            <Fragment key={ds}>
              <div
                className={`wk-d ${isToday ? "today" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectDate && onSelectDate(ds)}
                title="View this day"
              >
                <span className="dl">
                  {d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}
                </span>
                <span className="dn">
                  {d.toLocaleDateString("en-US", { day: "numeric", timeZone: TZ })}
                </span>
                {dayTotals.count > 0 && (
                  <span className="wk-d-totals">
                    {dayTotals.count} · {dayTotals.hours.toFixed(1)}h
                  </span>
                )}
              </div>

              {BAYS.map((bay) => {
                const bks = monthBk[`${ds}-${bay}`] || [];
                const cellHrs = perBayDayHours[`${ds}-${bay}`] || 0;
                const heat = heatColor(cellHrs);
                return (
                  <div
                    key={bay}
                    className={`wk-c ${isToday ? "today" : ""}`}
                    style={heat ? { background: heat } : undefined}
                  >
                    {bks.map((b) => (
                      <div
                        key={b.booking_id}
                        className="wk-b"
                        onClick={() => onSelectMember(b.customer_email)}
                        title={`${b.customer_name} ${fT(new Date(b.booking_start))}\u2013${fT(new Date(b.booking_end))}`}
                      >
                        {fT(new Date(b.booking_start))} {b.customer_name?.split(" ")[0]}
                      </div>
                    ))}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
