import { useMemo, useState } from "react";
import { TIERS } from "../../lib/constants";
import { mL, hrs, dlr, allD } from "../../lib/format";
import Badge from "../ui/Badge";

export default function OverviewView({
  usage, payments, members, bookings, tierCfg,
  selMonth, setSelMonth,
  onSelectMember, onUpdateTier,
  onChargeNonMember, onChargeNonMembersBatch,
  saving,
}) {
  const [batchLoading, setBatchLoading] = useState(false);

  const activeBk = useMemo(
    () => (bookings || []).filter((b) => b.booking_status !== "Cancelled"),
    [bookings]
  );

  // Build month list from BOTH the usage view and the bookings table so we
  // always have months even if the view is empty for the current month.
  const allMonths = useMemo(() => {
    const set = new Set();
    activeBk.forEach((b) => {
      const d = new Date(b.booking_start);
      if (!isNaN(d)) {
        set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+00:00`);
      }
    });
    usage.forEach((r) => { if (r.billing_month) set.add(r.billing_month); });
    return [...set].sort().reverse();
  }, [activeBk, usage]);

  const actMonth = selMonth || allMonths[0] || "";

  // Normalize the monthly_usage view to handle both old and new column names.
  const curData = useMemo(
    () => usage
      .filter((r) => r.billing_month === actMonth)
      .map((r) => ({
        ...r,
        customer_email: r.customer_email || r.email || "",
        customer_name: r.customer_name || r.name || "",
      })),
    [usage, actMonth]
  );

  const memMonth = curData.filter((r) => r.tier && r.tier !== "Non-Member");

  // Get Non-Member hourly rate from tier_config (fallback $60)
  const nmRate = useMemo(() => {
    const tc = (tierCfg || []).find((t) => t.tier === "Non-Member");
    return Number(tc?.overage_rate || 60);
  }, [tierCfg]);

  // Build a set of charged booking IDs from payments
  const chargedBookingIds = useMemo(() => {
    const set = new Set();
    (payments || []).forEach((p) => { if (p.charged_booking_id) set.add(p.charged_booking_id); });
    return set;
  }, [payments]);

  // Non-members computed from bookings with per-booking detail
  const nonMem = useMemo(() => {
    if (!actMonth) return [];
    const monthDate = new Date(actMonth);
    const yr = monthDate.getUTCFullYear();
    const mo = monthDate.getUTCMonth();
    const memberSet = new Set(
      members.filter((m) => m.tier && m.tier !== "Non-Member").map((m) => m.email)
    );
    const stats = {};
    activeBk.forEach((b) => {
      if (memberSet.has(b.customer_email)) return;
      const bs = new Date(b.booking_start);
      if (isNaN(bs) || bs.getUTCFullYear() !== yr || bs.getUTCMonth() !== mo) return;
      if (!stats[b.customer_email]) {
        stats[b.customer_email] = {
          customer_email: b.customer_email,
          customer_name: b.customer_name,
          total_hours: 0,
          booking_count: 0,
          tier: "Non-Member",
          bookingIds: [],
        };
      }
      stats[b.customer_email].total_hours += Number(b.duration_hours || 0);
      stats[b.customer_email].booking_count += 1;
      stats[b.customer_email].bookingIds.push(b.booking_id);
      if (b.customer_name) stats[b.customer_email].customer_name = b.customer_name;
    });
    return Object.values(stats).sort((a, b) => b.total_hours - a.total_hours);
  }, [activeBk, members, actMonth]);

  // For each non-member, compute paid/unpaid counts
  function nmChargeStatus(r) {
    const paid = r.bookingIds.filter((id) => chargedBookingIds.has(id)).length;
    const unpaid = r.bookingIds.length - paid;
    return { paid, unpaid };
  }

  // Count total uncharged non-member bookings for batch button
  const totalUncharged = useMemo(() => {
    return nonMem.reduce((sum, r) => {
      return sum + r.bookingIds.filter((id) => !chargedBookingIds.has(id)).length;
    }, 0);
  }, [nonMem, chargedBookingIds]);

  const totOver = memMonth.reduce((s, r) => s + Number(r.overage_charge || 0), 0);
  const totHrs = memMonth.reduce((s, r) => s + Number(r.total_hours || 0), 0);

  function isPaid(email, month) {
    return payments.some((p) => p.member_email === email && p.billing_month === month && p.status === "succeeded");
  }

  async function handleBatchCharge() {
    if (batchLoading) return;
    setBatchLoading(true);
    try {
      await onChargeNonMembersBatch();
    } finally {
      setBatchLoading(false);
    }
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
                    {ho && pd && <span className="badge" style={{ background: "#4C8D73", fontSize: 9 }}>PAID</span>}
                    {ho && !pd && <span className="badge" style={{ background: "var(--red)", fontSize: 9 }}>UNPAID</span>}
                    {!ho && <span className="muted">&mdash;</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
        <h2 className="section-head" style={{ margin: 0 }}>Non-Members &mdash; {mL(actMonth)}</h2>
        {totalUncharged > 0 && (
          <button
            className="btn primary"
            style={{ fontSize: 11, padding: "4px 12px" }}
            disabled={saving || batchLoading}
            onClick={handleBatchCharge}
          >
            {batchLoading ? "Charging..." : `Charge All (${totalUncharged})`}
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        Rate: ${nmRate}/hr
      </div>
      <div className="tbl">
        <div className="th">
          <span style={{ flex: 2 }}>Customer</span>
          <span style={{ flex: 1 }} className="text-r">Hours</span>
          <span style={{ flex: 1 }} className="text-r">Sessions</span>
          <span style={{ flex: 1 }} className="text-r">Revenue</span>
          <span style={{ flex: 1 }} className="text-r">Status</span>
          <span style={{ flex: 1 }} className="text-c">Assign</span>
        </div>
        {nonMem.slice(0, 25).map((r) => {
          const { paid, unpaid } = nmChargeStatus(r);
          const revenue = Number(r.total_hours) * nmRate;

          return (
            <div key={r.customer_email} className="tr">
              <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(r.customer_email)}>
                <strong>{r.customer_name}</strong><br />
                <span className="email-sm">{r.customer_email}</span>
              </span>
              <span style={{ flex: 1 }} className="text-r tab-num">{hrs(r.total_hours)}</span>
              <span style={{ flex: 1 }} className="text-r tab-num">{r.booking_count}</span>
              <span style={{ flex: 1 }} className="text-r tab-num">${revenue.toFixed(0)}</span>
              <span style={{ flex: 1 }} className="text-r">
                {paid > 0 && unpaid === 0 && (
                  <span className="badge" style={{ background: "#4C8D73", fontSize: 9 }}>PAID</span>
                )}
                {paid > 0 && unpaid > 0 && (
                  <span className="badge" style={{ background: "var(--amber, #D97706)", fontSize: 9 }}>
                    {paid}/{r.booking_count} PAID
                  </span>
                )}
                {paid === 0 && unpaid > 0 && (
                  <button
                    className="btn primary"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                    disabled={saving}
                    onClick={(e) => {
                      e.stopPropagation();
                      const unchargedIds = r.bookingIds.filter((id) => !chargedBookingIds.has(id));
                      unchargedIds.forEach((id) => onChargeNonMember(id));
                    }}
                  >
                    Charge ${revenue.toFixed(0)}
                  </button>
                )}
                {r.booking_count === 0 && <span className="muted">&mdash;</span>}
              </span>
              <span style={{ flex: 1 }} className="text-c">
                <select className="tier-sel" value="Non-Member" onChange={(e) => onUpdateTier(r.customer_email, e.target.value, r.customer_name)}>
                  <option value="Non-Member">&mdash;</option>
                  {TIERS.filter((t) => t !== "Non-Member").map((t) => <option key={t}>{t}</option>)}
                </select>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
