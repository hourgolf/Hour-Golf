import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import useMemberAuth from "../../hooks/useMemberAuth";
import { TIER_COLORS } from "../../lib/constants";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/members/dashboard" },
  { key: "book", label: "Book a Bay", href: "/members/book" },
  { key: "billing", label: "Billing", href: "/members/billing" },
  { key: "account", label: "Account", href: "/members/account" },
];

export default function MemberLayout({ activeTab, children }) {
  const router = useRouter();
  const { member, tierConfig, loading, error, login, signup, completeAccount, logout, refresh } = useMemberAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"

  // Login fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Signup fields
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupBirthday, setSignupBirthday] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupTerms, setSignupTerms] = useState(false);

  // Complete account fields (legacy)
  const [completePassword, setCompletePassword] = useState("");
  const [completeConfirm, setCompleteConfirm] = useState("");
  const [completeTerms, setCompleteTerms] = useState(false);

  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Login handler
  async function handleLogin() {
    if (!email.trim()) return;
    setFormLoading(true);
    setFormError("");
    const ok = await login(email.trim(), password);
    if (!ok) {
      setFormError(error || "Login failed");
    }
    setFormLoading(false);
  }

  // Signup handler
  async function handleSignup() {
    setFormError("");

    if (!signupName.trim() || !signupEmail.trim() || !signupPhone.trim() || !signupBirthday || !signupPassword) {
      setFormError("All fields are required");
      return;
    }
    if (signupPassword.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }
    if (signupPassword !== signupConfirm) {
      setFormError("Passwords do not match");
      return;
    }
    if (!signupTerms) {
      setFormError("You must agree to the Terms & Conditions and Club Policies");
      return;
    }

    // Age check
    const birth = new Date(signupBirthday);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const md = today.getMonth() - birth.getMonth();
    if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
    if (age < 18) {
      setFormError("You must be at least 18 years old to create an account");
      return;
    }

    setFormLoading(true);
    const ok = await signup({
      email: signupEmail.trim(),
      password: signupPassword,
      name: signupName.trim(),
      phone: signupPhone.trim(),
      birthday: signupBirthday,
    });
    if (!ok) {
      setFormError(error || "Signup failed");
    }
    setFormLoading(false);
  }

  // Complete account handler (legacy members)
  async function handleComplete() {
    setFormError("");

    if (completePassword.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }
    if (completePassword !== completeConfirm) {
      setFormError("Passwords do not match");
      return;
    }
    if (!completeTerms) {
      setFormError("You must agree to the Terms & Conditions and Club Policies");
      return;
    }

    setFormLoading(true);
    const ok = await completeAccount(completePassword);
    if (!ok) {
      setFormError(error || "Failed to complete account setup");
    }
    setFormLoading(false);
  }

  // Still checking session
  if (loading) {
    return (
      <div className="mem-layout">
        <div className="mem-loading">Loading...</div>
      </div>
    );
  }

  // Not logged in — show login or signup form
  if (!member) {
    return (
      <div className="mem-layout">
        <div className="mem-login">
          <div className="mem-brand">HOUR GOLF</div>
          <div className="mem-brand-sub">Member Portal</div>

          {mode === "login" ? (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                placeholder="Email address"
                className="mem-input"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                placeholder="Password"
                className="mem-input"
              />
              {formError && <p className="mem-err">{formError}</p>}
              <button
                className="mem-btn mem-btn-primary mem-btn-full"
                onClick={handleLogin}
                disabled={!email.trim() || formLoading}
              >
                {formLoading ? "Signing in..." : "Sign In"}
              </button>
              <p style={{ marginTop: 20, fontSize: 13, color: "#888" }}>
                Don&rsquo;t have an account?{" "}
                <button
                  onClick={() => { setMode("signup"); setFormError(""); }}
                  style={{ background: "none", border: "none", color: "#006044", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline" }}
                >
                  Sign up
                </button>
              </p>
            </>
          ) : (
            <>
              <input
                type="text"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                placeholder="Full Name"
                className="mem-input"
              />
              <input
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="Email address"
                className="mem-input"
              />
              <input
                type="tel"
                value={signupPhone}
                onChange={(e) => setSignupPhone(e.target.value)}
                placeholder="Phone number"
                className="mem-input"
              />
              <div style={{ textAlign: "left", marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#888", display: "block", marginBottom: 5 }}>
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={signupBirthday}
                  onChange={(e) => setSignupBirthday(e.target.value)}
                  className="mem-input"
                  style={{ marginBottom: 0 }}
                />
              </div>
              <input
                type="password"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
                className="mem-input"
              />
              <input
                type="password"
                value={signupConfirm}
                onChange={(e) => setSignupConfirm(e.target.value)}
                placeholder="Confirm password"
                className="mem-input"
              />
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#555", marginBottom: 16, textAlign: "left", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={signupTerms}
                  onChange={(e) => setSignupTerms(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#4C8D73" }}
                />
                <span>
                  I agree to the <strong>Terms &amp; Conditions</strong> and <strong>Club Policies</strong>
                </span>
              </label>
              {formError && <p className="mem-err">{formError}</p>}
              <button
                className="mem-btn mem-btn-primary mem-btn-full"
                onClick={handleSignup}
                disabled={formLoading || !signupName.trim() || !signupEmail.trim() || !signupPhone.trim() || !signupBirthday || !signupPassword || signupPassword !== signupConfirm || !signupTerms}

              >
                {formLoading ? "Creating account..." : "Create Account"}
              </button>
              <p style={{ marginTop: 20, fontSize: 13, color: "#888" }}>
                Already have an account?{" "}
                <button
                  onClick={() => { setMode("login"); setFormError(""); }}
                  style={{ background: "none", border: "none", color: "#006044", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline" }}
                >
                  Sign in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Logged in but needs account setup (legacy member)
  if (member.needsAccountSetup) {
    return (
      <div className="mem-layout">
        <div className="mem-login">
          <div className="mem-brand">HOUR GOLF</div>
          <div className="mem-brand-sub">Complete Your Account</div>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 24, lineHeight: 1.5 }}>
            Welcome back, <strong>{member.name || member.email}</strong>! Please set a password and agree to our policies to continue.
          </p>
          <input
            type="password"
            value={completePassword}
            onChange={(e) => setCompletePassword(e.target.value)}
            placeholder="Create a password (min 8 characters)"
            className="mem-input"
          />
          <input
            type="password"
            value={completeConfirm}
            onChange={(e) => setCompleteConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleComplete(); }}
            placeholder="Confirm password"
            className="mem-input"
          />
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#555", marginBottom: 16, textAlign: "left", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={completeTerms}
              onChange={(e) => setCompleteTerms(e.target.checked)}
              style={{ marginTop: 2, accentColor: "#4C8D73" }}
            />
            <span>
              I agree to the <strong>Terms &amp; Conditions</strong> and <strong>Club Policies</strong>
            </span>
          </label>
          {formError && <p className="mem-err">{formError}</p>}
          <button
            className="mem-btn mem-btn-primary mem-btn-full"
            onClick={handleComplete}
            disabled={formLoading}
          >
            {formLoading ? "Saving..." : "Complete Setup"}
          </button>
          <button
            onClick={() => { logout(); router.push("/members"); }}
            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontFamily: "inherit", fontSize: 12, marginTop: 16 }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Logged in — render layout with content
  const tierObj = TIER_COLORS[member.tier] || { bg: "#D1DFCB", text: "#35443B" };

  return (
    <div className="mem-layout">
      {/* Header */}
      <header className="mem-header">
        <div className="mem-header-inner">
          <div className="mem-brand" style={{ fontSize: 16 }}>HOUR GOLF</div>
          <div className="mem-header-right">
            <span className="mem-header-name">{member.name}</span>
            <span className="mem-tier-badge" style={{ background: tierObj.bg, color: tierObj.text }}>{member.tier}</span>
            <button className="mem-btn-sm" onClick={() => { logout(); router.push("/members"); }}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="mem-nav">
        <div className="mem-nav-inner">
          {NAV_ITEMS.map(({ key, label, href }) => (
            <button
              key={key}
              className={`mem-nav-btn ${activeTab === key ? "active" : ""}`}
              onClick={() => router.push(href)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="mem-content">
        {typeof children === "function"
          ? children({ member, tierConfig, refresh, showToast })
          : children}
      </main>

      {/* Toast */}
      {toast && <div className={`mem-toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
