import { useMemo, useCallback, useState } from "react";
import { TIERS } from "../../lib/constants";
import { pacificMonthTag, pacificMonthWindow, mL, dlr, hrs } from "../../lib/format";
import { remainingOverageCents, overageStatus } from "../../lib/overage";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";
import KPIStrip from "../ui/KPIStrip";

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

// Launch-adoption chip. Green dot next to members who have at least
// one successful app login recorded. Absence is meaningful — helps the
// operator identify who still needs a nudge to install.
function OnAppChip() {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        marginLeft: 6,
        borderRadius: 999,
        background: "var(--primary)",
        color: "#EDF3E3",
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        verticalAlign: "middle",
      }}
      title="Has logged into the member app at least once"
    >
      App
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
  bookings, members, usage = [], payments = [], tierCfg = [],
  search, setSearch,
  cSort, setCSort,
  cTier, setCTier,
  onSelectMember, onUpdateTier,
  onChargeNonMember, onChargeNonMembersBatch, saving,
}) {
  const [batchLoading, setBatchLoading] = useState(false);
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
    // Launch adoption: how many paying members have logged into the app.
    // first_app_login_at is stamped by member-auth.js on first successful
    // login (or backfilled from member_sessions on migration). The KPI
    // ratio "<X> of <paying> on app" is the single clearest launch-day
    // metric.
    const payingMembers = members.filter(
      (m) => m?.tier && m.tier !== "Non-Member"
    );
    const onApp = payingMembers.filter((m) => !!m.first_app_login_at).length;
    return {
      total,
      members: Math.max(0, total - nonMember),
      nonMembers: nonMember,
      pastDue,
      onApp,
      payingTotal: payingMembers.length,
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

  // Same pattern for launch-day "has this member logged in yet?" chip.
  const onAppEmails = useMemo(() => {
    const s = new Set();
    for (const m of members) {
      if (m?.email && m.first_app_login_at) s.add(m.email);
    }
    return s;
  }, [members]);

  // ── Billing overlays (moved from OverviewView) ────────────────────
  // Current Pacific-month tag + window. All overage / to-charge math
  // below is scoped to this window so it matches what the member sees
  // on their own dashboard and what monthly_usage reports.
  const currentMonthTag = useMemo(() => pacificMonthTag(), []);
  const currentMonthWindow = useMemo(() => pacificMonthWindow(), []);
  const billingMonthISO = useMemo(
    () => `${currentMonthTag}-01T00:00:00+00:00`,
    [currentMonthTag]
  );

  // Members with remaining overage this month → chip "Overage". Pulls
  // from the monthly_usage view, then reconciles against payments via
  // remainingOverageCents so refunded / partial rows don't surface as
  // UNPAID when the money is actually in.
  const overageRowByEmail = useMemo(() => {
    const map = new Map();
    (usage || []).forEach((r) => {
      if (r.billing_month !== billingMonthISO) return;
      if (!r.tier || r.tier === "Non-Member") return;
      const row = {
        ...r,
        customer_email: r.customer_email || r.email || "",
        customer_name: r.customer_name || r.name || "",
      };
      if (Number(row.overage_hours || 0) <= 0) return;
      if (remainingOverageCents(row, payments) <= 0) return;
      map.set(row.customer_email, row);
    });
    return map;
  }, [usage, payments, billingMonthISO]);

  // Non-members with uncharged bookings this month → chip "To charge".
  // Same snapshot-tier discipline as OverviewView: historic Non-Member
  // bookings stay classified as Non-Member even if the member later
  // upgraded, because the booking's tier was stamped at creation time.
  const chargedBookingIds = useMemo(() => {
    const s = new Set();
    (payments || []).forEach((p) => {
      if (p.charged_booking_id) s.add(p.charged_booking_id);
    });
    return s;
  }, [payments]);

  const nmRate = useMemo(() => {
    const tc = (tierCfg || []).find((t) => t.tier === "Non-Member");
    return Number(tc?.overage_rate || 60);
  }, [tierCfg]);

  const toChargeInfoByEmail = useMemo(() => {
    const { startISO, endISO } = currentMonthWindow;
    const start = startISO;
    const end = endISO;
    const map = new Map();
    activeBk.forEach((b) => {
      const bookingTier = b.tier
        || members.find((m) => m.email === b.customer_email)?.tier
        || "Non-Member";
      if (bookingTier !== "Non-Member") return;
      if (!b.booking_start || b.booking_start < start || b.booking_start >= end) return;
      if (chargedBookingIds.has(b.booking_id)) return;
      const hours = Number(b.duration_hours || 0);
      if (hours <= 0) return;
      const existing = map.get(b.customer_email) || {
        email: b.customer_email,
        name: b.customer_name || b.customer_email,
        hours: 0,
        count: 0,
        bookingIds: [],
      };
      existing.hours += hours;
      existing.count += 1;
      existing.bookingIds.push(b.booking_id);
      if (b.customer_name) existing.name = b.customer_name;
      map.set(b.customer_email, existing);
    });
    return map;
  }, [activeBk, members, chargedBookingIds, currentMonthWindow]);

  const overageCount = overageRowByEmail.size;
  const toChargeCount = toChargeInfoByEmail.size;
  const totalUnchargedBookings = useMemo(
    () =>
      Array.from(toChargeInfoByEmail.values()).reduce(
        (sum, r) => sum + r.bookingIds.length,
        0
      ),
    [toChargeInfoByEmail]
  );
  // Dollar totals for the billing chips — visible at a glance so the
  // operator doesn't have to tap a chip to learn the magnitude of
  // what's outstanding.
  const overageTotalUsd = useMemo(() => {
    let cents = 0;
    overageRowByEmail.forEach((row) => {
      cents += remainingOverageCents(row, payments);
    });
    return cents / 100;
  }, [overageRowByEmail, payments]);
  const toChargeTotalUsd = useMemo(() => {
    let total = 0;
    toChargeInfoByEmail.forEach((info) => {
      total += (info.hours || 0) * nmRate;
    });
    return total;
  }, [toChargeInfoByEmail, nmRate]);

  const isBillingFilter = cTier === "__overage__" || cTier === "__tocharge__";

  const filtCust = useMemo(() => {
    let l = [...allCust];
    // Seed to-charge rows that don't already exist in allCust (e.g. a
    // walk-in whose booking hasn't been aggregated yet) so the chip count
    // matches what renders.
    if (cTier === "__tocharge__") {
      toChargeInfoByEmail.forEach((info, email) => {
        if (!l.find((c) => c.email === email)) {
          l.push({ email, name: info.name, hrs: info.hours, cnt: info.count });
        }
      });
    }
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
    if (cTier === "__overage__") {
      l = l.filter((c) => overageRowByEmail.has(c.email));
    } else if (cTier === "__tocharge__") {
      l = l.filter((c) => toChargeInfoByEmail.has(c.email));
    } else if (cTier === "members") {
      // Synthetic segment: every paying tier (anything not Non-Member).
      l = l.filter((c) => {
        const m = members.find((x) => x.email === c.email);
        return (m?.tier || "Non-Member") !== "Non-Member";
      });
    } else if (cTier !== "all") {
      l = l.filter((c) => { const m = members.find((x) => x.email === c.email); return (m?.tier || "Non-Member") === cTier; });
    }
    if (cTier === "__overage__") {
      l.sort((a, b) => {
        const ra = remainingOverageCents(overageRowByEmail.get(a.email) || {}, payments);
        const rb = remainingOverageCents(overageRowByEmail.get(b.email) || {}, payments);
        return rb - ra;
      });
    } else if (cTier === "__tocharge__") {
      l.sort((a, b) => {
        const ia = toChargeInfoByEmail.get(a.email);
        const ib = toChargeInfoByEmail.get(b.email);
        return (ib?.hours || 0) - (ia?.hours || 0);
      });
    } else if (cSort === "hours") l.sort((a, b) => b.hrs - a.hrs);
    else if (cSort === "name") l.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else l.sort((a, b) => b.cnt - a.cnt);
    return l;
  }, [allCust, search, cSort, cTier, members, overageRowByEmail, toChargeInfoByEmail, payments]);

  async function handleBatchCharge() {
    if (batchLoading || !onChargeNonMembersBatch) return;
    setBatchLoading(true);
    try {
      await onChargeNonMembersBatch();
    } finally {
      setBatchLoading(false);
    }
  }

  // ── Multi-select state for bulk actions ──────────────────────────
  const [selectedEmails, setSelectedEmails] = useState(() => new Set());
  // Sync selection against the visible filter — when the operator
  // switches tier chips we drop selections for rows that just left the
  // list so the bulk bar count doesn't lie.
  const visibleEmails = useMemo(() => new Set(filtCust.map((c) => c.email)), [filtCust]);
  const effectiveSelected = useMemo(() => {
    const s = new Set();
    selectedEmails.forEach((e) => { if (visibleEmails.has(e)) s.add(e); });
    return s;
  }, [selectedEmails, visibleEmails]);
  const allVisibleSelected = filtCust.length > 0 && effectiveSelected.size === filtCust.length;

  function toggleRow(email) {
    setSelectedEmails((prev) => {
      const n = new Set(prev);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });
  }

  function toggleAllVisible() {
    setSelectedEmails((prev) => {
      if (allVisibleSelected) {
        const n = new Set(prev);
        filtCust.forEach((c) => n.delete(c.email));
        return n;
      }
      const n = new Set(prev);
      filtCust.forEach((c) => n.add(c.email));
      return n;
    });
  }

  function clearSelection() {
    setSelectedEmails(new Set());
  }

  function bulkExport() {
    const rows = Array.from(effectiveSelected).map((email) => {
      const c = allCust.find((x) => x.email === email) || { email, name: "", hrs: 0, cnt: 0 };
      const m = members.find((x) => x.email === email);
      return {
        ...c,
        tier: m?.tier || "Non-Member",
        member_number: m?.member_number || null,
      };
    });
    exportCSV(
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      `HourGolf-Selected-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  async function bulkChangeTier(newTier) {
    if (!onUpdateTier || !newTier) return;
    const emails = Array.from(effectiveSelected);
    if (emails.length === 0) return;
    if (!confirm(`Change tier of ${emails.length} customer${emails.length === 1 ? "" : "s"} to "${newTier}"?`)) return;
    // Sequential, not parallel: admin-update-tier does a Stripe lookup
    // on first-time paying-tier flips, and we don't want to hammer the
    // Stripe API with N parallel searches. N is typically small (<20)
    // so the total time is fine.
    for (const email of emails) {
      const c = allCust.find((x) => x.email === email);
      try {
        await onUpdateTier(email, newTier, c?.name || "");
      } catch (e) {
        // onUpdateTier surfaces its own toasts; continue through the
        // batch so one failure doesn't abandon the rest.
        console.warn("bulk tier change failed for", email, e);
      }
    }
    clearSelection();
  }

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
      <KPIStrip items={[
        { label: "Customers", value: summary.total },
        { label: "Members", value: summary.members },
        { label: "Non-Members", value: summary.nonMembers },
        summary.pastDue > 0 && {
          label: "Past Due",
          value: summary.pastDue,
          color: "var(--danger, #C92F1F)",
          onClick: () => setSearch(""),
          title: "Members whose last Stripe charge failed \u2014 update their card",
        },
        // Billing hotspots — only render when money is actually on
        // the table. Clicking jumps to the relevant chip filter so
        // the operator can act without scrolling.
        overageTotalUsd > 0 && {
          label: `Overage (${mL(billingMonthISO)})`,
          value: dlr(overageTotalUsd),
          color: "var(--danger, #C92F1F)",
          onClick: () => setCTier("__overage__"),
          title: `Remaining overage for ${mL(billingMonthISO)} across ${overageCount} member${overageCount === 1 ? "" : "s"}`,
        },
        toChargeTotalUsd > 0 && {
          label: `To Charge (${mL(billingMonthISO)})`,
          value: dlr(toChargeTotalUsd),
          color: "#C77B3C",
          onClick: () => setCTier("__tocharge__"),
          title: `${totalUnchargedBookings} uncharged non-member booking${totalUnchargedBookings === 1 ? "" : "s"} across ${toChargeCount} customer${toChargeCount === 1 ? "" : "s"}`,
        },
        summary.payingTotal > 0 && {
          label: "On App",
          color: "var(--primary)",
          value: (
            <>
              {summary.onApp}
              <span style={{ fontSize: "0.55em", opacity: 0.6, fontWeight: 500 }}>
                {" "}/ {summary.payingTotal}
              </span>
            </>
          ),
          title: "Paying members who have ever logged into the app (launch adoption)",
        },
      ]} />

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
        {/* Billing filter chips — replace the old "Usage" tab. These only
            render when there's something to act on this month, so the
            chip row doesn't carry empty noise on quiet months. The
            $ amount is on the chip face (not just in a title tooltip)
            so the operator can size the billing load at a glance. */}
        {overageCount > 0 && (
          <button
            type="button"
            className={`cust-chip cust-chip-billing ${cTier === "__overage__" ? "active" : ""}`}
            onClick={() => setCTier("__overage__")}
            title={`Paying members with remaining overage for ${mL(billingMonthISO)}`}
            style={{
              borderColor: "var(--danger, #C92F1F)",
              color: cTier === "__overage__" ? "#EDF3E3" : "var(--danger, #C92F1F)",
              background: cTier === "__overage__" ? "var(--danger, #C92F1F)" : "var(--surface)",
            }}
          >
            Overage <strong style={{ fontFamily: "var(--font-mono)", marginLeft: 2 }}>{dlr(overageTotalUsd)}</strong>
            <span className="cust-chip-count">{overageCount}</span>
          </button>
        )}
        {toChargeCount > 0 && (
          <button
            type="button"
            className={`cust-chip cust-chip-billing ${cTier === "__tocharge__" ? "active" : ""}`}
            onClick={() => setCTier("__tocharge__")}
            title={`Non-members with uncharged bookings in ${mL(billingMonthISO)} (walk-in rate $${nmRate}/hr)`}
            style={{
              borderColor: "#C77B3C",
              color: cTier === "__tocharge__" ? "#EDF3E3" : "#C77B3C",
              background: cTier === "__tocharge__" ? "#C77B3C" : "var(--surface)",
            }}
          >
            To charge <strong style={{ fontFamily: "var(--font-mono)", marginLeft: 2 }}>{dlr(toChargeTotalUsd)}</strong>
            <span className="cust-chip-count">{toChargeCount}</span>
          </button>
        )}
      </div>

      {isBillingFilter && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            marginBottom: 12,
            background: "var(--primary-bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: 12,
          }}
        >
          <span>
            {cTier === "__overage__" && (
              <>
                <strong>{filtCust.length}</strong> paying member{filtCust.length === 1 ? "" : "s"} with remaining overage for{" "}
                <strong>{mL(billingMonthISO)}</strong>. Click a row to open their breakdown; charge from the Detail view.
              </>
            )}
            {cTier === "__tocharge__" && (
              <>
                <strong>{totalUnchargedBookings}</strong> uncharged non-member booking{totalUnchargedBookings === 1 ? "" : "s"} in{" "}
                <strong>{mL(billingMonthISO)}</strong> across <strong>{filtCust.length}</strong> customer{filtCust.length === 1 ? "" : "s"} (${nmRate}/hr).
              </>
            )}
          </span>
          {cTier === "__tocharge__" && totalUnchargedBookings > 0 && (
            <button
              className="btn primary"
              style={{ fontSize: 11, padding: "4px 12px", marginLeft: "auto" }}
              disabled={saving || batchLoading}
              onClick={handleBatchCharge}
            >
              {batchLoading ? "Charging…" : `Charge all (${totalUnchargedBookings})`}
            </button>
          )}
        </div>
      )}

      <div className="fbar">
        <label>Sort:</label>
        <select value={cSort} onChange={(e) => setCSort(e.target.value)} disabled={isBillingFilter}>
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
          <span style={{ width: 28, flex: "0 0 28px", display: "flex", justifyContent: "center" }}>
            <input
              type="checkbox"
              className="chk"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              aria-label="Select all visible"
            />
          </span>
          <span style={{ flex: 2 }}>Customer</span>
          <span style={{ flex: 1 }}>Tier</span>
          <span style={{ flex: 1 }} className="text-r">Hours</span>
          <span style={{ flex: 1 }} className="text-r">Sessions</span>
          {cTier === "__overage__" && <span style={{ flex: 1 }} className="text-r">Owed</span>}
          {cTier === "__tocharge__" && <span style={{ flex: 1 }} className="text-r">Charge</span>}
          <span style={{ flex: 1 }} className="text-c">
            {cTier === "__tocharge__" ? "Action" : "Assign"}
          </span>
        </div>
        {filtCust.map((c) => {
          const m = members.find((x) => x.email === c.email);
          const tier = m?.tier || "Non-Member";
          const isPastDue = pastDueEmails.has(c.email);
          const isOnApp = onAppEmails.has(c.email);
          const overageRow = overageRowByEmail.get(c.email);
          const toChargeInfo = toChargeInfoByEmail.get(c.email);
          const remainingCents = overageRow ? remainingOverageCents(overageRow, payments) : 0;
          const remainingUsd = remainingCents / 100;
          const status = overageRow ? overageStatus(overageRow, payments) : "none";
          const chargeAmountUsd = toChargeInfo ? toChargeInfo.hours * nmRate : 0;
          return (
            <div key={c.email} className="tr">
              <span
                style={{ width: 28, flex: "0 0 28px", display: "flex", justifyContent: "center" }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="chk"
                  checked={effectiveSelected.has(c.email)}
                  onChange={() => toggleRow(c.email)}
                  aria-label={`Select ${c.name || c.email}`}
                />
              </span>
              <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(c.email)}>
                <strong>{c.name}</strong>
                {m?.member_number && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                    #{String(m.member_number).padStart(3, "0")}
                  </span>
                )}
                {isOnApp && <OnAppChip />}
                {isPastDue && <PastDueChip />}
                <br />
                <span className="email-sm">{c.email}</span>
              </span>
              <span style={{ flex: 1 }}><Badge tier={tier} /></span>
              <span style={{ flex: 1 }} className="text-r tab-num">
                {cTier === "__tocharge__" && toChargeInfo ? hrs(toChargeInfo.hours) : `${c.hrs.toFixed(1)}h`}
              </span>
              <span style={{ flex: 1 }} className="text-r tab-num">
                {cTier === "__tocharge__" && toChargeInfo ? toChargeInfo.count : c.cnt}
              </span>
              {cTier === "__overage__" && (
                <span
                  style={{ flex: 1 }}
                  className={`text-r tab-num ${remainingCents > 0 ? "red bold" : ""}`}
                  title={status === "partial" ? `Partially paid — ${dlr(remainingUsd)} remaining` : undefined}
                >
                  {dlr(remainingUsd)}
                </span>
              )}
              {cTier === "__tocharge__" && (
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {dlr(chargeAmountUsd)}
                </span>
              )}
              <span style={{ flex: 1 }} className="text-c">
                {cTier === "__tocharge__" && toChargeInfo ? (
                  <button
                    className="btn primary"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                    disabled={saving || batchLoading || !onChargeNonMember}
                    onClick={(e) => {
                      e.stopPropagation();
                      toChargeInfo.bookingIds.forEach((id) => onChargeNonMember(id));
                    }}
                  >
                    Charge {dlr(chargeAmountUsd)}
                  </button>
                ) : (
                  <TierSelect value={tier} onChange={(t) => onUpdateTier(c.email, t, c.name)} />
                )}
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
          const isOnApp = onAppEmails.has(c.email);
          return (
            <div key={c.email} className="usage-card" onClick={() => onSelectMember(c.email)}>
              <div className="usage-card-top">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    className="chk"
                    checked={effectiveSelected.has(c.email)}
                    onChange={() => toggleRow(c.email)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${c.name || c.email}`}
                  />
                  <div>
                  <strong>{c.name}</strong>
                  {m?.member_number && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                      #{String(m.member_number).padStart(3, "0")}
                    </span>
                  )}
                  {isOnApp && <OnAppChip />}
                {isPastDue && <PastDueChip />}
                  </div>
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

      {effectiveSelected.size > 0 && (
        <div className="bulk-bar">
          <span>{effectiveSelected.size} selected</span>
          {cTier !== "__tocharge__" && (
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                bulkChangeTier(e.target.value);
                e.target.value = "";
              }}
              style={{ fontSize: 12, padding: "4px 8px" }}
              title="Change tier for selected customers"
            >
              <option value="" disabled>Change tier…</option>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button onClick={bulkExport}>Export CSV</button>
          <button onClick={clearSelection}>Clear</button>
        </div>
      )}
    </div>
  );
}
