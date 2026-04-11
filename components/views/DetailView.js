import { useMemo, useState } from "react";
import { BAYS } from "../../lib/constants";
import { fT, fD, mL, hrs, dlr, allD } from "../../lib/format";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";
import BulkBar from "../ui/BulkBar";
import MemberProfileForm from "../settings/MemberProfileForm";

export default function DetailView({
  selMember, members, bookings, usage, payments, apiKey,
  bayFilter, setBayFilter, showCanc, setShowCanc,
  saving,
  onUpdateTier, onEdit, onCancel, onDelete, onRestore,
  onAddBooking, onChargeOverage,
  onBulkCancel, onBulkDelete, onRefresh,
}) {
  const [selected, setSelected] = useState(new Set());

  const selData = useMemo(() => {
    if (!selMember) return null;
    const mb = bookings.filter((b) => b.customer_email === selMember);
    let filtered = showCanc ? mb : mb.filter((b) => b.booking_status !== "Cancelled");
    if (bayFilter !== "all") filtered = filtered.filter((b) => b.bay === bayFilter);
    const activeBk = bookings.filter((b) => b.booking_status !== "Cancelled");
    const allCust = {};
    activeBk.forEach((b) => {
      if (!allCust[b.customer_email]) allCust[b.customer_email] = { email: b.customer_email, name: b.customer_name, hrs: 0, cnt: 0 };
      allCust[b.customer_email].hrs += Number(b.duration_hours || 0);
      allCust[b.customer_email].cnt++;
      if (b.customer_name) allCust[b.customer_email].name = b.customer_name;
    });
    return {
      member: members.find((m) => m.email === selMember),
      bookings: filtered,
      cancelledCount: mb.filter((b) => b.booking_status === "Cancelled").length,
      usage: usage.filter((r) => r.customer_email === selMember),
      customer: allCust[selMember],
    };
  }, [selMember, members, bookings, usage, showCanc, bayFilter]);

  function isPaid(email, month) {
    return payments.some((p) => p.member_email === email && p.billing_month === month && p.status === "succeeded");
  }

  function toggleSelect(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function selectAll(ids) {
    setSelected((s) => s.size === ids.length ? new Set() : new Set(ids));
  }

  if (!selData) return null;

  const nonCancelledIds = selData.bookings.filter((b) => b.booking_status !== "Cancelled").map((b) => b.booking_id);

  return (
    <div className="content">
            <div className="detail-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{selData.customer?.name || selMember}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <a
              href={`mailto:${selMember}`}
              className="email-sm"
              style={{ color: "var(--primary)", textDecoration: "underline" }}
              title="Send email"
            >
              {"\u2709"} {selMember}
            </a>
            {selData.member?.phone && (
              <a
                href={`sms:${selData.member.phone.replace(/[^\d+]/g, "")}`}
                className="email-sm"
                style={{ color: "var(--primary)", textDecoration: "underline" }}
                title="Send text message"
              >
                {"\u260E"} {selData.member.phone}
              </a>
            )}
            {selData.member?.stripe_customer_id && <span className="muted">Stripe &#10003;</span>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => onAddBooking(selMember)}>+ Booking</button>
          <TierSelect value={selData.member?.tier || "Non-Member"} onChange={(t) => onUpdateTier(selMember, t, selData.customer?.name)} />
        </div>
      </div>

      <MemberProfileForm member={selData.member} apiKey={apiKey} onSaved={onRefresh} />

      <h3 className="section-head">Monthly Breakdown</h3>
      <div className="tbl">
        <div className="th">
          <span style={{ flex: 1 }}>Month</span>
          <span style={{ flex: 1 }} className="text-r">Hours</span>
          <span style={{ flex: 1 }} className="text-r">Allot</span>
          <span style={{ flex: 1 }} className="text-r">Over</span>
          <span style={{ flex: 1 }} className="text-r">Charge</span>
          <span style={{ flex: 1 }} className="text-r">Status</span>
        </div>
        {selData.usage.map((u) => {
          const ho = Number(u.overage_charge) > 0;
          const pd = isPaid(u.customer_email, u.billing_month);
          const mr = members.find((m) => m.email === u.customer_email);
          const hasStripe = !!mr?.stripe_customer_id;
          return (
            <div key={u.billing_month} className="tr">
              <span style={{ flex: 1 }}>{mL(u.billing_month)}</span>
              <span style={{ flex: 1 }} className="text-r tab-num">{hrs(u.total_hours)}</span>
              <span style={{ flex: 1 }} className="text-r tab-num">{allD(u.included_hours)}</span>
              <span style={{ flex: 1 }} className={`text-r tab-num ${Number(u.overage_hours) > 0 ? "red" : ""}`}>
                {Number(u.overage_hours) > 0 ? hrs(u.overage_hours) : "\u2014"}
              </span>
              <span style={{ flex: 1 }} className={`text-r tab-num ${ho ? "red bold" : ""}`}>
                {ho ? dlr(u.overage_charge) : "\u2014"}
              </span>
              <span style={{ flex: 1 }} className="text-r">
                {ho && pd && <span className="badge" style={{ background: "#4a7c59", fontSize: 9 }}>PAID</span>}
                {ho && !pd && hasStripe && (
                  <button
                    className="btn primary"
                    style={{ fontSize: 10 }}
                    disabled={saving}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChargeOverage({
                        email: u.customer_email,
                        month: u.billing_month,
                        amount: Number(u.overage_charge),
                        stripe_customer_id: mr.stripe_customer_id,
                        name: u.customer_name,
                      });
                    }}
                  >
                    Charge {dlr(u.overage_charge)}
                  </button>
                )}
                {ho && !pd && !hasStripe && <span className="muted" style={{ fontSize: 10 }}>No Stripe</span>}
                {!ho && <span className="muted">&mdash;</span>}
              </span>
            </div>
          );
        })}
      </div>

      <h3 className="section-head" style={{ marginTop: 20 }}>
        <span>Bookings</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select className="tier-sel" style={{ fontSize: 10 }} value={bayFilter} onChange={(e) => setBayFilter(e.target.value)}>
            <option value="all">All Bays</option>
            {BAYS.map((b) => <option key={b}>{b}</option>)}
          </select>
          {selData.cancelledCount > 0 && (
            <button className="btn" style={{ fontSize: 10 }} onClick={() => setShowCanc(!showCanc)}>
              {showCanc ? "Hide" : "Show"} {selData.cancelledCount} canc.
            </button>
          )}
          <button className="btn primary" style={{ fontSize: 10 }} onClick={() => onAddBooking(selMember)}>+ Add</button>
        </span>
      </h3>

      <div className="tbl">
        <div className="th">
          <span style={{ width: 24 }}>
            <input
              type="checkbox"
              className="chk"
              checked={selected.size > 0 && selected.size === nonCancelledIds.length}
              onChange={() => selectAll(nonCancelledIds)}
            />
          </span>
          <span style={{ flex: 2 }}>Date</span>
          <span style={{ flex: 1 }}>Bay</span>
          <span style={{ flex: 1 }} className="text-r">Duration</span>
          <span style={{ flex: 1 }} className="text-r">Actions</span>
        </div>
        {selData.bookings.map((b, i) => {
          const d = new Date(b.booking_start);
          const e = new Date(b.booking_end);
          const ic = b.booking_status === "Cancelled";
          const im = (b.booking_id || "").startsWith("manual_");
          return (
            <div key={b.booking_id || i} className={`tr ${ic ? "cancelled" : ""} ${selected.has(b.booking_id) ? "selected" : ""}`}>
              <span style={{ width: 24 }}>
                {!ic && <input type="checkbox" className="chk" checked={selected.has(b.booking_id)} onChange={() => toggleSelect(b.booking_id)} />}
              </span>
              <span style={{ flex: 2 }}>
                {fD(d)} {fT(d)}&ndash;{fT(e)}
                {im && <span className="badge badge-sm" style={{ background: "var(--gold)", marginLeft: 6 }}>MANUAL</span>}
              </span>
              <span style={{ flex: 1 }}>{b.bay}</span>
              <span style={{ flex: 1 }} className="text-r tab-num">{hrs(b.duration_hours)}</span>
              <span style={{ flex: 1, display: "flex", gap: 4, justifyContent: "flex-end" }}>
                {ic ? (
                  <>
                    <button className="btn" style={{ fontSize: 10 }} onClick={() => onRestore(b)} disabled={saving}>Restore</button>
                    <button className="btn danger" style={{ fontSize: 10 }} onClick={() => onDelete(b)} disabled={saving}>Delete</button>
                  </>
                ) : (
                  <>
                    <button className="btn" style={{ fontSize: 10 }} onClick={() => onEdit(b)} disabled={saving}>Edit</button>
                    <button className="btn danger" style={{ fontSize: 10 }} onClick={() => onCancel(b)} disabled={saving}>Cancel</button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <BulkBar
        count={selected.size}
        onCancel={() => { onBulkCancel([...selected]); setSelected(new Set()); }}
        onDelete={() => { onBulkDelete([...selected]); setSelected(new Set()); }}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}
