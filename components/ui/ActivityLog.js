import { useEffect, useState } from "react";
import { supa } from "../../lib/supabase";
import { TZ } from "../../lib/constants";

// Displays admin audit-log rows from admin_activity_log. Used by
// DetailView (per-member) and ReportsView (global). Fetches on mount
// — rows are small and not refreshed on the 60s loop in useData.

const ACTION_LABELS = {
  "member.tier_changed": "Tier changed",
  "member.hours_adjusted": "Hours adjusted",
  "member.credits_adjusted": "Pro shop credits adjusted",
  "member.created": "Member created",
  "booking.cancelled": "Booking cancelled",
  "booking.deleted": "Booking deleted",
  "booking.restored": "Booking restored",
  "booking.created": "Booking created",
  "booking.edited": "Booking edited",
};

function labelFor(action) {
  return ACTION_LABELS[action] || action;
}

function timeAgo(iso) {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
}

function fmtBookingTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: TZ,
    });
  } catch {
    return iso;
  }
}

function summarize(row) {
  const m = row.metadata || {};
  switch (row.action) {
    case "member.tier_changed":
      return `${m.from || "—"} → ${m.to || "—"}`;
    case "member.hours_adjusted": {
      const delta = Number(m.delta || 0);
      const sign = delta > 0 ? "+" : "";
      const r = m.reason ? ` · ${m.reason}` : "";
      return `${sign}${delta}h${r}`;
    }
    case "member.credits_adjusted": {
      const delta = Number(m.delta || 0);
      const sign = delta > 0 ? "+" : "";
      const r = m.reason ? ` · ${m.reason}` : "";
      return `${sign}$${Math.abs(delta).toFixed(2)}${r}`;
    }
    case "member.created":
      return m.tier ? `Tier: ${m.tier}` : "";
    case "booking.cancelled":
    case "booking.deleted":
    case "booking.restored":
    case "booking.created":
    case "booking.edited": {
      const when = fmtBookingTime(m.start);
      const bay = m.bay ? ` · Bay ${m.bay}` : "";
      return when ? `${when}${bay}` : "";
    }
    default:
      return "";
  }
}

function targetLabel(row, includeTarget) {
  if (!includeTarget) return null;
  const m = row.metadata || {};
  if (row.target_type === "member") {
    return m.customer_name || row.target_id || null;
  }
  if (row.target_type === "booking") {
    return m.customer_name || m.member_email || null;
  }
  return row.target_id || null;
}

export default function ActivityLog({
  apiKey,
  targetType = null,
  targetId = null,
  limit = 30,
  emptyMessage = "No activity yet.",
  includeTarget = false,
}) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!apiKey) return;
    setRows(null);
    setErr(null);
    const params = new URLSearchParams();
    params.set(
      "select",
      "id,actor_email,action,target_type,target_id,metadata,created_at"
    );
    params.set("order", "created_at.desc");
    params.set("limit", String(limit));
    if (targetType) params.set("target_type", `eq.${targetType}`);
    if (targetId) params.set("target_id", `eq.${targetId}`);
    let cancelled = false;
    supa(apiKey, "admin_activity_log", `?${params.toString()}`)
      .then((r) => {
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey, targetType, targetId, limit]);

  if (err) {
    return <div className="muted" style={{ fontSize: 12 }}>Couldn't load activity ({err}).</div>;
  }
  if (rows === null) {
    return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="muted" style={{ fontSize: 12 }}>{emptyMessage}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row) => {
        const summary = summarize(row);
        const target = targetLabel(row, includeTarget);
        return (
          <div
            key={row.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "baseline",
              fontSize: 12,
              lineHeight: 1.4,
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              title={new Date(row.created_at).toLocaleString("en-US", { timeZone: TZ })}
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                minWidth: 64,
                fontSize: 11,
              }}
            >
              {timeAgo(row.created_at)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{labelFor(row.action)}</span>
              {target && (
                <>
                  {" · "}
                  <span>{target}</span>
                </>
              )}
              {summary && (
                <>
                  {" · "}
                  <span className="muted">{summary}</span>
                </>
              )}
            </span>
            {row.actor_email && (
              <span
                className="muted"
                style={{ fontSize: 11, whiteSpace: "nowrap" }}
                title={`by ${row.actor_email}`}
              >
                {row.actor_email.split("@")[0]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
