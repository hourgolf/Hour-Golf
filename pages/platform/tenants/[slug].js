import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import { usePlatformAuth } from "../../../hooks/usePlatformAuth";
import TenantBranding from "../../../components/settings/TenantBranding";

const TABS = ["Overview", "Branding", "Stripe", "Seam", "Features"];

const FEATURE_KEYS = [
  { key: "bookings", label: "Bookings", hint: "Bay reservations, Skedda sync" },
  { key: "pro_shop", label: "Pro Shop", hint: "Shop items, cart, checkout, credits" },
  { key: "loyalty", label: "Loyalty", hint: "Monthly loyalty rules + rewards" },
  { key: "events", label: "Events", hint: "Event pages, RSVPs, paid event tickets" },
  { key: "punch_passes", label: "Punch Passes", hint: "Discounted bulk-hour packages" },
  { key: "subscriptions", label: "Subscriptions", hint: "Tier-based Stripe subscriptions" },
  { key: "stripe_enabled", label: "Stripe Enabled", hint: "Master switch for any Stripe-backed flow" },
  { key: "email_notifications", label: "Email Notifications", hint: "Transactional emails via Resend" },
  { key: "access_codes", label: "Access Codes", hint: "Smart-lock door codes, access troubleshooting, code-delivery email copy" },
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
              {tab === "Overview" && <OverviewTab detail={detail} apiKey={apiKey} onSaved={reload} />}
              {tab === "Branding" && <BrandingTab detail={detail} apiKey={apiKey} />}
              {tab === "Stripe" && <StripeTab detail={detail} apiKey={apiKey} onSaved={reload} />}
              {tab === "Seam" && <SeamTab detail={detail} apiKey={apiKey} />}
              {tab === "Features" && <FeaturesTab detail={detail} apiKey={apiKey} onSaved={reload} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function OverviewTab({ detail, apiKey, onSaved }) {
  const router = useRouter();
  const { tenant, stats, stripe, features, admins } = detail;
  const enabledFeatures = (features || []).filter((f) => f.enabled).length;
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [deleteBlockedCounts, setDeleteBlockedCounts] = useState(null);

  async function toggleStatus() {
    const next = tenant.status === "active" ? "suspended" : "active";
    const msg =
      next === "suspended"
        ? `Suspend ${tenant.name}? Subdomain will 404 for users but all data is preserved. You can reactivate at any time.`
        : `Reactivate ${tenant.name}? Subdomain becomes accessible again.`;
    if (!window.confirm(msg)) return;
    setStatusSaving(true);
    setStatusErr("");
    try {
      const r = await fetch("/api/platform-tenant-status", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id, status: next }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Status change failed");
      onSaved?.();
    } catch (e) {
      setStatusErr(e.message);
    }
    setStatusSaving(false);
  }

  async function deleteTenant() {
    const confirmText = `DELETE ${tenant.slug}`;
    const typed = window.prompt(
      `Permanently delete ${tenant.name}? This CANNOT be undone.\n\nBranding, features, and Stripe config will cascade. Delete fails if any member / booking / payment / shop / event / loyalty row exists for this tenant.\n\nType "${confirmText}" to confirm:`
    );
    if (typed !== confirmText) return;

    setDeleting(true);
    setDeleteErr("");
    setDeleteBlockedCounts(null);
    try {
      const r = await fetch(
        `/api/platform-tenant-delete?tenant_id=${encodeURIComponent(tenant.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const d = await r.json();
      if (!r.ok) {
        if (d.counts) setDeleteBlockedCounts(d.counts);
        throw new Error(d.detail || d.error || "Delete failed");
      }
      // Success — bounce back to the tenant list.
      router.replace("/platform");
    } catch (e) {
      setDeleteErr(e.message);
      setDeleting(false);
    }
  }

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

      <div>
        <h3 className="section-head">Status</h3>
        <p className="muted" style={{ fontSize: 12, marginBottom: 10, maxWidth: 520 }}>
          Suspended tenants return 404 on their subdomain when MULTI_TENANT_STRICT=true.
          All data (bookings, members, orders, payments) is preserved.
        </p>
        <button
          onClick={toggleStatus}
          disabled={statusSaving}
          style={{
            padding: "8px 16px",
            fontSize: 12,
            background: tenant.status === "active" ? "var(--red)" : "var(--primary)",
            color: "#EDF3E3",
            border: 0,
            borderRadius: 999,
            cursor: statusSaving ? "wait" : "pointer",
          }}
        >
          {statusSaving
            ? "Saving…"
            : tenant.status === "active"
            ? "Suspend tenant"
            : "Reactivate tenant"}
        </button>
        {statusErr && <p className="err" style={{ marginTop: 8 }}>{statusErr}</p>}
      </div>

      {tenant.status === "suspended" && (
        <div>
          <h3 className="section-head" style={{ color: "var(--red)" }}>Danger zone</h3>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10, maxWidth: 520 }}>
            Hard-delete is only allowed on suspended tenants with zero data rows.
            Branding, features, and Stripe config cascade. Bookings, members,
            payments, shop orders, events, loyalty — any of these blocking will
            abort the delete and show you which table(s) still hold rows.
          </p>
          <button
            onClick={deleteTenant}
            disabled={deleting}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              background: "transparent",
              color: "var(--red)",
              border: "1.5px solid var(--red)",
              borderRadius: 999,
              cursor: deleting ? "wait" : "pointer",
            }}
          >
            {deleting ? "Deleting…" : "Delete tenant permanently"}
          </button>
          {deleteErr && <p className="err" style={{ marginTop: 8 }}>{deleteErr}</p>}
          {deleteBlockedCounts && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
              <div style={{ marginBottom: 4, fontWeight: 600 }}>Blocking rows:</div>
              {Object.entries(deleteBlockedCounts)
                .filter(([, v]) => typeof v === "number" && v > 0)
                .map(([tbl, n]) => (
                  <div key={tbl}>
                    <code>{tbl}</code>: {n}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

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

function SeamTab({ detail, apiKey }) {
  const tenantId = detail.tenant.id;
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [apiInput, setApiInput] = useState("");
  const [deviceInput, setDeviceInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/platform-tenant-seam?tenant_id=${encodeURIComponent(tenantId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = r.ok ? await r.json() : null;
        if (!cancelled) {
          setCfg(d);
          setEnabled(d?.enabled ?? false);
          setDeviceInput(d?.device_id || "");
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, apiKey]);

  async function save() {
    setSaving(true);
    setErr("");
    setStatus("");
    const payload = { tenant_id: tenantId, enabled };
    if (apiInput.trim()) payload.api_key = apiInput.trim();
    if (deviceInput.trim() && deviceInput.trim() !== (cfg?.device_id || "")) {
      payload.device_id = deviceInput.trim();
    }
    try {
      const r = await fetch("/api/platform-tenant-seam", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setCfg(d);
      setApiInput("");
      setStatus("Saved. Cache invalidated — next access-code job picks up new values.");
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  if (loading) return <p className="muted">Loading Seam config…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
      <div style={{ background: "#f6f7f4", padding: 14, borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Seam (smart-lock) credentials used by the <code>process-access-codes</code>
        edge function to generate per-booking door codes. Only relevant when the
        Access Codes feature is enabled. Secrets are write-only — existing values
        are masked (prefix + last 4). Leave the api_key field blank to keep the
        current key.
      </div>

      <div className="mf">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled (kill-switch — off pauses code generation without deleting keys)</span>
        </label>
      </div>

      <KeyRow
        label="Seam API key"
        existing={cfg?.api_key}
        placeholder="seam_..."
        value={apiInput}
        onChange={setApiInput}
      />

      <div className="mf">
        <label>Seam Device ID</label>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
          {cfg?.device_id
            ? <>Current: <code>{cfg.device_id}</code></>
            : <>Not configured</>
          }
        </div>
        <input
          type="text"
          value={deviceInput}
          onChange={(e) => setDeviceInput(e.target.value)}
          placeholder="uuid of the physical smart lock in Seam"
          style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className="btn primary"
          onClick={save}
          disabled={saving || (!cfg && (!apiInput.trim() || !deviceInput.trim()))}
          style={{ padding: "10px 24px", fontSize: 13 }}
        >
          {saving ? "Saving…" : "Save Seam config."}
        </button>
        {status && <span style={{ color: "var(--primary)", fontSize: 12 }}>{status}</span>}
        {err && <span style={{ color: "var(--red)", fontSize: 12 }}>{err}</span>}
      </div>

      {cfg && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Last updated {cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : "—"}
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
