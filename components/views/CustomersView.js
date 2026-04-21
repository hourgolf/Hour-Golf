import { useMemo, useCallback } from "react";
import { TIERS } from "../../lib/constants";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";

// Small inline chip next to the customer name when their Stripe
// subscription is past_due or unpaid. Visible on both the desktop
// table and mobile card list.
function PastDueChip() {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        marginLeft: 6,
        borderRadius: 999,
        background: "var(--danger, #C92F1F)",
        color: "#EDF3E3",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        verticalAlign: "middle",
      }}
      title="Last Stripe charge failed — member was emailed a link to update their card"
    >
      Past Due
    </span>
  );
}

function exportCSV(rows, filename) {
  const header = "Member #,Name,Email,Tier,Hours,Sessions";
  const lines = rows.map((r) =>
    `"${r.member_number ? String(r.member_number).padStart(3, "0") : ""}","${(r.name || "").replace(/"/g, '""')}","${r.email}","${r.tier}","${r.hrs.toFixed(1)}","${r.cnt}"`
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
    // Seed paying members who have zero bookings in HG (e.g. members
    // backfilled from Skedda or newly-paid subs who haven't booked yet).
    // Without this they'd be invisible in the Customers tab — the header
    // count would say 73 members but the list would only show those with
    // at least one booking (caught on 2026-04-20 after Kristina + Peter
    // were backfilled and vanished from the list).
    members.forEach((mem) => {
      if (!mem?.email) return;
      if (!mem.tier || mem.tier === "Non-Member") return;
      if (m[mem.email]) return;
      m[mem.email] = { email: mem.email, name: mem.name || mem.email, hrs: 0, cnt: 0 };
    });
    return Object.values(m);
  }, [activeBk, members]);

  // Per-tier counts for the KPI strip + chip badges. Builds once from
  // the unique customer set so it matches the table the operator sees.
  // Includes a synthetic "Non-Member" bucket for customers without a
  // matching members row — what the existing tier filter calls "Non-Member".
  const tierCounts = useMemo(() => {
    const counts = { all: allCust.length, "Non-Member": 0 };
    TIERS.forEach((t) => { counts[t] = 0; });
    for (const c of allCust) {
      const m = members.find((x) => x.email === c.email);
      const t = m?.tier || "Non-Member";
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [allCust, members]);

  // Aggregate KPIs above the chip row. "Members" = anything not in the
  // Non-Member bucket; "Non-Members" stays separate so the operator can
  // see the paid-vs-walk-in split at a glance.
  const summary = useMemo(() => {
    const total = allCust.length;
    const nonMember = tierCounts["Non-Member"] || 0;
    // Stripe subscription lifecycle → past_due / unpaid members need
    // operator attention. We count both as "past due" here since the
    // operator-side action is identical for either.
    const pastDue = members.filter(
      (m) => m?.subscription_status === "past_due" || m?.subscription_status === "unpaid"
    ).length;
    return {
      total,
      members: Math.max(0, total - nonMember),
      nonMembers: nonMember,
      pastDue,
    };
  }, [allCust.length, tierCounts, members]);

  // Fast lookup of past-due status by email — used to paint a chip next
  // to the row name. O(1) lookup keeps the row renderer cheap.
  const pastDueEmails = useMemo(() => {
    const s = new Set();
    for (const m of members) {
      if (m?.email && (m.subscription_status === "past_due" || m.subscription_status === "unpaid")) {
        s.add(m.email);
      }
    }
    return s;
  }, [members]);

  const filtCust = useMemo(() => {
    let l = [...allCust];
    const q = search.toLowerCase();
    if (q) {
      // Strip # and leading zeros for member number search (e.g. "#042" or "42" both match member 42)
      const qNum = q.replace(/[#\s]/g, "").replace(/^0+/, "");
      l = l.filter((c) => {
        const m = members.find((x) => x.email === c.email);
        const memberNum = m?.member_number ? String(m.member_number) : "";
        return (c.name || "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (qNum && memberNum === qNum);
      });
    }
    if (cTier === "members") {
      // Synthetic segment: every paying tier (anything not Non-Member).
      l = l.filter((c) => {
        const m = members.find((x) => x.email === c.email);
        return (m?.tier || "Non-Member") !== "Non-Member";
      });
    } else if (cTier !== "all") {
      l = l.filter((c) => { const m = members.find((x) => x.email === c.email); return (m?.tier || "Non-Member") === cTier; });
    }
    if (cSort === "hours") l.sort((a, b) => b.hrs - a.hrs);
    else if (cSort === "name") l.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else l.sort((a, b) => b.cnt - a.cnt);
    return l;
  }, [allCust, search, cSort, cTier, members]);

  const handleExport = useCallback((tierFilter) => {
    const rows = allCust.map((c) => {
      const m = members.find((x) => x.email === c.email);
      return { ...c, tier: m?.tier || "Non-Member", member_number: m?.member_number || null };
    });
    const filtered = tierFilter === "all" ? rows : rows.filter((r) => r.tier === tierFilter);
    const sorted = [...filtered].sort((a, b) => {
      // Sort by member # if both have one, else by name
      if (a.member_number && b.member_number) return a.member_number - b.member_number;
      if (a.member_number) return -1;
      if (b.member_number) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
    const label = tierFilter === "all" ? "All-Customers" : tierFilter.replace(/\s+/g, "-");
    exportCSV(sorted, `HourGolf-${label}-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [allCust, members]);

  return (
    <div className="content">
      {/* KPI strip — matches the shape used on TodayView + WeekView so
          the at-a-glance bar reads the same across views. */}
      <div className="summary">
        <div className="sum-item"><span className="sum-val">{summary.total}</span><span className="sum-lbl">Customers</span></div>
        <div className="sum-item"><span className="sum-val">{summary.members}</span><span className="sum-lbl">Members</span></div>
        <div className="sum-item"><span className="sum-val">{summary.nonMembers}</span><span className="sum-lbl">Non-Members</span></div>
        {summary.pastDue > 0 && (
          <div
            className="sum-item"
            style={{ cursor: "pointer" }}
            onClick={() => setSearch("")}
            title="Members whose last Stripe charge failed — update their card"
          >
            <span className="sum-val" style={{ color: "var(--danger, #C92F1F)" }}>{summary.pastDue}</span>
            <span className="sum-lbl">Past Due</span>
          </div>
        )}
      </div>

      <input
        className="search"
        type="text"
        placeholder="Search by name, email, or member # (shortcut: /)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Tier chip row — replaces the dropdown for one-tap filtering.
          "All" / "Members" are quick segments above the per-tier row.
          Each chip shows its count so the operator can size the
          segment before clicking. */}
      <div className="cust-chips">
        <button
          type="button"
          className={`cust-chip ${cTier === "all" ? "active" : ""}`}
          onClick={() => setCTier("all")}
        >
          All <span className="cust-chip-count">{tierCounts.all}</span>
        </button>
        <button
          type="button"
          className={`cust-chip ${cTier === "members" ? "active" : ""}`}
          onClick={() => setCTier("members")}
          title="All paying tiers (excludes Non-Member)"
        >
          Members <span className="cust-chip-count">{summary.members}</span>
        </button>
        {TIERS.map((t) => {
          const n = tierCounts[t] || 0;
          if (n === 0 && t !== cTier) return null;
          return (
            <button
              type="button"
              key={t}
              className={`cust-chip ${cTier === t ? "active" : ""}`}
              onClick={() => setCTier(t)}
            >
              {t} <span className="cust-chip-count">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="fbar">
        <label>Sort:</label>
        <select value={cSort} onChange={(e) => setCSort(e.target.value)}>
          <option value="hours">Hours</option>
          <option value="sessions">Sessions</option>
          <option value="name">Name</option>
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
          const isPastDue = pastDueEmails.has(c.email);
          return (
            <div key={c.email} className="tr">
              <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(c.email)}>
                <strong>{c.name}</strong>
                {m?.member_number && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                    #{String(m.member_number).padStart(3, "0")}
                  </span>
                )}
                {isPastDue && <PastDueChip />}
                <br />
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
          const isPastDue = pastDueEmails.has(c.email);
          return (
            <div key={c.email} className="usage-card" onClick={() => onSelectMember(c.email)}>
              <div className="usage-card-top">
                <div>
                  <strong>{c.name}</strong>
                  {m?.member_number && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                      #{String(m.member_number).padStart(3, "0")}
                    </span>
                  )}
                  {isPastDue && <PastDueChip />}
                </div>
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
