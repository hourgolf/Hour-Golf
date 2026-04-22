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

import { getTenantId } from "../../../lib/api-helpers";
import * as EmailLib from "../../../lib/email";

// Map shareable URL slugs → the actual exported function name in
// lib/email.js. Stable slugs so a preview URL the designer bookmarks
// doesn't break when we rename a function internally.
const TEMPLATES = {
  "booking-confirmation":       "sendBookingConfirmation",
  "booking-cancellation":       "sendCancellationEmail",
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

function wrapPreview({ slug, subject, from, to, html, text, portalUrl }) {
  // Wrapper page: thin toolbar + iframe so the email CSS is fully
  // isolated from our host page CSS. Iframe srcdoc renders the email
  // HTML verbatim, same as a mail client would roughly.
  const allSlugs = Object.keys(TEMPLATES);
  const menuLinks = allSlugs
    .map((s) =>
      `<a href="/api/email-preview/${s}" style="padding:6px 10px;border-radius:6px;color:${s === slug ? "#fff" : "#35443B"};background:${s === slug ? "#4C8D73" : "transparent"};text-decoration:none;font-size:12px;">${s}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Email preview — ${escapeHtml(subject || slug)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #EDF3E3; color: #35443B; }
  .toolbar { padding: 14px 20px; background: #fff; border-bottom: 1px solid #d0d7c6; position: sticky; top: 0; z-index: 2; }
  .toolbar h1 { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #35443B; }
  .toolbar .meta { font-size: 12px; color: #6B7A6F; margin-bottom: 10px; }
  .toolbar .meta strong { color: #35443B; font-weight: 600; }
  .toolbar .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .content { display: grid; grid-template-columns: minmax(0, 1fr); max-width: 820px; margin: 20px auto; padding: 0 12px 40px; gap: 12px; }
  .frame-wrap { background: #fff; border: 1px solid #d0d7c6; border-radius: 8px; overflow: hidden; }
  .frame-wrap iframe { width: 100%; border: 0; min-height: 900px; display: block; }
  .text-block { background: #fff; border: 1px solid #d0d7c6; border-radius: 8px; padding: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-wrap; line-height: 1.5; }
  .text-block h2 { margin: 0 0 10px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; color: #6B7A6F; text-transform: uppercase; letter-spacing: 1px; }
  .section-title { font-size: 11px; color: #6B7A6F; text-transform: uppercase; letter-spacing: 1.2px; margin: 0 0 8px; font-weight: 700; }
</style>
</head>
<body>
  <header class="toolbar">
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
  </header>

  <div class="content">
    <div>
      <p class="section-title">Rendered HTML (as a member sees it)</p>
      <div class="frame-wrap">
        <iframe srcdoc="${escapeHtml(html || "")}" sandbox="" title="Rendered email"></iframe>
      </div>
    </div>

    ${text ? `<div>
      <p class="section-title">Plain-text fallback</p>
      <div class="text-block">
        <h2>For clients that can't render HTML</h2>
${escapeHtml(text)}
      </div>
    </div>` : ""}
  </div>
</body>
</html>`;
}

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
    })
  );
}
