import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import { usePlatformAuth } from "../../../hooks/usePlatformAuth";
import PlatformShell from "../../../components/platform/PlatformShell";
import TenantBranding from "../../../components/settings/TenantBranding";

const TABS = ["Overview", "Branding", "Stripe", "Seam", "Square", "Shippo", "Features", "Billing"];

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
  const { apiKey, connected } = usePlatformAuth();
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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

  useEffect(() => { if (connected) reload(); }, [reload, connected]);

  const tenantName = detail?.tenant?.name || slug || "Tenant";
  const tenantStatus = detail?.tenant?.status;

  return (
    <PlatformShell
      activeNav="tenants"
      breadcrumbs={[
        { label: "Tenants", href: "/platform" },
        { label: tenantName },
      ]}
      title={tenantName}
      subtitle={
        detail ? (
          <span className="p-row" style={{ gap: 10, fontSize: 13, alignItems: "center" }}>
            <StatusPill status={tenantStatus} />
            <a
              href={`https://${detail.tenant.slug}.ourlee.co`}
              target="_blank"
              rel="noreferrer"
              className="p-mono"
              style={{ color: "var(--p-text-muted)", textDecoration: "none" }}
            >
              {detail.tenant.slug}.ourlee.co <span aria-hidden>↗</span>
            </a>
          </span>
        ) : undefined
      }
    >
      {loading && !detail && (
        <div className="p-muted" style={{ padding: 32 }}>Loading tenant…</div>
      )}
      {err && <div className="p-msg p-msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      {detail && (
        <>
          <div className="p-tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={`p-tab ${tab === t ? "is-active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" && <OverviewTab detail={detail} apiKey={apiKey} onSaved={reload} />}
          {tab === "Branding" && <BrandingTab detail={detail} apiKey={apiKey} />}
          {tab === "Stripe" && <StripeTab detail={detail} apiKey={apiKey} onSaved={reload} />}
          {tab === "Seam" && <SeamTab detail={detail} apiKey={apiKey} />}
          {tab === "Square" && <SquareTab detail={detail} apiKey={apiKey} />}
          {tab === "Shippo" && <ShippoTab detail={detail} apiKey={apiKey} />}
          {tab === "Features" && <FeaturesTab detail={detail} apiKey={apiKey} onSaved={reload} />}
          {tab === "Billing" && <BillingTab detail={detail} apiKey={apiKey} />}
        </>
      )}
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

// ───────────────────────────────────────────────────────────
// Overview
// ───────────────────────────────────────────────────────────

function StatCard({ label, value, tone }) {
  return (
    <div className="p-card" style={{ padding: "14px 16px" }}>
      <div className="p-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          marginTop: 4,
          fontFamily: "var(--p-font-mono)",
          color: tone === "green" ? "var(--p-primary-text)" : tone === "muted" ? "var(--p-text-muted)" : "var(--p-text)",
        }}
      >
        {value}
      </div>
    </div>
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
      router.replace("/platform");
    } catch (e) {
      setDeleteErr(e.message);
      setDeleting(false);
    }
  }

  const stripeValue = stripe
    ? stripe.enabled
      ? String(stripe.mode || "").toUpperCase()
      : "DISABLED"
    : "NONE";

  return (
    <div className="p-stack">
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatCard label="Members" value={stats.member_count} />
        <StatCard label="Admins" value={stats.admin_count} />
        <StatCard label="Features on" value={`${enabledFeatures}/${features.length}`} />
        <StatCard label="Stripe" value={stripeValue} tone={stripe?.enabled ? "green" : "muted"} />
      </div>

      {/* Admins + tier breakdown side-by-side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Tenant admins</div>
              <div className="p-card-subtitle">Users linked to <code className="p-mono">admins</code> for this tenant</div>
            </div>
            <span className="p-pill p-pill--gray">{admins.length}</span>
          </div>
          <div className="p-card-body">
            {admins.length === 0 ? (
              <div className="p-muted">None</div>
            ) : (
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                {admins.map((a) => (
                  <li key={a.user_id} className="p-mono" style={{ color: "var(--p-text)" }}>
                    {a.email}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Tier breakdown</div>
              <div className="p-card-subtitle">Member count per membership tier</div>
            </div>
          </div>
          <div className="p-card-body">
            {Object.keys(stats.tier_breakdown || {}).length === 0 ? (
              <div className="p-muted">No members yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                {Object.entries(stats.tier_breakdown).map(([tier, count]) => (
                  <div key={tier} className="p-row-between">
                    <span>{tier}</span>
                    <span className="p-mono">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status control */}
      <div className="p-card">
        <div className="p-card-header">
          <div>
            <div className="p-card-title">Status</div>
            <div className="p-card-subtitle">
              Suspended tenants return 404 on their subdomain. All data (bookings, members,
              orders, payments) is preserved.
            </div>
          </div>
          <StatusPill status={tenant.status} />
        </div>
        <div className="p-card-body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className={tenant.status === "active" ? "p-btn p-btn--danger" : "p-btn p-btn--primary"}
            onClick={toggleStatus}
            disabled={statusSaving}
          >
            {statusSaving
              ? "Saving…"
              : tenant.status === "active"
              ? "Suspend tenant"
              : "Reactivate tenant"}
          </button>
          {statusErr && <span className="p-msg p-msg--error" style={{ padding: "6px 10px" }}>{statusErr}</span>}
        </div>
      </div>

      {/* Danger zone, only visible when suspended */}
      {tenant.status === "suspended" && (
        <div className="p-card" style={{ borderColor: "#fecaca" }}>
          <div className="p-card-header" style={{ background: "var(--p-danger-soft)" }}>
            <div>
              <div className="p-card-title" style={{ color: "var(--p-danger-text)" }}>Danger zone</div>
              <div className="p-card-subtitle" style={{ color: "var(--p-danger-text)" }}>
                Hard-delete is only allowed on suspended tenants with zero data rows.
                Branding, features, and Stripe config cascade. Bookings, members,
                payments, shop orders, events, loyalty — any of these blocking will
                abort the delete and show which table(s) still hold rows.
              </div>
            </div>
          </div>
          <div className="p-card-body">
            <button
              className="p-btn p-btn--danger-solid"
              onClick={deleteTenant}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete tenant permanently"}
            </button>
            {deleteErr && <div className="p-msg p-msg--error" style={{ marginTop: 12 }}>{deleteErr}</div>}
            {deleteBlockedCounts && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--p-text)" }}>Blocking rows:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {Object.entries(deleteBlockedCounts)
                    .filter(([, v]) => typeof v === "number" && v > 0)
                    .map(([tbl, n]) => (
                      <div key={tbl} className="p-mono" style={{ color: "var(--p-text-muted)" }}>
                        {tbl}: {n}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="p-subtle" style={{ fontSize: 11 }}>
        Created {new Date(tenant.created_at).toLocaleString()}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Branding tab — delegates to the shared editor
// ───────────────────────────────────────────────────────────

function BrandingTab({ detail, apiKey }) {
  return (
    <div className="p-stack">
      <div className="p-msg p-msg--info">
        Editing <strong>{detail.tenant.name}</strong>&rsquo;s branding. Uploads land in that tenant&rsquo;s
        folder; saves flush the branding cache so changes show up on <code className="p-mono">{detail.tenant.slug}.ourlee.co</code> within the next request.
      </div>
      <TenantBranding apiKey={apiKey} tenantIdOverride={detail.tenant.id} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Stripe
// ───────────────────────────────────────────────────────────

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
    <div className="p-card" style={{ maxWidth: 720 }}>
      <div className="p-card-header">
        <div>
          <div className="p-card-title">Stripe configuration</div>
          <div className="p-card-subtitle">
            Secrets are write-only. Existing values are masked (prefix + last 4). Leave a
            field blank to keep its current value.
          </div>
        </div>
        <span className={`p-pill ${s?.enabled ? "p-pill--green" : "p-pill--gray"}`}>
          {s ? (s.enabled ? "Enabled" : "Disabled") : "Not configured"}
        </span>
      </div>
      <div className="p-card-body">
        <div className="p-stack">
          <div className="p-form-grid">
            <div className="p-field">
              <label className="p-field-label" htmlFor="stripe-mode">Mode</label>
              <select
                id="stripe-mode"
                className="p-select"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="p-field">
              <label className="p-field-label">Kill switch</label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                <input
                  className="p-checkbox"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span style={{ fontSize: 13 }}>
                  Enabled
                  <span className="p-subtle" style={{ fontSize: 11, marginLeft: 6 }}>
                    — off means <code className="p-mono">getStripeClient</code> throws
                  </span>
                </span>
              </label>
            </div>
          </div>

          <KeyRow label="Secret key" existing={s?.secret_key} placeholder="sk_live_… or sk_test_…" value={sk} onChange={setSk} />
          <KeyRow label="Publishable key (optional)" existing={s?.publishable_key} placeholder="pk_live_… or pk_test_…" value={pk} onChange={setPk} />
          <KeyRow label="Webhook signing secret" existing={s?.webhook_secret} placeholder="whsec_…" value={whs} onChange={setWhs} />

          {status && <div className="p-msg p-msg--ok">{status}</div>}
          {err && <div className="p-msg p-msg--error">{err}</div>}
        </div>
      </div>
      <div className="p-card-footer">
        {s && (
          <span className="p-subtle" style={{ fontSize: 11, marginRight: "auto", alignSelf: "center" }}>
            Last updated {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}
          </span>
        )}
        <button className="p-btn p-btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Stripe config"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Seam
// ───────────────────────────────────────────────────────────

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

  if (loading) return <div className="p-muted">Loading Seam config…</div>;

  return (
    <div className="p-card" style={{ maxWidth: 720 }}>
      <div className="p-card-header">
        <div>
          <div className="p-card-title">Seam (smart-lock) configuration</div>
          <div className="p-card-subtitle">
            Credentials used by <code className="p-mono">process-access-codes</code> to
            generate per-booking door codes. Only relevant when the Access Codes feature is enabled.
          </div>
        </div>
        <span className={`p-pill ${cfg?.enabled ? "p-pill--green" : "p-pill--gray"}`}>
          {cfg ? (cfg.enabled ? "Enabled" : "Disabled") : "Not configured"}
        </span>
      </div>
      <div className="p-card-body">
        <div className="p-stack">
          <div className="p-field">
            <label className="p-field-label">Kill switch</label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <input
                className="p-checkbox"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>
                Enabled
                <span className="p-subtle" style={{ fontSize: 11, marginLeft: 6 }}>
                  — off pauses code generation without deleting keys
                </span>
              </span>
            </label>
          </div>

          <KeyRow
            label="Seam API key"
            existing={cfg?.api_key}
            placeholder="seam_…"
            value={apiInput}
            onChange={setApiInput}
          />

          <div className="p-field">
            <label className="p-field-label" htmlFor="seam-device">Seam device ID</label>
            <div className="p-field-hint">
              {cfg?.device_id
                ? <>Current: <code className="p-mono">{cfg.device_id}</code></>
                : <>Not configured</>
              }
            </div>
            <input
              id="seam-device"
              className="p-input p-input--mono"
              type="text"
              value={deviceInput}
              onChange={(e) => setDeviceInput(e.target.value)}
              placeholder="uuid of the physical smart lock in Seam"
            />
          </div>

          {status && <div className="p-msg p-msg--ok">{status}</div>}
          {err && <div className="p-msg p-msg--error">{err}</div>}
        </div>
      </div>
      <div className="p-card-footer">
        {cfg && (
          <span className="p-subtle" style={{ fontSize: 11, marginRight: "auto", alignSelf: "center" }}>
            Last updated {cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : "—"}
          </span>
        )}
        <button
          className="p-btn p-btn--primary"
          onClick={save}
          disabled={saving || (!cfg && (!apiInput.trim() || !deviceInput.trim()))}
        >
          {saving ? "Saving…" : "Save Seam config"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Square
// ───────────────────────────────────────────────────────────

function SquareTab({ detail, apiKey }) {
  const tenantId = detail.tenant.id;
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [environment, setEnvironment] = useState("production");
  const [tokenInput, setTokenInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [appIdInput, setAppIdInput] = useState("");
  const [webhookInput, setWebhookInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [backfillDryRun, setBackfillDryRun] = useState(true);
  const [syncingTiers, setSyncingTiers] = useState(false);
  const [tierSyncResult, setTierSyncResult] = useState(null);
  const [tierSyncDryRun, setTierSyncDryRun] = useState(true);
  const [syncingGiftCards, setSyncingGiftCards] = useState(false);
  const [giftCardSyncResult, setGiftCardSyncResult] = useState(null);
  const [giftCardSyncDryRun, setGiftCardSyncDryRun] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/platform-tenant-square?tenant_id=${encodeURIComponent(tenantId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = r.ok ? await r.json() : null;
        if (!cancelled) {
          setCfg(d);
          setEnabled(d?.enabled ?? false);
          setEnvironment(d?.environment || "production");
          setLocationInput(d?.location_id || "");
          setAppIdInput(d?.application_id || "");
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
    const payload = { tenant_id: tenantId, enabled, environment };
    if (tokenInput.trim()) payload.access_token = tokenInput.trim();
    if (locationInput.trim() && locationInput.trim() !== (cfg?.location_id || "")) {
      payload.location_id = locationInput.trim();
    }
    if (appIdInput.trim() !== (cfg?.application_id || "")) {
      payload.application_id = appIdInput.trim() || null;
    }
    if (webhookInput.trim()) payload.webhook_signature_key = webhookInput.trim();
    try {
      const r = await fetch("/api/platform-tenant-square", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setCfg(d);
      setTokenInput("");
      setWebhookInput("");
      setStatus("Saved. Cache invalidated — next Square call picks up new values.");
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  async function runBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    setErr("");
    try {
      const r = await fetch("/api/admin-square-backfill", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, dryRun: backfillDryRun }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Backfill failed");
      setBackfillResult(d);
    } catch (e) {
      setErr(e.message);
    }
    setBackfilling(false);
  }

  async function runTierSync() {
    setSyncingTiers(true);
    setTierSyncResult(null);
    setErr("");
    try {
      const r = await fetch("/api/admin-square-sync-tiers", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, dryRun: tierSyncDryRun }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Tier sync failed");
      setTierSyncResult(d);
    } catch (e) {
      setErr(e.message);
    }
    setSyncingTiers(false);
  }

  async function runGiftCardSync() {
    setSyncingGiftCards(true);
    setGiftCardSyncResult(null);
    setErr("");
    try {
      const r = await fetch("/api/admin-square-sync-gift-cards", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, dryRun: giftCardSyncDryRun }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Gift card sync failed");
      setGiftCardSyncResult(d);
    } catch (e) {
      setErr(e.message);
    }
    setSyncingGiftCards(false);
  }

  if (loading) return <div className="p-muted">Loading Square config…</div>;

  return (
    <div className="p-card" style={{ maxWidth: 720 }}>
      <div className="p-card-header">
        <div>
          <div className="p-card-title">Square POS configuration</div>
          <div className="p-card-subtitle">
            Credentials used by the member QR backfill and the POS-purchase
            webhook so in-store Square Register scans round-trip into the
            app's loyalty and activity surfaces.
          </div>
        </div>
        <span className={`p-pill ${cfg?.enabled ? "p-pill--green" : "p-pill--gray"}`}>
          {cfg ? (cfg.enabled ? "Enabled" : "Disabled") : "Not configured"}
        </span>
      </div>
      <div className="p-card-body">
        <div className="p-stack">
          <div className="p-field">
            <label className="p-field-label">Environment</label>
            <div className="p-field-hint">
              Sandbox uses <code className="p-mono">connect.squareupsandbox.com</code>,
              production uses <code className="p-mono">connect.squareup.com</code>.
            </div>
            <select
              className="p-input p-input--mono"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <option value="production">production</option>
              <option value="sandbox">sandbox</option>
            </select>
          </div>

          <div className="p-field">
            <label className="p-field-label">Kill switch</label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <input
                className="p-checkbox"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>
                Enabled
                <span className="p-subtle" style={{ fontSize: 11, marginLeft: 6 }}>
                  — off pauses Square sync without deleting credentials
                </span>
              </span>
            </label>
          </div>

          <KeyRow
            label="Square access token"
            existing={cfg?.access_token}
            placeholder="EAAA… (production) or EAAAE… (sandbox)"
            value={tokenInput}
            onChange={setTokenInput}
          />

          <div className="p-field">
            <label className="p-field-label" htmlFor="sq-location">Location ID</label>
            <div className="p-field-hint">
              {cfg?.location_id
                ? <>Current: <code className="p-mono">{cfg.location_id}</code></>
                : <>Not configured</>
              }
            </div>
            <input
              id="sq-location"
              className="p-input p-input--mono"
              type="text"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              placeholder="LXXXXXXXXXXXX"
            />
          </div>

          <div className="p-field">
            <label className="p-field-label" htmlFor="sq-appid">Application ID (optional)</label>
            <div className="p-field-hint">
              Only needed if we ever push Terminal orders. Safe to leave blank for scan-only flow.
            </div>
            <input
              id="sq-appid"
              className="p-input p-input--mono"
              type="text"
              value={appIdInput}
              onChange={(e) => setAppIdInput(e.target.value)}
              placeholder="sq0idp-…"
            />
          </div>

          <KeyRow
            label="Webhook signature key"
            existing={cfg?.webhook_signature_key}
            placeholder="wh_…"
            value={webhookInput}
            onChange={setWebhookInput}
          />

          {status && <div className="p-msg p-msg--ok">{status}</div>}
          {err && <div className="p-msg p-msg--error">{err}</div>}

          {cfg?.enabled && cfg?.location_id && (
            <div className="p-field" style={{ marginTop: 16, padding: 14, background: "var(--p-surface-sunken, #f6f7f5)", borderRadius: 8, border: "1px solid var(--p-border, #e2eddb)" }}>
              <label className="p-field-label">Member backfill</label>
              <div className="p-field-hint" style={{ marginBottom: 10 }}>
                Walks every member in this tenant, searches Square by email, and either
                links an existing Square customer, backfills a <code className="p-mono">reference_id</code>, or
                creates a new Square customer. Always start with a dry run — the report
                shows conflicts, duplicates, and errors before any writes.
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <input
                  className="p-checkbox"
                  type="checkbox"
                  checked={backfillDryRun}
                  onChange={(e) => setBackfillDryRun(e.target.checked)}
                />
                <span>Dry run (no writes to Square or our DB)</span>
              </label>
              <div style={{ marginTop: 10 }}>
                <button
                  className="p-btn"
                  onClick={runBackfill}
                  disabled={backfilling}
                >
                  {backfilling ? "Running…" : backfillDryRun ? "Preview backfill" : "Run backfill"}
                </button>
              </div>
              {backfillResult && (
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {backfillResult.summary.dryRun ? "Dry-run summary" : "Backfill summary"}
                  </div>
                  <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: 0, overflowX: "auto" }}>
                    {JSON.stringify(backfillResult.summary, null, 2)}
                  </pre>
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--p-text-muted, #6a7a6c)" }}>
                      Per-member report ({backfillResult.report.length} rows)
                    </summary>
                    <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: "8px 0 0 0", maxHeight: 320, overflow: "auto" }}>
                      {JSON.stringify(backfillResult.report, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {cfg?.enabled && cfg?.location_id && (
            <div className="p-field" style={{ marginTop: 16, padding: 14, background: "var(--p-surface-sunken, #f6f7f5)", borderRadius: 8, border: "1px solid var(--p-border, #e2eddb)" }}>
              <label className="p-field-label">Tier sync (Phase 3)</label>
              <div className="p-field-hint" style={{ marginBottom: 10 }}>
                Writes each linked member's HG tier + pro-shop discount to the
                Square customer's <code className="p-mono">note</code> field, and
                assigns them to a <code className="p-mono">HG tier: &lt;Tier&gt;</code>
                customer group (auto-created on first run). Staff see the note in
                the Square POS customer profile; merchants can also wire the
                group to an automatic discount rule in Square Dashboard.
                Re-run whenever tiers change to keep Square in sync.
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <input
                  className="p-checkbox"
                  type="checkbox"
                  checked={tierSyncDryRun}
                  onChange={(e) => setTierSyncDryRun(e.target.checked)}
                />
                <span>Dry run (preview only, no writes)</span>
              </label>
              <div style={{ marginTop: 10 }}>
                <button
                  className="p-btn"
                  onClick={runTierSync}
                  disabled={syncingTiers}
                >
                  {syncingTiers ? "Syncing…" : tierSyncDryRun ? "Preview tier sync" : "Run tier sync"}
                </button>
              </div>
              {tierSyncResult && (
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {tierSyncResult.summary.dryRun ? "Dry-run summary" : "Tier sync summary"}
                  </div>
                  <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: 0, overflowX: "auto" }}>
                    {JSON.stringify(tierSyncResult.summary, null, 2)}
                  </pre>
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--p-text-muted, #6a7a6c)" }}>
                      Per-member report ({tierSyncResult.report.length} rows)
                    </summary>
                    <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: "8px 0 0 0", maxHeight: 320, overflow: "auto" }}>
                      {JSON.stringify(tierSyncResult.report, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {cfg?.enabled && cfg?.location_id && (
            <div className="p-field" style={{ marginTop: 16, padding: 14, background: "var(--p-surface-sunken, #f6f7f5)", borderRadius: 8, border: "1px solid var(--p-border, #e2eddb)" }}>
              <label className="p-field-label">Gift-card balance sync</label>
              <div className="p-field-hint" style={{ marginBottom: 10 }}>
                Mirrors each member's <code className="p-mono">shop_credit_balance</code> onto a
                Square digital gift card linked to their customer
                record. Square Register then auto-applies the balance
                at checkout without staff action. First run creates +
                activates cards for members with non-zero balance;
                subsequent runs adjust each card up or down to match.
                Zero-balance members without cards are skipped.
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <input
                  className="p-checkbox"
                  type="checkbox"
                  checked={giftCardSyncDryRun}
                  onChange={(e) => setGiftCardSyncDryRun(e.target.checked)}
                />
                <span>Dry run (no writes to Square)</span>
              </label>
              <div style={{ marginTop: 10 }}>
                <button
                  className="p-btn"
                  onClick={runGiftCardSync}
                  disabled={syncingGiftCards}
                >
                  {syncingGiftCards ? "Syncing\u2026" : giftCardSyncDryRun ? "Preview gift-card sync" : "Run gift-card sync"}
                </button>
              </div>
              {giftCardSyncResult && (
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {giftCardSyncResult.summary.dryRun ? "Dry-run summary" : "Gift-card sync summary"}
                  </div>
                  <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: 0, overflowX: "auto" }}>
                    {JSON.stringify(giftCardSyncResult.summary, null, 2)}
                  </pre>
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--p-text-muted, #6a7a6c)" }}>
                      Per-member report ({giftCardSyncResult.report.length} rows)
                    </summary>
                    <pre className="p-mono" style={{ background: "var(--p-surface, #fff)", padding: 10, borderRadius: 6, border: "1px solid var(--p-border, #e2eddb)", fontSize: 11, margin: "8px 0 0 0", maxHeight: 320, overflow: "auto" }}>
                      {JSON.stringify(giftCardSyncResult.report, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="p-card-footer">
        {cfg && (
          <span className="p-subtle" style={{ fontSize: 11, marginRight: "auto", alignSelf: "center" }}>
            Last updated {cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : "—"}
          </span>
        )}
        <button
          className="p-btn p-btn--primary"
          onClick={save}
          disabled={saving || (!cfg && (!tokenInput.trim() || !locationInput.trim()))}
        >
          {saving ? "Saving…" : "Save Square config"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Shippo
// ───────────────────────────────────────────────────────────

function ShippoTab({ detail, apiKey }) {
  const tenantId = detail.tenant.id;
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [generatingWebhookToken, setGeneratingWebhookToken] = useState(false);
  // Origin address — flat fields so the form is straightforward.
  const [origin, setOrigin] = useState({
    name: "", company: "",
    street1: "", street2: "",
    city: "", state: "", zip: "", country: "US",
    phone: "", email: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/platform-tenant-shippo?tenant_id=${encodeURIComponent(tenantId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = r.ok ? await r.json() : null;
        if (!cancelled) {
          setCfg(d);
          setEnabled(d?.enabled ?? false);
          setOrigin({
            name: d?.origin_name || "",
            company: d?.origin_company || "",
            street1: d?.origin_street1 || "",
            street2: d?.origin_street2 || "",
            city: d?.origin_city || "",
            state: d?.origin_state || "",
            zip: d?.origin_zip || "",
            country: d?.origin_country || "US",
            phone: d?.origin_phone || "",
            email: d?.origin_email || "",
          });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, apiKey]);

  function setOriginField(field, value) {
    setOrigin((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setErr("");
    setStatus("");
    const payload = { tenant_id: tenantId, enabled };
    if (tokenInput.trim()) payload.api_key = tokenInput.trim();
    payload.origin_name = origin.name;
    payload.origin_company = origin.company;
    payload.origin_street1 = origin.street1;
    payload.origin_street2 = origin.street2;
    payload.origin_city = origin.city;
    payload.origin_state = origin.state.toUpperCase();
    payload.origin_zip = origin.zip;
    payload.origin_country = origin.country.toUpperCase();
    payload.origin_phone = origin.phone;
    payload.origin_email = origin.email;
    try {
      const r = await fetch("/api/platform-tenant-shippo", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setCfg(d);
      setTokenInput("");
      setStatus("Saved. Cache invalidated — next rate quote uses new values.");
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  if (loading) return <div className="p-muted">Loading Shippo config…</div>;

  return (
    <div className="p-card" style={{ maxWidth: 720 }}>
      <div className="p-card-header">
        <div>
          <div className="p-card-title">Shippo (shipping carrier API)</div>
          <div className="p-card-subtitle">
            API key + origin address used by the public /shop guest
            checkout to fetch rates and purchase labels post-payment.
          </div>
        </div>
        <span className={`p-pill ${cfg?.enabled ? "p-pill--green" : "p-pill--gray"}`}>
          {cfg ? (cfg.enabled ? "Enabled" : "Disabled") : "Not configured"}
        </span>
      </div>
      <div className="p-card-body">
        <div className="p-stack">
          <div className="p-field">
            <label className="p-field-label">Kill switch</label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
              <input
                className="p-checkbox"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>
                Enabled
                <span className="p-subtle" style={{ fontSize: 11, marginLeft: 6 }}>
                  — off pauses rate fetching + label purchase
                </span>
              </span>
            </label>
          </div>

          <KeyRow
            label="Shippo API token"
            existing={cfg?.api_key}
            placeholder="shippo_live_… or shippo_test_…"
            value={tokenInput}
            onChange={setTokenInput}
          />

          <ShippoWebhookUrl
            tenantSlug={detail?.tenant?.slug}
            cfg={cfg}
            apiKey={apiKey}
            tenantId={tenantId}
            onChanged={(updated) => setCfg(updated)}
            generating={generatingWebhookToken}
            setGenerating={setGeneratingWebhookToken}
          />

          <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12, color: "var(--p-text)" }}>Origin address (where labels ship from)</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ShippoInput label="Contact name"   value={origin.name}     onChange={(v) => setOriginField("name", v)} placeholder="Hour Golf" />
            <ShippoInput label="Company"        value={origin.company}  onChange={(v) => setOriginField("company", v)} placeholder="Hour Golf LLC" />
            <ShippoInput label="Street 1"       value={origin.street1}  onChange={(v) => setOriginField("street1", v)} placeholder="Required" wide />
            <ShippoInput label="Street 2"       value={origin.street2}  onChange={(v) => setOriginField("street2", v)} placeholder="Suite, etc." wide />
            <ShippoInput label="City"           value={origin.city}     onChange={(v) => setOriginField("city", v)} placeholder="Portland" />
            <ShippoInput label="State"          value={origin.state}    onChange={(v) => setOriginField("state", v)} placeholder="OR" />
            <ShippoInput label="ZIP"            value={origin.zip}      onChange={(v) => setOriginField("zip", v)} placeholder="97201" />
            <ShippoInput label="Country"        value={origin.country}  onChange={(v) => setOriginField("country", v)} placeholder="US" />
            <ShippoInput label="Phone"          value={origin.phone}    onChange={(v) => setOriginField("phone", v)} placeholder="503-555-1234" />
            <ShippoInput label="Email"          value={origin.email}    onChange={(v) => setOriginField("email", v)} placeholder="ship@hour.golf" />
          </div>

          {status && <div className="p-msg p-msg--ok">{status}</div>}
          {err && <div className="p-msg p-msg--error">{err}</div>}
        </div>
      </div>
      <div className="p-card-footer">
        {cfg && (
          <span className="p-subtle" style={{ fontSize: 11, marginRight: "auto", alignSelf: "center" }}>
            Last updated {cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : "—"}
          </span>
        )}
        <button
          className="p-btn p-btn--primary"
          onClick={save}
          disabled={saving || (!cfg && (!tokenInput.trim() || !origin.street1 || !origin.city || !origin.state || !origin.zip))}
        >
          {saving ? "Saving…" : "Save Shippo config"}
        </button>
      </div>
    </div>
  );
}

function ShippoInput({ label, value, onChange, placeholder, wide }) {
  return (
    <div className="p-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label className="p-field-label">{label}</label>
      <input
        className="p-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ""}
      />
    </div>
  );
}

function ShippoWebhookUrl({ tenantSlug, cfg, apiKey, tenantId, onChanged, generating, setGenerating }) {
  const token = cfg?.tracking_webhook_secret || "";
  const fullUrl = token && tenantSlug
    ? `https://${tenantSlug}.ourlee.co/api/shippo-webhook?token=${token}`
    : "";

  async function generateToken() {
    if (!confirm(token
      ? "Replace the existing webhook URL? You'll need to update the URL in Shippo's dashboard too — the old URL will stop working."
      : "Generate a tracking webhook URL for Shippo?"
    )) return;
    setGenerating(true);
    try {
      const r = await fetch("/api/platform-tenant-shippo", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, regenerate_webhook_token: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Generate failed");
      onChanged(d);
    } catch (e) {
      alert(e.message);
    }
    setGenerating(false);
  }

  function copyUrl() {
    if (!fullUrl) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(fullUrl);
    }
  }

  return (
    <div className="p-field">
      <label className="p-field-label">Tracking webhook URL</label>
      <div className="p-field-hint">
        Shippo doesn't HMAC-sign webhooks. We use a hard-to-guess URL with
        a per-tenant token instead. Generate the URL here, then paste it
        into <strong>Shippo Dashboard → Webhooks</strong> with event{" "}
        <code className="p-mono">track_updated</code>.
      </div>
      {token ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--p-surface, #fff)", border: "1px solid var(--p-border, #e2eddb)", borderRadius: 8, fontSize: 11, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
            <span style={{ flex: 1 }}>{fullUrl}</span>
            <button
              className="p-btn"
              onClick={copyUrl}
              type="button"
              style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
            >
              Copy
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              className="p-btn"
              onClick={generateToken}
              disabled={generating}
              type="button"
              style={{ fontSize: 11 }}
            >
              {generating ? "Generating…" : "Regenerate URL"}
            </button>
          </div>
        </>
      ) : (
        <button
          className="p-btn p-btn--primary"
          onClick={generateToken}
          disabled={generating}
          type="button"
          style={{ fontSize: 12 }}
        >
          {generating ? "Generating…" : "Generate webhook URL"}
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Features
// ───────────────────────────────────────────────────────────

function FeaturesTab({ detail, apiKey, onSaved }) {
  const tenantId = detail.tenant.id;
  const current = {};
  (detail.features || []).forEach((f) => { current[f.feature_key] = !!f.enabled; });

  const [pending, setPending] = useState({});
  const [err, setErr] = useState("");
  const [pricing, setPricing] = useState([]);

  // Pull pricing so each feature row can show its upcharge. If the
  // fetch fails (e.g. /api/platform-pricing isn't deployed yet), the
  // tab still renders — just without dollars.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/platform-pricing", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setPricing(d.pricing || []);
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [apiKey]);

  const priceByKey = new Map();
  for (const row of pricing) {
    if (row.is_active) priceByKey.set(row.unit_key, row.monthly_price_cents || 0);
  }

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

  const onCount = Object.values(current).filter(Boolean).length;
  const baseCents = priceByKey.get("base") || 0;
  const enabledCents = Object.entries(current)
    .filter(([, on]) => on)
    .reduce((sum, [k]) => sum + (priceByKey.get(k) || 0), 0);
  const monthlyTotal = baseCents + enabledCents;
  const hasPricing = priceByKey.size > 0;

  return (
    <div className="p-card" style={{ maxWidth: 900 }}>
      <div className="p-card-header">
        <div>
          <div className="p-card-title">Feature flags</div>
          <div className="p-card-subtitle">
            Each toggle writes a row in <code className="p-mono">tenant_features</code>. The
            dollars column shows what each flag contributes to this tenant&rsquo;s monthly
            bill, per <a href="/platform/pricing" style={{ color: "var(--p-info-text)" }}>Pricing</a>.
          </div>
        </div>
        <div className="p-row" style={{ gap: 6 }}>
          <span className="p-pill p-pill--green">{onCount} on</span>
          {hasPricing && (
            <span className="p-pill p-pill--blue">
              ${(monthlyTotal / 100).toFixed(2)}/mo
            </span>
          )}
        </div>
      </div>
      <div className="p-card-body p-card-body--flush">
        <table className="p-table">
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Feature</th>
              <th>Description</th>
              <th style={{ width: 110 }} className="p-table-num">Monthly</th>
              <th style={{ width: 100, textAlign: "right" }}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_KEYS.map(({ key, label, hint }) => {
              const isOn = !!current[key];
              const state = pending[key];
              const cents = priceByKey.get(key);
              return (
                <tr key={key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{label}</div>
                    <div className="p-mono p-muted" style={{ marginTop: 2 }}>{key}</div>
                  </td>
                  <td className="p-muted">{hint}</td>
                  <td className="p-table-num p-muted">
                    {cents === undefined ? (
                      <span className="p-subtle">—</span>
                    ) : cents === 0 ? (
                      <span className="p-subtle">Free</span>
                    ) : (
                      <span style={{ color: isOn ? "var(--p-text)" : "var(--p-text-muted)" }}>
                        ${(cents / 100).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {state === "saving" && <span className="p-subtle" style={{ fontSize: 11 }}>saving…</span>}
                      {state === "saved" && <span style={{ color: "var(--p-primary-text)", fontSize: 11 }}>✓</span>}
                      {state === "err" && <span style={{ color: "var(--p-danger-text)", fontSize: 11 }}>err</span>}
                      <input
                        className="p-checkbox"
                        type="checkbox"
                        checked={isOn}
                        disabled={state === "saving"}
                        onChange={(e) => toggle(key, e.target.checked)}
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {hasPricing && (
            <tfoot>
              <tr>
                <td colSpan={2} className="p-muted" style={{ fontWeight: 500 }}>
                  Base {baseCents > 0 && <span className="p-subtle">({`$${(baseCents / 100).toFixed(2)}`})</span>} + enabled features
                </td>
                <td className="p-table-num" style={{ fontWeight: 600 }}>
                  ${(monthlyTotal / 100).toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {err && <div className="p-card-footer" style={{ justifyContent: "flex-start" }}>
        <div className="p-msg p-msg--error">{err}</div>
      </div>}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Billing
// ───────────────────────────────────────────────────────────

function BillingTab({ detail, apiKey }) {
  const tenantId = detail.tenant.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/platform-billing?tenant_id=${encodeURIComponent(tenantId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Load failed");
      setData(d);
      setStatus(d.billing?.status || "not_enrolled");
      setNotes(d.billing?.notes || "");
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [tenantId, apiKey]);

  useEffect(() => { load(); }, [load]);

  async function saveBilling() {
    setSaving(true);
    setSavedMsg("");
    setErr("");
    try {
      const r = await fetch("/api/platform-billing", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, status, notes: notes || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setSavedMsg("Saved.");
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  if (loading) return <div className="p-muted">Loading billing…</div>;
  if (err && !data) return <div className="p-msg p-msg--error">{err}</div>;
  if (!data) return null;

  const cents = data.computed_monthly_cents || 0;
  const { breakdown = [], billing, drift } = data;

  return (
    <div className="p-stack">
      <div className="p-msg p-msg--info">
        <strong>Phase 1 — preview only.</strong> The math below is the monthly total
        this tenant <em>will</em> be charged once Ourlee&rsquo;s own Stripe account is
        wired in (Phase 2). No actual charges happen today. Edit prices at
        <a href="/platform/pricing" style={{ color: "var(--p-info-text)", marginLeft: 4 }}>/platform/pricing</a>.
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div className="p-card" style={{ padding: "14px 16px" }}>
          <div className="p-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Monthly total
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, fontFamily: "var(--p-font-mono)", color: "var(--p-primary-text)" }}>
            ${(cents / 100).toFixed(2)}
          </div>
          <div className="p-subtle" style={{ fontSize: 11, marginTop: 2 }}>
            {breakdown.filter((b) => b.applies).length} line items
          </div>
        </div>
        <div className="p-card" style={{ padding: "14px 16px" }}>
          <div className="p-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Billing status
          </div>
          <div style={{ marginTop: 4 }}>
            <BillingStatusPill status={billing?.status} />
          </div>
          <div className="p-subtle" style={{ fontSize: 11, marginTop: 8 }}>
            {billing?.stripe_customer_id ? (
              <>Stripe customer <code className="p-mono">{billing.stripe_customer_id}</code></>
            ) : (
              "Not yet enrolled in Stripe"
            )}
          </div>
        </div>
        <div className="p-card" style={{ padding: "14px 16px" }}>
          <div className="p-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
            Cached snapshot
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, fontFamily: "var(--p-font-mono)" }}>
            ${((data.cached_monthly_cents || 0) / 100).toFixed(2)}
          </div>
          <div className="p-subtle" style={{ fontSize: 11, marginTop: 2 }}>
            {billing?.cost_snapshot_at ? new Date(billing.cost_snapshot_at).toLocaleString() : "Never"}
            {drift && <span style={{ color: "var(--p-warning-text)", marginLeft: 6 }}>· drift</span>}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="p-card">
        <div className="p-card-header">
          <div>
            <div className="p-card-title">Line items</div>
            <div className="p-card-subtitle">
              Each active pricing row shown; items marked Applied are counted in this tenant&rsquo;s total.
            </div>
          </div>
        </div>
        <div className="p-card-body p-card-body--flush">
          <table className="p-table">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Item</th>
                <th>Kind</th>
                <th className="p-table-num" style={{ width: 140 }}>Monthly</th>
                <th style={{ width: 100, textAlign: "right" }}>Applied</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-muted" style={{ textAlign: "center", padding: 24 }}>
                    No active pricing rows yet. Visit
                    <a href="/platform/pricing" style={{ color: "var(--p-info-text)", marginLeft: 4 }}>/platform/pricing</a> to
                    set up prices.
                  </td>
                </tr>
              )}
              {breakdown.map((b) => (
                <tr key={b.unit_key} style={{ opacity: b.applies ? 1 : 0.5 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{b.label}</div>
                    <div className="p-mono p-muted" style={{ marginTop: 2 }}>{b.unit_key}</div>
                  </td>
                  <td>
                    <span className={`p-pill ${b.kind === "base" ? "p-pill--blue" : "p-pill--gray"}`}>
                      {b.kind}
                    </span>
                  </td>
                  <td className="p-table-num">${(b.monthly_price_cents / 100).toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>
                    {b.applies ? (
                      <span className="p-pill p-pill--green">Applied</span>
                    ) : (
                      <span className="p-subtle" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ fontWeight: 500 }}>Monthly total</td>
                <td className="p-table-num" style={{ fontWeight: 600 }}>
                  ${(cents / 100).toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Billing state editor */}
      <div className="p-card" style={{ maxWidth: 720 }}>
        <div className="p-card-header">
          <div>
            <div className="p-card-title">Billing state</div>
            <div className="p-card-subtitle">
              Manually set the tenant&rsquo;s billing status and internal notes. When
              Phase 2 wires Stripe webhooks in, status will be updated automatically —
              manual edits are a stopgap for the interim.
            </div>
          </div>
        </div>
        <div className="p-card-body">
          <div className="p-stack">
            <div className="p-form-grid">
              <div className="p-field">
                <label className="p-field-label" htmlFor="billing-status">Status</label>
                <select
                  id="billing-status"
                  className="p-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="not_enrolled">Not enrolled</option>
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past due</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="p-field">
                <label className="p-field-label">Stripe IDs</label>
                <div className="p-field-hint" style={{ lineHeight: 1.6 }}>
                  Customer: <code className="p-mono">{billing?.stripe_customer_id || "—"}</code><br />
                  Subscription: <code className="p-mono">{billing?.stripe_subscription_id || "—"}</code>
                </div>
              </div>
            </div>
            <div className="p-field">
              <label className="p-field-label" htmlFor="billing-notes">Notes</label>
              <textarea
                id="billing-notes"
                className="p-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. grandfathered at $0 through 2026-07, pilot program"
                rows={3}
              />
            </div>
            {savedMsg && <div className="p-msg p-msg--ok">{savedMsg}</div>}
            {err && <div className="p-msg p-msg--error">{err}</div>}
          </div>
        </div>
        <div className="p-card-footer">
          <button className="p-btn p-btn--primary" onClick={saveBilling} disabled={saving}>
            {saving ? "Saving…" : "Save billing state"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BillingStatusPill({ status }) {
  switch (status) {
    case "active":
      return <span className="p-pill p-pill--green"><span className="p-pill-dot" />Active</span>;
    case "trialing":
      return <span className="p-pill p-pill--blue">Trialing</span>;
    case "past_due":
      return <span className="p-pill p-pill--red">Past due</span>;
    case "suspended":
      return <span className="p-pill p-pill--amber">Suspended</span>;
    case "cancelled":
      return <span className="p-pill p-pill--gray">Cancelled</span>;
    default:
      return <span className="p-pill p-pill--gray">Not enrolled</span>;
  }
}

// ───────────────────────────────────────────────────────────
// KeyRow — used by Stripe + Seam for write-only secrets
// ───────────────────────────────────────────────────────────

function KeyRow({ label, existing, placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="p-field">
      <label className="p-field-label">{label}</label>
      <div className="p-field-hint">
        {existing ? (
          <>Current: <code className="p-mono">{existing.prefix}</code>…<code className="p-mono">{existing.last4}</code> ({existing.length} chars)</>
        ) : (
          <>Not configured</>
        )}
      </div>
      <input
        className="p-input p-input--mono"
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <label style={{ fontSize: 11, color: "var(--p-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
        <input className="p-checkbox" type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <span>Show value while typing</span>
      </label>
    </div>
  );
}
