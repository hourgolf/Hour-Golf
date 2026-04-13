import { useState, useEffect } from "react";

export default function MemberAccount({ member, tierConfig, refresh, showToast }) {
  const [name, setName] = useState(member.name || "");
  const [phone, setPhone] = useState(member.phone || "");
  const [prefs, setPrefs] = useState({
    email_booking_confirmations: true,
    email_cancellations: true,
    email_reminders: true,
    email_billing: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  async function loadPreferences() {
    setLoading(true);
    try {
      const r = await fetch("/api/member-preferences", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setName(d.profile.name || "");
        setPhone(d.profile.phone || "");
        setPrefs(d.preferences);
      }
    } catch (_) { /* use defaults */ }
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch("/api/member-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          phone,
          preferences: {
            email_booking_confirmations: prefs.email_booking_confirmations,
            email_cancellations: prefs.email_cancellations,
            email_reminders: prefs.email_reminders,
            email_billing: prefs.email_billing,
          },
        }),
      });
      if (!r.ok) throw new Error("Failed to save");
      showToast("Settings saved!");
      refresh();
    } catch (e) {
      showToast("Failed to save settings", "error");
    }
    setSaving(false);
  }

  function togglePref(key) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  if (loading) {
    return <div className="mem-loading">Loading account...</div>;
  }

  return (
    <>
      {/* Profile Section */}
      <div className="mem-section">
        <div className="mem-section-head">Profile</div>
        <div style={{ maxWidth: 480 }}>
          <div className="mem-form-row">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="mem-form-row">
            <label>Email</label>
            <input
              type="email"
              value={member.email}
              disabled
              style={{ opacity: 0.6, cursor: "not-allowed" }}
            />
          </div>
          <div className="mem-form-row">
            <label>Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
      </div>

      {/* Email Notifications */}
      <div className="mem-section">
        <div className="mem-section-head">Email Notifications</div>
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
      </div>

      {/* Save Button */}
      <button
        className="mem-btn mem-btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ marginBottom: 24 }}
      >
        {saving ? "Saving..." : "Save Changes."}
      </button>
    </>
  );
}
