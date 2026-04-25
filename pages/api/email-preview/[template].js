// Read-only preview renderer for every transactional email the
// platform sends. Lets a designer (or anyone) eyeball exactly what
// members see without triggering a real send — each lib/email.js
// template accepts a `_preview: true` flag that short-circuits the
// Resend call and returns the rendered { subject, html, text }.
//
// Public by design — the templates themselves are branded marketing
// content with no PII (we inject fake sample data here). The URL is
// the main thing a designer needs to share back and forth.
//
// Routes:
//   /api/email-preview/<template>              → full HTML preview
//                                                  page (iframe +
//                                                  subject/from chip)
//   /api/email-preview/<template>?raw=1        → raw rendered email
//                                                  HTML (for embed)
//   /api/email-preview/<template>?format=text  → plaintext version
//
// <template> is the exported function name without the "send" prefix,
// kebab-cased:  sendBookingConfirmation → booking-confirmation.

import { getTenantId, getServiceKey, SUPABASE_URL } from "../../../lib/api-helpers";
import * as EmailLib from "../../../lib/email";
import { TEMPLATE_FIELDS, FIELD_LIMITS, getTemplateOverrides } from "../../../lib/email-overrides";

// Map shareable URL slugs → the actual exported function name in
// lib/email.js. Stable slugs so a preview URL the designer bookmarks
// doesn't break when we rename a function internally.
const TEMPLATES = {
  "booking-confirmation":       "sendBookingConfirmation",
  "booking-cancellation":       "sendCancellationEmail",
  "access-code":                "sendAccessCodeEmail",
  "booking-conflict-alert":     "sendBookingConflictAlert",
  "cutover-announcement":       "sendCutoverAnnouncement",
  "cutover-reminder":           "sendCutoverReminder",
  "cutover-complete-member":    "sendCutoverComplete",
  "cutover-complete-new":       "sendCutoverComplete",
  "welcome":                    "sendWelcomeEmail",
  "payment-receipt":            "sendPaymentReceiptEmail",
  "payment-failed":             "sendPaymentFailedEmail",
  "password-reset":             "sendPasswordResetEmail",
  "launch":                     "sendLaunchEmail",
  "shop-request-admin":         "sendShopRequestAdminNotification",
  "shop-request-ready":         "sendShopRequestReadyEmail",
  "shop-order-notification":    "sendShopOrderNotification",
  "shipment-delivered":         "sendShipmentDeliveredEmail",
};

// Realistic sample data per template. Kept in one spot so the designer
// gets consistent dummy values across every email (same customer name,
// same bay, same prices) — easier to compare layouts side-by-side.
function sampleDataFor(tpl, { tenantId, portalUrl }) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0); // 5 PM tomorrow
  const endTomorrow = new Date(tomorrow);
  endTomorrow.setHours(18, 0, 0, 0);

  const common = {
    tenantId,
    to: "sample.member@example.com",
    customerName: "Alex Rivera",
    portalUrl,
    _preview: true,
  };

  switch (tpl) {
    case "booking-confirmation":
      return {
        ...common,
        bay: "Bay 2",
        bookingStart: tomorrow.toISOString(),
        bookingEnd: endTomorrow.toISOString(),
      };
    case "booking-cancellation":
      return {
        ...common,
        bay: "Bay 2",
        bookingStart: tomorrow.toISOString(),
        bookingEnd: endTomorrow.toISOString(),
      };
    case "access-code":
      return {
        ...common,
        bay: "Bay 2",
        bookingStart: tomorrow.toISOString(),
        bookingEnd: endTomorrow.toISOString(),
        accessCode: "426801",
      };
    case "cutover-announcement": {
      const cutoverDate = new Date(now);
      cutoverDate.setDate(now.getDate() + 14);
      return { ...common, cutoverDate: cutoverDate.toISOString() };
    }
    case "cutover-reminder": {
      const cutoverDate = new Date(now);
      cutoverDate.setDate(now.getDate() + 3);
      return { ...common, cutoverDate: cutoverDate.toISOString() };
    }
    case "cutover-complete-member":
      return { ...common, alreadyOnApp: true };
    case "cutover-complete-new":
      return { ...common, alreadyOnApp: false };
    case "booking-conflict-alert":
      return {
        tenantId,
        _preview: true,
        incoming: {
          booking_id: "skedda-demo-982314",
          customer_email: "alex.rivera@example.com",
          customer_name: "Alex Rivera",
          bay: "Bay 2",
          booking_start: tomorrow.toISOString(),
          booking_end: endTomorrow.toISOString(),
        },
        existing: {
          booking_id: "portal-demo-20260423-001",
          customer_email: "morgan.chen@example.com",
          customer_name: "Morgan Chen",
          bay: "Bay 2",
          booking_start: tomorrow.toISOString(),
          booking_end: endTomorrow.toISOString(),
        },
      };
    case "welcome":
      return {
        ...common,
        tier: "Patron",
        monthlyFee: 75,
        includedHours: 2,
      };
    case "payment-receipt":
      return {
        ...common,
        amount: 7500, // $75.00 in cents
        description: "Patron Membership",
        date: now.toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        }),
      };
    case "payment-failed":
      return {
        ...common,
        amount: 7500,
        description: "Patron Membership",
      };
    case "password-reset":
      return {
        ...common,
        resetUrl: `${portalUrl}/members/reset-password?token=sample-token-xyz`,
      };
    case "launch":
      return { ...common };
    case "shop-request-admin":
      return {
        tenantId,
        _preview: true,
        request: {
          item_name: "TaylorMade Stealth 2 Driver",
          brand: "TaylorMade",
          size: "10.5°, Stiff Flex",
          color: "Black",
          quantity: 1,
          budget_range: "$400-500",
          reference_url: "https://www.taylormade.com/drivers/",
          notes: "Left-handed please — for my wife's birthday.",
          member_name: "Alex Rivera",
          member_email: "sample.member@example.com",
          member_phone: "(503) 555-0123",
          image_url: null,
        },
      };
    case "shop-request-ready":
      return {
        tenantId,
        to: "sample.member@example.com",
        memberName: "Alex Rivera",
        itemName: "TaylorMade Stealth 2 Driver",
        brand: "TaylorMade",
        size: "10.5°",
        color: "Black",
        quantity: 1,
        adminResponse: "Came in this morning. Grab it whenever you're next by the shop!",
        _preview: true,
      };
    case "shop-order-notification":
      return {
        tenantId,
        _preview: true,
        order: {
          id: "ORD-SAMPLE-2026",
          member_name: "Alex Rivera",
          member_email: "sample.member@example.com",
          member_phone: "(503) 555-0123",
          subtotal: 12000,
          discount_cents: 2400,
          shipping_cents: 0,
          tax_cents: 950,
          total: 10550,
          delivery_method: "pickup",
          shipping_address: null,
          items: [
            { item_name: "Pro Shop Polo", size: "M", quantity: 1, price_cents: 6000 },
            { item_name: "Hour Golf Hat", size: "One Size", quantity: 1, price_cents: 3500 },
            { item_name: "Titleist Pro V1 (sleeve)", quantity: 1, price_cents: 2500 },
          ],
        },
      };
    case "shipment-delivered":
      return {
        tenantId,
        to: "sample.member@example.com",
        memberName: "Alex Rivera",
        trackingNumber: "9400111899561234567890",
        carrier: "USPS",
        service: "Ground Advantage",
        portalUrl,
        _preview: true,
      };
    default:
      return null;
  }
}

function getOrigin(req) {
  const host =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

// JSON for embedding inside <script type="application/json"> blocks.
// Script contents bypass HTML entity decoding (so &quot; would stay
// literal and JSON.parse would choke), so we only need to neutralize
// the </script> sequence + a couple of stray characters that Web
// browsers occasionally treat specially in script-text contexts.
function safeJsonForScript(value) {
  // Use char escapes for the line separators so the source itself
  // doesn't contain literal U+2028 / U+2029 (which JS treats as
  // newlines in regex literals and string contexts).
  return JSON.stringify(value)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function wrapPreview({ slug, subject, from, to, html, text, portalUrl, currentOverrides, templateMeta }) {
  // Wrapper page: thin toolbar + iframe so the email CSS is fully
  // isolated from our host page CSS. Iframe srcdoc renders the email
  // HTML verbatim, same as a mail client would roughly.
  const allSlugs = Object.keys(TEMPLATES);
  const menuLinks = allSlugs
    .map((s) =>
      `<a href="/api/email-preview/${s}" style="padding:6px 10px;border-radius:6px;color:${s === slug ? "#fff" : "#35443B"};background:${s === slug ? "#4C8D73" : "transparent"};text-decoration:none;font-size:12px;">${s}</a>`
    )
    .join("");

  // The edit panel mounts client-side only when the admin JWT is
  // present in localStorage (set by the admin app on login). This keeps
  // the preview URL public + shareable for design reviews while still
  // letting an authenticated operator click straight from the preview
  // into editing the prose.
  const editorPayload = templateMeta
    ? {
        slug,
        currentOverrides: currentOverrides || {},
        fields: templateMeta.fields,
        tokens: templateMeta.tokens,
        limits: FIELD_LIMITS,
      }
    : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Email preview — ${escapeHtml(subject || slug)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #EDF3E3; color: #35443B; }
  .toolbar { padding: 14px 20px; background: #fff; border-bottom: 1px solid #d0d7c6; position: sticky; top: 0; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .toolbar-left { flex: 1; min-width: 0; }
  .toolbar h1 { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #35443B; }
  .toolbar .meta { font-size: 12px; color: #6B7A6F; margin-bottom: 10px; }
  .toolbar .meta strong { color: #35443B; font-weight: 600; }
  .toolbar .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .toolbar-right { flex: 0 0 auto; }
  #edit-toggle { display: none; padding: 8px 14px; border-radius: 6px; border: 1px solid #4C8D73; background: #fff; color: #4C8D73; font-size: 13px; font-weight: 600; cursor: pointer; }
  #edit-toggle.active { background: #4C8D73; color: #fff; }
  .content { display: grid; grid-template-columns: minmax(0, 1fr); max-width: 820px; margin: 20px auto; padding: 0 12px 40px; gap: 12px; }
  .content.editing { max-width: 1200px; grid-template-columns: minmax(420px, 1fr) minmax(0, 1.2fr); }
  @media (max-width: 900px) { .content.editing { grid-template-columns: minmax(0, 1fr); } }
  .frame-wrap { background: #fff; border: 1px solid #d0d7c6; border-radius: 8px; overflow: hidden; }
  .frame-wrap iframe { width: 100%; border: 0; min-height: 900px; display: block; }
  .text-block { background: #fff; border: 1px solid #d0d7c6; border-radius: 8px; padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; line-height: 1.5; }
  .text-block h2 { margin: 0 0 10px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; color: #6B7A6F; text-transform: uppercase; letter-spacing: 1px; }
  .section-title { font-size: 11px; color: #6B7A6F; text-transform: uppercase; letter-spacing: 1.2px; margin: 0 0 8px; font-weight: 700; }

  /* Edit panel */
  #edit-panel { display: none; }
  #edit-panel.open { display: flex; flex-direction: column; gap: 12px; }
  .edit-panel-card { background: #fff; border: 1px solid #d0d7c6; border-radius: 8px; padding: 16px; }
  .edit-field { margin-bottom: 14px; }
  .edit-field label { display: block; font-size: 11px; color: #6B7A6F; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 4px; }
  .edit-field input, .edit-field textarea { width: 100%; padding: 8px 10px; border: 1px solid #d0d7c6; border-radius: 6px; font-size: 13px; font-family: inherit; background: #fff; color: #35443B; box-sizing: border-box; }
  .edit-field input:focus, .edit-field textarea:focus { outline: none; border-color: #4C8D73; box-shadow: 0 0 0 3px rgba(76,141,115,0.12); }
  .edit-field textarea { min-height: 80px; resize: vertical; font-family: inherit; line-height: 1.5; }
  .edit-counter { font-size: 11px; color: #6B7A6F; margin-top: 3px; text-align: right; }
  .edit-counter.over { color: #C92F1F; font-weight: 600; }
  .edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .btn { padding: 8px 14px; border-radius: 6px; border: 1px solid #d0d7c6; background: #fff; color: #35443B; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: #4C8D73; border-color: #4C8D73; color: #fff; }
  .btn.danger { color: #C92F1F; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .tokens-card { background: #f6f9f0; border: 1px solid #d0d7c6; border-radius: 6px; padding: 10px 12px; font-size: 12px; }
  .tokens-card .tok-row { display: flex; gap: 10px; padding: 2px 0; }
  .tokens-card code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #4C8D73; min-width: 110px; cursor: pointer; }
  .tokens-card code:hover { text-decoration: underline; }
  #edit-status { font-size: 12px; color: #6B7A6F; padding: 6px 0; min-height: 18px; }
  #edit-status.success { color: #4C8D73; font-weight: 600; }
  #edit-status.error { color: #C92F1F; font-weight: 600; }
</style>
</head>
<body>
  <header class="toolbar">
    <div class="toolbar-left">
      <h1>${escapeHtml(subject || slug)}</h1>
      <div class="meta">
        <strong>From:</strong> ${escapeHtml(from || "(default from address)")} &nbsp; · &nbsp;
        <strong>To:</strong> ${escapeHtml(to || "(no recipient)")}
        &nbsp; · &nbsp;
        <a href="/api/email-preview/${slug}?raw=1" target="_blank" rel="noopener" style="color:#4C8D73;">raw HTML</a>
        &nbsp; · &nbsp;
        <a href="/api/email-preview/${slug}?format=text" target="_blank" rel="noopener" style="color:#4C8D73;">plain-text version</a>
      </div>
      <div class="tabs">${menuLinks}</div>
    </div>
    <div class="toolbar-right">
      <button id="edit-toggle" type="button">Edit copy</button>
    </div>
  </header>

  <div class="content" id="content-grid">
    <div id="edit-panel">
      <div class="edit-panel-card">
        <p class="section-title">Edit copy</p>
        <div id="edit-fields"></div>
        <div id="edit-status" aria-live="polite"></div>
        <div class="edit-actions">
          <button class="btn danger" id="edit-reset" type="button">Reset to default</button>
          <button class="btn" id="edit-cancel" type="button">Cancel</button>
          <button class="btn primary" id="edit-save" type="button">Save</button>
        </div>
      </div>
      <div class="edit-panel-card">
        <p class="section-title">Available tokens</p>
        <p class="muted" style="font-size:12px; color:#6B7A6F; margin:0 0 8px;">Click a token to copy. Tokens auto-fill at send time using the recipient's data.</p>
        <div id="tokens-list" class="tokens-card"></div>
      </div>
    </div>

    <div>
      <p class="section-title">Rendered HTML (as a member sees it)</p>
      <div class="frame-wrap">
        <iframe id="preview-frame" srcdoc="${escapeHtml(html || "")}" sandbox="" title="Rendered email"></iframe>
      </div>
      ${text ? `<div style="margin-top:12px;">
        <p class="section-title">Plain-text fallback</p>
        <div class="text-block">
          <h2>For clients that can't render HTML</h2>
${escapeHtml(text)}
        </div>
      </div>` : ""}
    </div>
  </div>

  <script id="edit-payload" type="application/json">${editorPayload ? safeJsonForScript(editorPayload) : "null"}</script>
  <script>${EDITOR_JS}</script>
</body>
</html>`;
}

// Vanilla-JS editor that mounts client-side. Reads the admin JWT from
// localStorage (where the admin app stashes it under "hg-admin-key");
// if absent, the Edit button stays hidden and the page is read-only.
// Save flow PATCHes /api/admin-tenant-branding with the merged
// email_overrides blob so the rest of Settings keeps its single
// source of truth.
const EDITOR_JS = `
(function(){
  var payloadEl = document.getElementById("edit-payload");
  var payload = null;
  try { payload = JSON.parse(payloadEl && payloadEl.textContent || "null"); } catch (e) { payload = null; }
  if (!payload) return; // template not yet wired for editing

  // Pull the admin JWT from Supabase's localStorage stash. The admin
  // app configures supabase-js with storageKey "hg-auth" (see
  // lib/supabase.js); the access_token field inside is what
  // verifyAdmin on the server validates.
  function getAdminJwt() {
    try {
      var raw = localStorage.getItem("hg-auth");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return (parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token))) || null;
    } catch (e) { return null; }
  }
  var apiKey = getAdminJwt();
  if (!apiKey) return; // not signed in as admin → read-only

  var toggle = document.getElementById("edit-toggle");
  var panel = document.getElementById("edit-panel");
  var content = document.getElementById("content-grid");
  var fieldsEl = document.getElementById("edit-fields");
  var statusEl = document.getElementById("edit-status");
  var saveBtn = document.getElementById("edit-save");
  var resetBtn = document.getElementById("edit-reset");
  var cancelBtn = document.getElementById("edit-cancel");
  var tokensEl = document.getElementById("tokens-list");
  var iframe = document.getElementById("preview-frame");

  toggle.style.display = "inline-block";

  // Build form fields based on the template's editable fields.
  var FIELD_LABELS = {
    subject: "Subject line",
    preheader: "Preheader (preview text in inbox)",
    intro: "Intro / greeting paragraph",
    outro: "Outro / closing line",
    cta_label: "CTA button label",
  };
  var inputs = {};
  payload.fields.forEach(function(field){
    var meta = payload.limits[field] || { max: 500, multiline: true };
    var wrap = document.createElement("div");
    wrap.className = "edit-field";
    var label = document.createElement("label");
    label.textContent = FIELD_LABELS[field] || field;
    wrap.appendChild(label);
    var input;
    if (meta.multiline) {
      input = document.createElement("textarea");
      input.rows = field === "intro" ? 4 : 2;
    } else {
      input = document.createElement("input");
      input.type = "text";
    }
    input.name = field;
    input.maxLength = meta.max + 50; // soft buffer; counter shows over-limit
    input.value = (payload.currentOverrides && payload.currentOverrides[field]) || "";
    wrap.appendChild(input);
    var counter = document.createElement("div");
    counter.className = "edit-counter";
    counter.textContent = input.value.length + " / " + meta.max;
    wrap.appendChild(counter);
    input.addEventListener("input", function(){
      counter.textContent = input.value.length + " / " + meta.max;
      counter.classList.toggle("over", input.value.length > meta.max);
    });
    fieldsEl.appendChild(wrap);
    inputs[field] = input;
  });

  // Token reference card.
  payload.tokens.forEach(function(t){
    var row = document.createElement("div");
    row.className = "tok-row";
    var code = document.createElement("code");
    code.textContent = t.token;
    code.addEventListener("click", function(){
      navigator.clipboard && navigator.clipboard.writeText(t.token);
      code.textContent = "✓ copied";
      setTimeout(function(){ code.textContent = t.token; }, 700);
    });
    row.appendChild(code);
    var span = document.createElement("span");
    span.style.color = "#6B7A6F";
    span.textContent = t.desc;
    row.appendChild(span);
    tokensEl.appendChild(row);
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = kind || "";
  }

  function setOpen(open) {
    if (open) {
      panel.classList.add("open");
      content.classList.add("editing");
      toggle.classList.add("active");
      toggle.textContent = "Hide editor";
    } else {
      panel.classList.remove("open");
      content.classList.remove("editing");
      toggle.classList.remove("active");
      toggle.textContent = "Edit copy";
    }
  }
  toggle.addEventListener("click", function(){ setOpen(!panel.classList.contains("open")); });
  cancelBtn.addEventListener("click", function(){
    payload.fields.forEach(function(f){
      inputs[f].value = (payload.currentOverrides && payload.currentOverrides[f]) || "";
      inputs[f].dispatchEvent(new Event("input"));
    });
    setOpen(false);
    setStatus("");
  });

  // GET current overrides (full blob) so save merges instead of clobbers.
  function fetchAllOverrides() {
    return fetch("/api/admin-tenant-branding", {
      headers: { Authorization: "Bearer " + apiKey },
    }).then(function(r){
      if (!r.ok) throw new Error("Could not load current settings");
      return r.json();
    }).then(function(row){
      return (row && typeof row.email_overrides === "object" && row.email_overrides) || {};
    });
  }

  function saveOverrides(allOverrides) {
    return fetch("/api/admin-tenant-branding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ email_overrides: allOverrides }),
    }).then(function(r){
      if (!r.ok) {
        return r.json().catch(function(){ return {}; }).then(function(d){
          throw new Error(d.error || d.detail || ("Save failed (" + r.status + ")"));
        });
      }
      return r.json();
    });
  }

  saveBtn.addEventListener("click", function(){
    saveBtn.disabled = true;
    setStatus("Saving…");
    fetchAllOverrides().then(function(all){
      var slug = payload.slug;
      var next = Object.assign({}, all);
      var blob = {};
      payload.fields.forEach(function(f){
        var v = (inputs[f].value || "").trim();
        if (v.length > 0) blob[f] = v;
      });
      if (Object.keys(blob).length > 0) {
        next[slug] = blob;
      } else {
        delete next[slug]; // all fields blank = revert to defaults
      }
      var payloadOut = Object.keys(next).length > 0 ? next : null;
      return saveOverrides(payloadOut);
    }).then(function(){
      setStatus("Saved. Reloading preview…", "success");
      setTimeout(function(){ window.location.reload(); }, 600);
    }).catch(function(e){
      setStatus(e.message || "Save failed", "error");
      saveBtn.disabled = false;
    });
  });

  resetBtn.addEventListener("click", function(){
    if (!confirm("Reset this email's copy back to platform defaults?")) return;
    saveBtn.disabled = true;
    setStatus("Resetting…");
    fetchAllOverrides().then(function(all){
      var next = Object.assign({}, all);
      delete next[payload.slug];
      var payloadOut = Object.keys(next).length > 0 ? next : null;
      return saveOverrides(payloadOut);
    }).then(function(){
      setStatus("Reset. Reloading preview…", "success");
      setTimeout(function(){ window.location.reload(); }, 600);
    }).catch(function(e){
      setStatus(e.message || "Reset failed", "error");
      saveBtn.disabled = false;
    });
  });
})();
`;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const slug = String(req.query.template || "").toLowerCase();
  const fnName = TEMPLATES[slug];
  if (!fnName) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    const list = Object.keys(TEMPLATES)
      .map((s) => `<li><a href="/api/email-preview/${s}">${s}</a></li>`)
      .join("");
    return res.end(`<!doctype html><html><body style="font-family: sans-serif; padding: 40px; background: #EDF3E3; color: #35443B;"><h1>Unknown template</h1><p>Try one of:</p><ul>${list}</ul></body></html>`);
  }
  const fn = EmailLib[fnName];
  if (typeof fn !== "function") {
    return res.status(500).json({ error: `template function ${fnName} not found` });
  }

  const tenantId = getTenantId(req);
  const portalUrl = getOrigin(req);
  const args = sampleDataFor(slug, { tenantId, portalUrl });
  if (!args) return res.status(500).json({ error: "no sample data for this template" });

  let payload;
  try {
    payload = await fn(args);
  } catch (e) {
    console.error(`email-preview[${slug}] threw:`, e);
    return res.status(500).json({ error: "template threw", detail: e.message });
  }

  // Admin-notification templates short-circuit with { skipped: true,
  // reason: "no_notification_email" } when the tenant hasn't set
  // email_notification_to. Surface a clear preview-time message
  // instead of silently rendering nothing.
  if (!payload || !payload.preview) {
    res.status(409).setHeader("Content-Type", "text/html; charset=utf-8");
    const reason = payload?.reason || "no-preview";
    return res.end(`<!doctype html><html><body style="font-family: sans-serif; padding: 40px; background: #EDF3E3; color: #35443B;">
      <h1>Preview unavailable</h1>
      <p>This template short-circuited during render (reason: <code>${escapeHtml(reason)}</code>).</p>
      <p>For admin-notification templates, set <code>tenants.email_notification_to</code> for this tenant so the template has a recipient to address.</p>
      <p><a href="/api/email-preview/launch">Back to template list →</a></p>
    </body></html>`);
  }

  const wantsRaw = req.query.raw === "1" || req.query.raw === "true";
  const wantsText = req.query.format === "text" || req.query.format === "txt";

  if (wantsRaw) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(payload.html || "");
  }
  if (wantsText) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(payload.text || "(no plaintext version)");
  }

  // Pull the current tenant_branding row so the editor pre-fills with
  // any saved overrides. Read-only — uses service-role + tenant
  // resolved from the request subdomain. The actual save flow goes
  // through admin-tenant-branding which still requires a JWT.
  let currentOverrides = {};
  try {
    const sk = getServiceKey();
    if (sk && tenantId) {
      const brResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_branding?tenant_id=eq.${tenantId}&select=email_overrides`,
        { headers: { apikey: sk, Authorization: `Bearer ${sk}` } }
      );
      if (brResp.ok) {
        const rows = await brResp.json();
        currentOverrides = getTemplateOverrides(rows[0] || {}, slug);
      }
    }
  } catch (_) { /* preview keeps working even if branding lookup fails */ }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(
    wrapPreview({
      slug,
      subject: payload.subject,
      from: payload.from,
      to: payload.to,
      html: payload.html,
      text: payload.text,
      portalUrl,
      currentOverrides,
      templateMeta: TEMPLATE_FIELDS[slug] || null,
    })
  );
}
