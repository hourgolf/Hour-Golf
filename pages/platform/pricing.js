// Per-feature pricing editor for the platform. Platform admin sets the
// monthly dollar value for each feature (and an optional flat base).
// The Billing tab on each tenant rolls those up into a monthly total
// against that tenant's current enabled-features.
//
// Editing is inline: type a new dollars value, blur or press Enter, the
// row saves. Prices are stored as integer cents under the hood; the UI
// shows dollars with two decimal places.

import { useEffect, useState, useCallback } from "react";
import { usePlatformAuth } from "../../hooks/usePlatformAuth";
import PlatformShell from "../../components/platform/PlatformShell";

export default function PlatformPricingPage() {
  const { apiKey, connected } = usePlatformAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/platform-pricing", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Load failed");
      setRows(d.pricing || []);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }, [apiKey]);

  useEffect(() => { if (connected) load(); }, [connected, load]);

  async function patchRow(unit_key, payload) {
    try {
      const r = await fetch("/api/platform-pricing", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ unit_key, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      setRows((prev) => prev.map((row) => (row.unit_key === unit_key ? d.row : row)));
      return true;
    } catch (e) {
      setErr(`${unit_key}: ${e.message}`);
      return false;
    }
  }

  const baseRow = rows.find((r) => r.kind === "base");
  const featureRows = rows.filter((r) => r.kind === "feature");

  const activeSum = featureRows
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + (r.monthly_price_cents || 0), 0);
  const baseCents = baseRow?.is_active ? baseRow.monthly_price_cents || 0 : 0;

  return (
    <PlatformShell
      activeNav="pricing"
      breadcrumbs={[{ label: "Pricing" }]}
      title="Pricing"
      subtitle="What Ourlee charges tenants per month. Each feature toggle on a tenant's Features tab adds or removes its line item from that tenant's cost."
    >
      {err && <div className="p-msg p-msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="p-stack" style={{ maxWidth: 900 }}>
        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <SummaryCard
            label="Base floor"
            cents={baseCents}
            sub={baseRow?.is_active ? "Applied to every active tenant" : "Inactive"}
          />
          <SummaryCard
            label="All features on"
            cents={baseCents + activeSum}
            sub={`${featureRows.filter((r) => r.is_active).length} active features`}
          />
          <SummaryCard
            label="Avg per feature"
            cents={featureRows.filter((r) => r.is_active).length ? Math.round(activeSum / featureRows.filter((r) => r.is_active).length) : 0}
            sub="Averaged over active features"
          />
        </div>

        {/* Base */}
        {baseRow && (
          <div className="p-card">
            <div className="p-card-header">
              <div>
                <div className="p-card-title">Base tier</div>
                <div className="p-card-subtitle">{baseRow.description}</div>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--p-text-muted)" }}>
                <input
                  className="p-checkbox"
                  type="checkbox"
                  checked={baseRow.is_active}
                  onChange={(e) => patchRow(baseRow.unit_key, { is_active: e.target.checked })}
                />
                <span>{baseRow.is_active ? "Active" : "Inactive"}</span>
              </label>
            </div>
            <div className="p-card-body">
              <PriceInput
                valueCents={baseRow.monthly_price_cents}
                disabled={!baseRow.is_active}
                onSave={(cents) => patchRow(baseRow.unit_key, { monthly_price_cents: cents })}
              />
            </div>
          </div>
        )}

        {/* Features */}
        <div className="p-card">
          <div className="p-card-header">
            <div>
              <div className="p-card-title">Per-feature pricing</div>
              <div className="p-card-subtitle">
                Inactive rows don&rsquo;t appear as line items on tenant Billing tabs.
                Amounts are in USD per month.
              </div>
            </div>
            <span className="p-pill p-pill--green">
              ${((activeSum) / 100).toFixed(2)}/mo if all enabled
            </span>
          </div>
          <div className="p-card-body p-card-body--flush">
            {loading ? (
              <div className="p-muted" style={{ padding: 32, textAlign: "center" }}>Loading…</div>
            ) : (
              <table className="p-table">
                <thead>
                  <tr>
                    <th style={{ width: "24%" }}>Feature</th>
                    <th>Description</th>
                    <th style={{ width: 140 }}>Monthly price</th>
                    <th style={{ width: 100, textAlign: "right" }}>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {featureRows.map((r) => (
                    <tr key={r.unit_key}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.label}</div>
                        <div className="p-mono p-muted" style={{ marginTop: 2 }}>{r.unit_key}</div>
                      </td>
                      <td className="p-muted">{r.description}</td>
                      <td>
                        <PriceInput
                          valueCents={r.monthly_price_cents}
                          disabled={!r.is_active}
                          onSave={(cents) => patchRow(r.unit_key, { monthly_price_cents: cents })}
                          compact
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          className="p-checkbox"
                          type="checkbox"
                          checked={r.is_active}
                          onChange={(e) => patchRow(r.unit_key, { is_active: e.target.checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="p-msg p-msg--info">
          <strong>Phase 1 — no real Stripe yet.</strong> These prices are captured in
          Supabase but nothing charges anyone. Tenant billing surfaces show the
          computed monthly total as a preview of what Phase 2 will actually invoice.
        </div>
      </div>
    </PlatformShell>
  );
}

function SummaryCard({ label, cents, sub }) {
  return (
    <div className="p-card" style={{ padding: "14px 16px" }}>
      <div className="p-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, fontFamily: "var(--p-font-mono)" }}>
        ${(cents / 100).toFixed(2)}
      </div>
      <div className="p-subtle" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function PriceInput({ valueCents, disabled, onSave, compact }) {
  const [text, setText] = useState(((valueCents || 0) / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(((valueCents || 0) / 100).toFixed(2));
    setDirty(false);
  }, [valueCents]);

  async function commit() {
    const parsed = parseFloat(text);
    if (Number.isNaN(parsed) || parsed < 0) {
      setText(((valueCents || 0) / 100).toFixed(2));
      setDirty(false);
      return;
    }
    const cents = Math.round(parsed * 100);
    if (cents === valueCents) {
      setDirty(false);
      return;
    }
    setSaving(true);
    await onSave(cents);
    setSaving(false);
    setDirty(false);
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="p-muted" style={{ fontFamily: "var(--p-font-mono)" }}>$</span>
      <input
        className="p-input p-input--mono"
        type="number"
        step="0.01"
        min="0"
        value={text}
        disabled={disabled || saving}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ width: compact ? 100 : 140, textAlign: "right" }}
      />
      {saving && <span className="p-subtle" style={{ fontSize: 11 }}>…</span>}
      {dirty && !saving && <span className="p-subtle" style={{ fontSize: 11 }}>↵</span>}
    </div>
  );
}
