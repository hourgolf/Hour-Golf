import { useState, useEffect, useCallback } from "react";
import Modal from "../ui/Modal";
import StatusBadge from "../ui/StatusBadge";

// Admin management for pro-shop promo / discount codes. Rendered as
// a sub-section on ConfigView. CRUD against /api/admin-discount-codes.
// Not stackable with member tier discount (rule enforced at checkout,
// not here — this panel just sets up the code).

const BLANK = {
  code: "",
  type: "percent",
  value: "",
  min_order_cents: "",
  expires_at: "",
  usage_limit_total: "",
  usage_limit_per_member: "",
  scope: "both",
  description: "",
  is_active: true,
};

function formatValue(c) {
  if (c.type === "percent") return `${Number(c.value).toFixed(0)}% off`;
  return `$${Number(c.value).toFixed(2)} off`;
}

function formatExpiry(c) {
  if (!c.expires_at) return "No expiry";
  const d = new Date(c.expires_at);
  if (isNaN(d)) return "—";
  if (d.getTime() <= Date.now()) return `Expired ${d.toLocaleDateString()}`;
  return `Expires ${d.toLocaleDateString()}`;
}

function codeStatusIntent(c) {
  if (!c.is_active) return "neutral";
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return "warning";
  if (c.usage_limit_total && (c.total_uses || 0) >= c.usage_limit_total) return "warning";
  return "success";
}

function codeStatusLabel(c) {
  if (!c.is_active) return "OFF";
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return "EXPIRED";
  if (c.usage_limit_total && (c.total_uses || 0) >= c.usage_limit_total) return "USED UP";
  return "ACTIVE";
}

function CodeModal({ open, onClose, code, onSave }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (code) {
      setForm({
        code: code.code || "",
        type: code.type || "percent",
        value: code.value != null ? String(code.value) : "",
        min_order_cents: code.min_order_cents != null ? String(code.min_order_cents) : "",
        expires_at: code.expires_at ? code.expires_at.slice(0, 16) : "",
        usage_limit_total: code.usage_limit_total != null ? String(code.usage_limit_total) : "",
        usage_limit_per_member: code.usage_limit_per_member != null ? String(code.usage_limit_per_member) : "",
        scope: code.scope || "both",
        description: code.description || "",
        is_active: code.is_active !== false,
      });
    } else {
      setForm(BLANK);
    }
    setErr(null);
  }, [code, open]);

  function u(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setErr(null);
    if (!form.code.trim()) return setErr("Code is required");
    if (!form.value || isNaN(Number(form.value))) return setErr("Value is required");
    setSaving(true);
    try {
      await onSave({
        ...form,
        code: form.code.trim(),
        value: Number(form.value),
        min_order_cents: form.min_order_cents !== "" ? Number(form.min_order_cents) : null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        usage_limit_total: form.usage_limit_total !== "" ? Number(form.usage_limit_total) : null,
        usage_limit_per_member: form.usage_limit_per_member !== "" ? Number(form.usage_limit_per_member) : null,
      }, !!code);
    } catch (e) {
      setErr(e.message || "Save failed");
    }
    setSaving(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{code ? "Edit code" : "New discount code"}</h2>
      {err && <div style={{ color: "var(--danger, #C92F1F)", marginBottom: 12, fontSize: 13 }}>{err}</div>}
      <div className="mf">
        <label>Code *</label>
        <input
          value={form.code}
          onChange={(e) => u("code", e.target.value.toUpperCase())}
          placeholder="SUMMER10"
          style={{ fontFamily: "var(--font-mono)", letterSpacing: 1 }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="mf">
          <label>Type</label>
          <select value={form.type} onChange={(e) => u("type", e.target.value)}>
            <option value="percent">Percent off</option>
            <option value="amount">Dollar amount off</option>
          </select>
        </div>
        <div className="mf">
          <label>{form.type === "percent" ? "Percent (e.g. 10)" : "Dollars (e.g. 5)"} *</label>
          <input type="number" step={form.type === "percent" ? "1" : "0.01"} value={form.value} onChange={(e) => u("value", e.target.value)} />
        </div>
        <div className="mf">
          <label>Min order ($)</label>
          <input type="number" step="0.01" value={form.min_order_cents} onChange={(e) => u("min_order_cents", e.target.value === "" ? "" : Math.round(Number(e.target.value) * 100))} placeholder="No min" />
        </div>
        <div className="mf">
          <label>Expires</label>
          <input type="datetime-local" value={form.expires_at} onChange={(e) => u("expires_at", e.target.value)} />
        </div>
        <div className="mf">
          <label>Total uses cap</label>
          <input type="number" min={0} value={form.usage_limit_total} onChange={(e) => u("usage_limit_total", e.target.value)} placeholder="No limit" />
        </div>
        <div className="mf">
          <label>Per-member cap</label>
          <input type="number" min={0} value={form.usage_limit_per_member} onChange={(e) => u("usage_limit_per_member", e.target.value)} placeholder="No limit" />
        </div>
        <div className="mf">
          <label>Scope</label>
          <select value={form.scope} onChange={(e) => u("scope", e.target.value)}>
            <option value="both">Members + guests</option>
            <option value="member">Members only</option>
            <option value="public">Guest checkout only</option>
          </select>
        </div>
        <div className="mf">
          <label>Description (internal)</label>
          <input value={form.description} onChange={(e) => u("description", e.target.value)} placeholder="e.g. Summer 2026 promo" />
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
        <input type="checkbox" checked={form.is_active} onChange={(e) => u("is_active", e.target.checked)} />
        Active (can be used at checkout)
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || !form.code.trim()}>
          {saving ? "Saving…" : code ? "Update" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

export default function DiscountCodesSection({ jwt }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // row | "new" | null

  const refresh = useCallback(async () => {
    if (!jwt) return;
    try {
      const r = await fetch("/api/admin-discount-codes", { headers: { Authorization: `Bearer ${jwt}` } });
      if (r.ok) setCodes(await r.json());
    } catch {}
    setLoading(false);
  }, [jwt]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave(data, isEdit) {
    const url = isEdit ? `/api/admin-discount-codes?id=${editing.id}` : "/api/admin-discount-codes";
    const r = await fetch(url, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    setEditing(null);
    await refresh();
  }

  async function handleDelete(c) {
    if (!confirm(`Delete code "${c.code}"? Past redemptions stay in the ledger.`)) return;
    try {
      const r = await fetch(`/api/admin-discount-codes?id=${c.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) throw new Error();
      await refresh();
    } catch {
      alert("Delete failed");
    }
  }

  async function toggleActive(c) {
    try {
      const r = await fetch(`/api/admin-discount-codes?id=${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      if (!r.ok) throw new Error();
      await refresh();
    } catch {
      alert("Update failed");
    }
  }

  if (loading) return <p className="muted" style={{ fontSize: 13 }}>Loading codes…</p>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="btn primary" style={{ fontSize: 10 }} onClick={() => setEditing("new")}>+ New code</button>
      </div>

      {codes.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, padding: "16px 0" }}>
          No discount codes yet. Create one to run a promo.
        </p>
      ) : (
        <div className="tbl">
          <div className="th">
            <span style={{ flex: 2 }}>Code</span>
            <span style={{ flex: 1 }}>Value</span>
            <span style={{ flex: 1 }}>Scope</span>
            <span style={{ flex: 1 }}>Uses</span>
            <span style={{ flex: 1 }}>Expiry</span>
            <span style={{ flex: 0.8 }} className="text-c">Status</span>
            <span style={{ flex: 1 }} className="text-r">Actions</span>
          </div>
          {codes.map((c) => (
            <div key={c.id} className="tr">
              <span style={{ flex: 2 }}>
                <strong style={{ fontFamily: "var(--font-mono)", letterSpacing: 1 }}>{c.code}</strong>
                {c.description && <><br /><span className="email-sm">{c.description}</span></>}
              </span>
              <span style={{ flex: 1 }}>{formatValue(c)}</span>
              <span style={{ flex: 1 }} className="email-sm">
                {c.scope === "both" ? "Members + guests" : c.scope === "member" ? "Members" : "Guests"}
              </span>
              <span style={{ flex: 1 }} className="tab-num">
                {c.total_uses || 0}{c.usage_limit_total ? ` / ${c.usage_limit_total}` : ""}
              </span>
              <span style={{ flex: 1 }} className="email-sm">{formatExpiry(c)}</span>
              <span style={{ flex: 0.8 }} className="text-c">
                <StatusBadge intent={codeStatusIntent(c)}>{codeStatusLabel(c)}</StatusBadge>
              </span>
              <span style={{ flex: 1 }} className="text-r">
                <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => toggleActive(c)}>
                  {c.is_active ? "Disable" : "Enable"}
                </button>
                <button className="btn" style={{ fontSize: 10, padding: "2px 8px", marginRight: 4 }} onClick={() => setEditing(c)}>Edit</button>
                <button className="btn" style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)" }} onClick={() => handleDelete(c)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <CodeModal
        open={!!editing}
        onClose={() => setEditing(null)}
        code={editing === "new" ? null : editing}
        onSave={handleSave}
      />
    </>
  );
}
