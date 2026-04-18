import { useState, useEffect } from "react";
import DatePicker from "../DatePicker";

// Birthday picker bounds: anyone older than 1900 is unrealistic; max is
// "today" minus 18 years (signup enforces 18+, and edits should stay
// consistent). Computed lazily inside the component so the values are
// fresh on every render rather than baked at module load.
function birthdayMinIso() {
  return "1900-01-01";
}
function birthdayMaxIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export default function MemberAccount({ member, tierConfig, refresh, showToast, onLogout }) {
  const [name, setName] = useState(member.name || "");
  const [phone, setPhone] = useState(member.phone || "");
  const [birthday, setBirthday] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [prefs, setPrefs] = useState({
    email_booking_confirmations: true,
    email_cancellations: true,
    email_reminders: true,
    email_billing: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

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
        setBirthday(d.profile.birthday || "");
        setAddress(d.profile.address || "");
        setEmergencyContact(d.profile.emergency_contact || "");
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
          birthday,
          address,
          emergency_contact: emergencyContact,
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

  async function handleChangeEmail() {
    if (!newEmail.trim() || !emailPassword) return;
    setEmailSaving(true);
    try {
      const r = await fetch("/api/member-change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newEmail: newEmail.trim(), password: emailPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to update email");
      showToast("Email updated successfully!");
      setNewEmail("");
      setEmailPassword("");
      setShowEmailForm(false);
      refresh();
    } catch (e) {
      showToast(e.message, "error");
    }
    setEmailSaving(false);
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword.length < 8) {
      showToast("New password must be at least 8 characters", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match", "error");
      return;
    }
    setPasswordSaving(true);
    try {
      const r = await fetch("/api/member-change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to update password");
      showToast("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
    } catch (e) {
      showToast(e.message, "error");
    }
    setPasswordSaving(false);
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
          <div className="mem-form-row">
            <label>Birthday</label>
            <DatePicker
              value={birthday}
              onChange={setBirthday}
              min={birthdayMinIso()}
              max={birthdayMaxIso()}
              placeholder="Pick your birthday"
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              So we can celebrate — a birthday bonus may be coming your way.
            </div>
          </div>
          <div className="mem-form-row">
            <label>Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Portland, OR 97201"
            />
          </div>
          <div className="mem-form-row">
            <label>Emergency contact</label>
            <input
              type="text"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="Name &amp; phone number"
            />
          </div>
        </div>
        <button
          className="mem-btn mem-btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 16 }}
        >
          {saving ? "Saving..." : "Save Changes."}
        </button>
      </div>

      {/* Change Email */}
      <div className="mem-section">
        <div className="mem-section-head">
          <span>Email Address</span>
          {!showEmailForm && (
            <button
              className="mem-btn-sm mem-btn-accent"
              onClick={() => setShowEmailForm(true)}
            >
              Change Email.
            </button>
          )}
        </div>

        {showEmailForm ? (
          <div style={{ maxWidth: 480 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Enter your new email address and confirm with your current password.
            </p>
            <div className="mem-form-row">
              <label>New Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@email.com"
              />
            </div>
            <div className="mem-form-row">
              <label>Confirm Password</label>
              <input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleChangeEmail(); }}
                placeholder="Enter your current password"
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="mem-btn mem-btn-primary"
                onClick={handleChangeEmail}
                disabled={emailSaving || !newEmail.trim() || !emailPassword}
              >
                {emailSaving ? "Updating..." : "Update Email."}
              </button>
              <button
                className="mem-btn-sm"
                style={{ color: "var(--text)", border: "1px solid var(--border)", padding: "10px 18px" }}
                onClick={() => { setShowEmailForm(false); setNewEmail(""); setEmailPassword(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text)" }}>
            {member.email}
          </p>
        )}
      </div>

      {/* Change Password */}
      <div className="mem-section">
        <div className="mem-section-head">
          <span>Password</span>
          {!showPasswordForm && (
            <button
              className="mem-btn-sm mem-btn-accent"
              onClick={() => setShowPasswordForm(true)}
            >
              Change Password.
            </button>
          )}
        </div>

        {showPasswordForm ? (
          <div style={{ maxWidth: 480 }}>
            <div className="mem-form-row">
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
              />
            </div>
            <div className="mem-form-row">
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
              />
            </div>
            <div className="mem-form-row">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }}
                placeholder="Confirm new password"
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="mem-btn mem-btn-primary"
                onClick={handleChangePassword}
                disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              >
                {passwordSaving ? "Updating..." : "Update Password."}
              </button>
              <button
                className="mem-btn-sm"
                style={{ color: "var(--text)", border: "1px solid var(--border)", padding: "10px 18px" }}
                onClick={() => { setShowPasswordForm(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
            ••••••••
          </p>
        )}
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
         {/* Sign Out */}
      {onLogout && (
        <div className="mem-section" style={{ textAlign: "center", paddingTop: 16, paddingBottom: 32 }}>
          <button
            className="mem-cancel-btn"
            onClick={onLogout}
            style={{ width: "100%", padding: "14px 32px", fontSize: 13 }}
          >
            Sign Out
          </button>
        </div>
      )} </>
  );
}
