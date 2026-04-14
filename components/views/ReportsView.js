import { useMemo, useState } from "react";
import { TIERS, TIER_COLORS, BAYS, TZ } from "../../lib/constants";
import { mL, hrs, dlr } from "../../lib/format";
import Badge from "../ui/Badge";

/* ── helpers ────────────────────────────────────── */

function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) : "0.0"; }
function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(k) {
  const [y, m] = k.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[+m - 1]} ${y}`;
}
function monthLabelShort(k) {
  const [, m] = k.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names[+m - 1];
}
function localHour(iso) {
  return new Date(iso).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: TZ });
}
function localDow(iso) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
}

const DOW_ORDER = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const HOUR_LABELS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am–9pm

/* ── sub-sections (toggle) ──────────────────────── */
const SECTIONS = [
  { key: "revenue", label: "Revenue" },
  { key: "usage",   label: "Usage" },
  { key: "members", label: "Members" },
  { key: "passes",  label: "Punch Passes" },
];

/* ══════════════════════════════════════════════════ */
export default function ReportsView({ members, bookings, tierCfg, payments }) {
  const [section, setSection] = useState("revenue");
  const [selMonth, setSelMonth] = useState(null); // null = "All Time"

  const activeBk = useMemo(
    () => (bookings || []).filter((b) => b.booking_status !== "Cancelled"),
    [bookings]
  );
  const allBk = bookings || [];

  // Available months from bookings
  const allMonths = useMemo(() => {
    const set = new Set();
    activeBk.forEach((b) => set.add(monthKey(new Date(b.booking_start))));
    return [...set].sort().reverse();
  }, [activeBk]);

  // Filtered bookings for the selected month
  const filteredBk = useMemo(() => {
    if (!selMonth) return activeBk;
    return activeBk.filter((b) => monthKey(new Date(b.booking_start)) === selMonth);
  }, [activeBk, selMonth]);

  const filteredAllBk = useMemo(() => {
    if (!selMonth) return allBk;
    return allBk.filter((b) => monthKey(new Date(b.booking_start)) === selMonth);
  }, [allBk, selMonth]);

  // Tier config lookup
  const tierMap = useMemo(() => {
    const m = {};
    (tierCfg || []).forEach((t) => { m[t.tier] = t; });
    return m;
  }, [tierCfg]);

  // Active members (with a real tier)
  const activeMembers = useMemo(
    () => (members || []).filter((m) => m.tier && m.tier !== "Non-Member"),
    [members]
  );

  /* ── REVENUE data ───────────────────────────────── */
  const revenue = useMemo(() => {
    // MRR by tier (always current snapshot)
    const byTier = {};
    TIERS.filter((t) => t !== "Non-Member").forEach((t) => {
      const count = activeMembers.filter((m) => m.tier === t).length;
      const fee = Number(tierMap[t]?.monthly_fee || 0);
      byTier[t] = { count, fee, total: count * fee };
    });
    const mrr = Object.values(byTier).reduce((s, v) => s + v.total, 0);

    // Non-member revenue by month (hours × $60)
    const nmRevByMonth = {};
    const memberEmails = new Set(activeMembers.map((m) => m.email));
    activeBk.forEach((b) => {
      if (memberEmails.has(b.customer_email)) return;
      const k = monthKey(new Date(b.booking_start));
      nmRevByMonth[k] = (nmRevByMonth[k] || 0) + Number(b.duration_hours || 0) * 60;
    });

    // Member revenue by month
    const mRevByMonth = {};
    const allMos = new Set();
    activeBk.forEach((b) => { allMos.add(monthKey(new Date(b.booking_start))); });
    const monthMemberHrs = {};
    activeBk.forEach((b) => {
      const k = monthKey(new Date(b.booking_start));
      if (!monthMemberHrs[k]) monthMemberHrs[k] = {};
      if (memberEmails.has(b.customer_email)) {
        monthMemberHrs[k][b.customer_email] = true;
      }
    });
    [...allMos].forEach((k) => {
      let memRev = 0;
      const activeInMonth = monthMemberHrs[k] || {};
      activeMembers.forEach((m) => {
        if (activeInMonth[m.email]) {
          memRev += Number(tierMap[m.tier]?.monthly_fee || 0);
        }
      });
      mRevByMonth[k] = memRev;
    });

    // Overage revenue by month
    const overByMonth = {};
    (payments || []).forEach((p) => {
      if (p.status !== "succeeded") return;
      const k = monthKey(new Date(p.billing_month));
      overByMonth[k] = (overByMonth[k] || 0) + Number(p.amount_cents || 0) / 100;
    });

    // Combined monthly trend (last 6 months) — always unfiltered for navigation
    const sortedMonths = [...allMos].sort().slice(-6);
    const trend = sortedMonths.map((k) => ({
      month: k,
      label: monthLabelShort(k),
      membership: mRevByMonth[k] || 0,
      nonMember: nmRevByMonth[k] || 0,
      overage: overByMonth[k] || 0,
      total: (mRevByMonth[k] || 0) + (nmRevByMonth[k] || 0) + (overByMonth[k] || 0),
    }));

    // Selected month totals for KPIs
    let selTotal = null;
    if (selMonth) {
      selTotal = {
        membership: mRevByMonth[selMonth] || 0,
        nonMember: nmRevByMonth[selMonth] || 0,
        overage: overByMonth[selMonth] || 0,
        total: (mRevByMonth[selMonth] || 0) + (nmRevByMonth[selMonth] || 0) + (overByMonth[selMonth] || 0),
      };
    }

    return { byTier, mrr, trend, selTotal };
  }, [activeMembers, activeBk, tierMap, payments, selMonth]);

  /* ── USAGE data ─────────────────────────────────── */
  const usage = useMemo(() => {
    const availPerDay = BAYS.length * 16;

    // Daily utilization — filtered by month or last 30 days
    const dayHrs = {};
    if (selMonth) {
      filteredBk.forEach((b) => {
        const dk = new Date(b.booking_start).toLocaleDateString("en-CA", { timeZone: TZ });
        dayHrs[dk] = (dayHrs[dk] || 0) + Number(b.duration_hours || 0);
      });
    } else {
      const now = new Date();
      const thirtyAgo = new Date(now);
      thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      activeBk.forEach((b) => {
        const d = new Date(b.booking_start);
        if (d < thirtyAgo) return;
        const dk = d.toLocaleDateString("en-CA", { timeZone: TZ });
        dayHrs[dk] = (dayHrs[dk] || 0) + Number(b.duration_hours || 0);
      });
    }
    const days = Object.keys(dayHrs).sort();
    const avgUtil = days.length
      ? days.reduce((s, k) => s + dayHrs[k], 0) / days.length / availPerDay * 100
      : 0;

    // Utilization timeline for selected month
    const utilDays = [];
    if (selMonth) {
      const [yr, mo] = selMonth.split("-").map(Number);
      const daysInMonth = new Date(yr, mo, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dk = `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const h = dayHrs[dk] || 0;
        utilDays.push({ date: dk, day: d, hours: h, pct: (h / availPerDay) * 100 });
      }
    }

    // Heatmap — uses filtered bookings
    const heat = {};
    DOW_ORDER.forEach((d) => { heat[d] = {}; HOUR_LABELS.forEach((h) => { heat[d][h] = 0; }); });
    filteredBk.forEach((b) => {
      const dow = localDow(b.booking_start);
      const hr = +localHour(b.booking_start);
      if (heat[dow] && heat[dow][hr] !== undefined) heat[dow][hr]++;
    });
    const maxHeat = Math.max(1, ...Object.values(heat).flatMap((d) => Object.values(d)));

    // By bay — filtered
    const byBay = {};
    BAYS.forEach((bay) => { byBay[bay] = 0; });
    filteredBk.forEach((b) => {
      const bay = b.bay || "Bay 1";
      byBay[bay] = (byBay[bay] || 0) + Number(b.duration_hours || 0);
    });

    // Cancellation rate — filtered
    const totalBk = filteredAllBk.length;
    const cancelled = filteredAllBk.filter((b) => b.booking_status === "Cancelled").length;
    const cancRate = totalBk ? (cancelled / totalBk * 100).toFixed(1) : "0.0";

    // Monthly booking count trend — always unfiltered for navigation
    const bkByMonth = {};
    activeBk.forEach((b) => {
      const k = monthKey(new Date(b.booking_start));
      bkByMonth[k] = (bkByMonth[k] || 0) + 1;
    });
    const sortedBkMonths = Object.keys(bkByMonth).sort().slice(-6);
    const bkTrend = sortedBkMonths.map((k) => ({ month: k, label: monthLabelShort(k), count: bkByMonth[k] }));

    return { avgUtil, heat, maxHeat, byBay, cancRate, cancelled, totalBk, bkTrend, utilDays, availPerDay };
  }, [activeBk, allBk, filteredBk, filteredAllBk, selMonth]);

  /* ── MEMBERS data ───────────────────────────────── */
  const memStats = useMemo(() => {
    // Tier distribution (always current snapshot)
    const dist = {};
    TIERS.forEach((t) => { dist[t] = 0; });
    (members || []).forEach((m) => { dist[m.tier || "Non-Member"]++; });

    // New signups per month — always unfiltered
    const signupsByMonth = {};
    activeMembers.forEach((m) => {
      const d = m.join_date ? new Date(m.join_date) : m.created_at ? new Date(m.created_at) : null;
      if (!d || isNaN(d)) return;
      const k = monthKey(d);
      signupsByMonth[k] = (signupsByMonth[k] || 0) + 1;
    });
    const signupMonths = Object.keys(signupsByMonth).sort().slice(-6);
    const signupTrend = signupMonths.map((k) => ({ month: k, label: monthLabelShort(k), count: signupsByMonth[k] }));

    // Active members — uses filtered bookings
    const recentEmails = new Set();
    filteredBk.forEach((b) => recentEmails.add(b.customer_email));
    const activeRecent = activeMembers.filter((m) => recentEmails.has(m.email)).length;

    // Average bookings per member — filtered
    const memberBkCounts = {};
    const memberEmails = new Set(activeMembers.map((m) => m.email));
    filteredBk.forEach((b) => {
      if (memberEmails.has(b.customer_email)) {
        memberBkCounts[b.customer_email] = (memberBkCounts[b.customer_email] || 0) + 1;
      }
    });
    const avgBkPerMember = activeMembers.length
      ? Object.values(memberBkCounts).reduce((s, v) => s + v, 0) / activeMembers.length
      : 0;

    // Top members by hours — filtered
    const memberHrs = {};
    filteredBk.forEach((b) => {
      if (!memberEmails.has(b.customer_email)) return;
      memberHrs[b.customer_email] = (memberHrs[b.customer_email] || 0) + Number(b.duration_hours || 0);
    });
    const topMembers = Object.entries(memberHrs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([email, hours]) => {
        const m = activeMembers.find((x) => x.email === email);
        return { email, name: m?.name || email, tier: m?.tier, hours };
      });

    return { dist, signupTrend, activeRecent, avgBkPerMember, topMembers };
  }, [members, activeMembers, filteredBk]);

  /* ── PUNCH PASS data (always unfiltered — current snapshot) ── */
  const passStats = useMemo(() => {
    const withBonus = activeMembers.filter((m) => Number(m.bonus_hours || 0) > 0);
    const totalBonus = activeMembers.reduce((s, m) => s + Number(m.bonus_hours || 0), 0);

    const bonusByTier = {};
    TIERS.filter((t) => t !== "Non-Member").forEach((t) => { bonusByTier[t] = 0; });
    activeMembers.forEach((m) => {
      if (Number(m.bonus_hours || 0) > 0) {
        bonusByTier[m.tier] = (bonusByTier[m.tier] || 0) + Number(m.bonus_hours);
      }
    });

    const topBonus = [...activeMembers]
      .filter((m) => Number(m.bonus_hours || 0) > 0)
      .sort((a, b) => Number(b.bonus_hours) - Number(a.bonus_hours))
      .slice(0, 10);

    return { withBonus: withBonus.length, totalBonus, bonusByTier, topBonus };
  }, [activeMembers]);

  /* ── render helpers ─────────────────────────────── */
  const monthSuffix = selMonth ? ` — ${monthLabel(selMonth)}` : "";

  function Bar({ value, max, color, label, subLabel }) {
    const w = max ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div className="rpt-bar-row">
        <div className="rpt-bar-label">{label}</div>
        <div className="rpt-bar-track">
          <div className="rpt-bar-fill" style={{ width: `${w}%`, background: color || "var(--primary)" }} />
        </div>
        <div className="rpt-bar-val">{subLabel}</div>
      </div>
    );
  }

  function TrendCol({ month, label, height, children, onClick }) {
    const isSel = selMonth === month;
    return (
      <div
        className="rpt-chart-col"
        onClick={onClick}
        style={{ cursor: "pointer", opacity: selMonth && !isSel ? 0.45 : 1, transition: "opacity 0.2s" }}
      >
        <div className="rpt-chart-bar-wrap">
          <div className="rpt-chart-bar" style={{ height, borderBottom: isSel ? "3px solid var(--text)" : "none" }} />
        </div>
        <div className="rpt-chart-lbl" style={{ fontWeight: isSel ? 700 : 600 }}>{label}</div>
        {children}
      </div>
    );
  }

  /* ── Utilization Line Chart (SVG) ──────────────── */
  function renderUtilLine() {
    if (!selMonth || !usage.utilDays || usage.utilDays.length === 0) return null;
    const days = usage.utilDays;
    const maxPct = 100;
    const W = 640, H = 220, PL = 38, PR = 10, PT = 14, PB = 30;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const pts = days.map((d, i) => {
      const x = PL + (i / Math.max(days.length - 1, 1)) * plotW;
      const y = PT + plotH - (Math.min(d.pct, maxPct) / maxPct) * plotH;
      return { x, y };
    });
    const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const area = polyline + ` ${PL + plotW},${PT + plotH} ${PL},${PT + plotH}`;
    const step = days.length > 20 ? 5 : days.length > 10 ? 3 : 1;

    return (
      <>
        <h3 className="rpt-sub-head">Daily Utilization{monthSuffix}</h3>
        <div className="tbl" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, height: "auto", display: "block" }}>
              {[0, 25, 50, 75, 100].map((v) => {
                const y = PT + plotH - (v / maxPct) * plotH;
                return (
                  <g key={v}>
                    <line x1={PL} y1={y} x2={PL + plotW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
                    <text x={PL - 4} y={y + 3} textAnchor="end" style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}>{v}%</text>
                  </g>
                );
              })}
              <polygon points={area} fill="rgba(76,141,115,0.12)" />
              <polyline points={polyline} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--primary)">
                  <title>{days[i].date}: {days[i].pct.toFixed(0)}% ({days[i].hours.toFixed(1)}h)</title>
                </circle>
              ))}
              {days.filter((_, i) => i % step === 0 || i === days.length - 1).map((d) => {
                const i = days.indexOf(d);
                const x = PL + (i / Math.max(days.length - 1, 1)) * plotW;
                return (
                  <text key={d.day} x={x} y={H - 6} textAnchor="middle" style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}>
                    {d.day}
                  </text>
                );
              })}
            </svg>
          </div>
        </div>
      </>
    );
  }

  /* ── REVENUE section ────────────────────────────── */
  function renderRevenue() {
    const maxTier = Math.max(1, ...Object.values(revenue.byTier).map((v) => v.total));
    const maxTrend = Math.max(1, ...revenue.trend.map((t) => t.total));

    // KPI values — switch between all-time and selected month
    const kpiRev = revenue.selTotal ? dlr(revenue.selTotal.total) : dlr(revenue.mrr);
    const kpiLabel = revenue.selTotal ? `Total Revenue${monthSuffix}` : "Monthly Recurring Revenue";

    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{kpiRev}</div>
            <div className="rpt-kpi-lbl">{kpiLabel}</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{activeMembers.length}</div>
            <div className="rpt-kpi-lbl">Paying Members</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{activeMembers.length ? dlr(revenue.mrr / activeMembers.length) : "$0"}</div>
            <div className="rpt-kpi-lbl">Avg Revenue / Member</div>
          </div>
        </div>

        {/* Revenue by tier */}
        <h3 className="rpt-sub-head">Revenue by Tier</h3>
        <div className="rpt-bars">
          {TIERS.filter((t) => t !== "Non-Member").map((t) => (
            <Bar
              key={t}
              label={`${t} (${revenue.byTier[t].count})`}
              value={revenue.byTier[t].total}
              max={maxTier}
              color={(TIER_COLORS[t] || {}).bg}
              subLabel={dlr(revenue.byTier[t].total)}
            />
          ))}
        </div>

        {/* Monthly trend — clickable */}
        <h3 className="rpt-sub-head">Monthly Revenue Trend</h3>
        {revenue.trend.length > 0 ? (
          <div className="rpt-chart">
            {revenue.trend.map((t) => (
              <TrendCol
                key={t.month}
                month={t.month}
                label={t.label}
                height={`${(t.total / maxTrend) * 100}%`}
                onClick={() => setSelMonth(selMonth === t.month ? null : t.month)}
              >
                <div className="rpt-chart-amt">{dlr(t.total)}</div>
              </TrendCol>
            ))}
          </div>
        ) : <p className="muted">No data yet</p>}
      </>
    );
  }

  /* ── USAGE section ──────────────────────────────── */
  function renderUsage() {
    const maxBk = Math.max(1, ...usage.bkTrend.map((t) => t.count));
    const maxBay = Math.max(1, ...Object.values(usage.byBay));
    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{usage.avgUtil.toFixed(0)}%</div>
            <div className="rpt-kpi-lbl">{selMonth ? `Avg Utilization${monthSuffix}` : "Avg Bay Utilization (30d)"}</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{filteredBk.length}</div>
            <div className="rpt-kpi-lbl">{selMonth ? `Bookings${monthSuffix}` : "Total Bookings"}</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{usage.cancRate}%</div>
            <div className="rpt-kpi-lbl">{selMonth ? `Cancel Rate${monthSuffix}` : "Cancellation Rate"}</div>
          </div>
        </div>

        {/* By bay */}
        <h3 className="rpt-sub-head">Hours by Bay{monthSuffix}</h3>
        <div className="rpt-bars">
          {BAYS.map((bay) => (
            <Bar
              key={bay}
              label={bay}
              value={usage.byBay[bay] || 0}
              max={maxBay}
              color="var(--primary)"
              subLabel={hrs(usage.byBay[bay] || 0)}
            />
          ))}
        </div>

        {/* Booking trend — clickable */}
        <h3 className="rpt-sub-head">Monthly Bookings</h3>
        {usage.bkTrend.length > 0 ? (
          <div className="rpt-chart">
            {usage.bkTrend.map((t) => (
              <TrendCol
                key={t.month}
                month={t.month}
                label={t.label}
                height={`${(t.count / maxBk) * 100}%`}
                onClick={() => setSelMonth(selMonth === t.month ? null : t.month)}
              >
                <div className="rpt-chart-amt">{t.count}</div>
              </TrendCol>
            ))}
          </div>
        ) : <p className="muted">No data yet</p>}

        {/* Heatmap */}
        <h3 className="rpt-sub-head">Peak Hours{monthSuffix || " (All Time)"}</h3>
        <div className="rpt-heat-wrap">
          <div className="rpt-heat">
            <div className="rpt-heat-row rpt-heat-header">
              <div className="rpt-heat-dow" />
              {HOUR_LABELS.map((h) => (
                <div key={h} className="rpt-heat-cell rpt-heat-hlbl">
                  {h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`}
                </div>
              ))}
            </div>
            {DOW_ORDER.map((dow) => (
              <div key={dow} className="rpt-heat-row">
                <div className="rpt-heat-dow">{dow}</div>
                {HOUR_LABELS.map((h) => {
                  const v = usage.heat[dow]?.[h] || 0;
                  const intensity = v / usage.maxHeat;
                  return (
                    <div
                      key={h}
                      className="rpt-heat-cell"
                      style={{
                        background: v ? `rgba(76, 141, 115, ${0.15 + intensity * 0.85})` : "var(--surface)",
                        color: intensity > 0.5 ? "#EDF3E3" : "var(--text-muted)",
                      }}
                      title={`${dow} ${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}: ${v} bookings`}
                    >
                      {v || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Utilization line chart — only when a month is selected */}
        {renderUtilLine()}
      </>
    );
  }

  /* ── MEMBERS section ────────────────────────────── */
  function renderMembers() {
    const maxDist = Math.max(1, ...Object.values(memStats.dist));
    const maxSignup = Math.max(1, ...memStats.signupTrend.map((t) => t.count));
    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{activeMembers.length}</div>
            <div className="rpt-kpi-lbl">Active Members</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{memStats.activeRecent}</div>
            <div className="rpt-kpi-lbl">{selMonth ? `Booked${monthSuffix}` : "Booked in Last 30 Days"}</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{memStats.avgBkPerMember.toFixed(1)}</div>
            <div className="rpt-kpi-lbl">{selMonth ? `Avg Bookings${monthSuffix}` : "Avg Bookings / Member"}</div>
          </div>
        </div>

        {/* Tier distribution */}
        <h3 className="rpt-sub-head">Tier Distribution</h3>
        <div className="rpt-bars">
          {TIERS.map((t) => (
            <Bar
              key={t}
              label={t}
              value={memStats.dist[t]}
              max={maxDist}
              color={(TIER_COLORS[t] || {}).bg}
              subLabel={`${memStats.dist[t]} member${memStats.dist[t] !== 1 ? "s" : ""}`}
            />
          ))}
        </div>

        {/* New signups */}
        <h3 className="rpt-sub-head">New Member Signups</h3>
        {memStats.signupTrend.length > 0 ? (
          <div className="rpt-chart">
            {memStats.signupTrend.map((t) => (
              <div key={t.month} className="rpt-chart-col">
                <div className="rpt-chart-bar-wrap">
                  <div className="rpt-chart-bar" style={{ height: `${(t.count / maxSignup) * 100}%` }} />
                </div>
                <div className="rpt-chart-lbl">{t.label}</div>
                <div className="rpt-chart-amt">{t.count}</div>
              </div>
            ))}
          </div>
        ) : <p className="muted">No signup data yet</p>}

        {/* Top members */}
        <h3 className="rpt-sub-head">Top Members by Hours{monthSuffix}</h3>
        {memStats.topMembers.length > 0 ? (
          <div className="tbl">
            <div className="th">
              <span style={{ flex: 2 }}>Member</span>
              <span style={{ flex: 1 }}>Tier</span>
              <span style={{ flex: 1 }} className="text-r">Total Hours</span>
            </div>
            {memStats.topMembers.map((m) => (
              <div key={m.email} className="tr">
                <span style={{ flex: 2 }}>
                  <strong>{m.name}</strong><br />
                  <span className="email-sm">{m.email}</span>
                </span>
                <span style={{ flex: 1 }}><Badge tier={m.tier} /></span>
                <span style={{ flex: 1 }} className="text-r tab-num">{hrs(m.hours)}</span>
              </div>
            ))}
          </div>
        ) : <p className="muted">No member bookings{selMonth ? " this month" : ""}</p>}
      </>
    );
  }

  /* ── PUNCH PASS section ─────────────────────────── */
  function renderPasses() {
    const maxBonus = Math.max(1, ...Object.values(passStats.bonusByTier));
    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{passStats.totalBonus.toFixed(1)}h</div>
            <div className="rpt-kpi-lbl">Total Bonus Hours Outstanding</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{passStats.withBonus}</div>
            <div className="rpt-kpi-lbl">Members with Bonus Hours</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">
              {passStats.withBonus ? (passStats.totalBonus / passStats.withBonus).toFixed(1) + "h" : "0h"}
            </div>
            <div className="rpt-kpi-lbl">Avg Bonus Hours / Member</div>
          </div>
        </div>

        {/* By tier */}
        <h3 className="rpt-sub-head">Bonus Hours by Tier</h3>
        <div className="rpt-bars">
          {TIERS.filter((t) => t !== "Non-Member").map((t) => (
            <Bar
              key={t}
              label={t}
              value={passStats.bonusByTier[t] || 0}
              max={maxBonus}
              color={(TIER_COLORS[t] || {}).bg}
              subLabel={hrs(passStats.bonusByTier[t] || 0)}
            />
          ))}
        </div>

        {/* Top holders */}
        {passStats.topBonus.length > 0 && (
          <>
            <h3 className="rpt-sub-head">Top Bonus Hour Holders</h3>
            <div className="tbl">
              <div className="th">
                <span style={{ flex: 2 }}>Member</span>
                <span style={{ flex: 1 }}>Tier</span>
                <span style={{ flex: 1 }} className="text-r">Bonus Hours</span>
              </div>
              {passStats.topBonus.map((m) => (
                <div key={m.email} className="tr">
                  <span style={{ flex: 2 }}>
                    <strong>{m.name}</strong><br />
                    <span className="email-sm">{m.email}</span>
                  </span>
                  <span style={{ flex: 1 }}><Badge tier={m.tier} /></span>
                  <span style={{ flex: 1 }} className="text-r tab-num">{hrs(m.bonus_hours)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {passStats.topBonus.length === 0 && (
          <p className="muted" style={{ marginTop: 16 }}>No members have bonus hours yet.</p>
        )}
      </>
    );
  }

  /* ── main render ────────────────────────────────── */
  return (
    <div className="content">
      {/* Sub-tabs */}
      <div className="rpt-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`rpt-tab ${section === s.key ? "active" : ""}`}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Month picker */}
      <div className="month-sel" style={{ marginBottom: 20 }}>
        <button
          className={`mo-btn ${!selMonth ? "active" : ""}`}
          onClick={() => setSelMonth(null)}
        >
          All
        </button>
        {allMonths.map((k) => (
          <button
            key={k}
            className={`mo-btn ${selMonth === k ? "active" : ""}`}
            onClick={() => setSelMonth(selMonth === k ? null : k)}
          >
            {monthLabel(k)}
          </button>
        ))}
      </div>

      {section === "revenue" && renderRevenue()}
      {section === "usage" && renderUsage()}
      {section === "members" && renderMembers()}
      {section === "passes" && renderPasses()}
    </div>
  );
}
