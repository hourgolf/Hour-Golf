import { useState, useEffect, useCallback } from "react";

// Saved shipping addresses — list + add/edit/delete. Rendered on the
// member Account page so members can manage their address book
// outside of checkout. The same component powers a future address-
// picker at checkout; for now it's display-only there.
//
// Max 5 addresses enforced API-side. "Set default" is a single-click
// action that flips is_default on this row and clears it on siblings.

const BLANK = {
  label: "Home",
  name: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  phone: "",
  is_default: false,
};

function formatAddr(a) {
  const line2 = a.street2 ? `, ${a.street2}` : "";
  return `${a.street1}${line2}, ${a.city}, ${a.state} ${a.zip}`;
}

export default function MemberAddressBook({ showToast }) {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // "new" | <id> | null
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/member-addresses");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAddresses(d.addresses || []);
    } catch (e) {
      console.warn("member-addresses load failed:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function startAdd() {
    setForm(BLANK);
    setEditingId("new");
  }

  function startEdit(a) {
    setForm({
      label: a.label || "Home",
      name: a.name || "",
      street1: a.street1 || "",
      street2: a.street2 || "",
      city: a.city || "",
      state: a.state || "",
      zip: a.zip || "",
      country: a.country || "US",
      phone: a.phone || "",
      is_default: !!a.is_default,
    });
    setEditingId(a.id);
  }

  function cancel() {
    setEditingId(null);
    setForm(BLANK);
  }

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.street1 || !form.city || !form.state || !form.zip) {
      showToast?.("Street, city, state, and zip are required", "error");
      return;
    }
    setBusy(true);
    try {
      const isNew = editingId === "new";
      const url = isNew ? "/api/member-addresses" : `/api/member-addresses?id=${encodeURIComponent(editingId)}`;
      const r = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await refresh();
      cancel();
      showToast?.(isNew ? "Address saved" : "Address updated");
    } catch (e) {
      showToast?.(e.message || "Save failed", "error");
    }
    setBusy(false);
  }

  async function setDefault(id) {
    setBusy(true);
    try {
      const r = await fetch(`/api/member-addresses?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      if (!r.ok) throw new Error("Failed to update default");
      await refresh();
    } catch (e) {
      showToast?.(e.message, "error");
    }
    setBusy(false);
  }

  async function remove(a) {
    if (!confirm(`Delete ${a.label || "this address"}?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/member-addresses?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      await refresh();
      showToast?.("Address deleted");
    } catch (e) {
      showToast?.(e.message, "error");
    }
    setBusy(false);
  }

  if (loading) return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading addresses…</div>;

  const inputStyle = {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
    width: "100%",
    background: "var(--surface)",
    color: "var(--text)",
  };

  return (
    <div>
      {addresses.length === 0 && editingId !== "new" && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          No saved addresses yet. Add one for faster checkout.
        </p>
      )}

      {addresses.map((a) => (
        <div key={a.id} style={{ padding: "12px 0", borderBottom: "1px dashed var(--border)" }}>
          {editingId === a.id ? (
            <AddressForm form={form} update={update} save={save} cancel={cancel} busy={busy} inputStyle={inputStyle} />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{a.label}</strong>
                  {a.is_default && (
                    <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", background: "var(--primary)", color: "#EDF3E3", borderRadius: 10, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700 }}>Default</span>
                  )}
                  {a.name && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.name}</div>}
                  <div style={{ fontSize: 13 }}>{formatAddr(a)}</div>
                  {a.phone && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.phone}</div>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!a.is_default && (
                    <button type="button" onClick={() => setDefault(a.id)} disabled={busy} style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--text)" }}>
                      Make default
                    </button>
                  )}
                  <button type="button" onClick={() => startEdit(a)} disabled={busy} style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--text)" }}>
                    Edit
                  </button>
                  <button type="button" onClick={() => remove(a)} disabled={busy} style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--red)" }}>
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {editingId === "new" ? (
        <div style={{ marginTop: 12 }}>
          <AddressForm form={form} update={update} save={save} cancel={cancel} busy={busy} inputStyle={inputStyle} />
        </div>
      ) : (
        addresses.length < 5 && (
          <button
            type="button"
            onClick={startAdd}
            disabled={busy}
            style={{ marginTop: 12, fontSize: 12, padding: "6px 12px", background: "var(--primary)", color: "#EDF3E3", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            + Add address
          </button>
        )
      )}
    </div>
  );
}

function AddressForm({ form, update, save, cancel, busy, inputStyle }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
      <input type="text" placeholder="Label (Home, Work, Mom's)" value={form.label} onChange={(e) => update("label", e.target.value)} style={{ ...inputStyle, gridColumn: "1 / -1" }} />
      <input type="text" placeholder="Recipient name (optional)" value={form.name} onChange={(e) => update("name", e.target.value)} style={{ ...inputStyle, gridColumn: "1 / -1" }} />
      <input type="text" placeholder="Street address" value={form.street1} onChange={(e) => update("street1", e.target.value)} style={{ ...inputStyle, gridColumn: "1 / -1" }} />
      <input type="text" placeholder="Apt, suite (optional)" value={form.street2} onChange={(e) => update("street2", e.target.value)} style={{ ...inputStyle, gridColumn: "1 / -1" }} />
      <input type="text" placeholder="City" value={form.city} onChange={(e) => update("city", e.target.value)} style={inputStyle} />
      <input type="text" placeholder="State" value={form.state} onChange={(e) => update("state", e.target.value)} maxLength={2} style={inputStyle} />
      <input type="text" placeholder="ZIP" value={form.zip} onChange={(e) => update("zip", e.target.value)} style={inputStyle} />
      <input type="text" placeholder="Phone (optional)" value={form.phone} onChange={(e) => update("phone", e.target.value)} style={inputStyle} />
      <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
        <input type="checkbox" checked={!!form.is_default} onChange={(e) => update("is_default", e.target.checked)} />
        Use as default shipping address
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={cancel} disabled={busy} style={{ fontSize: 12, padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", color: "var(--text)" }}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={busy} style={{ fontSize: 12, padding: "6px 12px", background: "var(--primary)", color: "#EDF3E3", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
