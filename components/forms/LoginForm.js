import { useState } from "react";

export default function LoginForm({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit() {
    if (!email || !password || loading) return;
    onLogin(email, password);
  }

  return (
    <div className="setup">
      <div className="logo" style={{ fontSize: 28, color: "var(--primary)" }}>HOUR GOLF</div>
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
