import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";

export default function PlatformLogin() {
  const router = useRouter();
  const { connected, authLoading, loading, error, login } = usePlatformAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Same scope-flip as PlatformShell — login lives outside the shell
  // but still needs platform styling (not the current subdomain tenant's).
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-surface");
    document.documentElement.setAttribute("data-surface", "platform");
    return () => {
      if (prev === null) document.documentElement.removeAttribute("data-surface");
      else document.documentElement.setAttribute("data-surface", prev);
    };
  }, []);

  useEffect(() => {
    if (!authLoading && connected) router.replace("/platform");
  }, [connected, authLoading, router]);

  function submit() {
    if (!email || !password || loading) return;
    login(email, password);
  }

  return (
    <>
      <Head>
        <title>Sign in — Ourlee Platform</title>
      </Head>
      <div className="p-auth">
        <div className="p-auth-card">
          <div className="p-auth-brand">
            <div className="p-auth-brand-logo">O</div>
            <div>
              <div className="p-auth-title">Ourlee Platform</div>
              <div className="p-auth-subtitle">Super-admin console</div>
            </div>
          </div>

          <div className="p-stack">
            <div className="p-field">
              <label className="p-field-label" htmlFor="email">Email</label>
              <input
                id="email"
                className="p-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </div>
            <div className="p-field">
              <label className="p-field-label" htmlFor="password">Password</label>
              <input
                id="password"
                className="p-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </div>
            {error && <div className="p-msg p-msg--error">{error}</div>}
            <button
              className="p-btn p-btn--primary"
              onClick={submit}
              disabled={!email || !password || loading}
              style={{ width: "100%", padding: "9px 14px" }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <div className="p-subtle" style={{ fontSize: 11, marginTop: 20, textAlign: "center" }}>
            Restricted — platform admins only.
          </div>
        </div>
      </div>
    </>
  );
}
