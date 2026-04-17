import { useState } from "react";
import { useBranding } from "../../hooks/useBranding";

export default function LoginForm({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const branding = useBranding();

  function submit() {
    if (!email || !password || loading) return;
    onLogin(email, password);
  }

  const appName = branding?.app_name || "";
  const welcomeLogoUrl = branding?.welcome_logo_url || branding?.logo_url;
  const showLogo = branding?.show_welcome_logo !== false && !!welcomeLogoUrl;
  const showTitle = branding?.show_welcome_title !== false && !!appName;
  return (
    <div className="setup">
      {showLogo && (
        <img
          src={welcomeLogoUrl}
          alt={appName}
          style={{ maxWidth: 260, maxHeight: 80, marginBottom: showTitle ? 6 : 12 }}
        />
      )}
      {showTitle && (
        <div
          className={showLogo ? "" : "logo"}
          style={{
            fontSize: showLogo ? 18 : 28,
            color: "var(--primary)",
            fontFamily: "var(--font-display)",
            textTransform: showLogo ? "none" : "uppercase",
            letterSpacing: 1,
            marginBottom: showLogo ? 4 : 0,
          }}
        >
          {appName}
        </div>
      )}
      <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: 2, marginBottom: 32 }}>
        ADMIN DASHBOARD
      </div>
      <input
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      {error && <p className="err">{error}</p>}
      <button onClick={submit} disabled={!email || !password || loading}>
        {loading ? "..." : "Sign In."}
      </button>
    </div>
  );
}
