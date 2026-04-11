import { useState } from "react";

export default function LoginForm({ onConnect, loading, error }) {
  const [keyIn, setKeyIn] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("hg-key") || "";
    return "";
  });

  return (
    <div className="setup">
      <div className="logo" style={{ fontSize: 28, color: "var(--primary)" }}>HOUR GOLF</div>
      <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: 2, marginBottom: 32 }}>
        ADMIN DASHBOARD
      </div>
      <input
        type="password"
        value={keyIn}
        onChange={(e) => setKeyIn(e.target.value)}
        placeholder="Supabase API Key"
        onKeyDown={(e) => { if (e.key === "Enter" && keyIn) onConnect(keyIn); }}
      />
      {error && <p className="err">{error}</p>}
      <button onClick={() => onConnect(keyIn)} disabled={!keyIn || loading}>
        {loading ? "..." : "Connect"}
      </button>
    </div>
  );
}
