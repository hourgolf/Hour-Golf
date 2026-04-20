import { useState, useEffect } from "react";
import { fD } from "../../lib/format";

// /members/billing now owns three things: payment method on file,
// notification preferences, and the receipt history. Membership
// management + punch passes moved to /members/account so the surfaces
// members touch most often (upgrade / downgrade / buy hours) are one
// nav-tap away instead of two.
export default function MemberBilling({ member, tierConfig, refresh, showToast }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingUpCard, setSettingUpCard] = useState(false);

  // Notification preferences — moved here from Account so the
  // Account page can lead with membership management instead of a
  // toggle list a member edits maybe twice a year.
  const [prefs, setPrefs] = useState({
    email_booking_confirmations: true,
    email_cancellations: true,
    email_reminders: true,
    email_billing: true,
  });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  useEffect(() => {
    loadBilling();
    loadPreferences();

    // Catch the Stripe-checkout return for "add card" — only flow
    // that still lands on /members/billing. (Subscribe + punch-pass
    // checkouts now return to /members/account.)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("card_added")) {
        showToast("Payment method added successfully!");
        window.history.replaceState({}, "", "/members/billing");
        refresh();
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

  async function loadPreferences() {
    try {
      const r = await fetch("/api/member-preferences", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        if (d.preferences) setPrefs(d.preferences);
      }
    } catch (_) { /* defaults stand */ }
    setPrefsLoaded(true);
  }

  async function savePreferences(next) {
    // Optimistic update — toggles feel instant; rollback on failure.
    const prev = prefs;
    setPrefs(next);
    setPrefsSaving(true);
    try {
      const r = await fetch("/api/member-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ preferences: next }),
      });
      if (!r.ok) throw new Error("Failed to save preferences");
    } catch (e) {
      setPrefs(prev);
      showToast("Failed to save preferences", "error");
    }
    setPrefsSaving(false);
  }

  function togglePref(key) {
    savePreferences({ ...prefs, [key]: !prefs[key] });
  }

  async function handleSetupPayment() {
    setSettingUpCard(true);
    try {
      const r = await fetch("/api/member-setup-payment", {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      window.location.href = d.url;
    } catch (err) {
      showToast(err.message, "error");
      setSettingUpCard(false);
    }
  }

  const hasCard = member.hasPaymentMethod;

  return (
    <>
      {/* Payment Method */}
      <div className="mem-section">
        <div className="mem-section-head">Payment Method</div>
        {hasCard ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ color: "#4C8D73", fontWeight: 600 }}>{"\u2713"} Card on file</span>
              <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 2 }}>Your payment method is set up</div>
            </div>
            <button
              className="mem-btn-sm"
              style={{ color: "var(--text)", border: "1px solid var(--border)", background: "var(--surface)" }}
              onClick={handleSetupPayment}
              disabled={settingUpCard}
            >
              {settingUpCard ? "..." : "Update Card"}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <p style={{ fontSize: 14, color: "#C92F1F", marginBottom: 12 }}>
              {"\u26a0\ufe0f"} No payment method on file. A card is required to make bookings.
            </p>
            <button
              className="mem-btn mem-btn-primary"
              onClick={handleSetupPayment}
              disabled={settingUpCard}
            >
              {settingUpCard ? "Setting up..." : "Add Payment Method."}
            </button>
          </div>
        )}
      </div>

      {/* Notification preferences — toggles save optimistically. */}
      <div className="mem-section">
        <div className="mem-section-head">Email Notifications</div>
        {!prefsLoaded ? (
          <div className="mem-loading">Loading preferences...</div>
        ) : (
          <>
            <div className="mem-toggle" onClick={() => togglePref("email_booking_confirmations")}>
              <div>
                <div className="mem-toggle-label">Booking Confirmations</div>
                <div className="mem-toggle-sub">Receive an email when your booking is confirmed</div>
              </div>
              <div className={`mem-toggle-switch ${prefs.email_booking_confirmations ? "on" : ""}`} />
            </div>
            <div className="mem-toggle" onClick={() => togglePref("email_cancellations")}>
              <div>
                <div className="mem-toggle-label">Cancellation Confirmations</div>
                <div className="mem-toggle-sub">Receive an email when you cancel a booking</div>
              </div>
              <div className={`mem-toggle-switch ${prefs.email_cancellations ? "on" : ""}`} />
            </div>
            <div className="mem-toggle" onClick={() => togglePref("email_reminders")}>
              <div>
                <div className="mem-toggle-label">Booking Reminders</div>
                <div className="mem-toggle-sub">Get a reminder before your upcoming bookings</div>
              </div>
              <div className={`mem-toggle-switch ${prefs.email_reminders ? "on" : ""}`} />
            </div>
            <div className="mem-toggle" onClick={() => togglePref("email_billing")}>
              <div>
                <div className="mem-toggle-label">Billing Notifications</div>
                <div className="mem-toggle-sub">Receive emails about payments and billing</div>
              </div>
              <div className={`mem-toggle-switch ${prefs.email_billing ? "on" : ""}`} />
            </div>
            {prefsSaving && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", marginTop: 6 }}>Saving...</div>
            )}
          </>
        )}
      </div>

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
