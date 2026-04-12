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
  const { member, tierConfig, loading, error, login, logout, refresh } = useMemberAuth();
  const [email, setEmail] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleLogin() {
    if (!email.trim()) return;
    setLoginLoading(true);
    setLoginError("");
    const ok = await login(email.trim());
    if (!ok) {
      setLoginError(error || "Login failed");
    }
    setLoginLoading(false);
  }

  // Still checking session
  if (loading) {
    return (
      <div className="mem-layout">
        <div className="mem-loading">Loading...</div>
      </div>
    );
  }

  // Not logged in — show login screen
  if (!member) {
    return (
      <div className="mem-layout">
        <div className="mem-login">
          <div className="mem-brand">HOUR GOLF</div>
          <div className="mem-brand-sub">Member Portal</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
            placeholder="Enter your email"
            className="mem-input"
          />
          {(loginError || error) && <p className="mem-err">{loginError || error}</p>}
          <button
            className="mem-btn mem-btn-primary mem-btn-full"
            onClick={handleLogin}
            disabled={!email.trim() || loginLoading}
          >
            {loginLoading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </div>
    );
  }

  // Logged in — render layout with content
  const tierColor = TIER_COLORS[member.tier] || "var(--primary)";

  return (
    <div className="mem-layout">
      {/* Header */}
      <header className="mem-header">
        <div className="mem-header-inner">
          <div className="mem-brand" style={{ fontSize: 16 }}>HOUR GOLF</div>
          <div className="mem-header-right">
            <span className="mem-header-name">{member.name}</span>
            <span className="mem-tier-badge" style={{ background: tierColor }}>{member.tier}</span>
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
