import { useState, useEffect } from "react";
import DatePicker from "../DatePicker";
import { useTenantFeatures } from "../../hooks/useTenantFeatures";

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

// Punch-pass tiers shown on the Account page. Discount tiers reward
// volume — same shape that lived inside MemberBilling before this page
// took over membership management.
const PUNCH_PASSES = [
  { hours: 1, discount: 0,    label: "1 Hour" },
  { hours: 5, discount: 0.10, label: "5 Hours",  tag: "10% off" },
  { hours: 10, discount: 0.25, label: "10 Hours", tag: "25% off" },
];

export default function MemberAccount({ member, tierConfig, refresh, showToast, onLogout }) {
  const { isEnabled: isFeatureEnabled } = useTenantFeatures();
  const billingEnabled = isFeatureEnabled("stripe_enabled");

  // Profile fields
  const [name, setName] = useState(member.name || "");
  const [phone, setPhone] = useState(member.phone || "");
  const [birthday, setBirthday] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
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

  // Membership / subscription state — moved here from MemberBilling so
  // the most-used membership controls (upgrade, downgrade, cancel) are
  // one nav-tap away instead of two.
  const [tiers, setTiers] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [changingTier, setChangingTier] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [upgradeConfirm, setUpgradeConfirm] = useState(null);

  // Punch pass purchase state — also moved here from Billing for the
  // same reason: members buy passes far more often than they manage
  // their card or read receipts.
  const [purchasing, setPurchasing] = useState(false);
  const overageRate = Number(tierConfig?.overage_rate || 60);

  useEffect(() => {
    loadProfile();
    if (billingEnabled) loadSubscription();

    // Catch the Stripe-checkout return redirects. Punch-pass and
    // subscribe flows both come back to /members/account now (the
    // return URLs in the two API endpoints were repointed when this
    // page took over membership ownership).
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("subscribed")) {
        showToast(`Welcome! You're now a ${params.get("subscribed")} member.`);
        window.history.replaceState({}, "", "/members/account");
        refresh();
      }
      if (params.get("purchased")) {
        const h = params.get("purchased");
        showToast(`${h} bonus hour${h === "1" ? "" : "s"} added to your account!`);
        window.history.replaceState({}, "", "/members/account");
      }
    }
  }, []);

  async function loadProfile() {
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
      }
    } catch (_) { /* use defaults */ }
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

  async function handleSaveProfile() {
    setSaving(true);
    try {
      // Notification-pref toggles moved to /members/billing — only the
      // profile half of the endpoint payload is sent from this page.
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
        }),
      });
      if (!r.ok) throw new Error("Failed to save");
      showToast("Profile saved!");
      refresh();
    } catch (e) {
      showToast("Failed to save profile", "error");
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
    setUpgradeConfirm(null);
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

  if (loading) {
    return <div className="mem-loading">Loading account...</div>;
  }

  const hasSubscription = subscription && subscription.status === "active";
  const isCancelling = subscription?.cancel_at_period_end;
  function isUpgrade(t) { return Number(t.monthly_fee) > Number(tierConfig?.monthly_fee || 0); }

  return (
    <>
      {/* Membership — top of page now. Most-used billing surface
          (upgrade / downgrade / cancel) lives one tap from the nav. */}
      {billingEnabled && (
        <div className="mem-section">
          <div className="mem-section-head">Membership</div>

          {subLoading ? (
            <div className="mem-loading">Loading membership info...</div>
          ) : (
            <>
              {hasSubscription && (
                <div style={{ marginBottom: 20, padding: "12px 16px", background: "var(--bg, #EDF3E3)", borderRadius: 15 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 15 }}>{member.tier} Member</strong>
                    <span className={`mem-sub-status ${isCancelling ? "cancelling" : "active"}`}>
                      {isCancelling ? "Cancelling" : "Active"}
                    </span>
                  </div>
                  {isCancelling && subscription.current_period_end && (
                    <div style={{ fontSize: 13, color: "#8BB5A0" }}>
                      Membership ends {new Date(subscription.current_period_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>
                  )}
                </div>
              )}

              {tiers.length > 0 && (
                <div className="mem-tier-grid">
                  {tiers.map((t) => {
                    const isCurrent = t.tier === member.tier;
                    const isUnlimited = Number(t.included_hours) >= 99999;
                    const hasStripePriceId = !!t.stripe_price_id;
                    const up = isUpgrade(t);
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
                          <span style={{ fontSize: 12, color: "#4C8D73", fontWeight: 600 }}>Current Plan</span>
                        ) : !hasStripePriceId ? (
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Contact us</span>
                        ) : hasSubscription ? (
                          <button
                            className="mem-btn mem-btn-primary"
                            style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
                            onClick={() => setUpgradeConfirm(t.tier)}
                            disabled={changingTier}
                          >
                            {changingTier ? "..." : up ? "Upgrade" : "Downgrade"}
                          </button>
                        ) : (
                          <button
                            className="mem-btn mem-btn-primary"
                            style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
                            onClick={() => handleSubscribe(t.tier)}
                            disabled={changingTier}
                          >
                            {changingTier ? "..." : "Subscribe"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {upgradeConfirm && (
                <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "var(--bg, #EDF3E3)", border: "1px solid var(--border)" }}>
                  {(() => {
                    const targetTier = tiers.find((t) => t.tier === upgradeConfirm);
                    const up = targetTier && isUpgrade(targetTier);
                    return (
                      <>
                        <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                          <strong>{up ? "Upgrade" : "Downgrade"} to {upgradeConfirm}?</strong>
                        </p>
                        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
                          {up
                            ? "The price difference will be prorated for the rest of your billing cycle. Your new rate takes effect immediately."
                            : "You'll receive a prorated credit for the remainder of your billing cycle. Your new rate takes effect immediately."}
                        </p>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="mem-btn mem-btn-primary"
                            style={{ padding: "8px 20px", fontSize: 13 }}
                            onClick={() => handleChangeTier(upgradeConfirm)}
                            disabled={changingTier}
                          >
                            {changingTier ? "Processing..." : `Confirm ${up ? "Upgrade" : "Downgrade"}`}
                          </button>
                          <button
                            className="mem-btn-sm"
                            style={{ color: "var(--text)", border: "1px solid var(--border)" }}
                            onClick={() => setUpgradeConfirm(null)}
                          >
                            Nevermind
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {hasSubscription && !isCancelling && (
                <div style={{ marginTop: 8, textAlign: "center" }}>
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
      )}

      {/* Punch passes — second card. Members buying extra hours
          shouldn't have to dig two pages deep. */}
      {billingEnabled && overageRate > 0 && (
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

      {/* Profile + Email + Password combined into one block.
          Profile fields are always editable inline; the email and
          password change forms expand on demand so the section stays
          quiet by default. */}
      <div className="mem-section">
        <div className="mem-section-head">Profile & Account</div>

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
          <button
            className="mem-btn mem-btn-primary"
            onClick={handleSaveProfile}
            disabled={saving}
            style={{ marginTop: 4 }}
          >
            {saving ? "Saving..." : "Save Profile."}
          </button>
        </div>

        {/* Divider line so email/password feel grouped under the
            same Profile & Account header but visually distinct from
            the editable fields above. */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "24px 0 18px" }} />

        {/* Change Email row */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: showEmailForm ? 12 : 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Email login</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {showEmailForm ? "Confirm with your current password to update." : member.email}
              </div>
            </div>
            {!showEmailForm && (
              <button
                className="mem-btn-sm mem-btn-accent"
                onClick={() => setShowEmailForm(true)}
              >
                Change
              </button>
            )}
          </div>
          {showEmailForm && (
            <div style={{ maxWidth: 480 }}>
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
              <div style={{ display: "flex", gap: 8 }}>
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
          )}
        </div>

        {/* Change Password row */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: showPasswordForm ? 12 : 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Password</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {showPasswordForm ? "Pick a new one (min 8 characters)." : "••••••••"}
              </div>
            </div>
            {!showPasswordForm && (
              <button
                className="mem-btn-sm mem-btn-accent"
                onClick={() => setShowPasswordForm(true)}
              >
                Change
              </button>
            )}
          </div>
          {showPasswordForm && (
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
              <div style={{ display: "flex", gap: 8 }}>
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
          )}
        </div>
      </div>

      {/* Sign out lives at the bottom — same as before. */}
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
      )}
    </>
  );
}
