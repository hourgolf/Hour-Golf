// Shared HTML email layout. Every transactional template wraps its body
// in renderEmailLayout() so a tenant's logo, brand colors, and footer
// stay consistent across booking confirmations, receipts, password
// resets, etc. without each template hand-rolling its own scaffolding.
//
// Hand-written inline-style HTML is the right call for transactional
// email — Outlook desktop, Gmail-on-iOS, and dark-mode webmail clients
// all strip <style> tags and ignore CSS classes. Inline styles and
// table-based layout are the lowest common denominator that survives
// every client.
//
// Returns { html, text } so callers can hand both to Resend; plaintext
// fallback helps deliverability and accessibility.
//
// Tenant theming priority for each color slot:
//   1. branding[<slot>_color] (tenant-specific value from tenant_branding)
//   2. FALLBACK_BRANDING (HG defaults — kept for tenants whose branding
//      hasn't been customized yet, since HG's palette is the platform's
//      design intent baseline)

import { loadBranding, FALLBACK_BRANDING } from "./branding";

// Email-safe color palette derived from a branding row. Each value has
// a hex string fallback so the layout still renders if branding load
// silently failed (network blip, RLS misconfig, etc.).
function paletteFor(branding) {
  const b = branding || FALLBACK_BRANDING;
  return {
    primary: b.primary_color || "#4C8D73",
    text:    b.text_color    || "#35443B",
    cream:   b.cream_color   || "#EDF3E3",
    accent:  b.accent_color  || "#ddd480",
    danger:  b.danger_color  || "#C92F1F",
    surface: "#FFFFFF",
    muted:   "#6B7A6F",
    line:    "#E2E8DD",
  };
}

// Build a header that surfaces the tenant's brand. Uses the header logo
// when present (capped to a sensible email-friendly size); otherwise
// renders the tenant name as a stylized wordmark. Either way: members
// open the email and immediately know who it's from.
function renderHeader(branding, palette) {
  const logoUrl = branding?.header_logo_url || branding?.logo_url || null;
  const appName = branding?.app_name || "Ourlee";
  if (logoUrl) {
    return `
    <tr>
      <td align="center" style="padding: 28px 24px 18px;">
        <img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(appName)}" style="max-height: 48px; max-width: 220px; display: block;" />
      </td>
    </tr>`;
  }
  return `
    <tr>
      <td align="center" style="padding: 28px 24px 18px;">
        <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; letter-spacing: 1px; color: ${palette.primary};">
          ${escapeHtml(appName)}
        </div>
      </td>
    </tr>`;
}

// CTA button. Accepts an optional palette key to swap colors (default:
// primary). Inline-styles only, with bulletproof bg + color + padding so
// Outlook 2016+ doesn't render it as a bare hyperlink.
export function renderEmailButton({ label, url, color, textColor }) {
  if (!label || !url) return "";
  const bg = color || "#4C8D73";
  const fg = textColor || "#FFFFFF";
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius: 8px;">
        <a href="${escapeAttr(url)}" style="display: inline-block; padding: 14px 28px; background: ${bg}; color: ${fg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 8px; letter-spacing: 0.04em;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

// Detail box — used by every template for the "key facts" panel
// (booking date/time, payment amount, request item, etc). Keeps the
// look identical across templates while letting each provide its own
// content.
export function renderDetailBox({ palette, bodyHtml, muted }) {
  const bg = muted ? "#F4F6F2" : palette.cream;
  return `
    <div style="background: ${bg}; border-radius: 10px; padding: 16px 18px; margin: 0 0 18px 0;">
      ${bodyHtml}
    </div>`;
}

// Strip HTML to a readable plaintext fallback. Naive but sufficient for
// our small templates — preserves line breaks via paragraph + br + div
// boundaries, collapses whitespace.
export function htmlToPlaintext(html) {
  if (!html) return "";
  let t = String(html);
  t = t.replace(/<br\s*\/?>(\s*)/gi, "\n");
  t = t.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  t = t.replace(/<li[^>]*>/gi, "- ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&middot;/g, "·").replace(/&hellip;/g, "…");
  // Decode numeric entities (covers the emoji we hand-encode).
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  t = t.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  // Collapse runs of blank lines + leading/trailing whitespace.
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

// Build the wrapper. Returns { html, text }.
//
// `bodyHtml` is whatever the specific template wants in the message
// body — paragraphs, detail boxes, CTAs. The layout adds:
//   - hidden preheader for inbox preview
//   - tenant logo header
//   - colored brand bar
//   - footer (tenant name + optional small note)
//
// Pass `tenantId` OR a pre-loaded `branding` object — the helper
// resolves whichever is available.
export async function renderEmailLayout({
  tenantId,
  branding: providedBranding,
  title,
  preheader,
  bodyHtml,
  ctaButton,         // optional { label, url }
  footerNote,        // optional small line below "— Tenant Name"
  footerText,        // overrides tenant_branding.email_footer_text if set
}) {
  const branding = providedBranding || (tenantId ? await loadBranding(tenantId) : FALLBACK_BRANDING);
  const palette = paletteFor(branding);
  const appName = branding?.app_name || "Ourlee";
  const footerLine = footerText || appName;

  const preheaderText = (preheader || "").slice(0, 140);

  const ctaHtml = ctaButton && ctaButton.label && ctaButton.url
    ? renderEmailButton({
        label: ctaButton.label,
        url: ctaButton.url,
        color: palette.primary,
        textColor: "#FFFFFF",
      })
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title || appName)}</title>
</head>
<body style="margin: 0; padding: 0; background: #F4F6F2; -webkit-font-smoothing: antialiased;">
<!-- Preheader: hidden text shown in inbox preview line. Padded with
     whitespace runs so Gmail doesn't backfill with the body's first
     visible chars. -->
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: transparent;">
${escapeHtml(preheaderText)}
${"&nbsp;&zwnj;".repeat(60)}
</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #F4F6F2;">
  <tr>
    <td align="center" style="padding: 24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: ${palette.surface}; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(53,68,59,0.06);">
        ${renderHeader(branding, palette)}
        <tr>
          <td style="height: 4px; background: ${palette.primary}; padding: 0; line-height: 4px; font-size: 4px;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding: 24px 28px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${palette.text}; font-size: 15px; line-height: 1.55;">
            ${title ? `<h1 style="margin: 0 0 14px 0; font-size: 20px; font-weight: 700; color: ${palette.text};">${escapeHtml(title)}</h1>` : ""}
            ${bodyHtml}
            ${ctaHtml ? `<div style="margin: 18px 0 6px;">${ctaHtml}</div>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${palette.muted}; font-size: 13px;">
            <div style="border-top: 1px solid ${palette.line}; padding-top: 14px;">
              — ${escapeHtml(footerLine)}
              ${footerNote ? `<div style="margin-top: 4px; font-size: 12px; color: ${palette.muted};">${escapeHtml(footerNote)}</div>` : ""}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  // Plaintext: feed the rendered body through the stripper plus a
  // minimal header/footer so the text-only version reads naturally.
  const textBody = htmlToPlaintext(`
${title ? `<h1>${title}</h1>\n` : ""}
${bodyHtml}
${ctaButton && ctaButton.label && ctaButton.url ? `<p>${ctaButton.label}: ${ctaButton.url}</p>` : ""}
`);

  const text = [
    preheaderText,
    "",
    textBody,
    "",
    `— ${footerLine}`,
    footerNote || "",
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n").trim();

  return { html, text };
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ---- Booking-confirmation specific helpers ----

// Build a Google Calendar "add event" link. Works on every desktop +
// mobile browser; falls back gracefully when Google Calendar isn't the
// member's preferred service (we still also surface an .ics download).
export function googleCalendarUrl({ title, start, end, details, location }) {
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    // YYYYMMDDTHHMMSSZ format Google expects, in UTC.
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title || "Booking",
    dates: `${fmt(start)}/${fmt(end)}`,
    details: details || "",
    location: location || "",
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

// Build an .ics data URL. Works on Apple Mail (iOS + macOS), Outlook
// desktop, and most Android mail clients. Members tap → "Add to
// Calendar" sheet appears. Email-safe because data: URLs can be linked
// to from anchor tags.
export function icsDataUrl({ title, start, end, description, location, uid }) {
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ourlee//Booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid || `${Date.now()}@ourlee.co`}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${(title || "Booking").replace(/\n/g, " ")}`,
    description ? `DESCRIPTION:${description.replace(/\n/g, "\\n")}` : "",
    location ? `LOCATION:${location.replace(/\n/g, " ")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return `data:text/calendar;charset=utf-8;base64,${Buffer.from(lines, "utf8").toString("base64")}`;
}
