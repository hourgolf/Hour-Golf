import { useMemo, Fragment } from "react";
import { BAYS, TZ } from "../../lib/constants";
import { fT, lds, tds } from "../../lib/format";

export default function WeekView({ bookings, weekOff, setWeekOff, onSelectMember, onSelectDate }) {

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
  }, [monthDays, activeBk]);

  const today = tds();

  return (
    <div className="content">
      <div className="wk-nav">
        <button className="btn" onClick={() => setWeekOff((w) => w - 1)}>
          &larr; Prev
        </button>
        <button className="btn" onClick={() => setWeekOff(0)}>
          This Month
        </button>
        <button className="btn" onClick={() => setWeekOff((w) => w + 1)}>
          Next &rarr;
        </button>
        <span style={{ marginLeft: 8 }}>{monthLabel}</span>
      </div>

      <div className="wk-grid">
        <div className="wk-h">Day</div>
        {BAYS.map((b) => (
          <div key={b} className="wk-h">{b}</div>
        ))}

        {monthDays.map((d) => {
          const ds = lds(d);
          const isToday = ds === today;
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
              </div>

              {BAYS.map((bay) => {
                const bks = monthBk[`${ds}-${bay}`] || [];
                return (
                  <div key={bay} className={`wk-c ${isToday ? "today" : ""}`}>
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
