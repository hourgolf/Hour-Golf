import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";

export default function PlatformHome() {
  const router = useRouter();
  const { apiKey, connected, authLoading, user, logout } = usePlatformAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Redirect to login if not an authorized platform admin
  useEffect(() => {
    if (!authLoading && !connected) router.replace("/platform/login");
  }, [connected, authLoading, router]);

  // Load tenant list once we have a session
  useEffect(() => {
    if (!connected || !apiKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/platform-tenants", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || d.error || "Failed to load tenants");
        if (!cancelled) setTenants(d.tenants || []);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [connected, apiKey]);

  if (authLoading || !connected) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Ourlee Platform — Tenants</title>
      </Head>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--primary)", letterSpacing: 1 }}>
              OURLEE
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: 2 }}>
              PLATFORM DASHBOARD
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {user?.email}
            <button
              onClick={logout}
              style={{ marginLeft: 12, fontSize: 11, padding: "4px 10px" }}
            >
              Sign out
            </button>
          </div>
        </div>

        <h2 className="section-head" style={{ marginTop: 32 }}>
          Tenants {tenants.length > 0 && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>({tenants.length})</span>}
        </h2>

        {err && <p className="err">{err}</p>}
        {loading && <p style={{ color: "var(--text-muted)" }}>Loading tenants…</p>}

        {!loading && tenants.length > 0 && (
          <div className="tbl">
            <div className="th">
              <span style={{ flex: 2 }}>Tenant</span>
              <span style={{ flex: 1 }}>Status</span>
              <span style={{ flex: 1 }} className="text-r">Members</span>
              <span style={{ flex: 1 }} className="text-r">Admins</span>
              <span style={{ flex: 1 }} className="text-r">Features</span>
              <span style={{ flex: 1 }} className="text-r">Stripe</span>
            </div>
            {tenants.map((t) => (
              <div key={t.id} className="tr">
                <span style={{ flex: 2 }}>
                  <strong>{t.name}</strong>
                  <br />
                  <span className="email-sm">{t.slug}.ourlee.co</span>
                </span>
                <span style={{ flex: 1 }}>
                  <span
                    className="badge"
                    style={{
                      background: t.status === "active" ? "#4C8D73" : "#9aa29b",
                      color: "#EDF3E3",
                      fontSize: 9,
                    }}
                  >
                    {String(t.status || "").toUpperCase()}
                  </span>
                </span>
                <span style={{ flex: 1 }} className="text-r tab-num">{t.member_count}</span>
                <span style={{ flex: 1 }} className="text-r tab-num">{t.admin_count}</span>
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {t.feature_summary.enabled}/{t.feature_summary.total}
                </span>
                <span style={{ flex: 1 }} className="text-r">
                  {stripeLabel(t.stripe)}
                </span>
              </div>
            ))}
          </div>
        )}

        {!loading && tenants.length === 0 && !err && (
          <p style={{ color: "var(--text-muted)" }}>No tenants yet.</p>
        )}

        <p style={{ marginTop: 32, fontSize: 11, color: "var(--text-muted)" }}>
          Read-only for now. Tenant detail, create, and edit land in S2.
        </p>
      </div>
    </>
  );
}

function stripeLabel(s) {
  if (!s) return <span className="muted">—</span>;
  if (!s.enabled) {
    return (
      <span className="badge" style={{ background: "#9aa29b", color: "#EDF3E3", fontSize: 9 }}>
        DISABLED
      </span>
    );
  }
  const hasWhs = s.has_webhook_secret;
  const modeColor = s.mode === "live" ? "#4C8D73" : "#C77B3C";
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
      <span className="badge" style={{ background: modeColor, color: "#EDF3E3", fontSize: 9 }}>
        {String(s.mode || "").toUpperCase()}
      </span>
      {!hasWhs && (
        <span className="badge" title="No webhook_secret set" style={{ background: "var(--red)", color: "#EDF3E3", fontSize: 9 }}>
          NO WHS
        </span>
      )}
    </span>
  );
}
