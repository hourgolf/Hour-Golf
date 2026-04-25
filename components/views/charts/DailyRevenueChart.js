import { useMemo, useState } from "react";
import { computeTodayRevenue } from "../../../lib/today-revenue";

// Daily revenue line chart for the Reports → Revenue tab.
//
// Pulls one data point per day in the trailing window by running the
// same computeTodayRevenue helper that drives the TodayView KPI.
// That ties this chart's "today" value to the operator's familiar
// glance number — and any change to the formula (e.g. adjusting MRR
// share, adding new revenue components) flows through automatically.
//
// Caveats acknowledged in tooltip:
//   - MRR share uses today's member roster for every historical day.
//     If a member churned 5 days ago, their fee retroactively
//     disappears from the trailing 5 days too. For a live-run-rate
//     chart that's the right call (you want "what's the floor today
//     given who's paying right now"). The operator's monthly bar
//     chart elsewhere on this tab uses actual payments and is the
//     better source of historical truth for invoices/receipts.
//   - members.monthly_rate overrides honored same as the live calc.

const PT_TZ = "America/Los_Angeles";

function pacificToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: PT_TZ });
}

function shiftPacificDay(dateStr, deltaDays) {
  // dateStr is "YYYY-MM-DD" PT. Use noon UTC to avoid DST edge cases
  // on the day we add/subtract.
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatShortDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: PT_TZ, month: "short", day: "numeric" });
}

function dlr(n) {
  return `$${(Math.round(n) || 0).toLocaleString()}`;
}

export default function DailyRevenueChart({ bookings, members, tierCfg, days = 30 }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  // Build one row per day in the trailing window (oldest → today).
  const series = useMemo(() => {
    const today = pacificToday();
    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = shiftPacificDay(today, -i);
      const r = computeTodayRevenue({ bookings, members, tierCfg, viewDate: date });
      rows.push({ date, ...r });
    }
    return rows;
  }, [bookings, members, tierCfg, days]);

  const maxY = Math.max(1, ...series.map((s) => s.total));
  const avgTotal = series.reduce((sum, s) => sum + s.total, 0) / Math.max(1, series.length);

  // SVG layout. Use a viewBox so it scales with the container while
  // keeping the points + axes pixel-snapped on the rendered grid.
  const W = 800;
  const H = 240;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xAt = (i) => padL + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const yAt = (val) => padT + innerH - (val / maxY) * innerH;

  // Build a smoothed line path. Plain line segments — readable without
  // pulling in a smoothing library.
  const linePath = series
    .map((s, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(s.total).toFixed(1)}`)
    .join(" ");

  // Area fill below the line so the chart feels filled and the daily
  // floor reads at a glance.
  const areaPath = linePath
    + ` L ${xAt(series.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)}`
    + ` L ${xAt(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  // 4 horizontal grid lines at 0, 25%, 50%, 75%, 100% of maxY.
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + innerH - f * innerH,
    label: dlr(f * maxY),
  }));

  // X-axis labels: pick ~6 ticks evenly distributed.
  const tickCount = Math.min(series.length, 6);
  const tickIdxs = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / (tickCount - 1)) * (series.length - 1))
  );

  const hovered = hoverIdx != null ? series[hoverIdx] : null;

  return (
    <div className="rpt-card">
      <h3 className="rpt-sub-head">Daily Revenue (Last {days} Days)</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        Run-rate from non-member walk-ins + member overage on today's bookings + a daily share of MRR.
        Ties to the Today KPI — same calculation, hover any day for the breakdown.
      </p>

      <div style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", height: "auto" }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal grid + Y-axis labels */}
          {gridYs.map((g, i) => (
            <g key={i}>
              <line
                x1={padL} y1={g.y} x2={W - padR} y2={g.y}
                stroke="var(--border, rgba(0,0,0,0.08))"
                strokeWidth={i === 0 ? 1.5 : 1}
              />
              <text
                x={padL - 6} y={g.y + 4}
                textAnchor="end"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--text-muted)"
              >
                {g.label}
              </text>
            </g>
          ))}

          {/* Average reference line — dashed, primary color */}
          <line
            x1={padL} y1={yAt(avgTotal)} x2={W - padR} y2={yAt(avgTotal)}
            stroke="var(--primary)"
            strokeWidth="1"
            strokeDasharray="4,4"
            opacity="0.5"
          />
          <text
            x={W - padR - 4} y={yAt(avgTotal) - 4}
            textAnchor="end"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--primary)"
          >
            Avg {dlr(avgTotal)}
          </text>

          {/* Area + line */}
          <path d={areaPath} fill="var(--primary)" opacity="0.12" />
          <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2" />

          {/* Data points + invisible hover hit-areas */}
          {series.map((s, i) => (
            <g key={s.date}>
              <circle
                cx={xAt(i)}
                cy={yAt(s.total)}
                r={hoverIdx === i ? 5 : 3}
                fill={hoverIdx === i ? "var(--primary)" : "var(--surface, #fff)"}
                stroke="var(--primary)"
                strokeWidth="2"
              />
              {/* Wide invisible rect for easier mouse targeting */}
              <rect
                x={xAt(i) - (innerW / series.length) / 2}
                y={padT}
                width={innerW / series.length}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                style={{ cursor: "crosshair" }}
              />
            </g>
          ))}

          {/* Hover crosshair */}
          {hovered && (
            <line
              x1={xAt(hoverIdx)} x2={xAt(hoverIdx)}
              y1={padT} y2={padT + innerH}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="2,3"
              opacity="0.5"
            />
          )}

          {/* X-axis date labels */}
          {tickIdxs.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--font-mono)"
              fill="var(--text-muted)"
            >
              {formatShortDate(series[i].date)}
            </text>
          ))}
        </svg>

        {/* Floating tooltip — absolute-positioned beside the cursor */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              minWidth: 200,
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{formatShortDate(hovered.date)}</div>
            <Row label="Total" value={dlr(hovered.total)} bold />
            <Row label="Non-member" value={dlr(hovered.nonMember)} muted={hovered.nonMember === 0} />
            <Row label="Overage" value={dlr(hovered.memberOverage)} muted={hovered.memberOverage === 0} />
            <Row label="MRR / day" value={dlr(hovered.mrrShare)} muted={hovered.mrrShare === 0} />
            {hovered.breakdown && hovered.breakdown.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                <div style={{ marginBottom: 3, color: "var(--text-muted)" }}>Overage:</div>
                {hovered.breakdown.slice(0, 4).map((row) => (
                  <div key={row.email} style={{ fontSize: 11, lineHeight: 1.4 }}>
                    {row.name} — {dlr(row.overage_dollars)}
                  </div>
                ))}
                {hovered.breakdown.length > 4 && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    + {hovered.breakdown.length - 4} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, muted, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, lineHeight: 1.5 }}>
      <span style={{ color: muted ? "var(--text-muted)" : "var(--text)", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: muted ? "var(--text-muted)" : "var(--text)", fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}
