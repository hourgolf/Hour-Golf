import { useState, useEffect } from "react";
import Badge from "../ui/Badge";
import TierSelect from "../ui/TierSelect";
import Modal from "../ui/Modal";
import TenantBranding from "../settings/TenantBranding";
import DiscountCodesSection from "../settings/DiscountCodesSection";

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

// Catalog of every transactional email the platform sends. Source of
// truth: lib/email.js (templates) + lib/email-layout.js (visual
// wrapper). This is purely informational — templates are intentionally
// locked in code so they stay in lockstep with the data they reference
// (booking ids, tier configs, Stripe state, etc.). What CAN be
// customized is in the right-hand "Customize" column.
const TRANSACTIONAL_EMAILS = [
  {
    key: "booking_confirmation",
    label: "Booking confirmation",
    trigger: "Member books a bay (or a non-member books via the public flow).",
    recipient: "The booking customer.",
    customize: "Logo + colors via Settings → Branding. Sender + footer via Settings → Tenant Email. Cancel-cutoff copy follows the tenant's policy field.",
    preview: "booking-confirmation",
  },
  {
    key: "booking_cancellation",
    label: "Booking cancelled",
    trigger: "Member cancels a booking from their dashboard, or admin cancels.",
    recipient: "The booking customer.",
    customize: "Same wrapper as above. Rebook CTA button.",
    preview: "booking-cancellation",
  },
  {
    key: "access_code",
    label: "Access code (door code)",
    trigger: "Cron job ~10 min before each Confirmed booking when the access_codes feature is enabled and Seam is configured. Code itself is rendered live on the dashboard hero too.",
    recipient: "The booking customer.",
    customize: "Big-code block uses the tenant primary color. The send itself currently runs from a Supabase Edge Function; keep its inline HTML in sync with the Node-side template after design updates (see docs/EMAIL_TEMPLATE_HANDOFF.md).",
    preview: "access-code",
  },
  {
    key: "welcome",
    label: "Welcome (new membership)",
    trigger: "Stripe webhook checkout.session.completed in subscription mode.",
    recipient: "The new member.",
    customize: "Tier name + monthly fee + included hours pulled from tier_config. CTA button lands on the member portal.",
    preview: "welcome",
  },
  {
    key: "payment_receipt",
    label: "Payment receipt",
    trigger: "Stripe webhook invoice.paid (recurring + first payments).",
    recipient: "The paying member.",
    customize: "Amount, description, date pulled from the Stripe invoice. CTA button → /members/billing.",
    preview: "payment-receipt",
  },
  {
    key: "payment_failed",
    label: "Payment failed (card declined)",
    trigger: "Stripe webhook invoice.payment_failed on attempt #1.",
    recipient: "The paying member.",
    customize: "Amount + membership label from the invoice. CTA button → /members/billing to update card.",
    preview: "payment-failed",
  },
  {
    key: "password_reset",
    label: "Password reset",
    trigger: "Member taps Forgot Password on /members.",
    recipient: "The member email on file.",
    customize: "Reset URL is single-use and expires in 1 hour.",
    preview: "password-reset",
  },
  {
    key: "launch",
    label: "Launch announcement",
    trigger: "Admin runs the Launch Announcement broadcast above.",
    recipient: "Every paying member not yet emailed.",
    customize: "Copy + CTA live in lib/email.js sendLaunchEmail.",
    preview: "launch",
  },
  {
    key: "shop_order",
    label: "Pro Shop order (admin notification)",
    trigger: "Member completes an in-app shop checkout via Stripe.",
    recipient: "The tenant's notification inbox (Settings → Tenant Email).",
    customize: "Item rows + totals + member discount from the order. No customer-facing receipt — Stripe sends its own.",
    preview: "shop-order-notification",
  },
  {
    key: "shop_request_admin",
    label: "Pro Shop request (admin notification)",
    trigger: "Member submits a 'request an item' form on the Pro Shop.",
    recipient: "The tenant's notification inbox.",
    customize: "Request fields shown verbatim. Member contact info attached.",
    preview: "shop-request-admin",
  },
  {
    key: "shop_request_ready",
    label: "Pro Shop request ready (member notification)",
    trigger: "Admin marks a shop request as in-stock from the Pro Shop Requests panel above.",
    recipient: "The requesting member.",
    customize: "Optional admin response gets surfaced in the body.",
    preview: "shop-request-ready",
  },
  {
    key: "shipment_delivered",
    label: "Shipment delivered",
    trigger: "Shippo webhook reports a tracked order moved to delivered.",
    recipient: "The order's customer.",
    customize: "Tracking number + carrier + service rendered live; CTA → /members/shop.",
    preview: "shipment-delivered",
  },
];

// Launch-broadcast section — fires the one-off "The app is here" email
// to every paying member who hasn't received it yet. Idempotent on the
// server (filters by launch_email_sent_at IS NULL), so the button can
// be clicked again safely after onboarding new members.
function LaunchBroadcastSection({ jwt, members }) {
  const [dryRunInfo, setDryRunInfo] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Quick local stats for the card: "X of Y paying members already got
  // the email". Keeps the admin oriented without a preflight round-trip.
  const payingMembers = (members || []).filter(
    (m) => m?.tier && m.tier !== "Non-Member"
  );
  const alreadySent = payingMembers.filter((m) => !!m.launch_email_sent_at).length;
  const remaining = payingMembers.length - alreadySent;
  // CTA target for the launch email. Landing on /members gets members
  // one tap from sign-in — fewer steps than the /app install explainer
  // which is still reachable directly for anyone who wants the
  // Add-to-Home-Screen walkthrough.
  const signInLink = typeof window !== "undefined" ? `${window.location.origin}/members` : "/members";
  const installLink = typeof window !== "undefined" ? `${window.location.origin}/app` : "/app";

  async function runDryRun() {
    setDryRunInfo(null);
    setResult(null);
    try {
      const r = await fetch("/api/admin-broadcast-launch?dryRun=1", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Preview failed");
      setDryRunInfo(d);
    } catch (e) {
      setResult({ error: e.message });
    }
  }

  async function runTest() {
    setTestResult(null);
    setTesting(true);
    try {
      // `to` is optional — blank sends to the admin's own email. Trim
      // so "  me@x.com " doesn't get encoded with stray whitespace.
      const addr = (testEmail || "").trim();
      const qs = addr ? `?preview=1&to=${encodeURIComponent(addr)}` : "?preview=1";
      const r = await fetch(`/api/admin-broadcast-launch${qs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Test send failed");
      setTestResult({ ok: true, to: d.to, skipped: d.skipped });
    } catch (e) {
      setTestResult({ error: e.message });
    }
    setTesting(false);
  }

  async function runSend() {
    if (!confirm(`Send the launch email to ${dryRunInfo?.wouldSend ?? remaining} members now? This can't be un-sent.`)) return;
    setSending(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin-broadcast-launch", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Send failed");
      setResult(d);
      setDryRunInfo(null);
    } catch (e) {
      setResult({ error: e.message });
    }
    setSending(false);
  }

  return (
    <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
      <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 8px" }}>
        One-off email to every paying member pointing them at the install explainer page.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
        Idempotent — clicking Send again only emails members who haven't received it yet (new signups after your first broadcast, missed recipients from the previous run).
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "12px 14px", borderRadius: 10, background: "var(--bg, #EDF3E3)", marginBottom: 14 }}>
        <Stat val={payingMembers.length} lbl="Paying members" />
        <Stat val={alreadySent} lbl="Already received" />
        <Stat val={remaining} lbl="Will receive" />
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        CTA link in the email: <code style={{ background: "var(--bg, #EDF3E3)", padding: "2px 6px", borderRadius: 4 }}>{signInLink}</code> — drops members straight on the sign-in page. Physical QR codes can still point at <code style={{ background: "var(--bg, #EDF3E3)", padding: "2px 6px", borderRadius: 4 }}>{installLink}</code> for the Add-to-Home-Screen walkthrough.
      </div>

      {/* Preview-to-inbox: send one copy of the exact email to the admin
          (or any address), so you can eyeball it in a real mail client
          before broadcasting. Doesn't touch launch_email_sent_at — test
          sends are invisible to the broadcast idempotency tracking. */}
      <div style={{ padding: "12px 14px", border: "1px dashed var(--border)", borderRadius: 10, marginBottom: 14, background: "var(--surface)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>See it in an inbox first</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Sends one copy of the exact email to any address so you can review the wording + layout in a real mail client. Doesn't affect the broadcast count.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="email"
            placeholder="Leave blank to send to your admin email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !testing) runTest(); }}
            style={{ flex: 1, minWidth: 220, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, fontFamily: "inherit" }}
          />
          <button
            type="button"
            className="btn"
            onClick={runTest}
            disabled={testing}
          >
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
        {testResult?.ok && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--primary)" }}>
            ✓ Sent to <strong>{testResult.to}</strong>. Check your inbox in ~30s.
          </div>
        )}
        {testResult?.skipped && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            Skipped: {testResult.reason || "unknown"}. Verify Resend is configured for this tenant.
          </div>
        )}
        {testResult?.error && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger, #C92F1F)" }}>
            {testResult.error}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={runDryRun}
          disabled={sending}
        >
          Preview recipients
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={runSend}
          disabled={sending || remaining === 0}
          style={{ opacity: remaining === 0 ? 0.5 : 1 }}
        >
          {sending ? "Sending…" : remaining === 0 ? "No one to send to" : `Send launch email (${remaining})`}
        </button>
      </div>

      {dryRunInfo && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg, #EDF3E3)", borderRadius: 10, fontSize: 12 }}>
          <strong>{dryRunInfo.wouldSend} members</strong> would receive the email now.
          {dryRunInfo.skippedOptOut > 0 && <> {dryRunInfo.skippedOptOut} skipped (opted out of billing emails).</>}
          {dryRunInfo.sample?.length > 0 && (
            <div style={{ marginTop: 6, opacity: 0.75 }}>First few: {dryRunInfo.sample.map((s) => s.name || s.email).join(", ")}{dryRunInfo.wouldSend > dryRunInfo.sample.length ? "…" : ""}</div>
          )}
        </div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg, #EDF3E3)", borderRadius: 10, fontSize: 13, color: "var(--primary)" }}>
          <strong>✓ Sent to {result.sent} of {result.total}.</strong>
          {result.failed > 0 && (
            <>
              <span style={{ color: "var(--danger, #C92F1F)" }}> {result.failed} failed.</span>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text)" }}>
                {result.failures?.length > 0 ? (
                  <details>
                    <summary style={{ cursor: "pointer", color: "var(--danger, #C92F1F)", fontWeight: 600 }}>
                      Show failed recipients
                    </summary>
                    <ul style={{ margin: "6px 0 0 18px", padding: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>
                      {result.failures.map((f, i) => (
                        <li key={`${f.email}-${i}`} style={{ marginBottom: 2 }}>
                          <strong>{f.email}</strong> — <span style={{ color: "var(--text-muted)" }}>{f.reason || "unknown"}</span>
                        </li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                      These members were NOT marked as sent — clicking Send again will retry them.
                      Full server logs: Vercel dashboard → Logs → <code>/api/admin-broadcast-launch</code>.
                    </div>
                  </details>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    See Vercel dashboard → Logs → <code>/api/admin-broadcast-launch</code> for details. Clicking Send again will retry these members.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {result?.error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg, #EDF3E3)", borderRadius: 10, fontSize: 13, color: "var(--danger, #C92F1F)" }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

function Stat({ val, lbl }) {
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display, inherit)", lineHeight: 1.1 }}>{val}</div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)" }}>{lbl}</div>
    </div>
  );
}

// --- Skedda → new-portal cutover broadcasts --------------------------
// Three-phase transition comms. Admin picks a cutover date, the three
// phase rows show progress + let the operator fire each at the right
// moment. See docs/SKEDDA_CUTOVER_PLAN.md for timing recommendations.
// Idempotent per-phase (each row writes its own cutover_*_sent_at
// column; re-clicks pick up stragglers without duplicating sends).
const CUTOVER_PHASES = [
  {
    key: "announcement",
    label: "Announcement (T−14)",
    column: "cutover_announcement_sent_at",
    previewSlug: "cutover-announcement",
    needsDate: true,
    targetDescription: "All paying members not yet emailed.",
    recommendedDay: "2 weeks before cutover",
  },
  {
    key: "reminder",
    label: "T−3 reminder",
    column: "cutover_reminder_sent_at",
    previewSlug: "cutover-reminder",
    needsDate: true,
    targetDescription: "Paying members who still haven't logged in (first_app_login_at IS NULL).",
    recommendedDay: "3 days before cutover",
  },
  {
    key: "complete",
    label: "Post-cutover (day of)",
    column: "cutover_complete_sent_at",
    previewSlug: "cutover-complete-member",
    needsDate: false,
    targetDescription: "All paying members. Renders a different variant for members already on the app vs not-yet.",
    recommendedDay: "Morning of cutover, after Skedda/Zapier are turned off",
  },
];

function CutoverBroadcastSection({ jwt, members }) {
  // Default cutover date: 14 days out, Monday. Operator can override.
  const defaultDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    // Roll forward to the next Monday so the default isn't a weekend.
    const day = d.getDay();
    if (day !== 1) d.setDate(d.getDate() + ((8 - day) % 7 || 7));
    return d.toISOString().slice(0, 10);
  })();
  const [cutoverDate, setCutoverDate] = useState(defaultDate);
  const [busy, setBusy] = useState({}); // { [phase]: bool }
  const [result, setResult] = useState({}); // { [phase]: { kind, data } }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const payingMembers = (members || []).filter(
    (m) => m?.tier && m.tier !== "Non-Member"
  );

  async function fire(phaseKey, options = {}) {
    const p = CUTOVER_PHASES.find((x) => x.key === phaseKey);
    if (!p) return;
    if (p.needsDate && !cutoverDate) {
      setResult((r) => ({ ...r, [phaseKey]: { kind: "error", data: { error: "Pick a cutover date first." } } }));
      return;
    }
    setBusy((b) => ({ ...b, [phaseKey]: true }));
    setResult((r) => ({ ...r, [phaseKey]: null }));
    const params = new URLSearchParams();
    params.set("phase", phaseKey);
    if (p.needsDate) params.set("date", cutoverDate);
    if (options.dryRun) params.set("dryRun", "1");
    if (options.preview) {
      params.set("preview", "1");
      if (options.to) params.set("to", options.to);
    }
    try {
      const r = await fetch(`/api/admin-broadcast-cutover?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Broadcast failed");
      const kind = options.dryRun ? "dryrun" : options.preview ? "preview" : "sent";
      setResult((x) => ({ ...x, [phaseKey]: { kind, data: d } }));
    } catch (e) {
      setResult((x) => ({ ...x, [phaseKey]: { kind: "error", data: { error: e.message } } }));
    }
    setBusy((b) => ({ ...b, [phaseKey]: false }));
  }

  async function confirmAndSend(phaseKey, remaining) {
    const p = CUTOVER_PHASES.find((x) => x.key === phaseKey);
    if (!window.confirm(
      `Send "${p.label}" to ${remaining} member${remaining === 1 ? "" : "s"} now?\n\nThis can't be un-sent.${p.needsDate ? `\n\nCutover date: ${cutoverDate}` : ""}`
    )) return;
    fire(phaseKey);
  }

  return (
    <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
      <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 6px" }}>
        Retire Skedda on a specific date. Each phase below fires a different email — announcement, reminder, post-cutover — and tracks its own progress so re-clicking picks up stragglers without duplicating sends.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
        Copy + full procedure lives in <code>docs/SKEDDA_CUTOVER_PLAN.md</code>. Preview any phase in the table below before broadcasting.
      </p>

      <div style={{ padding: "12px 14px", background: "var(--bg, #EDF3E3)", borderRadius: 10, marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text)" }}>
          Cutover date
        </label>
        <input
          type="date"
          value={cutoverDate}
          onChange={(e) => setCutoverDate(e.target.value)}
          min={new Date().toISOString().slice(0, 10)}
          style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, fontFamily: "inherit", background: "var(--surface)", color: "var(--text)" }}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Templated into the announcement + reminder copy. Pick a Monday for the smoothest first-day ops.
        </span>
      </div>

      {CUTOVER_PHASES.map((p) => {
        const remaining = payingMembers.filter((m) => {
          if (m?.[p.column]) return false;
          // Reminder-only filter: members who've never logged in.
          if (p.key === "reminder" && m?.first_app_login_at) return false;
          return true;
        }).length;
        const alreadySent = payingMembers.filter((m) => !!m?.[p.column]).length;
        const phaseResult = result[p.key];
        const isBusy = !!busy[p.key];

        return (
          <div
            key={p.key}
            style={{
              padding: "14px 16px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg, #EDF3E3)",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
              <strong style={{ fontSize: 14, fontFamily: "var(--font-display, inherit)" }}>{p.label}</strong>
              <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                {p.recommendedDay}
              </span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {p.targetDescription}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12, marginBottom: 10 }}>
              <Stat val={alreadySent} lbl="Already sent" />
              <Stat val={remaining} lbl="Will receive" />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <a
                href={`${origin}/api/email-preview/${p.previewSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                Preview →
              </a>
              <button
                type="button"
                className="btn"
                onClick={() => fire(p.key, { preview: true })}
                disabled={isBusy}
              >
                Send test to me
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => fire(p.key, { dryRun: true })}
                disabled={isBusy}
              >
                Preview recipients
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => confirmAndSend(p.key, remaining)}
                disabled={isBusy || remaining === 0}
                style={{ opacity: remaining === 0 ? 0.5 : 1 }}
              >
                {isBusy ? "Sending…" : remaining === 0 ? "No one to send to" : `Send to ${remaining}`}
              </button>
            </div>
            {phaseResult && (
              <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--surface)", borderRadius: 8, fontSize: 12, border: "1px solid var(--border)" }}>
                {phaseResult.kind === "error" && (
                  <span style={{ color: "var(--danger, #C92F1F)" }}>✗ {phaseResult.data.error}</span>
                )}
                {phaseResult.kind === "dryrun" && (
                  <span>
                    <strong>{phaseResult.data.wouldSend} members</strong> would receive now.
                    {phaseResult.data.skippedOptOut > 0 && <> {phaseResult.data.skippedOptOut} skipped (opted out).</>}
                    {phaseResult.data.sample?.length > 0 && (
                      <div style={{ marginTop: 4, opacity: 0.75 }}>First few: {phaseResult.data.sample.map((s) => s.name || s.email).join(", ")}{phaseResult.data.wouldSend > phaseResult.data.sample.length ? "…" : ""}</div>
                    )}
                  </span>
                )}
                {phaseResult.kind === "preview" && (
                  <span style={{ color: "var(--primary)" }}>
                    ✓ Sent test to <strong>{phaseResult.data.to}</strong>. Check your inbox.
                  </span>
                )}
                {phaseResult.kind === "sent" && (
                  <>
                    <span style={{ color: "var(--primary)" }}>
                      <strong>✓ Sent to {phaseResult.data.sent} of {phaseResult.data.total}.</strong>
                      {phaseResult.data.failed > 0 && <span style={{ color: "var(--danger, #C92F1F)" }}> {phaseResult.data.failed} failed.</span>}
                    </span>
                    {phaseResult.data.failed > 0 && phaseResult.data.failures?.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer", color: "var(--danger, #C92F1F)", fontWeight: 600, fontSize: 11 }}>
                          Show failed recipients
                        </summary>
                        <ul style={{ margin: "6px 0 0 18px", padding: 0, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {phaseResult.data.failures.map((f, i) => (
                            <li key={`${f.email}-${i}`} style={{ marginBottom: 2 }}>
                              <strong>{f.email}</strong> — <span style={{ color: "var(--text-muted)" }}>{f.reason || "unknown"}</span>
                            </li>
                          ))}
                        </ul>
                        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                          Not marked as sent. Clicking Send again will retry these.
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmailConfigSection({ jwt }) {
  // Base origin for preview links. Build on the client so each admin's
  // active tenant subdomain gets used (previews are tenant-branded via
  // the subdomain middleware resolution — same way any other public
  // page is). Safe to share with a designer via Slack/Email.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
      <p style={{ fontSize: 13, color: "var(--text)", margin: "0 0 6px" }}>
        Every transactional email the platform sends, with what triggers it, and a preview you can open or share.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>
        Template HTML lives in <code>lib/email.js</code> and shares a branded wrapper from <code>lib/email-layout.js</code>. Logo + colors come from <strong>Settings → Branding</strong>; sender address + footer come from your tenant email config; recipient inboxes for admin notifications come from the same place. Preview URLs are public (no login) and render with fake sample data — safe to send to a designer.
      </p>

      <div className="tbl">
        <div className="th" style={{ display: "grid", gridTemplateColumns: "1.4fr 1.8fr 1fr 1.8fr 0.6fr", gap: 12 }}>
          <span>Email</span>
          <span>Triggered by</span>
          <span>Sent to</span>
          <span>Customize</span>
          <span className="text-r">Preview</span>
        </div>
        {TRANSACTIONAL_EMAILS.map((e) => (
          <div
            key={e.key}
            className="tr"
            style={{ display: "grid", gridTemplateColumns: "1.4fr 1.8fr 1fr 1.8fr 0.6fr", gap: 12, alignItems: "start", padding: "10px 12px" }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>{e.label}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.trigger}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.recipient}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.customize}</span>
            <span style={{ fontSize: 12 }} className="text-r">
              {e.preview ? (
                <a
                  href={`${origin}/api/email-preview/${e.preview}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}
                >
                  Open →
                </a>
              ) : (
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, padding: "0 4px" }}>
        To hand a template to a designer: right-click the Preview link → Copy link, send it to them. The page renders the email in an iframe plus a plain-text version, and has a tab row at the top so they can cycle through every template without asking for more URLs. See <code>docs/EMAIL_TEMPLATE_HANDOFF.md</code> for the delivery format the designer should use when handing work back.
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

function BirthdayBonusSection({ jwt }) {
  const [cfg, setCfg] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);

  const [enabled, setEnabled] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [bonusHours, setBonusHours] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await fetch("/api/admin-birthday-bonus", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (r.ok) {
        const data = await r.json();
        setCfg(data.config || null);
        setLedger(data.ledger || []);
        setEnabled(!!data.config?.enabled);
        setCreditAmount(
          data.config?.credit_amount == null ? "" : String(data.config.credit_amount)
        );
        setBonusHours(
          data.config?.bonus_hours == null ? "" : String(data.config.bonus_hours)
        );
      }
    } catch {}
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        enabled,
        credit_amount: creditAmount === "" ? null : Number(creditAmount),
        bonus_hours: bonusHours === "" ? null : Number(bonusHours),
      };
      const r = await fetch("/api/admin-birthday-bonus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(payload),
      });
      if (r.ok) await load();
    } catch {}
    setSaving(false);
  }

  async function runToday() {
    setProcessing(true);
    setProcessResult(null);
    try {
      const r = await fetch("/api/admin-birthday-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      setProcessResult(data);
      await load();
    } catch (e) {
      setProcessResult({ error: e.message });
    }
    setProcessing(false);
  }

  if (loading) {
    return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading birthday bonus config...</div>;
  }

  return (
    <>
      <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ accentColor: "var(--primary)" }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Enabled</span>
          </label>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Runs daily at ~8am Pacific. Each member receives their bonus once per year.
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Shop credit ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 10"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Free bay hours</label>
            <input
              type="number"
              min="0"
              step="0.25"
              placeholder="e.g. 1"
              value={bonusHours}
              onChange={(e) => setBonusHours(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Leave blank to skip that reward type. Both blank + enabled is a no-op.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn primary" onClick={save} disabled={saving} style={{ fontSize: 11 }}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn"
            onClick={runToday}
            disabled={processing || !cfg?.enabled}
            title={!cfg?.enabled ? "Enable + save first" : "Run the daily processor for today"}
            style={{ fontSize: 11 }}
          >
            {processing ? "Running..." : "Run today's bonuses now"}
          </button>
        </div>
        {processResult && (
          <pre style={{ marginTop: 10, fontSize: 11, background: "var(--primary-bg)", padding: 10, borderRadius: 6, overflowX: "auto" }}>
            {JSON.stringify(processResult, null, 2)}
          </pre>
        )}
      </div>

      {ledger.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            Recent issuances
          </div>
          <div className="tbl" style={{ fontSize: 12 }}>
            <div className="th">
              <span style={{ flex: 2 }}>Member</span>
              <span style={{ flex: 1 }} className="text-r">Year</span>
              <span style={{ flex: 1 }} className="text-r tab-num">Credit</span>
              <span style={{ flex: 1 }} className="text-r tab-num">Hours</span>
              <span style={{ flex: 1 }} className="text-r">Issued</span>
            </div>
            {ledger.map((l) => (
              <div className="tr" key={l.id}>
                <span style={{ flex: 2 }} className="email-sm">{l.member_email}</span>
                <span style={{ flex: 1 }} className="text-r">{l.bonus_year}</span>
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {l.credit_issued != null ? `$${Number(l.credit_issued).toFixed(0)}` : "\u2014"}
                </span>
                <span style={{ flex: 1 }} className="text-r tab-num">
                  {l.hours_issued != null ? `${Number(l.hours_issued).toFixed(1)}h` : "\u2014"}
                </span>
                <span style={{ flex: 1 }} className="text-r email-sm">
                  {new Date(l.issued_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const NEWS_SEVERITIES = ["info", "success", "warning", "urgent"];
const NEWS_SEVERITY_HEX = {
  info:    "#4C8D73",
  success: "#4C8D73",
  warning: "#ddd480",
  urgent:  "#C92F1F",
};
const EMPTY_NEWS_DRAFT = {
  title: "",
  body: "",
  image_url: "",
  severity: "info",
  show_as_popup: false,
  show_on_dashboard: true,
  is_published: true,
  starts_at: "",
  ends_at: "",
};

function NewsSection({ jwt }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_NEWS_DRAFT);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin-news", { headers: { Authorization: `Bearer ${jwt}` } });
      if (r.ok) {
        const d = await r.json();
        setNews(d.news || []);
      }
    } catch {}
    setLoading(false);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setDraft({
      title: item.title || "",
      body: item.body || "",
      image_url: item.image_url || "",
      severity: item.severity || "info",
      show_as_popup: !!item.show_as_popup,
      show_on_dashboard: item.show_on_dashboard !== false,
      is_published: item.is_published !== false,
      starts_at: item.starts_at ? item.starts_at.slice(0, 16) : "",
      ends_at: item.ends_at ? item.ends_at.slice(0, 16) : "",
    });
    setError("");
  }

  function resetDraft() {
    setDraft(EMPTY_NEWS_DRAFT);
    setEditingId(null);
    setError("");
  }

  async function save() {
    if (!draft.title.trim() || !draft.body.trim()) {
      setError("Title and body required.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      image_url: draft.image_url.trim() || null,
      severity: draft.severity,
      show_as_popup: draft.show_as_popup,
      show_on_dashboard: draft.show_on_dashboard,
      is_published: draft.is_published,
      starts_at: draft.starts_at || null,
      ends_at: draft.ends_at || null,
    };
    try {
      const url = editingId ? `/api/admin-news?id=${editingId}` : "/api/admin-news";
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Save failed");
      resetDraft();
      await load();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function remove(id) {
    if (!confirm("Delete this news item? Members will stop seeing it.")) return;
    try {
      await fetch(`/api/admin-news?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function togglePublished(item) {
    try {
      await fetch(`/api/admin-news?id=${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ is_published: !item.is_published }),
      });
      await load();
    } catch {}
  }

  if (loading) return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading news…</div>;

  return (
    <>
      {/* Editor */}
      <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>
          {editingId ? "Edit news item" : "Create news item"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title (required)"
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13 }}
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="Body — what should members know? (required)"
            rows={3}
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
          />
          <input
            type="url"
            value={draft.image_url}
            onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
            placeholder="Image URL (optional)"
            style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {NEWS_SEVERITIES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft({ ...draft, severity: s })}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: draft.severity === s ? `2px solid ${NEWS_SEVERITY_HEX[s]}` : "1.5px solid var(--border)",
                  background: draft.severity === s ? NEWS_SEVERITY_HEX[s] : "transparent",
                  color: draft.severity === s ? "#fff" : "var(--text)",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              <span>Published</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.show_on_dashboard} onChange={(e) => setDraft({ ...draft, show_on_dashboard: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              <span>Show on member home page</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.show_as_popup} onChange={(e) => setDraft({ ...draft, show_as_popup: e.target.checked })} style={{ accentColor: "var(--primary)" }} />
              <span>Show as popup on portal load</span>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Starts (optional)</label>
              <input
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>Ends (optional)</label>
              <input
                type="datetime-local"
                value={draft.ends_at}
                onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
            </div>
          </div>

          {error && (
            <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: 8, borderRadius: 6, fontSize: 12 }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn primary" onClick={save} disabled={saving} style={{ fontSize: 11 }}>
              {saving ? "Saving…" : editingId ? "Update" : "Publish"}
            </button>
            {editingId && (
              <button className="btn" onClick={resetDraft} style={{ fontSize: 11 }}>Cancel edit</button>
            )}
          </div>
        </div>
      </div>

      {/* Existing items list */}
      {news.length === 0 ? (
        <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>No news items yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {news.map((n) => (
            <div
              key={n.id}
              style={{
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                borderLeft: `4px solid ${NEWS_SEVERITY_HEX[n.severity] || "var(--border)"}`,
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    padding: "1px 8px", borderRadius: 999,
                    background: NEWS_SEVERITY_HEX[n.severity] || "var(--text-muted)", color: "#fff",
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                  }}>{n.severity}</span>
                  <strong style={{ fontSize: 13 }}>{n.title}</strong>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => togglePublished(n)} style={{ fontSize: 10 }}>
                    {n.is_published ? "Unpublish" : "Publish"}
                  </button>
                  <button className="btn" onClick={() => startEdit(n)} style={{ fontSize: 10 }}>Edit</button>
                  <button className="btn" onClick={() => remove(n.id)} style={{ fontSize: 10, color: "var(--red)" }}>Delete</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap" }}>{n.body}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                {n.show_as_popup && <span>📣 Popup</span>}
                {n.show_on_dashboard && <span>📌 Home page</span>}
                {!n.is_published && <span>🚫 Unpublished</span>}
                {n.starts_at && <span>From {new Date(n.starts_at).toLocaleString()}</span>}
                {n.ends_at && <span>Until {new Date(n.ends_at).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const REQUEST_STATUSES = ["pending", "acknowledged", "ordering", "in_stock", "declined"];
const REQUEST_STATUS_LABEL = {
  pending:      "Pending",
  acknowledged: "Reviewing",
  ordering:     "Sourcing",
  in_stock:     "Ready",
  declined:     "Declined",
  cancelled:    "Cancelled",
};
const REQUEST_STATUS_COLOR = {
  pending:      { bg: "var(--primary-bg)", color: "var(--primary)" },
  acknowledged: { bg: "var(--primary-bg)", color: "var(--primary)" },
  ordering:     { bg: "#ddd480", color: "#35443B" },
  in_stock:     { bg: "var(--primary)", color: "#fff" },
  declined:     { bg: "#8BB5A0", color: "#fff" },
  cancelled:    { bg: "#8BB5A0", color: "#fff" },
};

function ShopRequestsSection({ jwt }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [responseDrafts, setResponseDrafts] = useState({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin-shop-requests", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (r.ok) {
        const d = await r.json();
        setRequests(d.requests || []);
      }
    } catch {}
    setLoading(false);
  }

  async function updateRequest(id, patch) {
    setSavingId(id);
    try {
      const r = await fetch(`/api/admin-shop-requests?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(patch),
      });
      if (r.ok) await load();
    } catch {}
    setSavingId(null);
  }

  if (loading) return <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading requests…</div>;
  if (requests.length === 0) {
    return <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>No requests yet.</div>;
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <>
      {pendingCount > 0 && (
        <div style={{ padding: "8px 12px", background: "var(--primary-bg)", borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
          <strong>{pendingCount}</strong> pending review
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {requests.map((r) => {
          const color = REQUEST_STATUS_COLOR[r.status] || REQUEST_STATUS_COLOR.pending;
          const responseDraft = responseDrafts[r.id] ?? r.admin_response ?? "";
          const responseChanged = responseDraft !== (r.admin_response || "");
          const saving = savingId === r.id;
          return (
            <div
              key={r.id}
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${color.bg}`,
                borderRadius: 8,
                background: "var(--surface)",
                fontSize: 12,
                display: "flex", flexDirection: "column", gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{r.item_name}</strong>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {r.member_name} &lt;{r.member_email}&gt;{r.member_phone ? ` · ${r.member_phone}` : ""}
                  </div>
                </div>
                <span style={{
                  padding: "2px 10px", borderRadius: 999,
                  background: color.bg, color: color.color,
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                  whiteSpace: "nowrap",
                }}>{REQUEST_STATUS_LABEL[r.status] || r.status}</span>
              </div>

              {(r.brand || r.size || r.color || r.quantity > 1 || r.budget_range) && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {[
                    r.brand && `Brand: ${r.brand}`,
                    r.size && `Size: ${r.size}`,
                    r.color && `Color: ${r.color}`,
                    r.quantity > 1 && `Qty: ${r.quantity}`,
                    r.budget_range && `Budget: ${r.budget_range}`,
                  ].filter(Boolean).join(" · ")}
                </div>
              )}

              {r.notes && (
                <div style={{ fontSize: 12, color: "var(--text)", fontStyle: "italic" }}>"{r.notes}"</div>
              )}

              {r.reference_url && (
                <div style={{ fontSize: 11 }}>
                  <a href={r.reference_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 600 }}>
                    Reference link →
                  </a>
                </div>
              )}

              {r.image_url && (
                <a
                  href={r.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open full size"
                  style={{ display: "block", marginTop: 2 }}
                >
                  <img
                    src={r.image_url}
                    alt="Member photo"
                    loading="lazy"
                    decoding="async"
                    style={{ maxWidth: 180, maxHeight: 180, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                  />
                </a>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {REQUEST_STATUSES.map((s) => (
                  <button
                    key={s}
                    className="btn"
                    onClick={() => updateRequest(r.id, { status: s })}
                    disabled={saving || r.status === s}
                    style={{
                      fontSize: 10,
                      ...(r.status === s
                        ? { background: REQUEST_STATUS_COLOR[s].bg, color: REQUEST_STATUS_COLOR[s].color, border: "none" }
                        : {}),
                    }}
                  >
                    {REQUEST_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 6 }}>
                <textarea
                  value={responseDraft}
                  onChange={(e) => setResponseDrafts({ ...responseDrafts, [r.id]: e.target.value })}
                  placeholder="Note to member (optional — sent on next save)"
                  rows={2}
                  style={{ width: "100%", padding: 8, border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                />
                {responseChanged && (
                  <button
                    className="btn primary"
                    onClick={() => updateRequest(r.id, { admin_response: responseDraft })}
                    disabled={saving}
                    style={{ fontSize: 10, marginTop: 4 }}
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                )}
              </div>

              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                Submitted {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
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
      <h2 className="section-head">Workspace</h2>
      <div className="tbl" style={{ padding: 20, marginBottom: 20 }}>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
          Brand, logos, colors, fonts, bays, and facility info. Changes here affect every member and admin view for this tenant.
        </p>
        <TenantBranding apiKey={jwt} />
      </div>

      <h2 className="section-head" style={{ marginTop: 24 }}>
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

      <h2 className="section-head" style={{ marginTop: 24 }}>Birthday Bonus</h2>
      <BirthdayBonusSection jwt={jwt} />

      <h2 className="section-head" style={{ marginTop: 24 }}>Launch Announcement</h2>
      <LaunchBroadcastSection jwt={jwt} members={members} />

      <h2 className="section-head" style={{ marginTop: 24 }}>Skedda Cutover Broadcasts</h2>
      <CutoverBroadcastSection jwt={jwt} members={members} />

      <h2 className="section-head" style={{ marginTop: 24 }}>News &amp; Announcements</h2>
      <NewsSection jwt={jwt} />

      <h2 className="section-head" style={{ marginTop: 24 }}>Discount Codes</h2>
      <DiscountCodesSection jwt={jwt} />

      <h2 className="section-head" style={{ marginTop: 24 }}>Pro Shop Requests</h2>
      <ShopRequestsSection jwt={jwt} />

      {/* Members table removed — every per-member control here
          (tier assign, Stripe link, member number, search) lives on
          the Customers tab now. Keeping a duplicate roster on Config
          made the page longer without adding any function. Use the
          Customers tab for tier changes; use the Detail view for
          per-member Stripe linking. */}

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
