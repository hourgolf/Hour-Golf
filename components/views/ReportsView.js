import { useMemo, useState } from "react";
import { TIERS, TIER_COLORS, TZ } from "../../lib/constants";
import { mL, hrs, dlr } from "../../lib/format";
import { useBranding } from "../../hooks/useBranding";
import { resolveBays } from "../../lib/branding";
import { supaPatch } from "../../lib/supabase";
import Badge from "../ui/Badge";
import ActivityLog from "../ui/ActivityLog";

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
  { key: "revenue",   label: "Revenue" },
  { key: "usage",     label: "Usage" },
  { key: "members",   label: "Members" },
  { key: "passes",    label: "Punch Passes" },
  { key: "conflicts", label: "Conflicts" },
  { key: "activity",  label: "Activity" },
];

/* ══════════════════════════════════════════════════ */
export default function ReportsView({ members, bookings, tierCfg, payments, apiKey }) {
  const branding = useBranding();
  // Per-tenant bay list drives the by-bay breakdown + capacity math.
  // BAYS.length used to be a hardcoded 2; now it adapts so a tenant
  // with 4 sims gets accurate utilization numbers.
  const BAYS = useMemo(() => resolveBays(branding), [branding]);

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
  //
  // Source of truth: the `payments` table. Every Stripe charge
  // (subscriptions, overages, non-member bookings, in-app retail) AND
  // every Square POS sale lands there with its own row, so we can
  // bucket by description + source instead of inventing revenue from
  // membership counts × monthly fee. The previous calc multiplied
  // active members by their tier fee even when payments hadn't
  // landed, conflated overage and non-member booking with the
  // catch-all sum-of-payments, and never counted retail at all.
  //
  // Net = amount_cents - refunded_cents. status='succeeded' AND
  // status='refunded' both contribute (a fully-refunded row nets to
  // 0 naturally; a partially-refunded row still has revenue).
  // status='pending' and 'failed' are excluded.
  //
  // Buckets (heuristic on description + source):
  //   Membership          — recurring subscription invoice
  //   Overage             — manual overage charge
  //   Non-member booking  — pay-per-bay charge for a non-member
  //   Pro Shop            — in-app retail charged via Stripe
  //   In-store retail     — Square POS sale (source='square_pos')
  //   Other               — anything we can't classify
  function classifyPayment(p) {
    if (p.source === "square_pos") return "In-store retail";
    const desc = String(p.description || "").toLowerCase();
    if (/(membership|unlimited)/.test(desc)) return "Membership";
    if (/^overage/.test(desc)) return "Overage";
    if (/^bay |non[- ]?member/.test(desc)) return "Non-member booking";
    if (/^in-store purchase/.test(desc)) return "In-store retail";
    return "Pro Shop";
  }
  const REVENUE_BUCKETS = ["Membership", "Pro Shop", "In-store retail", "Overage", "Non-member booking", "Other"];
  const BUCKET_COLORS = {
    "Membership":         "var(--primary)",
    "Pro Shop":           "#8BB5A0",
    "In-store retail":    "#5C7A6B",
    "Overage":            "#ddd480",
    "Non-member booking": "#C9A14C",
    "Other":              "var(--border)",
  };

  const revenue = useMemo(() => {
    // Forward-looking MRR snapshot (active subscriptions × tier fee).
    // Kept as a secondary KPI distinct from actual cash.
    const byTier = {};
    TIERS.filter((t) => t !== "Non-Member").forEach((t) => {
      const count = activeMembers.filter((m) => m.tier === t).length;
      const fee = Number(tierMap[t]?.monthly_fee || 0);
      byTier[t] = { count, fee, total: count * fee };
    });
    const mrr = Object.values(byTier).reduce((s, v) => s + v.total, 0);

    // Per-month, per-bucket actual revenue.
    const months = new Set();
    const byMonth = {}; // month -> { bucket -> dollars, gross, refunded }
    let totalRefunded = 0;
    (payments || []).forEach((p) => {
      if (p.status !== "succeeded" && p.status !== "refunded") return;
      const dateSrc = p.billing_month || p.created_at;
      if (!dateSrc) return;
      const d = new Date(dateSrc);
      if (isNaN(d)) return;
      const k = monthKey(d);
      const gross = Number(p.amount_cents || 0) / 100;
      const refunded = Number(p.refunded_cents || 0) / 100;
      // Treat status='refunded' rows with refunded_cents=0 as fully
      // refunded (some legacy refund rows didn't update the column).
      const effectiveRefund = (p.status === "refunded" && refunded === 0) ? gross : refunded;
      const net = Math.max(0, gross - effectiveRefund);
      const bucket = classifyPayment(p);
      months.add(k);
      if (!byMonth[k]) byMonth[k] = { gross: 0, refunded: 0 };
      byMonth[k][bucket] = (byMonth[k][bucket] || 0) + net;
      byMonth[k].gross += gross;
      byMonth[k].refunded += effectiveRefund;
      totalRefunded += effectiveRefund;
    });

    // Trend: last 6 months by date desc → reversed for display.
    const sortedMonths = [...months].sort().slice(-6);
    const trend = sortedMonths.map((k) => {
      const m = byMonth[k] || {};
      const total = REVENUE_BUCKETS.reduce((s, b) => s + (m[b] || 0), 0);
      return {
        month: k,
        label: monthLabelShort(k),
        total,
        buckets: REVENUE_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: m[b] || 0 }), {}),
        gross: m.gross || 0,
        refunded: m.refunded || 0,
      };
    });

    // Selected-month detail.
    let selTotal = null;
    if (selMonth) {
      const m = byMonth[selMonth] || {};
      const total = REVENUE_BUCKETS.reduce((s, b) => s + (m[b] || 0), 0);
      selTotal = {
        total,
        buckets: REVENUE_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: m[b] || 0 }), {}),
        gross: m.gross || 0,
        refunded: m.refunded || 0,
      };
    }

    // All-time totals (for the no-month-selected KPI).
    const allTimeBuckets = REVENUE_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: 0 }), {});
    let allTimeNet = 0;
    Object.values(byMonth).forEach((m) => {
      REVENUE_BUCKETS.forEach((b) => {
        allTimeBuckets[b] += (m[b] || 0);
        allTimeNet += (m[b] || 0);
      });
    });

    return {
      byTier, mrr, trend, selTotal,
      allTimeBuckets, allTimeNet, totalRefunded,
    };
  }, [activeMembers, tierMap, payments, selMonth]);

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
  }, [activeBk, allBk, filteredBk, filteredAllBk, selMonth, BAYS]);

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
    // Native browser tooltip on hover. The visual bar already shows
    // value + share, but a hover tooltip makes the unrounded number
    // available for spot-checking against Stripe / Square statements.
    const tooltip = `${label}${subLabel ? ` — ${subLabel}` : ""}`;
    return (
      <div className="rpt-bar-row" title={tooltip}>
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
    // Active set: selected month if one is picked, else all-time.
    const active = revenue.selTotal || {
      total: revenue.allTimeNet,
      buckets: revenue.allTimeBuckets,
      gross: revenue.allTimeNet + revenue.totalRefunded,
      refunded: revenue.totalRefunded,
    };
    const activeLabel = selMonth ? monthSuffix : " (All Time)";

    // Sort buckets desc by their value for the breakdown bars.
    const bucketRows = REVENUE_BUCKETS
      .map((b) => ({ name: b, value: active.buckets[b] || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const maxBucket = Math.max(1, ...bucketRows.map((r) => r.value));

    return (
      <>
        {/* KPI row — actual revenue first (the number the operator
            wants), then the secondary forecast MRR + member counts. */}
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{dlr(active.total)}</div>
            <div className="rpt-kpi-lbl">Total Revenue{activeLabel}</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{dlr(revenue.mrr)}</div>
            <div className="rpt-kpi-lbl">Forecast MRR</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{activeMembers.length}</div>
            <div className="rpt-kpi-lbl">Paying Members</div>
          </div>
        </div>

        {/* Revenue breakdown — actual cash by source/bucket. The
            single most useful view: how much came from where, net of
            refunds, for the active period. */}
        <div className="rpt-card">
          <h3 className="rpt-sub-head">Revenue by Source{activeLabel}</h3>
          {bucketRows.length === 0 ? (
            <p className="muted">No payments in this period yet.</p>
          ) : (
            <div className="rpt-bars">
              {bucketRows.map((r) => (
                <Bar
                  key={r.name}
                  label={r.name}
                  value={r.value}
                  max={maxBucket}
                  color={BUCKET_COLORS[r.name] || "var(--primary)"}
                  subLabel={`${dlr(r.value)} (${active.total > 0 ? Math.round((r.value / active.total) * 100) : 0}%)`}
                />
              ))}
            </div>
          )}
          {active.refunded > 0 && (
            <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
              Net of {dlr(active.refunded)} in refunds (gross was {dlr(active.gross)}).
            </p>
          )}
        </div>

        {/* Monthly trend — stacked bars per bucket so the operator
            can see WHERE growth is coming from at a glance. Click a
            month to drill in (sets selMonth which the rest of Reports
            already respects). */}
        <div className="rpt-card">
        <h3 className="rpt-sub-head">Monthly Revenue (Last 6 Months)</h3>
        {revenue.trend.length === 0 ? (
          <p className="muted">No data yet</p>
        ) : (
          <>
            <div className="rpt-chart">
              {revenue.trend.map((t) => {
                const max = Math.max(1, ...revenue.trend.map((m) => m.total));
                const isSel = selMonth === t.month;
                // Build the stacked bar segments — biggest bucket on bottom.
                const segs = REVENUE_BUCKETS
                  .filter((b) => (t.buckets[b] || 0) > 0)
                  .sort((a, b) => (t.buckets[b] || 0) - (t.buckets[a] || 0));
                return (
                  <div
                    key={t.month}
                    className="rpt-chart-col"
                    onClick={() => setSelMonth(isSel ? null : t.month)}
                    style={{ cursor: "pointer", opacity: selMonth && !isSel ? 0.45 : 1, transition: "opacity 0.2s" }}
                  >
                    <div className="rpt-chart-bar-wrap">
                      <div
                        style={{
                          width: "100%",
                          maxWidth: 48,
                          height: `${(t.total / max) * 100}%`,
                          minHeight: 4,
                          display: "flex",
                          flexDirection: "column-reverse",
                          borderRadius: "var(--radius) var(--radius) 0 0",
                          overflow: "hidden",
                          border: isSel ? "2px solid var(--text)" : "none",
                        }}
                        title={`${t.label}: ${dlr(t.total)}`}
                      >
                        {segs.map((b) => {
                          const v = t.buckets[b] || 0;
                          return (
                            <div
                              key={b}
                              style={{
                                height: `${(v / t.total) * 100}%`,
                                background: BUCKET_COLORS[b] || "var(--primary)",
                              }}
                              title={`${b}: ${dlr(v)}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div className="rpt-chart-lbl" style={{ fontWeight: isSel ? 700 : 600 }}>{t.label}</div>
                    <div className="rpt-chart-amt">{dlr(t.total)}</div>
                  </div>
                );
              })}
            </div>
            {/* Legend for the stacked-bar colors. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11 }}>
              {REVENUE_BUCKETS.filter((b) => (revenue.allTimeBuckets[b] || 0) > 0).map((b) => (
                <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: BUCKET_COLORS[b] }} />
                  {b}
                </span>
              ))}
            </div>
          </>
        )}
        </div>

        {/* Active subscriptions snapshot — kept but reframed as a
            forecast (what we EXPECT to bill next cycle), not as
            recognized revenue. */}
        <div className="rpt-card">
          <h3 className="rpt-sub-head">Active Subscriptions by Tier (Forecast MRR)</h3>
          <div className="rpt-bars">
            {TIERS.filter((t) => t !== "Non-Member").map((t) => {
              const maxTier = Math.max(1, ...Object.values(revenue.byTier).map((v) => v.total));
              return (
                <Bar
                  key={t}
                  label={`${t} (${revenue.byTier[t].count})`}
                  value={revenue.byTier[t].total}
                  max={maxTier}
                  color={(TIER_COLORS[t] || {}).bg}
                  subLabel={dlr(revenue.byTier[t].total)}
                />
              );
            })}
          </div>
        </div>
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
        <div className="rpt-card">
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
        </div>

        {/* Booking trend — clickable */}
        <div className="rpt-card">
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
        </div>

        {/* Heatmap */}
        <div className="rpt-card">
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
        <div className="rpt-card">
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
        </div>

        {/* New signups */}
        <div className="rpt-card">
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
        </div>

        {/* Top members */}
        <div className="rpt-card">
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
        </div>
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

  /* ── Conflicts ──────────────────────────────────── */
  // Surfaces every booking stamped by the Skedda/new-portal overlap
  // webhook (migration 20260422010000). Today-only conflicts are
  // already flagged by TodayView's banner; this section extends that
  // to historic + future days so nothing gets forgotten. "Resolve"
  // clears conflict_detected_at + conflict_with via direct PostgREST
  // — the flag is advisory (admin-side only), members never see it.
  function renderConflicts() {
    const conflictRows = allBk
      .filter((b) => b.conflict_detected_at)
      .sort((a, b) => {
        // Unresolved first, then newest first.
        return new Date(b.conflict_detected_at) - new Date(a.conflict_detected_at);
      });

    if (conflictRows.length === 0) {
      return (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "24px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No booking conflicts</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Nothing flagged by the double-booking detector.
          </div>
        </div>
      );
    }

    // Pair up conflicts: we stamped both sides of an overlap, so one
    // "incident" = at least two rows sharing a time/bay window. Group
    // by the max(conflict_detected_at) rounded to the minute so paired
    // rows cluster. Cosmetic; the flat list still works if this
    // heuristic mis-clusters.
    const grouped = {};
    conflictRows.forEach((b) => {
      const minuteKey = String(b.conflict_detected_at || "").slice(0, 16);
      (grouped[minuteKey] = grouped[minuteKey] || []).push(b);
    });
    const clusters = Object.entries(grouped).sort((a, b) => (a[0] < b[0] ? 1 : -1));

    async function resolveConflict(booking) {
      if (!apiKey) return;
      const ids = [booking.booking_id];
      if (booking.conflict_with) {
        booking.conflict_with.split(",").map((s) => s.trim()).filter(Boolean).forEach((id) => ids.push(id));
      }
      try {
        await Promise.all(
          ids.map((id) =>
            supaPatch(apiKey, "bookings", { booking_id: id }, {
              conflict_detected_at: null,
              conflict_with: null,
            })
          )
        );
        // Force a soft refresh by reloading — useData refreshes on a
        // 60s loop so the operator would otherwise see the row linger.
        // Cheap UX tradeoff for a rare action.
        if (typeof window !== "undefined") window.location.reload();
      } catch (e) {
        alert(`Failed to resolve: ${e.message || e}`);
      }
    }

    return (
      <div>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
          padding: "10px 14px",
          background: "var(--primary-bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: 13,
        }}>
          <strong style={{ color: "var(--danger, #C92F1F)" }}>{conflictRows.length}</strong>
          <span>booking{conflictRows.length === 1 ? "" : "s"} flagged as conflicted.</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
            Resolving clears the flag on both sides; it doesn&rsquo;t cancel anyone.
          </span>
        </div>

        {clusters.map(([key, rows]) => (
          <div key={key} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "12px 14px",
            marginBottom: 10,
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
              Detected {new Date(rows[0].conflict_detected_at).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
            {rows.map((b) => (
              <div key={b.booking_id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 0",
                borderTop: "1px dashed var(--border)",
                fontSize: 13,
              }}>
                <div style={{ minWidth: 160 }}>
                  <strong>{b.customer_name || b.customer_email}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>{b.customer_email}</div>
                </div>
                <div style={{ flex: 1 }}>
                  {new Date(b.booking_start).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {" – "}
                  {new Date(b.booking_end).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}
                  <span className="muted" style={{ marginLeft: 8 }}>{b.bay ? `Bay ${b.bay}` : ""}</span>
                  {b.booking_status === "Cancelled" && (
                    <span className="badge" style={{ background: "var(--text-muted)", marginLeft: 8, fontSize: 9 }}>CANCELLED</span>
                  )}
                </div>
                <button
                  className="btn"
                  style={{ fontSize: 10 }}
                  onClick={() => resolveConflict(b)}
                  title="Clear the conflict flag on this booking and every booking it's paired with"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
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
      {section === "conflicts" && renderConflicts()}
      {section === "activity" && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 10 }}>
            Last 50 admin actions
          </div>
          <ActivityLog apiKey={apiKey} limit={50} includeTarget emptyMessage="No admin actions recorded yet." />
        </div>
      )}
    </div>
  );
}
