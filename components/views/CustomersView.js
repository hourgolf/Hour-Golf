import { useMemo, useCallback } from "react";
import { TIERS } from "../../lib/constants";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";

function exportCSV(rows, filename) {
  const header = "Name,Email,Tier,Hours,Sessions";
  const lines = rows.map((r) =>
    `"${(r.name || "").replace(/"/g, '""')}","${r.email}","${r.tier}","${r.hrs.toFixed(1)}","${r.cnt}"`
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CustomersView({
  bookings, members,
  search, setSearch,
  cSort, setCSort,
  cTier, setCTier,
  onSelectMember, onUpdateTier,
}) {
  const activeBk = useMemo(() => bookings.filter((b) => b.booking_status !== "Cancelled"), [bookings]);

  const allCust = useMemo(() => {
    const m = {};
    activeBk.forEach((b) => {
      if (!m[b.customer_email]) m[b.customer_email] = { email: b.customer_email, name: b.customer_name, hrs: 0, cnt: 0 };
      m[b.customer_email].hrs += Number(b.duration_hours || 0);
      m[b.customer_email].cnt++;
      if (b.customer_name) m[b.customer_email].name = b.customer_name;
    });
    return Object.values(m);
  }, [activeBk]);

  const filtCust = useMemo(() => {
    let l = [...allCust];
    const q = search.toLowerCase();
    if (q) l = l.filter((c) => (c.name || "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    if (cTier !== "all") l = l.filter((c) => { const m = members.find((x) => x.email === c.email); return (m?.tier || "Non-Member") === cTier; });
    if (cSort === "hours") l.sort((a, b) => b.hrs - a.hrs);
    else if (cSort === "name") l.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else l.sort((a, b) => b.cnt - a.cnt);
    return l;
  }, [allCust, search, cSort, cTier, members]);

  const handleExport = useCallback((tierFilter) => {
    const rows = allCust.map((c) => {
      const m = members.find((x) => x.email === c.email);
      return { ...c, tier: m?.tier || "Non-Member" };
    });
    const filtered = tierFilter === "all" ? rows : rows.filter((r) => r.tier === tierFilter);
    const sorted = [...filtered].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const label = tierFilter === "all" ? "All-Customers" : tierFilter.replace(/\s+/g, "-");
    exportCSV(sorted, `HourGolf-${label}-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [allCust, members]);

  return (
    <div className="content">
      <input
        className="search"
        type="text"
        placeholder="Search name or email... (keyboard shortcut: /)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="fbar">
        <label>Sort:</label>
        <select value={cSort} onChange={(e) => setCSort(e.target.value)}>
          <option value="hours">Hours</option>
          <option value="sessions">Sessions</option>
          <option value="name">Name</option>
        </select>
        <label style={{ marginLeft: 12 }}>Tier:</label>
        <select value={cTier} onChange={(e) => setCTier(e.target.value)}>
          <option value="all">All</option>
          {TIERS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: 12 }}>{filtCust.length} results</span>
        <select
          style={{ marginLeft: "auto", fontSize: 11, padding: "4px 8px", border: "1.5px solid var(--border)", borderRadius: "var(--radius)", fontFamily: "var(--font-body)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}
          value=""
          onChange={(e) => { if (e.target.value) { handleExport(e.target.value); e.target.value = ""; } }}
        >
          <option value="" disabled>Export CSV</option>
          <option value="all">All Customers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Desktop table */}
      <div className="tbl usage-desktop">
        <div className="th">
          <span style={{ flex: 2 }}>Customer</span>
          <span style={{ flex: 1 }}>Tier</span>
          <span style={{ flex: 1 }} className="text-r">Hours</span>
          <span style={{ flex: 1 }} className="text-r">Sessions</span>
          <span style={{ flex: 1 }} className="text-c">Assign</span>
        </div>
        {filtCust.map((c) => {
          const m = members.find((x) => x.email === c.email);
          const tier = m?.tier || "Non-Member";
          return (
            <div key={c.email} className="tr">
              <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(c.email)}>
                <strong>{c.name}</strong><br />
                <span className="email-sm">{c.email}</span>
              </span>
              <span style={{ flex: 1 }}><Badge tier={tier} /></span>
              <span style={{ flex: 1 }} className="text-r tab-num">{c.hrs.toFixed(1)}h</span>
              <span style={{ flex: 1 }} className="text-r tab-num">{c.cnt}</span>
              <span style={{ flex: 1 }} className="text-c">
                <TierSelect value={tier} onChange={(t) => onUpdateTier(c.email, t, c.name)} />
              </span>
            </div>
          );
        })}
      </div>
      {/* Mobile cards */}
      <div className="usage-mobile">
        {filtCust.map((c) => {
          const m = members.find((x) => x.email === c.email);
          const tier = m?.tier || "Non-Member";
          return (
            <div key={c.email} className="usage-card" onClick={() => onSelectMember(c.email)}>
              <div className="usage-card-top">
                <strong>{c.name}</strong>
                <Badge tier={tier} />
              </div>
              <div className="usage-card-stats" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <div className="usage-card-stat">
                    <span className="usage-card-val tab-num">{c.hrs.toFixed(1)}h</span>
                    <span className="usage-card-lbl">Hours</span>
                  </div>
                  <div className="usage-card-stat">
                    <span className="usage-card-val tab-num">{c.cnt}</span>
                    <span className="usage-card-lbl">Sessions</span>
                  </div>
                </div>
                <div className="usage-card-stat" onClick={(e) => e.stopPropagation()}>
                  <TierSelect value={tier} onChange={(t) => onUpdateTier(c.email, t, c.name)} />
                  <span className="usage-card-lbl">Assign</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
