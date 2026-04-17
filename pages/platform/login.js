import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";

export default function PlatformLogin() {
  const router = useRouter();
  const { connected, authLoading, loading, error, login } = usePlatformAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
        <title>Ourlee Platform</title>
      </Head>
      <div className="setup">
        <div className="logo" style={{ fontSize: 28, color: "var(--primary)" }}>OURLEE</div>
        <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: 2, marginBottom: 32 }}>
          PLATFORM DASHBOARD
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
    </>
  );
}
