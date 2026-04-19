import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { TIER_COLORS } from "../../lib/constants";
import { useBranding } from "../../hooks/useBranding";
import Modal from "../ui/Modal";
import InstallPrompt from "./InstallPrompt";
import { fT, fD, fDL } from "../../lib/format";

// What the QR encodes:
//   - If the member has a Square customer record linked, encode the member
//     UUID. That same UUID is also written to Square's `reference_id`, so
//     Square Register scans the QR and loads the customer profile natively.
//   - Otherwise fall back to the legacy /verify?token=... URL so staff
//     using a plain phone camera still land on the member-lookup page.
function qrPayload(member) {
  if (member.square_customer_id && member.id) return member.id;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/verify?token=${member.verify_token}`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return "Starts now";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

export default function MemberDashboard({ member, tierConfig, refresh, showToast }) {
  const router = useRouter();
  const branding = useBranding();
  const [usage, setUsage] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
  const [myEvents, setMyEvents] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a minute so the next-booking countdown stays live without a
  // full re-fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    loadData();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("purchased")) {
        showToast(`Successfully purchased ${params.get("purchased")} hour credit(s)!`);
        window.history.replaceState({}, "", "/members/dashboard");
      }
    }
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-data", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load data");
      const d = await r.json();
      setUsage(d.usage);
      setUpcoming(d.upcomingBookings || []);
      setMonthBookings(d.monthBookings || []);

      fetch("/api/member-shop?action=loyalty", { credentials: "include" })
        .then((lr) => lr.ok ? lr.json() : null)
        .then((ld) => { if (ld) setLoyalty(ld); })
        .catch(() => {});

      // News / announcements admins have flagged for the dashboard surface.
      // Empty array = nothing pinned right now; the section stays hidden so
      // the home tab doesn't show empty noise.
      fetch("/api/member-news?surface=dashboard", { credentials: "include" })
        .then((nr) => nr.ok ? nr.json() : null)
        .then((items) => { if (Array.isArray(items)) setNews(items); })
        .catch(() => {});

      // In-transit shipments — pulls the unified purchases feed and keeps
      // in-app shipped orders that have a label but haven't been delivered
      // yet. shipping_status comes from the Shippo tracking webhook;
      // delivered + returned + failure orders are auto-filtered out.
      fetch("/api/member-purchases?limit=20", { credentials: "include" })
        .then((sr) => sr.ok ? sr.json() : null)
        .then((d) => {
          if (!d?.purchases) return;
          const terminal = new Set(["delivered", "returned", "failure"]);
          const inTransit = d.purchases.filter((p) =>
            p.kind === "in_app"
            && p.delivery_method === "ship"
            && p.tracking_number
            && (!p.status || p.status === "confirmed")
            && !terminal.has(p.shipping_status || "")
          );
          setShipments(inTransit);
        })
        .catch(() => {});

      // Upcoming events the member has registered for or expressed interest
      // in. /api/member-events returns every published event flagged with
      // is_interested + registration_status; we filter to those the member
      // cares about and that haven't happened yet.
      fetch("/api/member-events", { credentials: "include" })
        .then((er) => er.ok ? er.json() : null)
        .then((events) => {
          if (!Array.isArray(events)) return;
          const tnow = Date.now();
          const relevant = events
            .filter((ev) => {
              if (!ev.is_interested && !ev.registration_status) return false;
              const end = ev.end_date ? new Date(ev.end_date).getTime() : null;
              const start = ev.start_date ? new Date(ev.start_date).getTime() : null;
              if (end && end < tnow) return false;
              if (!end && start && start < tnow - 24 * 3600 * 1000) return false;
              return true;
            })
            .sort((a, b) => new Date(a.start_date || 0) - new Date(b.start_date || 0));
          setMyEvents(relevant);
        })
        .catch(() => {});
    } catch (e) {
      showToast("Failed to load dashboard data", "error");
    }
    setLoading(false);
  }

  async function handleCancel(bookingId) {
    setCancelling(true);
    try {
      const r = await fetch("/api/member-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Cancellation failed");
      showToast("Booking cancelled");
      setCancelConfirm(null);
      await loadData();
    } catch (e) {
      showToast(e.message, "error");
    }
    setCancelling(false);
  }

  // Usage math.
  const totalHours = Number(usage?.total_hours || 0);
  const includedHours = Number(usage?.included_hours || tierConfig?.included_hours || 0);
  const isUnlimited = includedHours >= 99999;
  const bonusRemaining = Number(usage?.effective_bonus_remaining || 0);
  const monthlyRemaining = isUnlimited ? Infinity : Math.max(0, includedHours - totalHours);
  const overageHours = Number(usage?.overage_hours || 0);
  const overageRate = Number(tierConfig?.overage_rate || 60);
  const usagePct = isUnlimited ? 0 : Math.min(100, (totalHours / Math.max(includedHours, 0.001)) * 100);

  const fmt = (n) => Number(n || 0).toFixed(1);

  // Tier color for the inline pill — still pulls from TIER_COLORS, which
  // bakes in HG's palette. Per-tenant tier coloring is queued as a follow-up.
  const tierObj = TIER_COLORS[member.tier] || { bg: "var(--primary-bg)", text: "var(--primary)" };

  // For the "Contact us to cancel" link inside the cancel-window. We prefer
  // email over phone so members get a written paper trail; falls back to
  // phone, then to a plain (non-tappable) span if neither is configured.
  const supportContact = branding?.support_email
    ? { href: `mailto:${branding.support_email}`, label: branding.support_email }
    : branding?.support_phone
    ? { href: `tel:${branding.support_phone.replace(/[^0-9+]/g, "")}`, label: branding.support_phone }
    : null;

  // Hero pulls the next upcoming booking (closest start in the future, or
  // the active one if a session is currently in progress). Gives members
  // the single answer they open the home tab to find — when's next, and is
  // the access code coming?
  const nextBooking = useMemo(() => {
    if (!upcoming || upcoming.length === 0) return null;
    const sorted = [...upcoming].sort(
      (a, b) => new Date(a.booking_start) - new Date(b.booking_start)
    );
    return sorted.find((b) => new Date(b.booking_start).getTime() > now - 30 * 60 * 1000) || sorted[0];
  }, [upcoming, now]);

  if (loading) {
    return <div className="mem-loading">Loading dashboard...</div>;
  }

  const firstName = (member?.name || "").split(" ")[0] || "there";

  return (
    <>
      {/* Compact greeting strip: name + tier + member # + a "Show code"
          shortcut to surface the in-store discount QR without burying it
          in the stat row. */}
      <div className="mem2-greet">
        <div className="mem2-greet-text">
          <div className="mem2-greet-hi">Hi, {firstName}</div>
          <div className="mem2-greet-sub">
            <span
              className="mem2-tier-pill"
              style={{ background: tierObj.bg, color: tierObj.text }}
            >
              {member.tier}
            </span>
            {member.member_number && (
              <span className="mem2-member-no">
                #{String(member.member_number).padStart(3, "0")}
              </span>
            )}
          </div>
        </div>
        {member.verify_token && (
          <button
            type="button"
            className="mem2-qr-btn"
            onClick={() => setShowQR(true)}
            title="Show in-store discount code"
            aria-label="Show in-store discount code"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3z M19 14h2 M14 19h2 M17 17v4 M19 17v2 M21 17v4" />
            </svg>
            <span>Show code</span>
          </button>
        )}
      </div>

      <InstallPrompt variant="banner" />

      {/* Hero — Next booking. Empty-state hero falls back to a "ready to
          swing?" CTA so first-time members or members who just played see
          a single clear action instead of a bare list. */}
      {nextBooking ? (
        (() => {
          const s = new Date(nextBooking.booking_start);
          const e = new Date(nextBooking.booking_end);
          const startMs = s.getTime();
          const msUntil = startMs - now;
          const hoursUntil = msUntil / 3600000;
          const isLive = msUntil <= 0 && e.getTime() > now;
          const canCancel = hoursUntil > 6;
          return (
            <div className={`mem2-hero ${isLive ? "live" : ""}`}>
              <div className="mem2-hero-head">
                <span className="mem2-hero-eyebrow">
                  {isLive ? "Happening now" : "Next booking"}
                </span>
                <span className={`mem2-hero-count ${msUntil < 60 * 60 * 1000 ? "soon" : ""}`}>
                  {isLive ? "On the clock" : fmtCountdown(msUntil)}
                </span>
              </div>
              <div className="mem2-hero-when">
                {fT(s)} – {fT(e)}
                <span className="mem2-hero-bay"> · {nextBooking.bay}</span>
              </div>
              <div className="mem2-hero-date">{fDL(s)}</div>
              <div className="mem2-hero-meta">
                {hoursUntil > 0 && hoursUntil <= 1 ? (
                  <>🔑 Access code arrives ~10 min before start (check email).</>
                ) : isLive ? (
                  <>🔑 Your access code is in your inbox.</>
                ) : (
                  <>🔑 We email your access code ~10 min before start.</>
                )}
              </div>
              <div className="mem2-hero-actions">
                <button
                  className="mem2-btn-primary"
                  onClick={() => router.push("/members/book")}
                >
                  Book another
                </button>
                {canCancel ? (
                  <button
                    className="mem2-btn-ghost"
                    onClick={() => setCancelConfirm(nextBooking.booking_id)}
                    disabled={cancelling}
                  >
                    Cancel
                  </button>
                ) : supportContact ? (
                  <a className="mem2-btn-ghost" href={supportContact.href}>
                    Contact us to cancel
                  </a>
                ) : (
                  <span className="mem2-btn-ghost disabled">Contact us to cancel</span>
                )}
              </div>
              {cancelConfirm === nextBooking.booking_id && (
                <div className="mem-cancel-confirm" style={{ marginTop: 12 }}>
                  <span>Cancel this booking?</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="mem-cancel-btn mem-cancel-yes"
                      onClick={() => handleCancel(nextBooking.booking_id)}
                      disabled={cancelling}
                    >
                      {cancelling ? "..." : "Yes, cancel"}
                    </button>
                    <button
                      className="mem-btn-sm"
                      style={{ color: "var(--text)", border: "1px solid var(--border)" }}
                      onClick={() => setCancelConfirm(null)}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()
      ) : (
        <div className="mem2-hero empty">
          <div className="mem2-hero-eyebrow">No bookings yet</div>
          <div className="mem2-hero-when" style={{ fontSize: 18 }}>
            Ready to swing?
          </div>
          <div className="mem2-hero-meta">Pick a bay and a time — takes about 20 seconds.</div>
          <div className="mem2-hero-actions">
            <button
              className="mem2-btn-primary"
              onClick={() => router.push("/members/book?new=1")}
            >
              Book a bay
            </button>
          </div>
        </div>
      )}

      {/* Usage — single progress bar replaces the three sibling cards
          (Used / Remaining / Allowance) from the old layout. Bonus +
          overage + shop-credit collapse into a chip row that hides when
          everything is zero. */}
      <div className="mem-section mem2-usage">
        <div className="mem-section-head">
          <span>This month</span>
          <span className="mem2-usage-pct">
            {isUnlimited ? "Unlimited" : `${fmt(totalHours)} / ${includedHours}h`}
          </span>
        </div>

        {isUnlimited ? (
          <div className="mem2-usage-unlimited">
            ∞ Unlimited play this month — {fmt(totalHours)}h booked so far.
          </div>
        ) : (
          <>
            <div className="mem2-progress">
              <div
                className="mem2-progress-fill"
                style={{
                  width: `${Math.min(usagePct, 100)}%`,
                  background:
                    monthlyRemaining <= 2
                      ? "var(--status-warn, #ddd480)"
                      : "var(--status-good, var(--primary))",
                }}
              />
              {overageHours > 0 && (
                <div
                  className="mem2-progress-overage"
                  title={`${fmt(overageHours)}h overage`}
                />
              )}
            </div>
            <div className="mem2-usage-line">
              <strong style={{
                color: monthlyRemaining <= 2 ? "var(--status-danger, #C92F1F)" : "var(--text)",
              }}>
                {fmt(monthlyRemaining)}h
              </strong>{" "}
              remaining of your monthly allowance
              {bonusRemaining > 0 && (
                <> · <strong>{fmt(bonusRemaining)}h</strong> bonus</>
              )}
            </div>
          </>
        )}

        {(bonusRemaining > 0 || overageHours > 0 || Number(member.shop_credit_balance || 0) > 0) && (
          <div className="mem2-chips">
            {bonusRemaining > 0 && (
              <span className="mem2-chip bonus">
                <strong>+{fmt(bonusRemaining)}h</strong> bonus
              </span>
            )}
            {overageHours > 0 && (
              <span className="mem2-chip danger">
                <strong>{fmt(overageHours)}h</strong> overage · ${(overageHours * overageRate).toFixed(2)}
              </span>
            )}
            {Number(member.shop_credit_balance || 0) > 0 && (
              <span className="mem2-chip shop">
                <strong>${Number(member.shop_credit_balance).toFixed(2)}</strong> shop credit
              </span>
            )}
          </div>
        )}
      </div>

      {/* QR modal — image only fetched on open so the dashboard render
          itself doesn't hit qrserver.com (and doesn't leak the member id
          on every page view). Production-grade self-host with qrcode.react
          is queued as a follow-up. */}
      <Modal open={showQR} onClose={() => setShowQR(false)}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 4 }}>In-Store Discount</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px 0" }}>
            Show this code at the register to apply your member discount.
          </p>
          {showQR && (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrPayload(member))}&color=4C8D73&bgcolor=FFFFFF`}
              alt="Member QR Code"
              style={{ width: 240, height: 240, borderRadius: 8 }}
            />
          )}
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
            {member.tier} — {tierConfig?.pro_shop_discount || 0}% discount
          </div>
          {Number(member.shop_credit_balance || 0) > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--status-bonus, #ddd480)", fontWeight: 600 }}>
              ${Number(member.shop_credit_balance).toFixed(2)} store credit available
            </div>
          )}
        </div>
      </Modal>

      {/* Loyalty progress. The one-liner above the bars explains what hitting
          a threshold actually does ("we issue shop credit at month end") so
          members can decide whether the goal is worth chasing. */}
      {loyalty && loyalty.progress && loyalty.progress.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Rewards Progress</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8, marginBottom: 12 }}>
            Hit a threshold and we issue shop credit at month end.
          </div>

          {loyalty.is_member === false && (
            <div style={{ background: "var(--primary-bg)", borderRadius: "var(--radius)", padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text)" }}>
                <strong style={{ color: "var(--primary)" }}>Members only</strong> — become a member to start earning.
              </span>
              <button
                onClick={() => router.push("/members/billing")}
                className="mem-btn mem-btn-primary"
                style={{ fontSize: 11, padding: "6px 14px" }}
              >
                Join Now
              </button>
            </div>
          )}

          <div style={{ opacity: loyalty.is_member === false ? 0.45 : 1 }}>
            {loyalty.progress.map((p) => {
              const label = p.rule_type === "hours" ? `${p.current.toFixed(1)}/${p.threshold}h booked`
                : p.rule_type === "bookings" ? `${p.current}/${p.threshold} bookings`
                : `$${p.current.toFixed(0)}/$${p.threshold} spent`;
              return (
                <div key={p.rule_type} style={{ marginBottom: p === loyalty.progress[loyalty.progress.length - 1] ? 0 : 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
                    <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>${p.reward} credit</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.pct}%`, background: p.pct >= 100 ? "var(--status-bonus, #ddd480)" : "var(--primary)", borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                  {loyalty.is_member !== false && p.pct >= 100 && (
                    <div style={{ fontSize: 11, color: "var(--status-bonus, #ddd480)", fontWeight: 600, marginTop: 2 }}>Threshold reached! Credit issued at month end.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Announcements — pinned by admin via /api/admin-news. Hidden when
          nothing is active so the home tab stays uncluttered. */}
      {news.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Announcements</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {news.map((n) => {
              const accent =
                n.severity === "urgent" ? "var(--status-danger, #C92F1F)" :
                n.severity === "warning" ? "var(--status-warn, #ddd480)" :
                "var(--status-good, #4C8D73)";
              const label =
                n.severity === "urgent" ? "Important" :
                n.severity === "warning" ? "Heads up" :
                n.severity === "success" ? "Good news" :
                "Update";
              return (
                <div
                  key={n.id}
                  style={{
                    display: "flex", gap: 12,
                    padding: 12, borderRadius: 12,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderLeft: `4px solid ${accent}`,
                  }}
                >
                  {n.image_url && (
                    <img src={n.image_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: "inline-block", padding: "1px 8px", borderRadius: 999,
                      background: accent, color: "#fff", fontSize: 9, fontWeight: 700,
                      letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4,
                    }}>
                      {label}
                    </span>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, color: "var(--text)" }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                      {n.body}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other upcoming bookings (the hero already covered the next one).
          Hidden when the only upcoming booking IS the hero. */}
      {upcoming.filter((b) => !nextBooking || b.booking_id !== nextBooking.booking_id).length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">
            <span>Also upcoming</span>
            <button className="mem-btn-sm mem-btn-accent" onClick={() => router.push("/members/book")}>
              Book another
            </button>
          </div>
          <div className="mem-list">
            {upcoming
              .filter((b) => !nextBooking || b.booking_id !== nextBooking.booking_id)
              .map((b) => {
                const s = new Date(b.booking_start);
                const e = new Date(b.booking_end);
                const hoursUntil = (s.getTime() - now) / 3600000;
                const canCancel = hoursUntil > 6;
                return (
                  <div key={b.booking_id} className="mem-list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>{fD(s)}</strong>
                        <div className="mem-list-sub">{fT(s)} – {fT(e)} · {b.bay}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="mem-dur">{Number(b.duration_hours).toFixed(1)}h</span>
                        {canCancel ? (
                          <button
                            className="mem-cancel-btn"
                            onClick={() => setCancelConfirm(b.booking_id)}
                            disabled={cancelling}
                          >
                            Cancel
                          </button>
                        ) : supportContact ? (
                          <a
                            href={supportContact.href}
                            className="mem-list-sub"
                            style={{ fontSize: 11, color: "var(--primary)", textDecoration: "underline" }}
                          >
                            Contact to cancel
                          </a>
                        ) : (
                          <span className="mem-list-sub" style={{ fontSize: 11 }}>Contact us to cancel</span>
                        )}
                      </div>
                    </div>

                    {cancelConfirm === b.booking_id && (
                      <div className="mem-cancel-confirm">
                        <span>Cancel this booking?</span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="mem-cancel-btn mem-cancel-yes"
                            onClick={() => handleCancel(b.booking_id)}
                            disabled={cancelling}
                          >
                            {cancelling ? "..." : "Yes, cancel"}
                          </button>
                          <button
                            className="mem-btn-sm"
                            style={{ color: "var(--text)", border: "1px solid var(--border)" }}
                            onClick={() => setCancelConfirm(null)}
                          >
                            Keep it
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Shipments — in-transit in-app shop orders. Hidden when the member
          has none. Tap a row to jump to the full order detail on Shop. */}
      {shipments.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Shipments</div>
          <div className="mem-list">
            {shipments.map((s) => {
              const placed = s.created_at ? new Date(s.created_at) : null;
              const itemsLabel = (s.items || []).length === 1
                ? s.items[0].item_title
                : `${(s.items || []).length} items`;
              const statusPill = (() => {
                const st = s.shipping_status || "label_created";
                if (st === "label_created") return { label: "Label created", bg: "var(--status-warn, #ddd480)", color: "#35443B" };
                if (st === "pre_transit")   return { label: "Pre-transit",   bg: "var(--status-warn, #ddd480)", color: "#35443B" };
                if (st === "transit")       return { label: "In transit",    bg: "var(--primary)", color: "var(--bg)" };
                if (st === "returned")      return { label: "Returned",      bg: "var(--status-danger, var(--red))", color: "#fff" };
                if (st === "failure")       return { label: "Issue",         bg: "var(--status-danger, var(--red))", color: "#fff" };
                return { label: "Shipped", bg: "var(--primary)", color: "var(--bg)" };
              })();
              return (
                <div
                  key={s.id}
                  className="mem-list-item"
                  style={{ alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                  onClick={() => router.push("/members/shop")}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                      <span className="mem-purchase-tag" style={{ background: statusPill.bg, color: statusPill.color }}>{statusPill.label}</span>
                      <strong style={{ fontSize: 14 }}>{itemsLabel}</strong>
                    </div>
                    {s.tracking_number && (
                      <div style={{ marginTop: 2, fontSize: 12 }}>
                        <a
                          href={s.tracking_url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none", fontFamily: "var(--font-mono)" }}
                        >
                          {s.tracking_number} {s.tracking_url ? "→" : ""}
                        </a>
                      </div>
                    )}
                  </div>
                  {placed && (
                    <span className="mem-list-sub" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      Shipped {fD(placed)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your Events — only events the member registered for or flagged
          interest in, and that haven't already ended. Hidden when empty so
          the dashboard stays uncluttered for members not engaged with
          events. Tap a row to jump to the event detail page. */}
      {myEvents.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Your Events</div>
          <div className="mem-list">
            {myEvents.map((ev) => {
              const start = ev.start_date ? new Date(ev.start_date) : null;
              const status = ev.registration_status;
              let tag = "Interested";
              let tagStyle = { background: "var(--primary-bg)", color: "var(--primary)" };
              if (status === "registered") {
                tag = "Registered";
                tagStyle = { background: "var(--primary)", color: "var(--bg)" };
              } else if (status === "waitlist") {
                tag = "Waitlist";
                tagStyle = { background: "var(--status-warn, #ddd480)", color: "#35443B" };
              } else if (status) {
                tag = status.charAt(0).toUpperCase() + status.slice(1);
              }
              return (
                <div
                  key={ev.id}
                  className="mem-list-item"
                  style={{ alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                  onClick={() => router.push(`/members/events/${ev.id}`)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", lineHeight: 1.25 }}>{ev.title}</strong>
                    {ev.subtitle && (
                      <div className="mem-list-sub" style={{ fontSize: 12, marginTop: 2 }}>
                        {ev.subtitle}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span className="mem-purchase-tag" style={tagStyle}>{tag}</span>
                    {start && (
                      <span className="mem-list-sub" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                        {fD(start)} · {fT(start)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* This month's activity — gives members a quick "I've been here X
          times" sense without leaving the home tab. */}
      <div className="mem-section">
        <div className="mem-section-head">This month's activity</div>
        {monthBookings.length === 0 ? (
          <div className="mem-empty">No bookings this month yet.</div>
        ) : (
          <div className="mem-list">
            {monthBookings.map((b) => {
              const s = new Date(b.booking_start);
              const e = new Date(b.booking_end);
              return (
                <div key={b.booking_id} className="mem-list-item">
                  <div>
                    <span>{fD(s)}</span>
                    <span className="mem-list-sub" style={{ marginLeft: 8 }}>{fT(s)}–{fT(e)}</span>
                    <span className="mem-list-sub" style={{ marginLeft: 8 }}>{b.bay}</span>
                  </div>
                  <div className="mem-dur">{Number(b.duration_hours).toFixed(1)}h</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
