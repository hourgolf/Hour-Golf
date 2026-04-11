import { useMemo } from "react";
import { TIERS } from "../../lib/constants";
import { mL, hrs, dlr, allD } from "../../lib/format";
import Badge from "../ui/Badge";

export default function OverviewView({
  usage, payments, members,
  selMonth, setSelMonth,
  onSelectMember, onUpdateTier,
}) {
  const allMonths = useMemo(() => [...new Set(usage.map((r) => r.billing_month))].sort().reverse(), [usage]);
  const actMonth = selMonth || allMonths[0] || "";
  const curData = useMemo(() => usage.filter((r) => r.billing_month === actMonth), [usage, actMonth]);
  const memMonth = curData.filter((r) => r.tier !== "Non-Member");
  const nonMem = curData.filter((r) => r.tier === "Non-Member");
  const totOver = memMonth.reduce((s, r) => s + Number(r.overage_charge || 0), 0);
  const totHrs = memMonth.reduce((s, r) => s + Number(r.total_hours || 0), 0);

  function isPaid(email, month) {
    return payments.some((p) => p.member_email === email && p.billing_month === month && p.status === "succeeded");
  }

  return (
    <div className="content">
      <div className="month-sel">
        {allMonths.map((m) => (
          <button key={m} className={`mo-btn ${m === actMonth ? "active" : ""}`} onClick={() => setSelMonth(m)}>
            {mL(m)}
          </button>
        ))}
      </div>

      {memMonth.length > 0 && (
        <div className="summary">
          <div className="sum-item"><span className="sum-val">{totHrs.toFixed(1)}h</span><span className="sum-lbl">Member Hours</span></div>
          <div className="sum-item"><span className={`sum-val ${totOver > 0 ? "red" : "green"}`}>{dlr(totOver)}</span><span className="sum-lbl">Overage Due</span></div>
          <div className="sum-item"><span className="sum-val">{memMonth.filter((r) => Number(r.overage_hours) > 0).length}</span><span className="sum-lbl">Over Allotment</span></div>
        </div>
      )}

      {memMonth.length > 0 && (
        <>
          <h2 className="section-head">Members &mdash; {mL(actMonth)}</h2>
          <div className="tbl">
            <div className="th">
              <span style={{ flex: 2 }}>Member</span>
              <span style={{ flex: 1 }}>Tier</span>
              <span style={{ flex: 1 }} className="text-r">Used</span>
              <span style={{ flex: 1 }} className="text-r">Allot</span>
              <span style={{ flex: 1 }} className="text-r">Over</span>
              <span style={{ flex: 1 }} className="text-r">Charge</span>
              <span style={{ flex: 1 }} className="text-r">Status</span>
            </div>
            {memMonth.map((r) => {
              const ho = Number(r.overage_charge) > 0;
              const pd = isPaid(r.customer_email, r.billing_month);
              return (
                <div key={r.customer_email} className="tr click" onClick={() => onSelectMember(r.customer_email)}>
                  <span style={{ flex: 2 }}>
                    <strong>{r.customer_name}</strong><br />
                    <span className="email-sm">{r.customer_email}</span>
                  </span>
                  <span style={{ flex: 1 }}><Badge tier={r.tier} /></span>
                  <span style={{ flex: 1 }} className="text-r tab-num">{hrs(r.total_hours)}</span>
                  <span style={{ flex: 1 }} className="text-r tab-num">{allD(r.included_hours)}</span>
                  <span style={{ flex: 1 }} className={`text-r tab-num ${Number(r.overage_hours) > 0 ? "red" : ""}`}>
                    {Number(r.overage_hours) > 0 ? hrs(r.overage_hours) : "\u2014"}
                  </span>
                  <span style={{ flex: 1 }} className={`text-r tab-num ${ho ? "red bold" : ""}`}>
                    {ho ? dlr(r.overage_charge) : "\u2014"}
                  </span>
                  <span style={{ flex: 1 }} className="text-r">
                    {ho && pd && <span className="badge" style={{ background: "#4a7c59", fontSize: 9 }}>PAID</span>}
                    {ho && !pd && <span className="badge" style={{ background: "var(--red)", fontSize: 9 }}>UNPAID</span>}
                    {!ho && <span className="muted">&mdash;</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className="section-head" style={{ marginTop: 24 }}>Non-Members &mdash; {mL(actMonth)}</h2>
      <div className="tbl">
        <div className="th">
          <span style={{ flex: 2 }}>Customer</span>
          <span style={{ flex: 1 }} className="text-r">Hours</span>
          <span style={{ flex: 1 }} className="text-r">Sessions</span>
          <span style={{ flex: 1 }} className="text-r">Revenue</span>
          <span style={{ flex: 1 }} className="text-c">Assign</span>
        </div>
        {nonMem.slice(0, 25).map((r) => (
          <div key={r.customer_email} className="tr">
            <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(r.customer_email)}>
              <strong>{r.customer_name}</strong><br />
              <span className="email-sm">{r.customer_email}</span>
            </span>
            <span style={{ flex: 1 }} className="text-r tab-num">{hrs(r.total_hours)}</span>
            <span style={{ flex: 1 }} className="text-r tab-num">{r.booking_count}</span>
            <span style={{ flex: 1 }} className="text-r tab-num">${(Number(r.total_hours) * 60).toFixed(0)}</span>
            <span style={{ flex: 1 }} className="text-c">
              <select className="tier-sel" value="Non-Member" onChange={(e) => onUpdateTier(r.customer_email, e.target.value, r.customer_name)}>
                <option value="Non-Member">&mdash;</option>
                {TIERS.filter((t) => t !== "Non-Member").map((t) => <option key={t}>{t}</option>)}
              </select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
