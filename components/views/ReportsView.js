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

  const activeBk = useMemo(
    () => (bookings || []).filter((b) => b.booking_status !== "Cancelled"),
    [bookings]
  );
  const allBk = bookings || [];

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
    // MRR by tier
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

    // Member revenue by month (sum tier fees for that month's active members)
    const mRevByMonth = {};
    const allMonths = new Set();
    activeBk.forEach((b) => {
      allMonths.add(monthKey(new Date(b.booking_start)));
    });
    const monthMemberHrs = {};
    activeBk.forEach((b) => {
      const k = monthKey(new Date(b.booking_start));
      if (!monthMemberHrs[k]) monthMemberHrs[k] = {};
      if (memberEmails.has(b.customer_email)) {
        monthMemberHrs[k][b.customer_email] = true;
      }
    });
    [...allMonths].forEach((k) => {
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

    // Combined monthly trend (last 6 months)
    const sortedMonths = [...allMonths].sort().slice(-6);
    const trend = sortedMonths.map((k) => ({
      month: k,
      label: monthLabel(k),
      membership: mRevByMonth[k] || 0,
      nonMember: nmRevByMonth[k] || 0,
      overage: overByMonth[k] || 0,
      total: (mRevByMonth[k] || 0) + (nmRevByMonth[k] || 0) + (overByMonth[k] || 0),
    }));

    return { byTier, mrr, trend };
  }, [activeMembers, activeBk, tierMap, payments]);

  /* ── USAGE data ─────────────────────────────────── */
  const usage = useMemo(() => {
    const availPerDay = BAYS.length * 16;
    const now = new Date();
    const thirtyAgo = new Date(now);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);

    const dayHrs = {};
    activeBk.forEach((b) => {
      const d = new Date(b.booking_start);
      if (d < thirtyAgo) return;
      const dk = d.toLocaleDateString("en-CA", { timeZone: TZ });
      dayHrs[dk] = (dayHrs[dk] || 0) + Number(b.duration_hours || 0);
    });
    const days = Object.keys(dayHrs).sort();
    const avgUtil = days.length
      ? days.reduce((s, k) => s + dayHrs[k], 0) / days.length / availPerDay * 100
      : 0;

    // Peak hours heatmap
    const heat = {};
    DOW_ORDER.forEach((d) => { heat[d] = {}; HOUR_LABELS.forEach((h) => { heat[d][h] = 0; }); });
    activeBk.forEach((b) => {
      const dow = localDow(b.booking_start);
      const hr = +localHour(b.booking_start);
      if (heat[dow] && heat[dow][hr] !== undefined) heat[dow][hr]++;
    });
    const maxHeat = Math.max(1, ...Object.values(heat).flatMap((d) => Object.values(d)));

    // By bay
    const byBay = {};
    BAYS.forEach((bay) => { byBay[bay] = 0; });
    activeBk.forEach((b) => {
      const bay = b.bay || "Bay 1";
      byBay[bay] = (byBay[bay] || 0) + Number(b.duration_hours || 0);
    });

    // Cancellation rate
    const totalBk = allBk.length;
    const cancelled = allBk.filter((b) => b.booking_status === "Cancelled").length;
    const cancRate = totalBk ? (cancelled / totalBk * 100).toFixed(1) : "0.0";

    // Monthly booking count trend
    const bkByMonth = {};
    activeBk.forEach((b) => {
      const k = monthKey(new Date(b.booking_start));
      bkByMonth[k] = (bkByMonth[k] || 0) + 1;
    });
    const sortedBkMonths = Object.keys(bkByMonth).sort().slice(-6);
    const bkTrend = sortedBkMonths.map((k) => ({ month: k, label: monthLabel(k), count: bkByMonth[k] }));

    return { avgUtil, heat, maxHeat, byBay, cancRate, cancelled, totalBk, bkTrend, dayHrs, days, availPerDay };
  }, [activeBk, allBk]);

  /* ── MEMBERS data ───────────────────────────────── */
  const memStats = useMemo(() => {
    const dist = {};
    TIERS.forEach((t) => { dist[t] = 0; });
    (members || []).forEach((m) => { dist[m.tier || "Non-Member"]++; });

    const signupsByMonth = {};
    activeMembers.forEach((m) => {
      const d = m.join_date ? new Date(m.join_date) : m.created_at ? new Date(m.created_at) : null;
      if (!d || isNaN(d)) return;
      const k = monthKey(d);
      signupsByMonth[k] = (signupsByMonth[k] || 0) + 1;
    });
    const signupMonths = Object.keys(signupsByMonth).sort().slice(-6);
    const signupTrend = signupMonths.map((k) => ({ month: k, label: monthLabel(k), count: signupsByMonth[k] }));

    const now = new Date();
    const thirtyAgo = new Date(now);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const recentEmails = new Set();
    activeBk.forEach((b) => {
      if (new Date(b.booking_start) >= thirtyAgo) recentEmails.add(b.customer_email);
    });
    const activeRecent = activeMembers.filter((m) => recentEmails.has(m.email)).length;

    const memberBkCounts = {};
    const memberEmails = new Set(activeMembers.map((m) => m.email));
    activeBk.forEach((b) => {
      if (memberEmails.has(b.customer_email)) {
        memberBkCounts[b.customer_email] = (memberBkCounts[b.customer_email] || 0) + 1;
      }
    });
    const avgBkPerMember = activeMembers.length
      ? Object.values(memberBkCounts).reduce((s, v) => s + v, 0) / activeMembers.length
      : 0;

    const memberHrs = {};
    activeBk.forEach((b) => {
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
  }, [members, activeMembers, activeBk]);

  /* ── PUNCH PASS data ────────────────────────────── */
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

  /* ── REVENUE section ────────────────────────────── */
  function renderRevenue() {
    const maxTier = Math.max(1, ...Object.values(revenue.byTier).map((v) => v.total));
    const maxTrend = Math.max(1, ...revenue.trend.map((t) => t.total));
    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{dlr(revenue.mrr)}</div>
            <div className="rpt-kpi-lbl">Monthly Recurring Revenue</div>
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

        <h3 className="rpt-sub-head">Monthly Revenue Trend</h3>
        {revenue.trend.length > 0 ? (
          <div className="rpt-chart">
            {revenue.trend.map((t) => (
              <div key={t.month} className="rpt-chart-col">
                <div className="rpt-chart-bar-wrap">
                  <div
                    className="rpt-chart-bar"
                    style={{ height: `${(t.total / maxTrend) * 100}%` }}
                    title={`Membership: ${dlr(t.membership)}\nNon-Member: ${dlr(t.nonMember)}\nOverage: ${dlr(t.overage)}`}
                  />
                </div>
                <div className="rpt-chart-lbl">{t.label}</div>
                <div className="rpt-chart-amt">{dlr(t.total)}</div>
              </div>
            ))}
          </div>
        ) : <p className="muted">No data yet</p>}
      </>
    );
  }

  /* ── USAGE section ──────────────────────────────── */
  function renderUsage() {
    const maxBk = Math.max(1, ...usage.bkTrend.map((t) => t.count));
    const totalBayHrs = Object.values(usage.byBay).reduce((s, v) => s + v, 0);
    const maxBay = Math.max(1, ...Object.values(usage.byBay));
    return (
      <>
        <div className="rpt-kpis">
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{usage.avgUtil.toFixed(0)}%</div>
            <div className="rpt-kpi-lbl">Avg Bay Utilization (30d)</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{activeBk.length}</div>
            <div className="rpt-kpi-lbl">Total Bookings</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{usage.cancRate}%</div>
            <div className="rpt-kpi-lbl">Cancellation Rate</div>
          </div>
        </div>

        <h3 className="rpt-sub-head">Hours by Bay</h3>
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

        <h3 className="rpt-sub-head">Monthly Bookings</h3>
        {usage.bkTrend.length > 0 ? (
          <div className="rpt-chart">
            {usage.bkTrend.map((t) => (
              <div key={t.month} className="rpt-chart-col">
                <div className="rpt-chart-bar-wrap">
                  <div className="rpt-chart-bar" style={{ height: `${(t.count / maxBk) * 100}%` }} />
                </div>
                <div className="rpt-chart-lbl">{t.label}</div>
                <div className="rpt-chart-amt">{t.count}</div>
              </div>
            ))}
          </div>
        ) : <p className="muted">No data yet</p>}

        <h3 className="rpt-sub-head">Peak Hours Heatmap</h3>
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
            <div className="rpt-kpi-lbl">Booked in Last 30 Days</div>
          </div>
          <div className="rpt-kpi">
            <div className="rpt-kpi-val">{memStats.avgBkPerMember.toFixed(1)}</div>
            <div className="rpt-kpi-lbl">Avg Bookings / Member</div>
          </div>
        </div>

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

        <h3 className="rpt-sub-head">Top Members by Hours</h3>
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

      {section === "revenue" && renderRevenue()}
      {section === "usage" && renderUsage()}
      {section === "members" && renderMembers()}
      {section === "passes" && renderPasses()}
    </div>
  );
}
