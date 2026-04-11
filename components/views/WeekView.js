import { useMemo, Fragment } from "react";
import { BAYS, TZ } from "../../lib/constants";
import { fT, fDS, lds, tds } from "../../lib/format";

export default function WeekView({ bookings, weekOff, setWeekOff, onSelectMember }) {
  const activeBk = useMemo(() => bookings.filter((b) => b.booking_status !== "Cancelled"), [bookings]);

  const weekDays = useMemo(() => {
    const d = [];
    const base = new Date();
    base.setDate(base.getDate() - base.getDay() + weekOff * 7);
    for (let i = 0; i < 7; i++) {
      const x = new Date(base);
      x.setDate(base.getDate() + i);
      d.push(x);
    }
    return d;
  }, [weekOff]);

  const weekBk = useMemo(() => {
    const r = {};
    weekDays.forEach((d) => {
      const ds = lds(d);
      BAYS.forEach((bay) => {
        r[`${ds}-${bay}`] = activeBk
          .filter((b) => lds(new Date(b.booking_start)) === ds && b.bay === bay)
          .sort((a, b) => new Date(a.booking_start) - new Date(b.booking_start));
      });
    });
    return r;
  }, [weekDays, activeBk]);

  const today = tds();

  return (
    <div className="content">
      <div className="wk-nav">
        <button className="btn" onClick={() => setWeekOff((w) => w - 1)}>&larr; Prev</button>
        <button className="btn" onClick={() => setWeekOff(0)}>This Week</button>
        <button className="btn" onClick={() => setWeekOff((w) => w + 1)}>Next &rarr;</button>
        <span style={{ marginLeft: 8 }}>{fDS(weekDays[0])} &ndash; {fDS(weekDays[6])}</span>
      </div>

      <div className="wk-grid">
        <div className="wk-h">Day</div>
        {BAYS.map((b) => <div key={b} className="wk-h">{b}</div>)}

        {weekDays.map((d) => {
          const ds = lds(d);
          const isToday = ds === today;
          return (
            <Fragment key={ds}>
              <div className={`wk-d ${isToday ? "today" : ""}`}>
                <span className="dl">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}</span>
                <span className="dn">{d.toLocaleDateString("en-US", { day: "numeric", timeZone: TZ })}</span>
              </div>
              {BAYS.map((bay) => {
                const bks = weekBk[`${ds}-${bay}`] || [];
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
