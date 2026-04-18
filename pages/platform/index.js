import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";
import PlatformShell, { PlusIcon } from "../../components/platform/PlatformShell";

export default function PlatformHome() {
  const router = useRouter();
  const { apiKey, connected } = usePlatformAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

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

  return (
    <PlatformShell
      activeNav="tenants"
      breadcrumbs={[{ label: "Tenants" }]}
      title="Tenants"
      subtitle={
        tenants.length > 0
          ? `${tenants.length} total — click a row to manage config and feature flags.`
          : "Create and manage every tenant on the platform."
      }
      actions={
        <Link href="/platform/tenants/new" className="p-btn p-btn--primary">
          <PlusIcon />
          <span>New tenant</span>
        </Link>
      }
    >
      {err && <div className="p-msg p-msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="p-card">
        {loading ? (
          <div className="p-card-body" style={{ color: "var(--p-text-muted)", textAlign: "center", padding: 48 }}>
            Loading tenants…
          </div>
        ) : tenants.length === 0 && !err ? (
          <div className="p-card-body" style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 14, color: "var(--p-text-muted)", marginBottom: 12 }}>
              No tenants yet.
            </div>
            <Link href="/platform/tenants/new" className="p-btn p-btn--primary">
              <PlusIcon />
              <span>Create the first tenant</span>
            </Link>
          </div>
        ) : (
          <div className="p-card-body p-card-body--flush">
            <table className="p-table">
              <thead>
                <tr>
                  <th style={{ width: "32%" }}>Tenant</th>
                  <th style={{ width: "12%" }}>Status</th>
                  <th style={{ width: "12%" }} className="p-table-num">Members</th>
                  <th style={{ width: "12%" }} className="p-table-num">Admins</th>
                  <th style={{ width: "14%" }} className="p-table-num">Features</th>
                  <th style={{ width: "18%" }}>Stripe</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr
                    key={t.id}
                    className="is-clickable"
                    onClick={() => router.push(`/platform/tenants/${t.slug}`)}
                  >
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--p-text)" }}>{t.name}</div>
                      <div className="p-mono p-muted" style={{ marginTop: 2 }}>
                        {t.slug}.ourlee.co
                      </div>
                    </td>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td className="p-table-num">{t.member_count}</td>
                    <td className="p-table-num">{t.admin_count}</td>
                    <td className="p-table-num">
                      {t.feature_summary.enabled}
                      <span className="p-subtle"> / {t.feature_summary.total}</span>
                    </td>
                    <td>
                      <StripeCell stripe={t.stripe} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}

function StatusPill({ status }) {
  const s = String(status || "").toLowerCase();
  if (s === "active") {
    return <span className="p-pill p-pill--green"><span className="p-pill-dot" />Active</span>;
  }
  if (s === "suspended") {
    return <span className="p-pill p-pill--amber">Suspended</span>;
  }
  return <span className="p-pill p-pill--gray">{s || "—"}</span>;
}

function StripeCell({ stripe }) {
  if (!stripe) return <span className="p-subtle">—</span>;
  if (!stripe.enabled) {
    return <span className="p-pill p-pill--gray">Disabled</span>;
  }
  const isLive = stripe.mode === "live";
  return (
    <div className="p-row" style={{ gap: 6 }}>
      <span className={`p-pill ${isLive ? "p-pill--green" : "p-pill--amber"}`}>
        {String(stripe.mode || "").toUpperCase()}
      </span>
      {!stripe.has_webhook_secret && (
        <span className="p-pill p-pill--red" title="No webhook_secret set">
          No WHS
        </span>
      )}
    </div>
  );
}
