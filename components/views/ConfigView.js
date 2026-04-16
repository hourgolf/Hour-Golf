import { useState, useEffect } from "react";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";
import Modal from "../ui/Modal";

function TierEditModal({ open, onClose, tier, onSave }) {
  const [form, setForm] = useState({
    tier: "", monthly_fee: 0, included_hours: 0,
    overage_rate: 0, pro_shop_discount: 0, display_order: 0,
    booking_hours_start: 0, booking_hours_end: 24,
  });
  const [saving, setSaving] = useState(false);
  const [unlimited, setUnlimited] = useState(false);
  const isNew = !tier;

  useEffect(() => {
    if (tier) {
      setForm({
        tier: tier.tier,
        monthly_fee: Number(tier.monthly_fee),
        included_hours: Number(tier.included_hours),
        overage_rate: Number(tier.overage_rate),
        pro_shop_discount: Number(tier.pro_shop_discount),
        display_order: Number(tier.display_order || 0),
        booking_hours_start: Number(tier.booking_hours_start ?? 0),
        booking_hours_end: Number(tier.booking_hours_end ?? 24),
      });
      setUnlimited(Number(tier.included_hours) >= 99999);
    } else {
      setForm({ tier: "", monthly_fee: 0, included_hours: 0, overage_rate: 0, pro_shop_discount: 0, display_order: 99, booking_hours_start: 0, booking_hours_end: 24 });
      setUnlimited(false);
    }
  }, [tier]);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.tier.trim()) return;
    setSaving(true);
    await onSave({
      ...form,
      tier: form.tier.trim(),
      included_hours: unlimited ? 99999 : Number(form.included_hours),
      monthly_fee: Number(form.monthly_fee),
      overage_rate: Number(form.overage_rate),
      pro_shop_discount: Number(form.pro_shop_discount),
      display_order: Number(form.display_order),
      booking_hours_start: Number(form.booking_hours_start),
      booking_hours_end: Number(form.booking_hours_end),
    }, isNew);
    setSaving(false);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <h2>{isNew ? "Add Tier" : "Edit Tier"}</h2>
      <div className="mf">
        <label>Tier Name</label>
        <input
          value={form.tier}
          onChange={(e) => update("tier", e.target.value)}
          placeholder="e.g. Gold"
          disabled={!isNew}
          style={!isNew ? { opacity: 0.6 } : {}}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="mf">
          <label>Monthly Fee ($)</label>
          <input type="number" min={0} value={form.monthly_fee} onChange={(e) => update("monthly_fee", e.target.value)} />
        </div>
        <div className="mf">
          <label>Included Hours</label>
          <input
            type="number" min={0} value={unlimited ? "" : form.included_hours}
            disabled={unlimited}
            onChange={(e) => update("included_hours", e.target.value)}
            placeholder={unlimited ? "Unlimited" : "0"}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, cursor: "pointer", textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--text)" }}>
            <input type="checkbox" className="chk" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} style={{ width: 14, height: 14 }} />
            Unlimited
          </label>
        </div>
        <div className="mf">
          <label>Overage Rate ($/hr)</label>
          <input type="number" min={0} step={0.01} value={form.overage_rate} onChange={(e) => update("overage_rate", e.target.value)} />
        </div>
        <div className="mf">
          <label>Pro Shop Discount (%)</label>
          <input type="number" min={0} max={100} value={form.pro_shop_discount} onChange={(e) => update("pro_shop_discount", e.target.value)} />
        </div>
        <div className="mf">
          <label>Display Order</label>
          <input type="number" min={0} value={form.display_order} onChange={(e) => update("display_order", e.target.value)} />
        </div>
        <div className="mf">
          <label>Booking Window Start</label>
          <select value={form.booking_hours_start} onChange={(e) => update("booking_hours_start", Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`}</option>
            ))}
          </select>
        </div>
        <div className="mf">
          <label>Booking Window End</label>
          <select value={form.booking_hours_end} onChange={(e) => update("booking_hours_end", Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{h === 24 ? "12:00 AM (next day)" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="macts">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving || !form.tier.trim()}>
          {saving ? "..." : isNew ? "Add Tier" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function EmailConfigSection({ jwt }) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => { loadConfigs(); }, []);

  async function loadConfigs() {
    setLoading(true);
    try {
      const SUPABASE_URL = "https://uxpkqbioxoezjmcoylkw.supabase.co";
      const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
      const r = await fetch(`${SUPABASE_URL}/rest/v1/email_config?order=template_key.asc`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt || ANON_KEY}` },
      });
      if (r.ok) setConfigs(await r.json());
    } catch (_) {}
    setLoading(false);
  }

  async function updateConfig(id, field, value) {
    setSaving(id);
    try {
      const SUPABASE_URL = "https://uxpkqbioxoezjmcoylkw.supabase.co";
      const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
      await fetch(`${SUPABASE_URL}/rest/v1/email_config?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          apikey: ANON_KEY, Authorization: `Bearer ${jwt || ANON_KEY}`,
          "Content-Type": "application/json", Prefer: "return=representation",
        },
        body: JSON.stringify({ [field]: value, updated_at: new Date().toISOString() }),
      });
      setConfigs((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c));
    } catch (_) {}
    setSaving(null);
  }

  if (loading) return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading email config...</div>;

  return (
    <div className="tbl">
      <div className="th">
        <span style={{ flex: 2 }}>Email Type</span>
        <span style={{ flex: 3 }}>Resend Template ID</span>
        <span style={{ flex: 1, textAlign: "center" }}>Active</span>
      </div>
      {configs.map((c) => (
        <div key={c.id} className="tr" style={{ alignItems: "center" }}>
          <span style={{ flex: 2, textTransform: "capitalize" }}>
            {c.template_key.replace(/_/g, " ")}
          </span>
          <span style={{ flex: 3 }}>
            <input
              style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)", boxSizing: "border-box" }}
              value={c.resend_template_id || ""}
              placeholder="Paste Resend template ID (optional)"
              onChange={(e) => {
                setConfigs((prev) => prev.map((x) => x.id === c.id ? { ...x, resend_template_id: e.target.value } : x));
              }}
              onBlur={(e) => updateConfig(c.id, "resend_template_id", e.target.value)}
            />
          </span>
          <span style={{ flex: 1, textAlign: "center" }}>
            <input
              type="checkbox"
              className="chk"
              checked={c.is_active}
              onChange={(e) => updateConfig(c.id, "is_active", e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
          </span>
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, padding: "0 4px" }}>
        Design email templates in your <a href="https://resend.com/emails" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>Resend dashboard</a>, then paste the template ID here. If no template ID is set, a default branded email will be used.
      </p>
    </div>
  );
}

const RULE_LABELS = {
  hours: { label: "Booking Hours", unit: "hours", icon: "\u23F0" },
  bookings: { label: "Booking Count", unit: "bookings", icon: "\ud83d\udcc5" },
  shop_spend: { label: "Pro Shop Spend", unit: "spent", icon: "\ud83d\uded2" },
};

function LoyaltyRuleCard({ rule, onUpdate, saving }) {
  const meta = RULE_LABELS[rule.rule_type] || { label: rule.rule_type, unit: "", icon: "" };
  const [localThreshold, setLocalThreshold] = useState(rule.threshold);
  const [localReward, setLocalReward] = useState(rule.reward);

  useEffect(() => { setLocalThreshold(rule.threshold); }, [rule.threshold]);
  useEffect(() => { setLocalReward(rule.reward); }, [rule.reward]);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{meta.icon}</span>
          <strong style={{ fontSize: 14 }}>{meta.label}</strong>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <div
            onClick={() => onUpdate(rule.id, "enabled", !rule.enabled)}
            className={`mem-toggle-switch ${rule.enabled ? "on" : ""}`}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", opacity: rule.enabled ? 1 : 0.5 }}>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Every</label>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="number" min={1} step={1}
              value={localThreshold}
              onChange={(e) => setLocalThreshold(e.target.value)}
              onBlur={() => { const v = Number(localThreshold); if (v > 0 && v !== rule.threshold) onUpdate(rule.id, "threshold", v); }}
              disabled={saving === rule.id}
              style={{ width: 80, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{meta.unit}</span>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Earn</label>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>$</span>
            <input
              type="number" min={1} step={1}
              value={localReward}
              onChange={(e) => setLocalReward(e.target.value)}
              onBlur={() => { const v = Number(localReward); if (v > 0 && v !== rule.reward) onUpdate(rule.id, "reward", v); }}
              disabled={saving === rule.id}
              style={{ width: 70, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13, background: "var(--surface)", color: "var(--text)" }}
            />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>credit</span>
          </div>
        </div>
      </div>
      {rule.enabled && (
        <p style={{ fontSize: 11, color: "var(--primary)", marginTop: 8, marginBottom: 0 }}>
          Members earn ${rule.reward} for every {rule.threshold} {meta.unit}
        </p>
      )}
    </div>
  );
}

function LoyaltySection({ jwt }) {
  const [rules, setRules] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);

  useEffect(() => { loadLoyalty(); }, []);

  async function loadLoyalty() {
    try {
      const r = await fetch("/api/admin-loyalty", { headers: { Authorization: `Bearer ${jwt}` } });
      if (r.ok) {
        const data = await r.json();
        setRules(data.rules || []);
        setLedger(data.ledger || []);
      }
    } catch {}
    setLoading(false);
  }

  async function updateRule(id, field, value) {
    setSaving(id);
    try {
      await fetch(`/api/admin-loyalty?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ [field]: value }),
      });
      await loadLoyalty();
    } catch {}
    setSaving(null);
  }

  async function processMonth() {
    setProcessing(true);
    setProcessResult(null);
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    try {
      const r = await fetch("/api/admin-loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ month }),
      });
      const data = await r.json();
      setProcessResult(data);
      await loadLoyalty();
    } catch (e) {
      setProcessResult({ error: e.message });
    }
    setProcessing(false);
  }

  if (loading) return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading loyalty config...</div>;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        {rules.map((rule) => (
          <LoyaltyRuleCard key={rule.id} rule={rule} onUpdate={updateRule} saving={saving} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="btn primary" onClick={processMonth} disabled={processing} style={{ fontSize: 11 }}>
          {processing ? "Processing..." : "Process Current Month"}
        </button>
        {processResult && !processResult.error && (
          <span style={{ fontSize: 12, color: "var(--primary)" }}>
            ${processResult.credits_issued} issued to {processResult.members_affected} member{processResult.members_affected !== 1 ? "s" : ""}
          </span>
        )}
        {processResult?.error && (
          <span style={{ fontSize: 12, color: "var(--red)" }}>{processResult.error}</span>
        )}
      </div>

      {ledger.filter((l) => l.reward_issued > 0).length > 0 && (
        <>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 6 }}>Recent Rewards</div>
          <div className="tbl" style={{ marginBottom: 0 }}>
            <div className="th">
              <span style={{ flex: 2 }}>Member</span>
              <span style={{ flex: 1 }}>Rule</span>
              <span style={{ flex: 1 }} className="text-r">Progress</span>
              <span style={{ flex: 1 }} className="text-r">Reward</span>
              <span style={{ flex: 1 }} className="text-r">Period</span>
            </div>
            {ledger.filter((l) => l.reward_issued > 0).slice(0, 20).map((l) => (
              <div key={l.id} className="tr">
                <span style={{ flex: 2 }} className="email-sm">{l.member_email}</span>
                <span style={{ flex: 1 }}>{(RULE_LABELS[l.rule_type] || {}).label || l.rule_type}</span>
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {l.rule_type === "shop_spend" ? `$${Number(l.progress).toFixed(0)}` : l.rule_type === "hours" ? `${Number(l.progress).toFixed(1)}h` : l.progress}
                </span>
                <span style={{ flex: 1 }} className="text-r tab-num" style={{ color: "var(--primary)", fontWeight: 600 }}>${Number(l.reward_issued).toFixed(0)}</span>
                <span style={{ flex: 1 }} className="text-r email-sm">{l.period}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function ConfigView({ tierCfg, members, onUpdateTier, onLinkStripe, onSaveTier, onSelectMember, jwt }) {
  const [linking, setLinking] = useState(null);
  const [editTier, setEditTier] = useState(null);
  const [addTier, setAddTier] = useState(false);

  async function handleLink(email, name) {
    setLinking(email);
    await onLinkStripe(email, name);
    setLinking(null);
  }

  async function handleSaveTier(data, isNew) {
    await onSaveTier(data, isNew);
    setEditTier(null);
    setAddTier(false);
  }

  return (
    <div className="content">
      <h2 className="section-head">
        <span>Tier Configuration</span>
        <button className="btn primary" style={{ fontSize: 10 }} onClick={() => setAddTier(true)}>+ Add Tier</button>
      </h2>
      <div className="tbl">
        <div className="th">
          <span style={{ flex: 2 }}>Tier</span>
          <span style={{ flex: 1 }} className="text-r">Monthly</span>
          <span style={{ flex: 1 }} className="text-r">Included</span>
          <span style={{ flex: 1 }} className="text-r">Overage</span>
          <span style={{ flex: 1 }} className="text-r">Pro Shop</span>
          <span style={{ flex: 1 }} className="text-r">Actions</span>
        </div>
        {tierCfg.map((tc) => (
          <div key={tc.tier} className="tr">
            <span style={{ flex: 2 }}><Badge tier={tc.tier} /></span>
            <span style={{ flex: 1 }} className="text-r tab-num">${Number(tc.monthly_fee).toFixed(0)}/mo</span>
            <span style={{ flex: 1 }} className="text-r tab-num">
              {Number(tc.included_hours) >= 99999 ? "Unlimited" : Number(tc.included_hours) + "h"}
            </span>
            <span style={{ flex: 1 }} className="text-r tab-num">${Number(tc.overage_rate)}/hr</span>
            <span style={{ flex: 1 }} className="text-r tab-num">{tc.pro_shop_discount}% off</span>
            <span style={{ flex: 1 }} className="text-r">
              <button className="btn" style={{ fontSize: 10 }} onClick={() => setEditTier(tc)}>Edit</button>
            </span>
          </div>
        ))}
      </div>

      <h2 className="section-head" style={{ marginTop: 24 }}>Loyalty Rewards</h2>
      <LoyaltySection jwt={jwt} />

      <h2 className="section-head" style={{ marginTop: 24 }}>Members ({members.length})</h2>
      {/* Desktop table */}
      <div className="tbl usage-desktop">
        <div className="th">
          <span style={{ flex: 2 }}>Member</span>
          <span style={{ flex: 1 }}>Tier</span>
          <span style={{ flex: 1 }} className="text-r">Rate</span>
          <span style={{ flex: 1 }}>Stripe</span>
        </div>
        {members.map((m) => (
          <div key={m.email} className="tr">
            <span style={{ flex: 2, cursor: "pointer" }} onClick={() => onSelectMember(m.email)}>
              <strong>{m.name}</strong>
              {m.member_number && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                  #{String(m.member_number).padStart(3, "0")}
                </span>
              )}
              <br />
              <span className="email-sm">{m.email}</span>
            </span>
            <span style={{ flex: 1 }}>
              <TierSelect value={m.tier} onChange={(t) => onUpdateTier(m.email, t, m.name)} />
            </span>
            <span style={{ flex: 1 }} className="text-r tab-num">
              {m.monthly_rate ? `$${Number(m.monthly_rate).toFixed(0)}` : "\u2014"}
            </span>
            <span style={{ flex: 1 }}>
              {m.stripe_customer_id ? (
                <span className="email-sm" title={m.stripe_customer_id}>
                  {m.stripe_customer_id.slice(0, 14)}&hellip;
                </span>
              ) : (
                <button
                  className="btn primary"
                  style={{ fontSize: 10 }}
                  onClick={() => handleLink(m.email, m.name)}
                  disabled={linking === m.email}
                >
                  {linking === m.email ? "\u2026" : "Link"}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile cards */}
      <div className="usage-mobile">
        {members.map((m) => (
          <div key={m.email} className="usage-card" onClick={() => onSelectMember(m.email)}>
            <div className="usage-card-top">
              <div>
                <strong>{m.name}</strong>
                {m.member_number && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "var(--primary)", marginLeft: 6, letterSpacing: 0.5 }}>
                    #{String(m.member_number).padStart(3, "0")}
                  </span>
                )}
              </div>
              <Badge tier={m.tier} />
            </div>
            <div className="usage-card-stats" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {m.monthly_rate ? (
                  <span className="tab-num" style={{ fontSize: 13, color: "var(--text-muted)" }}>${Number(m.monthly_rate).toFixed(0)}/mo</span>
                ) : null}
                {!m.stripe_customer_id && (
                  <button
                    className="btn primary"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                    onClick={(e) => { e.stopPropagation(); handleLink(m.email, m.name); }}
                    disabled={linking === m.email}
                  >
                    {linking === m.email ? "\u2026" : "Link Stripe"}
                  </button>
                )}
              </div>
              <div className="usage-card-stat" onClick={(e) => e.stopPropagation()}>
                <TierSelect value={m.tier} onChange={(t) => onUpdateTier(m.email, t, m.name)} />
                <span className="usage-card-lbl">Assign</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-head" style={{ marginTop: 24 }}>Email Settings</h2>
      <EmailConfigSection jwt={jwt} />

      <TierEditModal
        open={!!editTier || addTier}
        onClose={() => { setEditTier(null); setAddTier(false); }}
        tier={editTier}
        onSave={handleSaveTier}
      />
    </div>
  );
}
