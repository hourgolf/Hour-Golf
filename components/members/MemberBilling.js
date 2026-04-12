import { useState, useEffect } from "react";
import { fD } from "../../lib/format";

const PUNCH_PASSES = [
  { hours: 1, discount: 0, label: "1 Hour" },
  { hours: 5, discount: 0.10, label: "5 Hours", tag: "10% off" },
  { hours: 10, discount: 0.25, label: "10 Hours", tag: "25% off" },
];

export default function MemberBilling({ member, tierConfig, refresh, showToast }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  // Subscription state
  const [tiers, setTiers] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [changingTier, setChangingTier] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const overageRate = Number(tierConfig?.overage_rate || 60);

  useEffect(() => {
    loadBilling();
    loadSubscription();

    // Check for success redirects
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("subscribed")) {
        showToast(`Welcome! You're now a ${params.get("subscribed")} member.`);
        window.history.replaceState({}, "", "/members/billing");
        refresh();
      }
      if (params.get("purchased")) {
        showToast(`${params.get("purchased")} bonus hour${params.get("purchased") === "1" ? "" : "s"} added to your account!`);
        window.history.replaceState({}, "", "/members/billing");
      }
    }
  }, []);

  async function loadBilling() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-billing", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setPayments(d.payments || []);
      }
    } catch (_) {}
    setLoading(false);
  }

  async function loadSubscription() {
    setSubLoading(true);
    try {
      const r = await fetch("/api/member-subscription", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setTiers(d.availableTiers || []);
        setSubscription(d.subscription);
      }
    } catch (_) {}
    setSubLoading(false);
  }

  async function handleSubscribe(tier) {
    setChangingTier(true);
    try {
      const r = await fetch("/api/member-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      window.location.href = d.url;
    } catch (e) {
      showToast(e.message, "error");
      setChangingTier(false);
    }
  }

  async function handleChangeTier(tier) {
    setChangingTier(true);
    try {
      const r = await fetch("/api/member-subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      showToast(`Membership updated to ${tier}!`);
      refresh();
      await loadSubscription();
    } catch (e) {
      showToast(e.message, "error");
    }
    setChangingTier(false);
  }

  async function handleCancelSubscription() {
    setChangingTier(true);
    try {
      const r = await fetch("/api/member-subscription", {
        method: "DELETE",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      const cancelDate = new Date(d.cancel_at).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
      showToast(`Membership will end on ${cancelDate}`);
      setCancelConfirm(false);
      await loadSubscription();
    } catch (e) {
      showToast(e.message, "error");
    }
    setChangingTier(false);
  }

  async function handleBuyPunchPass(hours) {
    setPurchasing(true);
    try {
      const r = await fetch("/api/punch-pass-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hours }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      window.location.href = d.url;
    } catch (err) {
      showToast(err.message, "error");
      setPurchasing(false);
    }
  }

  const hasSubscription = subscription && subscription.status === "active";
  const isCancelling = subscription?.cancel_at_period_end;

  return (
    <>
      {/* Membership Section */}
      <div className="mem-section">
        <div className="mem-section-head">Membership</div>

        {subLoading ? (
          <div className="mem-loading">Loading membership info...</div>
        ) : (
          <>
            {/* Current status */}
            {hasSubscription && (
              <div style={{ marginBottom: 20, padding: "12px 16px", background: "var(--bg, #f5f3ef)", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <strong style={{ fontSize: 15 }}>{member.tier} Member</strong>
                  <span className={`mem-sub-status ${isCancelling ? "cancelling" : "active"}`}>
                    {isCancelling ? "Cancelling" : "Active"}
                  </span>
                </div>
                {isCancelling && subscription.current_period_end && (
                  <div style={{ fontSize: 13, color: "#a67c00" }}>
                    Membership ends {new Date(subscription.current_period_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                )}
              </div>
            )}

            {/* Tier cards */}
            {tiers.length > 0 && (
              <div className="mem-tier-grid">
                {tiers.map((t) => {
                  const isCurrent = t.tier === member.tier;
                  const isUnlimited = Number(t.included_hours) >= 99999;
                  const hasStripePriceId = !!t.stripe_price_id;

                  return (
                    <div key={t.tier} className={`mem-tier-card ${isCurrent ? "current" : ""}`}>
                      <div className="mem-tier-card-name">{t.tier}</div>
                      <div className="mem-tier-card-price">${Number(t.monthly_fee).toFixed(0)}</div>
                      <div className="mem-tier-card-period">/month</div>
                      <div className="mem-tier-card-features">
                        {isUnlimited ? "Unlimited hours" : `${t.included_hours} hours/month`}
                        <br />${Number(t.overage_rate)}/hr overage
                        {Number(t.pro_shop_discount) > 0 && (<><br />{t.pro_shop_discount}% pro shop discount</>)}
                      </div>

                      {isCurrent ? (
                        <span style={{ fontSize: 12, color: "#006044", fontWeight: 600 }}>Current Plan</span>
                      ) : !hasStripePriceId ? (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Contact us</span>
                      ) : hasSubscription ? (
                        <button
                          className="mem-btn mem-btn-primary"
                          style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
                          onClick={() => handleChangeTier(t.tier)}
                          disabled={changingTier}
                        >
                          {changingTier ? "..." : Number(t.monthly_fee) > Number(tierConfig?.monthly_fee || 0) ? "Upgrade" : "Downgrade"}
                        </button>
                      ) : (
                        <button
                          className="mem-btn mem-btn-primary"
                          style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
                          onClick={() => handleSubscribe(t.tier)}
                          disabled={changingTier}
                        >
                          {changingTier ? "..." : "Select Plan"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cancel button */}
            {hasSubscription && !isCancelling && (
              <div style={{ marginTop: 8 }}>
                {cancelConfirm ? (
                  <div className="mem-cancel-confirm">
                    <span>Cancel your membership? It will remain active until the end of your billing period.</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="mem-cancel-btn mem-cancel-yes"
                        onClick={handleCancelSubscription}
                        disabled={changingTier}
                      >
                        {changingTier ? "..." : "Yes, cancel"}
                      </button>
                      <button
                        className="mem-btn-sm"
                        style={{ color: "var(--text)", border: "1px solid var(--border)" }}
                        onClick={() => setCancelConfirm(false)}
                      >
                        Keep membership
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="mem-cancel-btn"
                    onClick={() => setCancelConfirm(true)}
                    style={{ fontSize: 12 }}
                  >
                    Cancel Membership
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Punch Passes */}
      {overageRate > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Buy Hour Passes</div>
          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            Purchase extra bay hours. Unused hours carry over month to month.
          </p>
          <div className="mem-punch-grid">
            {PUNCH_PASSES.map((p) => {
              const fullPrice = p.hours * overageRate;
              const finalPrice = fullPrice * (1 - p.discount);
              return (
                <button
                  key={p.hours}
                  className="mem-punch-card"
                  onClick={() => handleBuyPunchPass(p.hours)}
                  disabled={purchasing}
                >
                  {p.tag && <div className="mem-punch-tag">{p.tag}</div>}
                  <div className="mem-punch-hrs">{p.label}</div>
                  <div className="mem-punch-price">${Math.round(finalPrice)}</div>
                  {p.discount > 0 && (
                    <div className="mem-punch-orig">
                      <s>${Math.round(fullPrice)}</s>
                    </div>
                  )}
                  <div className="mem-punch-rate">${overageRate}/hr</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment History */}
      <div className="mem-section">
        <div className="mem-section-head">Payment History</div>
        {loading ? (
          <div className="mem-loading">Loading payments...</div>
        ) : payments.length === 0 ? (
          <div className="mem-empty">No payment history</div>
        ) : (
          <div className="mem-table-scroll"><table className="mem-billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th style={{ textAlign: "right" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{fD(new Date(p.created_at))}</td>
                  <td>{p.description || "Payment"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    ${(Number(p.amount_cents) / 100).toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`mem-billing-status ${p.status}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
