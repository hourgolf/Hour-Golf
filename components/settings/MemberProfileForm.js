import { useState, useEffect } from "react";
import { supaPatch } from "../../lib/supabase";

export default function MemberProfileForm({ member, apiKey, onSaved }) {
  const [form, setForm] = useState({
    phone: "", birthday: "", join_date: "", address: "",
    emergency_contact: "", referral_source: "", notes: "", tags: [],
    stripe_customer_id: "",
  });
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Stripe sync state
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeMsg, setStripeMsg] = useState("");
  const [stripeMatches, setStripeMatches] = useState(null); // array or null

  useEffect(() => {
    if (member) {
      setForm({
        phone: member.phone || "",
        birthday: member.birthday || "",
        join_date: member.join_date || "",
        address: member.address || "",
        emergency_contact: member.emergency_contact || "",
        referral_source: member.referral_source || "",
        notes: member.notes || "",
        tags: member.tags || [],
        stripe_customer_id: member.stripe_customer_id || "",
      });
      setDirty(false);
      setStripeMsg("");
      setStripeMatches(null);
    }
  }, [member]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) {
      update("tags", [...form.tags, t]);
    }
    setTagInput("");
  }

  function removeTag(tag) {
    update("tags", form.tags.filter((t) => t !== tag));
  }

  async function handleSave() {
    if (!member) return;
    setSaving(true);
    try {
      await supaPatch(apiKey, "members", { email: member.email }, {
        phone: form.phone || null,
        birthday: form.birthday || null,
        join_date: form.join_date || null,
        address: form.address || null,
        emergency_contact: form.emergency_contact || null,
        referral_source: form.referral_source || null,
        notes: form.notes || null,
        tags: form.tags,
        stripe_customer_id: form.stripe_customer_id || null,
      });
      setDirty(false);
      if (onSaved) onSaved();
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  }

  async function handleStripeResync() {
    if (!member?.email) return;
    setStripeLoading(true);
    setStripeMsg("");
    setStripeMatches(null);
    try {
      const r = await fetch("/api/stripe-lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ email: member.email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail || "Lookup failed");
      if (!d.found || !d.customers?.length) {
        setStripeMsg("No Stripe customer found for this email.");
        return;
      }
      if (d.customers.length === 1) {
        update("stripe_customer_id", d.customers[0].id);
        setStripeMsg(`\u2713 Matched: ${d.customers[0].id}${d.customers[0].has_payment_method ? " (payment method on file)" : " (no payment method)"}`);
      } else {
        setStripeMatches(d.customers);
        setStripeMsg(`Found ${d.customers.length} Stripe customers. Choose one:`);
      }
    } catch (e) {
      setStripeMsg(`Error: ${e.message}`);
    }
    setStripeLoading(false);
  }

  function selectStripeMatch(id) {
    update("stripe_customer_id", id);
    setStripeMatches(null);
    setStripeMsg(`\u2713 Selected: ${id}`);
  }

  if (!member) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 className="section-head">
        <span>Member Profile</span>
        {dirty && (
          <button className="btn primary" style={{ fontSize: 10 }} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        )}
      </h3>
      <div className="tbl" style={{ padding: 16 }}>
        <div className="profile-grid">
          <div className="mf">
            <label>Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="(503) 555-1234" />
          </div>
          <div className="mf">
            <label>Birthday</label>
            <input type="date" value={form.birthday} onChange={(e) => update("birthday", e.target.value)} />
          </div>
          <div className="mf">
            <label>Join Date</label>
            <input type="date" value={form.join_date} onChange={(e) => update("join_date", e.target.value)} />
          </div>
          <div className="mf">
            <label>Referral Source</label>
            <input value={form.referral_source} onChange={(e) => update("referral_source", e.target.value)} placeholder="How they found us" />
          </div>
          <div className="mf full">
            <label>Address</label>
            <input value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="Street, City, State ZIP" />
          </div>
          <div className="mf full">
            <label>Emergency Contact</label>
            <input value={form.emergency_contact} onChange={(e) => update("emergency_contact", e.target.value)} placeholder="Name — Phone" />
          </div>
          <div className="mf full">
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Admin notes..." rows={2} />
          </div>
          <div className="mf full">
            <label>Tags</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="Add tag and press Enter"
                style={{ flex: 1 }}
              />
              <button className="btn primary" style={{ fontSize: 10 }} onClick={addTag} type="button">Add</button>
            </div>
            {form.tags.length > 0 && (
              <div className="tag-list">
                {form.tags.map((t) => (
                  <span key={t} className="tag">{t}<button onClick={() => removeTag(t)}>&times;</button></span>
                ))}
              </div>
            )}
          </div>
          <div className="mf full">
            <label>Stripe Customer ID</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={form.stripe_customer_id}
                onChange={(e) => update("stripe_customer_id", e.target.value)}
                placeholder="cus_..."
                style={{ flex: 1, fontFamily: "var(--font)" }}
              />
              <button
                className="btn"
                type="button"
                style={{ fontSize: 10, whiteSpace: "nowrap" }}
                onClick={handleStripeResync}
                disabled={stripeLoading}
                title="Search Stripe by this member's email and populate the ID"
              >
                {stripeLoading ? "Searching..." : "\u21BB Re-sync from Stripe"}
              </button>
              {form.stripe_customer_id && (
                <button
                  className="btn danger"
                  type="button"
                  style={{ fontSize: 10 }}
                  onClick={() => update("stripe_customer_id", "")}
                  title="Clear Stripe link"
                >
                  Unlink
                </button>
              )}
            </div>
            {stripeMsg && (
              <div style={{ marginTop: 6, fontSize: 11, color: stripeMsg.startsWith("Error") ? "var(--red)" : "var(--text-muted)" }}>
                {stripeMsg}
              </div>
            )}
            {stripeMatches && stripeMatches.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {stripeMatches.map((c) => (
                  <button
                    key={c.id}
                    className="btn"
                    type="button"
                    style={{ fontSize: 11, textAlign: "left", padding: 8 }}
                    onClick={() => selectStripeMatch(c.id)}
                  >
                    <div><strong>{c.id}</strong></div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>
                      {c.name || "(no name)"} &middot; {c.email} &middot; {c.has_payment_method ? "Has payment method" : "No payment method"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
