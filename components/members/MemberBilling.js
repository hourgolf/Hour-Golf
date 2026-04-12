import { useState, useEffect } from "react";
import { fD } from "../../lib/format";

const CREDIT_OPTIONS = [1, 2, 5, 10];

export default function MemberBilling({ member, tierConfig, refresh, showToast }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  const overageRate = Number(tierConfig?.overage_rate || 60);

  useEffect(() => {
    loadBilling();
  }, []);

  async function loadBilling() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-billing", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setPayments(d.payments || []);
      }
    } catch (_) { /* ignore */ }
    setLoading(false);
  }

  async function handleBuyCredits(hours) {
    setPurchasing(true);
    try {
      const r = await fetch("/api/customer-buy-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: member.email, hours }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      window.location.href = d.url;
    } catch (err) {
      showToast(err.message, "error");
      setPurchasing(false);
    }
  }

  return (
    <>
      {/* Buy Credits */}
      <div className="mem-section">
        <div className="mem-section-head">Buy Hour Credits</div>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
          Purchase additional bay hours at ${overageRate}/hr.
        </p>
        <div className="mem-credit-grid">
          {CREDIT_OPTIONS.map((h) => (
            <button
              key={h}
              className="mem-credit-btn"
              onClick={() => handleBuyCredits(h)}
              disabled={purchasing}
            >
              <div className="mem-credit-hrs">{h}h</div>
              <div className="mem-credit-price">${(h * overageRate).toFixed(0)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Payment History */}
      <div className="mem-section">
        <div className="mem-section-head">Payment History</div>
        {loading ? (
          <div className="mem-loading">Loading payments...</div>
        ) : payments.length === 0 ? (
          <div className="mem-empty">No payment history</div>
        ) : (
          <table className="mem-billing-table">
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
          </table>
        )}
      </div>
    </>
  );
}
