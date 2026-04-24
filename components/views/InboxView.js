import { useEffect, useMemo, useState } from "react";
import { supa } from "../../lib/supabase";
import { TZ } from "../../lib/constants";
import { pacificMonthWindow, dlr, hrs } from "../../lib/format";
import StatusBadge from "../ui/StatusBadge";

// The Inbox is the operator's "stuff needing attention" hub.
// Aggregates signals from data we're already loading (bookings,
// members, payments, tierCfg) plus one dedicated shop_items query
// for the low-stock card. Every card links to the canonical place
// the operator would resolve the issue — Inbox doesn't try to
// mutate data itself. It's a triage surface, not a workshop.

function InboxCard({ intent, title, count, children, action }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderLeft: `4px solid ${intentColor(intent)}`,
      borderRadius: "var(--radius)",
      padding: "14px 16px",
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)" }}>{title}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: intentColor(intent) }}>
            {count}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function intentColor(intent) {
  switch (intent) {
    case "danger": return "var(--danger, #C92F1F)";
    case "warning": return "#C77B3C";
    case "info": return "var(--primary)";
    default: return "var(--text-muted)";
  }
}

function fmtBookingTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: TZ,
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function InboxView({
  bookings, members, payments, tierCfg, apiKey,
  onSelectMember, setView, setCTier,
}) {
  const [lowStock, setLowStock] = useState(null);

  // Low-stock items pull — only what Inbox needs, keep it narrow.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    supa(apiKey, "shop_items", "?is_published=eq.true&select=id,title,brand,quantity_available,quantity_claimed&limit=200")
      .then((rows) => {
        if (cancelled) return;
        const out = (rows || [])
          .filter((i) => i.quantity_available != null)
          .map((i) => ({ ...i, remaining: i.quantity_available - (i.quantity_claimed || 0) }))
          .filter((i) => i.remaining <= 3)
          .sort((a, b) => a.remaining - b.remaining);
        setLowStock(out);
      })
      .catch(() => { if (!cancelled) setLowStock([]); });
    return () => { cancelled = true; };
  }, [apiKey]);

  // ── Conflicts (all-time) ──
  const conflictRows = useMemo(
    () => (bookings || [])
      .filter((b) => b.conflict_detected_at)
      .sort((a, b) => new Date(b.conflict_detected_at) - new Date(a.conflict_detected_at)),
    [bookings]
  );

  // ── Past Due ──
  const pastDueMembers = useMemo(
    () => (members || []).filter(
      (m) => m?.subscription_status === "past_due" || m?.subscription_status === "unpaid"
    ),
    [members]
  );

  // ── Non-members to charge (current Pacific month) ──
  const toChargeInfo = useMemo(() => {
    const { startISO, endISO } = pacificMonthWindow();
    const charged = new Set(
      (payments || [])
        .filter((p) => p.charged_booking_id)
        .map((p) => p.charged_booking_id)
    );
    const map = new Map();
    (bookings || []).forEach((b) => {
      if (b.booking_status === "Cancelled") return;
      const bookingTier = b.tier
        || (members || []).find((m) => m.email === b.customer_email)?.tier
        || "Non-Member";
      if (bookingTier !== "Non-Member") return;
      if (!b.booking_start || b.booking_start < startISO || b.booking_start >= endISO) return;
      if (charged.has(b.booking_id)) return;
      const hrsVal = Number(b.duration_hours || 0);
      if (hrsVal <= 0) return;
      const existing = map.get(b.customer_email) || {
        email: b.customer_email,
        name: b.customer_name || b.customer_email,
        hours: 0,
        count: 0,
      };
      existing.hours += hrsVal;
      existing.count += 1;
      if (b.customer_name) existing.name = b.customer_name;
      map.set(b.customer_email, existing);
    });
    const nmRate = Number(
      (tierCfg || []).find((t) => t.tier === "Non-Member")?.overage_rate || 60
    );
    const rows = Array.from(map.values()).map((r) => ({ ...r, owed: r.hours * nmRate }));
    const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
    return { rows, totalOwed, nmRate };
  }, [bookings, members, payments, tierCfg]);

  // Empty state detection.
  const anyConflicts = conflictRows.length > 0;
  const anyPastDue = pastDueMembers.length > 0;
  const anyToCharge = toChargeInfo.rows.length > 0;
  const anyLowStock = lowStock && lowStock.length > 0;
  const lowStockLoading = lowStock === null;
  const isEmpty = !anyConflicts && !anyPastDue && !anyToCharge && !anyLowStock && !lowStockLoading;

  function goto(view, extra) {
    if (extra?.cTier) setCTier?.(extra.cTier);
    setView?.(view);
  }

  function miniBtn(label, onClick, intent = "neutral") {
    const colors = {
      danger: { bg: "var(--danger, #C92F1F)", color: "#EDF3E3" },
      warning: { bg: "#C77B3C", color: "#EDF3E3" },
      info: { bg: "var(--primary)", color: "#EDF3E3" },
      neutral: { bg: "var(--surface)", color: "var(--text)" },
    }[intent] || {};
    return (
      <button
        type="button"
        className="btn"
        style={{ fontSize: 11, padding: "6px 12px", background: colors.bg, color: colors.color, border: intent === "neutral" ? "1px solid var(--border)" : "none", whiteSpace: "nowrap" }}
        onClick={onClick}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="content">
      <h2 className="section-head" style={{ marginTop: 0 }}>Inbox</h2>

      {isEmpty && (
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "32px 16px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Inbox zero</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            No conflicts, no past-due members, no uncharged non-members, nothing low on stock.
          </div>
        </div>
      )}

      {anyConflicts && (
        <InboxCard
          intent="danger"
          title="Booking conflicts"
          count={conflictRows.length}
          action={miniBtn("Resolve in Reports", () => goto("reports"), "danger")}
        >
          {conflictRows.slice(0, 3).map((b) => (
            <div key={b.booking_id} style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0" }}>
              <strong style={{ color: "var(--text)" }}>{b.customer_name || b.customer_email}</strong>
              {" · "}
              {fmtBookingTime(b.booking_start)}
              {b.bay ? ` · ${b.bay}` : ""}
            </div>
          ))}
          {conflictRows.length > 3 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>+{conflictRows.length - 3} more</div>
          )}
        </InboxCard>
      )}

      {anyPastDue && (
        <InboxCard
          intent="warning"
          title="Past-due members"
          count={pastDueMembers.length}
          action={miniBtn("Open Customers", () => goto("customers"), "warning")}
        >
          {pastDueMembers.slice(0, 3).map((m) => (
            <div
              key={m.email}
              onClick={() => onSelectMember?.(m.email)}
              style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0", cursor: "pointer" }}
              role="button"
            >
              <strong style={{ color: "var(--text)" }}>{m.name || m.email}</strong>
              <span className="muted"> · {m.email}</span>
              <StatusBadge intent="warning" style={{ marginLeft: 6, fontSize: 8 }}>
                {(m.subscription_status || "").toUpperCase()}
              </StatusBadge>
            </div>
          ))}
          {pastDueMembers.length > 3 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>+{pastDueMembers.length - 3} more</div>
          )}
        </InboxCard>
      )}

      {anyToCharge && (
        <InboxCard
          intent="info"
          title={`Non-members to charge this month (${toChargeInfo.rows.length})`}
          count={dlr(toChargeInfo.totalOwed)}
          action={miniBtn("Batch charge in Customers", () => goto("customers", { cTier: "__tocharge__" }), "info")}
        >
          {toChargeInfo.rows.slice(0, 3).map((r) => (
            <div
              key={r.email}
              onClick={() => onSelectMember?.(r.email)}
              style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0", cursor: "pointer" }}
              role="button"
            >
              <strong style={{ color: "var(--text)" }}>{r.name}</strong>
              <span className="muted"> · {hrs(r.hours)} · {dlr(r.owed)}</span>
            </div>
          ))}
          {toChargeInfo.rows.length > 3 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>+{toChargeInfo.rows.length - 3} more</div>
          )}
        </InboxCard>
      )}

      {lowStockLoading && (
        <InboxCard intent="neutral" title="Low stock" count="…" />
      )}

      {anyLowStock && (
        <InboxCard
          intent="warning"
          title="Low stock items"
          count={lowStock.length}
          action={miniBtn("Open Pro Shop", () => goto("shop"), "warning")}
        >
          {lowStock.slice(0, 3).map((i) => (
            <div key={i.id} style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0" }}>
              <strong style={{ color: "var(--text)" }}>{i.title}</strong>
              {i.brand && <span className="muted"> · {i.brand}</span>}
              <span style={{ marginLeft: 6, color: i.remaining === 0 ? "var(--danger, #C92F1F)" : "inherit", fontWeight: 600 }}>
                {i.remaining === 0 ? "SOLD OUT" : `${i.remaining} left`}
              </span>
            </div>
          ))}
          {lowStock.length > 3 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>+{lowStock.length - 3} more</div>
          )}
        </InboxCard>
      )}
    </div>
  );
}
