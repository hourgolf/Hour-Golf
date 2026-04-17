import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { usePlatformAuth } from "../../../hooks/usePlatformAuth";
import TenantBranding from "../../../components/settings/TenantBranding";

const TABS = ["Overview", "Branding", "Stripe", "Features"];

const FEATURE_KEYS = [
  { key: "bookings", label: "Bookings", hint: "Bay reservations, Skedda sync, access code emails" },
  { key: "pro_shop", label: "Pro Shop", hint: "Shop items, cart, checkout, credits" },
  { key: "loyalty", label: "Loyalty", hint: "Monthly loyalty rules + rewards" },
  { key: "events", label: "Events", hint: "Event pages, RSVPs, paid event tickets" },
  { key: "punch_passes", label: "Punch Passes", hint: "Discounted bulk-hour packages" },
  { key: "subscriptions", label: "Subscriptions", hint: "Tier-based Stripe subscriptions" },
  { key: "stripe_enabled", label: "Stripe Enabled", hint: "Master switch for any Stripe-backed flow" },
  { key: "email_notifications", label: "Email Notifications", hint: "Transactional emails via Resend" },
];

export default function PlatformTenantDetail() {
  const router = useRouter();
  const { slug } = router.query;
  const { apiKey, connected, authLoading } = usePlatformAuth();
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!authLoading && !connected) router.replace("/platform/login");
  }, [connected, authLoading, router]);

  const reload = useCallback(async () => {
    if (!slug || !apiKey) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/platform-tenant?slug=${encodeURIComponent(slug)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Failed to load tenant");
      setDetail(d);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [slug, apiKey]);

  useEffect(() => { reload(); }, [reload]);

  if (authLoading || !connected) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  }

  return (
    <>
      <Head>
        <title>{detail?.tenant?.name || slug} — Ourlee Platform</title>
      </Head>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
        <Link href="/platform" style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 1 }}>
          ← All tenants
        </Link>

        {loading && <p style={{ color: "var(--text-muted)" }}>Loading tenant…</p>}
        {err && <p className="err">{err}</p>}

        {detail && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 16 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{detail.tenant.name}</h1>
              <span
                className="badge"
                style={{
                  background: detail.tenant.status === "active" ? "#4C8D73" : "#9aa29b",
                  color: "#EDF3E3",
                  fontSize: 9,
                }}
              >
                {String(detail.tenant.status || "").toUpperCase()}
              </span>
              <a
                href={`https://${detail.tenant.slug}.ourlee.co`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: "var(--text-muted)" }}
              >
                {detail.tenant.slug}.ourlee.co ↗
              </a>
            </div>

            <div style={{ display: "flex", gap: 4, marginTop: 24, borderBottom: "1px solid var(--border, #ddd)" }}>
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "8px 16px",
                    border: 0,
                    background: tab === t ? "var(--surface, #fff)" : "transparent",
                    borderBottom: tab === t ? "2px solid var(--primary)" : "2px solid transparent",
                    fontSize: 13,
                    fontWeight: tab === t ? 600 : 400,
                    color: tab === t ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{ padding: "24px 0" }}>
              {tab === "Overview" && <OverviewTab detail={detail} />}
              {tab === "Branding" && <BrandingTab detail={detail} apiKey={apiKey} />}
              {tab === "Stripe" && <StripeTab detail={detail} apiKey={apiKey} onSaved={reload} />}
              {tab === "Features" && <FeaturesTab detail={detail} apiKey={apiKey} onSaved={reload} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function OverviewTab({ detail }) {
  const { tenant, stats, stripe, features, admins } = detail;
  const enabledFeatures = (features || []).filter((f) => f.enabled).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="summary">
        <div className="sum-item">
          <span className="sum-val">{stats.member_count}</span>
          <span className="sum-lbl">Members</span>
        </div>
        <div className="sum-item">
          <span className="sum-val">{stats.admin_count}</span>
          <span className="sum-lbl">Admins</span>
        </div>
        <div className="sum-item">
          <span className="sum-val">{enabledFeatures}/{features.length}</span>
          <span className="sum-lbl">Features On</span>
        </div>
        <div className="sum-item">
          <span className={`sum-val ${stripe?.enabled ? "green" : ""}`} style={{ fontSize: 18 }}>
            {stripe ? (stripe.enabled ? stripe.mode?.toUpperCase() : "DISABLED") : "NONE"}
          </span>
          <span className="sum-lbl">Stripe</span>
        </div>
      </div>

      <div>
        <h3 className="section-head">Tenant Admins</h3>
        {admins.length === 0 && <p className="muted">None</p>}
        {admins.length > 0 && (
          <ul style={{ fontSize: 13, lineHeight: 1.8 }}>
            {admins.map((a) => (
              <li key={a.user_id}>{a.email}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="section-head">Tier Breakdown</h3>
        {Object.entries(stats.tier_breakdown || {}).length === 0 && <p className="muted">No members yet</p>}
        {Object.entries(stats.tier_breakdown || {}).map(([tier, count]) => (
          <div key={tier} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", maxWidth: 280 }}>
            <span>{tier}</span>
            <span className="tab-num">{count}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Created {new Date(tenant.created_at).toLocaleString()}
      </div>
    </div>
  );
}

function BrandingTab({ detail, apiKey }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "#f6f7f4", padding: 14, borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Editing <strong>{detail.tenant.name}</strong>&rsquo;s branding. Uploads land in that tenant&rsquo;s
        folder; saves flush the branding cache so changes show up on
        <code> {detail.tenant.slug}.ourlee.co</code> within the next request.
      </div>
      <TenantBranding apiKey={apiKey} tenantIdOverride={detail.tenant.id} />
    </div>
  );
}

function StripeTab({ detail, apiKey, onSaved }) {
  const s = detail.stripe;
  const tenantId = detail.tenant.id;
  const [mode, setMode] = useState(s?.mode || "test");
  const [enabled, setEnabled] = useState(s?.enabled ?? false);
  const [sk, setSk] = useState("");
  const [pk, setPk] = useState("");
  const [whs, setWhs] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  async function save() {
    setSaving(true);
    setErr("");
    setStatus("");
    const payload = { tenant_id: tenantId, mode, enabled };
    if (sk.trim()) payload.secret_key = sk.trim();
    if (pk.trim() !== "") payload.publishable_key = pk.trim();
    if (whs.trim() !== "") payload.webhook_secret = whs.trim();
    try {
      const r = await fetch("/api/platform-tenant-stripe", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setStatus("Saved. Cache invalidated — next API request picks up new values.");
      setSk(""); setPk(""); setWhs("");
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
      <div style={{ background: "#f6f7f4", padding: 14, borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Secrets are write-only. Existing values are masked (last 4 chars shown). Leave a field
        blank to keep it unchanged. Clear publishable / webhook by submitting <code>null</code>
        via the API — this UI can only set values.
      </div>

      <div className="mf">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="test">Test</option>
          <option value="live">Live</option>
        </select>
      </div>

      <div className="mf">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled (kill-switch — off means getStripeClient throws)</span>
        </label>
      </div>

      <KeyRow label="Secret key" existing={s?.secret_key} placeholder="sk_live_... or sk_test_..." value={sk} onChange={setSk} />
      <KeyRow label="Publishable key" existing={s?.publishable_key} placeholder="pk_live_... or pk_test_... (optional)" value={pk} onChange={setPk} />
      <KeyRow label="Webhook signing secret" existing={s?.webhook_secret} placeholder="whsec_..." value={whs} onChange={setWhs} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn primary" onClick={save} disabled={saving} style={{ padding: "10px 24px", fontSize: 13 }}>
          {saving ? "Saving…" : "Save Stripe config."}
        </button>
        {status && <span style={{ color: "var(--primary)", fontSize: 12 }}>{status}</span>}
        {err && <span style={{ color: "var(--red)", fontSize: 12 }}>{err}</span>}
      </div>

      {s && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Last updated {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}
        </div>
      )}
    </div>
  );
}

function KeyRow({ label, existing, placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mf">
      <label>{label}</label>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        {existing
          ? <>Current: <code>{existing.prefix}</code>…<code>{existing.last4}</code> ({existing.length} chars)</>
          : <>Not configured</>
        }
      </div>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
      />
      <label style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <span>Show value while typing</span>
      </label>
    </div>
  );
}

function FeaturesTab({ detail, apiKey, onSaved }) {
  const tenantId = detail.tenant.id;
  const current = {};
  (detail.features || []).forEach((f) => { current[f.feature_key] = !!f.enabled; });

  const [pending, setPending] = useState({}); // feature_key -> "saving" | "saved" | "err"
  const [err, setErr] = useState("");

  async function toggle(key, nextEnabled) {
    setPending((p) => ({ ...p, [key]: "saving" }));
    setErr("");
    try {
      const r = await fetch("/api/platform-tenant-features", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, feature_key: key, enabled: nextEnabled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Toggle failed");
      setPending((p) => ({ ...p, [key]: "saved" }));
      onSaved?.();
    } catch (e) {
      setErr(`${key}: ${e.message}`);
      setPending((p) => ({ ...p, [key]: "err" }));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div style={{ background: "#f6f7f4", padding: 14, borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Nothing in the app reads tenant_features yet — Phase 4 wires these toggles to
        <code> assertFeature</code> guards and the <code>useTenantFeatures</code> hook.
        Toggling here writes DB rows so the data is ready when Phase 4 lands.
      </div>

      <div className="tbl">
        <div className="th">
          <span style={{ flex: 2 }}>Feature</span>
          <span style={{ flex: 3 }}>Description</span>
          <span style={{ flex: 1 }} className="text-r">Enabled</span>
        </div>
        {FEATURE_KEYS.map(({ key, label, hint }) => {
          const isOn = !!current[key];
          const state = pending[key];
          return (
            <div key={key} className="tr">
              <span style={{ flex: 2 }}><strong>{label}</strong><br /><code style={{ fontSize: 10, color: "var(--text-muted)" }}>{key}</code></span>
              <span style={{ flex: 3, fontSize: 12, color: "var(--text-muted)" }}>{hint}</span>
              <span style={{ flex: 1 }} className="text-r">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={state === "saving"}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                  {state === "saving" && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>…</span>}
                  {state === "saved" && <span style={{ fontSize: 10, color: "var(--primary)" }}>✓</span>}
                  {state === "err" && <span style={{ fontSize: 10, color: "var(--red)" }}>err</span>}
                </label>
              </span>
            </div>
          );
        })}
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
