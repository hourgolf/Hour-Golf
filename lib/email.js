// Shared email sending logic. Calls the Resend API directly — no
// self-fetch needed.
//
// Every exported template function takes `tenantId` as its first arg
// and renders through lib/email-layout.js so a tenant's logo, colors,
// and footer stay consistent across the whole transactional family
// (booking, billing, shop, password reset, shipment).
//
// Admin-facing notifications (Pro Shop order, Pro Shop request) land
// in the tenant's configured notification inbox, not Hour Golf's.
//
// Config source: public.tenants columns `name`, `email_from`,
// `email_notification_to`, `email_footer_text` (see migration
// 20260417220000_tenants_email_config.sql). Fallbacks when a field is
// null are documented per-field below.
//
// Cache: module-scope 60s TTL, mirroring lib/branding.js. Warm Vercel
// instances skip the lookup on subsequent calls within the window.

import { loadFeatures, isFeatureEnabled } from "./tenant-features";
import { loadBranding, DEFAULT_CANCEL_CUTOFF_HOURS } from "./branding";
import { applyOverride } from "./email-overrides";
import {
  renderEmailLayout,
  renderDetailBox,
  googleCalendarUrl,
  icsDataUrl,
} from "./email-layout";

const TZ = "America/Los_Angeles";
const CACHE_TTL_MS = 60_000;
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://uxpkqbioxoezjmcoylkw.supabase.co";

const tenantEmailCache = new Map(); // tenantId -> { value, cachedAt }

function toPacific(dt) {
  const date = dt.toLocaleDateString("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
  });
  const time = dt.toLocaleTimeString("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
  });
  return { date, time };
}

// Load tenant email config (name, from, notification inbox, footer
// text). Service-role-only because `tenants` has RLS. Returns a merged
// object with safe defaults; never throws.
async function loadTenantEmail(tenantId) {
  if (!tenantId) return null;
  const cached = tenantEmailCache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}&select=name,email_from,email_notification_to,email_footer_text`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal:
          typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(1500)
            : undefined,
      }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!row) return null;
    // When a tenant hasn't set their own email_from, fall back to the
    // platform's verified domain (ourlee.co is verified in Resend).
    // We avoid sandbox resend.dev addresses here because they only
    // deliver to the Resend-account-owner's inbox — every other
    // recipient gets a 403 and the email vanishes silently.
    const defaultFrom = `${row.name || "Ourlee"} <no-reply@ourlee.co>`;
    const resolved = {
      name: row.name || "Ourlee",
      email_from: row.email_from || defaultFrom,
      email_notification_to: row.email_notification_to || null,
      email_footer_text: row.email_footer_text || row.name || "Ourlee",
    };
    tenantEmailCache.set(tenantId, { value: resolved, cachedAt: Date.now() });
    return resolved;
  } catch {
    return null;
  }
}

export function invalidateTenantEmail(tenantId) {
  if (tenantId) tenantEmailCache.delete(tenantId);
  else tenantEmailCache.clear();
}

// Pull both the email config (from/footer/notification inbox) and the
// branding row (colors, logo, app_name) in one place so every template
// can reach them without juggling two loads.
async function loadTenantContext(tenantId) {
  const [tenantEmail, branding] = await Promise.all([
    loadTenantEmail(tenantId),
    loadBranding(tenantId),
  ]);
  return { tenantEmail, branding };
}

// --- Shared send helper ---
async function sendEmail({ to, subject, html, text, fromOverride }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  // Final-fallback from address. Uses the platform's verified ourlee.co
  // domain — never the unverified resend.dev sandbox, since that
  // silently 403s for any non-Resend-account-owner recipient.
  const envFallbackFrom =
    process.env.RESEND_FROM_EMAIL || "Ourlee <no-reply@ourlee.co>";
  const from = fromOverride || envFallbackFrom;

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return { skipped: true, reason: "no_api_key" };
  }
  if (!to) {
    console.warn("sendEmail called without a recipient, skipping");
    return { skipped: true, reason: "no_recipient" };
  }

  try {
    const payload = { from, to: [to], subject, html };
    if (text) payload.text = text;
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error("Resend error:", data);
      return { error: true, detail: data.message || JSON.stringify(data) };
    }
    console.log(`Email sent to ${to}, id: ${data.id}`);
    return { success: true, id: data.id };
  } catch (e) {
    console.error("Email failed:", e);
    return { error: true, detail: e.message };
  }
}

// Resolve the "View dashboard" URL for the CTA buttons. Callers pass
// `portalUrl` derived from req.headers.host so each tenant gets links
// to their own subdomain. Falls back to a sensible default when the
// caller didn't provide one (older API routes, cron jobs, etc.).
function resolvePortalUrl(portalUrl, path = "/members/dashboard") {
  const base = portalUrl
    || process.env.NEXT_PUBLIC_PORTAL_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || null;
  if (!base) return null;
  // Strip trailing slash to keep concatenation clean.
  const clean = base.replace(/\/$/, "");
  return `${clean}${path.startsWith("/") ? path : `/${path}`}`;
}

// --- Booking Confirmation ---
export async function sendBookingConfirmation({
  tenantId, to, customerName, bay, bookingStart, bookingEnd, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  // Access-code feature gates the "You'll receive your access code"
  // promise. Tenants without a keypad/smart-lock integration skip that
  // paragraph entirely so members aren't waiting for a code that will
  // never arrive.
  const features = await loadFeatures(tenantId);
  const accessCodesOn = isFeatureEnabled(features, "access_codes");

  const startDt = new Date(bookingStart);
  const endDt = new Date(bookingEnd);
  const start = toPacific(startDt);
  const end = toPacific(endDt);
  const durationHrs =
    Math.round(Math.max(0, (endDt - startDt) / 3600000) * 10) / 10;
  const venueName = branding?.app_name || tenantEmail?.name || "us";

  const dashboardUrl = resolvePortalUrl(portalUrl, "/members/dashboard");
  const bayLabel = branding?.bay_label_singular || "Bay";

  // Token context for any override fields the admin has set. Same
  // tokens listed in TEMPLATE_FIELDS["booking-confirmation"].tokens
  // so the editor's help text matches what actually substitutes.
  const tokens = {
    "{name}":      customerName || "there",
    "{venue}":     venueName,
    "{bay}":       bay || bayLabel,
    "{bay_label}": bayLabel.toLowerCase(),
    "{date}":      start.date,
    "{time}":      `${start.time} – ${end.time}`,
    "{duration}":  `${durationHrs} hour${durationHrs !== 1 ? "s" : ""}`,
  };
  const calendarTitle = `${venueName} — ${bay || bayLabel}`;
  // Calendar location: use the tenant's facility_address when set so
  // members can tap the calendar event and get directions. Falls back
  // to venue name when address isn't configured (preserves prior
  // behavior for tenants that haven't filled it in).
  const calendarLocation = branding?.facility_address
    ? `${venueName} · ${branding.facility_address}`
    : venueName;
  const calendarDetails = `Your ${venueName} booking. ${dashboardUrl ? `Manage at ${dashboardUrl}` : ""}`.trim();
  const gcalUrl = googleCalendarUrl({
    title: calendarTitle,
    start: startDt,
    end: endDt,
    details: calendarDetails,
    location: calendarLocation,
  });
  const icsUrl = icsDataUrl({
    title: calendarTitle,
    start: startDt,
    end: endDt,
    description: calendarDetails,
    location: calendarLocation,
    uid: `booking-${startDt.getTime()}-${(bay || "bay").replace(/\s+/g, "")}@ourlee.co`,
  });

  const accessBlock = accessCodesOn
    ? `<p style="margin: 0 0 16px 0;">🔑 We'll email your access code about <strong>10 minutes before</strong> your start time.</p>`
    : "";

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">📅 <strong>${start.date}</strong></p>
    <p style="margin: 0 0 6px 0;">🕐 <strong>${start.time} – ${end.time}</strong> · ${durationHrs} hour${durationHrs !== 1 ? "s" : ""}</p>
    ${bay ? `<p style="margin: 0;">📍 <strong>${bay}</strong></p>` : ""}
  `;

  // Calendar links — Google + .ics — rendered as small text links so
  // members can tap "Add to Calendar" without us forcing a giant
  // button. The .ics data URL works on Apple Mail (iOS + macOS) and
  // most Android clients; gcal works everywhere as a fallback.
  const calendarLinks = `
    <p style="margin: 0 0 18px 0; font-size: 13px; color: #6B7A6F;">
      Add to calendar:
      <a href="${gcalUrl}" style="color: #4C8D73; text-decoration: underline;">Google</a>
      &nbsp;·&nbsp;
      <a href="${icsUrl}" download="booking.ics" style="color: #4C8D73; text-decoration: underline;">Apple / Outlook</a>
    </p>`;

  const cancelCutoff = Number(branding?.cancel_cutoff_hours ?? DEFAULT_CANCEL_CUTOFF_HOURS);
  const cancelCopy = cancelCutoff > 0
    ? `You can cancel from your member portal up to ${cancelCutoff} hour${cancelCutoff === 1 ? "" : "s"} before your booking.`
    : `You can cancel from your member portal anytime before your booking.`;

  // Editable copy via tenant_branding.email_overrides — admin can set
  // these on the email preview page. Each falls back to the platform
  // default when no override exists. Tokens substitute on either side
  // so {name}/{venue}/etc work regardless of source.
  const SLUG = "booking-confirmation";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},`;
  const greetingDefault = `Your ${escapeHtml(bayLabel.toLowerCase())} is booked. Here are the details:`;
  // We treat "intro" as the full greeting block (line 1: "Hey X,",
  // line 2: "Your bay is booked..."). Splitting them into two fields
  // would crowd the editor; one combined field with newline support
  // is plainer.
  const introOverride = applyOverride(
    `${introDefault}\n\n${greetingDefault}`,
    branding, SLUG, "intro", tokens,
  );
  // Render newlines in the override as paragraph breaks.
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");

  const outroDefault = cancelCopy;
  const outroOverride = applyOverride(outroDefault, branding, SLUG, "outro", tokens);
  const outroHtml = `<p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>`;

  const ctaLabelDefault = "View in dashboard";
  const ctaLabelOverride = applyOverride(ctaLabelDefault, branding, SLUG, "cta_label", tokens);

  const subjectDefault = `Booked: ${start.date} at ${start.time}${bay ? ` · ${bay}` : ""}`;
  const subjectOverride = applyOverride(subjectDefault, branding, SLUG, "subject", tokens);

  const preheaderDefault = `${start.date} · ${start.time}–${end.time}${bay ? ` · ${bay}` : ""}`;
  const preheaderOverride = applyOverride(preheaderDefault, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    ${calendarLinks}
    ${accessBlock}
    ${outroHtml}
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Booking confirmed",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: dashboardUrl ? { label: ctaLabelOverride, url: dashboardUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Access Code (door code) ---
//
// Sent ~10 min before each confirmed booking, when the access_codes
// feature is enabled and Seam has issued the code. Currently the
// actual send lives in the Deno edge function
// supabase/functions/process-access-codes/index.ts (runs on the
// cron → Seam → email pipeline). This Node-side template exists so
// the preview viewer has something to render with the shared branded
// wrapper; designer work flows through here, and the edge function's
// inline HTML (buildEmailHtml in index.ts) should be updated to mirror
// when a new design lands. TODO: migrate the edge-function send to
// call this endpoint so there's a single source of truth.
export async function sendAccessCodeEmail({
  tenantId, to, customerName, bay, bookingStart, bookingEnd, accessCode, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const startDt = new Date(bookingStart);
  const endDt = new Date(bookingEnd);
  const start = toPacific(startDt);
  const end = toPacific(endDt);
  const venueName = branding?.app_name || tenantEmail?.name || "us";
  const bayLabel = branding?.bay_label_singular || "Bay";
  const dashboardUrl = resolvePortalUrl(portalUrl, "/members/dashboard");
  const durationHrs = Math.round(Math.max(0, (endDt - startDt) / 3600000) * 10) / 10;

  const tokens = {
    "{name}":        customerName || "there",
    "{venue}":       venueName,
    "{bay}":         bay || bayLabel,
    "{bay_label}":   bayLabel.toLowerCase(),
    "{date}":        start.date,
    "{time}":        `${start.time} – ${end.time}`,
    "{duration}":    `${durationHrs} hour${durationHrs !== 1 ? "s" : ""}`,
    "{access_code}": accessCode || "------",
  };

  // Detail box: when + where. Matches the booking-confirmation layout
  // so the member's eye knows where to look across both emails.
  const detailHtml = `
    <p style="margin: 0 0 6px 0;">📅 <strong>${escapeHtml(start.date)}</strong></p>
    <p style="margin: 0 0 6px 0;">🕐 <strong>${escapeHtml(start.time)} – ${escapeHtml(end.time)}</strong></p>
    ${bay ? `<p style="margin: 0;">📍 <strong>${escapeHtml(bay)}</strong></p>` : ""}
  `;

  // Big code display — the entire point of this email is for the
  // member to glance + remember six digits. Monospace, oversized,
  // letter-spaced. Background uses the tenant primary color (inverts
  // on dark themes automatically).
  const codeBlock = `
    <div style="background: ${branding?.primary_color || "#4C8D73"}; color: #ffffff; border-radius: 10px; padding: 22px; text-align: center; margin: 18px 0;">
      <p style="margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.4px; opacity: 0.8;">Your Access Code</p>
      <p style="margin: 0; font-size: 38px; font-weight: 700; letter-spacing: 7px; font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;">${escapeHtml(accessCode || "------")}</p>
    </div>
  `;

  const SLUG = "access-code";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},\n\nYour booking at ${escapeHtml(venueName)} is coming up:`;
  const introOverride = applyOverride(introDefault, branding, SLUG, "intro", tokens);
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroDefault = "This code works from 10 minutes before your booking through 10 minutes after. Enter it on the keypad at the front door.";
  const outroOverride = applyOverride(outroDefault, branding, SLUG, "outro", tokens);
  const ctaLabelOverride = applyOverride("View booking", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(
    `Your ${venueName} access code — ${start.date}, ${start.time}`,
    branding, SLUG, "subject", tokens,
  );
  const preheaderOverride = applyOverride(
    `Your door code for ${start.date} at ${start.time}.`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    ${codeBlock}
    <p style="margin: 0 0 12px 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: `Your ${venueName} access code`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: dashboardUrl ? { label: ctaLabelOverride, url: dashboardUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "Code works 10 min before through 10 min after your start time.",
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Booking conflict (admin notification) ---
//
// Fires from the Skedda webhook when an incoming Skedda booking
// overlaps an existing same-bay booking. We can't reject the Skedda
// write (the member already committed on their side), so this email
// is the operator's handoff: who's on the schedule twice, when, and
// what to do about it. Goes to the tenant's notification inbox.
export async function sendBookingConflictAlert({
  tenantId, incoming, existing, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const notifyTo = tenantEmail?.email_notification_to;
  if (!notifyTo && !_preview) {
    return { skipped: true, reason: "no_notification_email" };
  }
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";

  const bayLabel = branding?.bay_label_singular || "Bay";

  function fmtLine(b) {
    if (!b) return "";
    const s = new Date(b.booking_start);
    const e = new Date(b.booking_end);
    const when = toPacific(s);
    const endTime = toPacific(e).time;
    return `
      <div style="background: #F4F6F2; border-left: 4px solid var(--danger, #C92F1F); border-radius: 6px; padding: 12px 14px; margin: 0 0 10px 0;">
        <p style="margin: 0 0 4px 0; font-weight: 700; font-size: 15px;">${escapeHtml(b.customer_name || b.customer_email || "Unknown member")}</p>
        <p style="margin: 0 0 2px 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(b.customer_email || "")}</p>
        <p style="margin: 0; font-size: 13px;">📍 <strong>${escapeHtml(b.bay || bayLabel)}</strong> · 📅 <strong>${escapeHtml(when.date)}</strong> · 🕐 <strong>${escapeHtml(when.time)} – ${escapeHtml(endTime)}</strong></p>
        ${b.booking_id ? `<p style="margin: 6px 0 0 0; font-size: 11px; color: #6B7A6F; font-family: monospace;">booking_id: ${escapeHtml(b.booking_id)}</p>` : ""}
      </div>
    `;
  }

  const conflictWhen = toPacific(new Date(incoming?.booking_start || Date.now()));
  const conflictEnd = toPacific(new Date(incoming?.booking_end || Date.now()));
  const tokens = {
    "{venue}":          venueName,
    "{bay}":            incoming?.bay || existing?.bay || bayLabel,
    "{date}":           conflictWhen.date,
    "{time}":           `${conflictWhen.time} – ${conflictEnd.time}`,
    "{existing_name}":  existing?.customer_name || existing?.customer_email || "(unknown)",
    "{existing_email}": existing?.customer_email || "",
    "{incoming_name}":  incoming?.customer_name || incoming?.customer_email || "(unknown)",
    "{incoming_email}": incoming?.customer_email || "",
  };

  const SLUG = "booking-conflict-alert";
  const introOverride = applyOverride(
    `Two bookings landed on the same ${bayLabel.toLowerCase()} at the same time.\n\nThis usually happens when a member books via the legacy Skedda flow while another member just booked the same slot in the new portal. Both bookings are recorded — reach out to one of them to reschedule.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para, i) => i === 0
      ? `<p style="margin: 0 0 10px 0; font-size: 16px;"><strong>${para.split("\n").map(escapeHtml).join("<br/>")}</strong></p>`
      : `<p style="margin: 0 0 16px 0; font-size: 13px; color: #6B7A6F;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    "Open the admin dashboard → Today — both bookings are flagged with a red CONFLICT chip so you can jump straight to them.",
    branding, SLUG, "outro", tokens,
  );

  const subjectOverride = applyOverride(
    `Double booking: ${incoming?.bay || "bay"} at ${conflictWhen.time}`,
    branding, SLUG, "subject", tokens,
  );
  const preheaderOverride = applyOverride(
    `${existing?.customer_name || existing?.customer_email || "A member"} and ${incoming?.customer_name || incoming?.customer_email || "another"} both booked the same slot.`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    ${introHtml}
    ${fmtLine(existing)}
    ${fmtLine(incoming)}
    <p style="margin: 14px 0 0 0; font-size: 13px;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Double-booking detected",
    preheader: preheaderOverride,
    bodyHtml,
    footerText: `${venueName} · Admin alert`,
    footerNote: "This alert fires automatically when the Skedda webhook lands a booking that overlaps an existing one.",
  });

  if (_preview) {
    return { preview: true, to: notifyTo || "(no notification inbox set)", from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to: notifyTo,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Cancellation Confirmation ---
export async function sendCancellationEmail({
  tenantId, to, customerName, bay, bookingStart, bookingEnd, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const startDt = new Date(bookingStart);
  const endDt = new Date(bookingEnd);
  const start = toPacific(startDt);
  const end = toPacific(endDt);
  const bayLabel = branding?.bay_label_singular || "Bay";
  const venueName = branding?.app_name || tenantEmail?.name || "us";
  const durationHrs = Math.round(Math.max(0, (endDt - startDt) / 3600000) * 10) / 10;

  const tokens = {
    "{name}":      customerName || "there",
    "{venue}":     venueName,
    "{bay}":       bay || bayLabel,
    "{bay_label}": bayLabel.toLowerCase(),
    "{date}":      start.date,
    "{time}":      `${start.time} – ${end.time}`,
    "{duration}":  `${durationHrs} hour${durationHrs !== 1 ? "s" : ""}`,
  };

  const detailHtml = `
    <p style="margin: 0 0 6px 0; opacity: 0.7;">📅 <s>${start.date}</s></p>
    <p style="margin: 0 0 6px 0; opacity: 0.7;">🕐 <s>${start.time} – ${end.time}</s></p>
    ${bay ? `<p style="margin: 0; opacity: 0.7;">📍 <s>${bay}</s></p>` : ""}
  `;

  const bookUrl = resolvePortalUrl(portalUrl, "/members/book");

  const SLUG = "booking-cancellation";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nYour booking has been cancelled.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride("Want to rebook? Tap below.", branding, SLUG, "outro", tokens);
  const ctaLabelOverride = applyOverride("Book a bay", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Cancelled: ${start.date} at ${start.time}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`Cancelled: ${start.date} · ${start.time}`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Booking cancelled",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: bookUrl ? { label: ctaLabelOverride, url: bookUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Welcome Email (new membership) ---
export async function sendWelcomeEmail({
  tenantId, to, customerName, tier, monthlyFee, includedHours, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const isUnlimited = Number(includedHours) >= 99999;
  const venueName = branding?.app_name || tenantEmail?.name || "us";

  const tokens = {
    "{name}":           customerName || "there",
    "{venue}":          venueName,
    "{tier}":           String(tier || ""),
    "{monthly_fee}":    `${Number(monthlyFee || 0).toFixed(0)}`,
    "{included_hours}": isUnlimited ? "Unlimited" : String(includedHours || 0),
  };

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">🏆 <strong>${escapeHtml(tier)} Membership</strong></p>
    <p style="margin: 0 0 6px 0;">💳 <strong>$${Number(monthlyFee).toFixed(0)} a month</strong></p>
    <p style="margin: 0;">⏰ <strong>${isUnlimited ? "Unlimited play" : `${includedHours} hours each month`}</strong></p>
  `;

  const dashboardUrl = resolvePortalUrl(portalUrl, "/members/dashboard");
  const bookUrl = resolvePortalUrl(portalUrl, "/members/book");

  const SLUG = "welcome";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},\n\nWelcome to ${escapeHtml(venueName)} — you're officially a ${escapeHtml(tier)} member. Here's your plan at a glance:`;
  const introOverride = applyOverride(introDefault, branding, SLUG, "intro", tokens);
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroDefault = `Everything you need lives in the member portal — book bays, check your usage, shop the pro shop, adjust your plan whenever you like.`;
  const outroOverride = applyOverride(outroDefault, branding, SLUG, "outro", tokens);
  const ctaLabelDefault = bookUrl ? "Book your first bay" : "Open dashboard";
  const ctaLabelOverride = applyOverride(ctaLabelDefault, branding, SLUG, "cta_label", tokens);
  const subjectDefault = `Welcome to ${venueName} · ${tier} member`;
  const subjectOverride = applyOverride(subjectDefault, branding, SLUG, "subject", tokens);
  const preheaderDefault = `You're in. ${tier} member · ${isUnlimited ? "unlimited play" : `${includedHours} hours each month`}.`;
  const preheaderOverride = applyOverride(preheaderDefault, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0 0 14px 0;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: `Welcome to ${venueName}`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: bookUrl ? { label: ctaLabelOverride, url: bookUrl } : (dashboardUrl ? { label: ctaLabelOverride, url: dashboardUrl } : null),
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Payment Receipt ---
export async function sendPaymentReceiptEmail({
  tenantId, to, customerName, amount, description, date, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const dollars = (Number(amount) / 100).toFixed(2);
  const receiptDate = date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const tokens = {
    "{name}":        customerName || "there",
    "{venue}":       venueName,
    "{amount}":      dollars,
    "{description}": description || `${venueName} Payment`,
    "{date}":        receiptDate,
  };

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">💳 <strong>$${dollars}</strong></p>
    <p style="margin: 0 0 6px 0;">📄 <strong>${escapeHtml(description || `${venueName} Payment`)}</strong></p>
    <p style="margin: 0;">📅 <strong>${escapeHtml(receiptDate)}</strong></p>
  `;

  const billingUrl = resolvePortalUrl(portalUrl, "/members/billing");

  const SLUG = "payment-receipt";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nHere's your receipt:`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride("Your full billing history is in the member portal.", branding, SLUG, "outro", tokens);
  const ctaLabelOverride = applyOverride("View billing", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Receipt: $${dollars} · ${venueName}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`$${dollars} · ${description || `${venueName} Payment`}`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Payment receipt",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: billingUrl ? { label: ctaLabelOverride, url: billingUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Launch broadcast: announce the new member app to every member ---
//
// Sent via /api/admin-broadcast-launch (admin-triggered, one-off).
// CTA lands on /members — the sign-in page — so the member is one tap
// away from their account. The /app install explainer exists but is
// one extra click too far for the launch nudge. Members who want the
// Add-to-Home-Screen walkthrough still find /app via the sign-in page
// and elsewhere. `path` defaults to "/members" but can be overridden.
export async function sendLaunchEmail({
  tenantId, to, customerName, portalUrl, path = "/members", _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const signInUrl = resolvePortalUrl(portalUrl, path);

  const tokens = {
    "{name}":  customerName || "there",
    "{venue}": venueName,
  };

  const SLUG = "launch";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},\n\nI'm excited to share that the new app custom built for ${escapeHtml(venueName)} has LAUNCHED! I'm pretty excited about this one, and i think you will be too...\n\nIt's the new home for everything you do with the club — booking a bay, edit and extend sessions, access door codes, see upcoming events, peruse the pro shop and make requests, and control your membership — all in one place on your phone.`;
  const introOverride = applyOverride(introDefault, branding, SLUG, "intro", tokens);
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");

  const outroOverride = applyOverride(
    "Questions or need a hand getting in? Just hit reply — I'd love to help.",
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride(`Open ${venueName}`, branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`The ${venueName} APP is LIVE`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(
    `Booking, door codes, pro shop, membership — all in your pocket. Get set up in two minutes.`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    ${introHtml}
    <p style="margin: 0 0 12px 0;"><strong>Getting set up is FAST:</strong></p>
    <ol style="margin: 0 0 14px 20px; padding: 0; font-size: 14px; line-height: 1.65;">
      <li>Tap the button below on your phone.</li>
      <li>Sign in with this email: <strong>${escapeHtml(to)}</strong>. Since you haven't set an app password yet, just type anything in the password field — we'll walk you through creating a real one on the next screen.</li>
      <li>(If it's your first time with us, you'll see a <strong>Create account</strong> button after signing in. Tap that and you're on your way.)</li>
      <li>Once you're signed in, tap your browser's menu (3 little dots), click Share, view more options and <strong>Add to Home Screen</strong> so the app opens full-screen and saves to your phones home page</li>
    </ol>
    <p style="margin: 0 0 12px 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: `The ${venueName} app is LIVE`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: signInUrl ? { label: ctaLabelOverride, url: signInUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "Reply any time — I'd love to help.",
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Skedda → new-portal cutover: three-phase member communication ---
//
// See docs/SKEDDA_CUTOVER_PLAN.md for the full timeline.
//
// All three emails carry the same DNA: explain what's happening, show
// the member WHICH email we have on file (embedded inline so there's
// zero ambiguity), give the 3-step sign-in flow, offer a reply-to-this
// human escape hatch. `cutoverDate` is a JS Date passed in at send
// time so the admin picks the date in the Config UI — no hardcoded
// days in the template.

function formatCutoverDate(d) {
  if (!d) return "soon";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ,
  });
}

// Shared 3-step block — same instructions on all three emails so a
// member reading the second or third email isn't re-learning the
// flow. `recipientEmail` is embedded so the member sees the exact
// address to use and never has to guess between personal/work mail.
function cutoverSignInSteps(venueName, recipientEmail) {
  return `
    <ol style="margin: 0 0 14px 20px; padding: 0; font-size: 14px; line-height: 1.65;">
      <li>Tap the button below on your phone to open ${escapeHtml(venueName)}.</li>
      <li>Sign in with this email: <strong>${escapeHtml(recipientEmail)}</strong>. Since you haven't set an app password yet, just type anything in the password field — we'll walk you through creating a real one on the next screen.</li>
      <li>If it's your first time with us, you'll see a <strong>Create account</strong> button after signing in. Tap that and you're on your way.</li>
    </ol>
  `;
}

// --- Cutover #1: Announcement (T−14) ---
export async function sendCutoverAnnouncement({
  tenantId, to, customerName, portalUrl, cutoverDate, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const signInUrl = resolvePortalUrl(portalUrl, "/members");
  const dateStr = formatCutoverDate(cutoverDate);

  const tokens = {
    "{name}":         customerName || "there",
    "{venue}":        venueName,
    "{cutover_date}": dateStr,
  };

  const SLUG = "cutover-announcement";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},\n\nWe're excited to share that the new ${escapeHtml(venueName)} app is ready. It's the new home for everything — booking a bay, your live door code, the pro shop, and your membership — all in one place on your phone.\n\nOn ${escapeHtml(dateStr)}, the app will become the ONLY way to book with us, and our old Skedda page will retire (RIP). You've got plenty of runway to get signed in whenever it's convenient. Let me know if i can help in any way`;
  const introOverride = applyOverride(introDefault, branding, SLUG, "intro", tokens);
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroDefault = `Any time before ${escapeHtml(dateStr)} works — once you're signed in, you're set.\n\nQuestions or need a hand getting in? Just hit reply — we'd love to help.`;
  const outroOverride = applyOverride(outroDefault, branding, SLUG, "outro", tokens);
  const outroHtml = outroOverride
    .split(/\n{2,}/)
    .map((para, i) => i === 0
      ? `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`
      : `<p style="margin: 0 0 12px 0; font-size: 13px; color: #6B7A6F;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const ctaLabelOverride = applyOverride(`Open ${venueName}`, branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Meet the new ${venueName} app`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(
    `Booking, door codes, pro shop, membership — all in your pocket. Get set up in two minutes.`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    ${introHtml}
    <p style="margin: 0 0 10px 0;"><strong>It takes under two minutes to get set up:</strong></p>
    ${cutoverSignInSteps(venueName, to)}
    ${outroHtml}
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: `The new ${venueName} app is here`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: signInUrl ? { label: ctaLabelOverride, url: signInUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "Reply any time — we read every message.",
  });

  if (_preview) return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  return sendEmail({
    to, subject: subjectOverride, html, text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Cutover #2: T−3 reminder ---
// Broadcast endpoint filters to members with first_app_login_at IS
// NULL so members already onboarded don't get nagged. `daysUntil` is
// computed from cutoverDate at send time and drives the headline.
export async function sendCutoverReminder({
  tenantId, to, customerName, portalUrl, cutoverDate, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const signInUrl = resolvePortalUrl(portalUrl, "/members");
  const dateStr = formatCutoverDate(cutoverDate);
  const daysUntil = cutoverDate
    ? Math.max(0, Math.ceil((new Date(cutoverDate) - new Date()) / 86_400_000))
    : 3;
  const daysLabel = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `${daysUntil} days`;

  const tokens = {
    "{name}":         customerName || "there",
    "{venue}":        venueName,
    "{cutover_date}": dateStr,
  };

  const SLUG = "cutover-reminder";
  const introDefault = `Hey ${escapeHtml(customerName || "there")},\n\nJust a friendly nudge — the ${escapeHtml(venueName)} app takes over for booking in ${escapeHtml(daysLabel)} (on ${escapeHtml(dateStr)}), and we wanted to make sure you had a chance to get signed in before then.\n\nOnce you're set up, reserving your next session is just a couple of taps from your home screen. Here's the quick walkthrough:`;
  const introOverride = applyOverride(introDefault, branding, SLUG, "intro", tokens);
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    `If anything is getting in the way, reply to this email and we'll get you sorted. Happy to walk you through it by phone or text too.`,
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride(`Open ${venueName}`, branding, SLUG, "cta_label", tokens);
  const subjectDefault = daysUntil === 0
    ? `A quick heads-up from ${venueName}`
    : `${daysLabel} until the ${venueName} app switchover`;
  const subjectOverride = applyOverride(subjectDefault, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(
    `${daysUntil === 0 ? "Today's the switchover" : `${daysLabel} until the switchover`} — here's the two-minute setup.`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    ${introHtml}
    ${cutoverSignInSteps(venueName, to)}
    <p style="margin: 0 0 14px 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: daysUntil === 0
      ? `${venueName} switches to the app today`
      : `A heads-up from ${venueName}`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: signInUrl ? { label: ctaLabelOverride, url: signInUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "Reply any time — we're happy to help you get in.",
  });

  if (_preview) return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  return sendEmail({
    to, subject: subjectOverride, html, text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Cutover #3: Post-cutover (T=0, day-of) ---
// Two variants in one template based on whether the member has ever
// logged in (alreadyOnApp). Admin-side broadcast passes the flag
// per-recipient from the members table.
export async function sendCutoverComplete({
  tenantId, to, customerName, portalUrl, alreadyOnApp, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const signInUrl = resolvePortalUrl(portalUrl, "/members");

  // Two distinct templates based on alreadyOnApp — separate slugs so
  // admin can edit each variant independently.
  const SLUG = alreadyOnApp ? "cutover-complete-member" : "cutover-complete-new";
  const tokens = {
    "{name}":  customerName || "there",
    "{venue}": venueName,
  };

  let introOverride;
  let outroOverride;
  let bodyHtml;
  if (alreadyOnApp) {
    introOverride = applyOverride(
      `Hey ${escapeHtml(customerName || "there")},\n\nToday's the day — the new ${escapeHtml(venueName)} app officially takes over for booking. Thanks for making the switch early; you're all set.`,
      branding, SLUG, "intro", tokens,
    );
    outroOverride = applyOverride("Thanks for coming along for the ride. See you at the club.", branding, SLUG, "outro", tokens);
    const introHtml = introOverride
      .split(/\n{2,}/)
      .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
      .join("");
    bodyHtml = `
      ${introHtml}
      <p style="margin: 0 0 12px 0;"><strong>Here's what's waiting for you:</strong></p>
      <ul style="margin: 0 0 14px 20px; padding: 0; font-size: 14px; line-height: 1.65;">
        <li>📅 Book bays right from your home screen</li>
        <li>🔑 Your door code appears about 10 minutes before each session</li>
        <li>🛍️ The pro shop lives in-app, and shipping's on us over $100</li>
        <li>⭐ Manage your membership — upgrade, pause, cancel — any time, right from Account</li>
      </ul>
      <p style="margin: 0 0 12px 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
    `;
  } else {
    introOverride = applyOverride(
      `Hey ${escapeHtml(customerName || "there")},\n\nToday's the day the new ${escapeHtml(venueName)} app becomes the home for booking. Whenever you're ready, here's the walkthrough to get you in:`,
      branding, SLUG, "intro", tokens,
    );
    outroOverride = applyOverride(
      "Once you're in, booking your next session is just a couple of taps. If anything is in the way, reply to this email — we'd love to help you through it.",
      branding, SLUG, "outro", tokens,
    );
    const introHtml = introOverride
      .split(/\n{2,}/)
      .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
      .join("");
    bodyHtml = `
      ${introHtml}
      ${cutoverSignInSteps(venueName, to)}
      <p style="margin: 0 0 14px 0;">${escapeHtml(outroOverride)}</p>
    `;
  }

  const ctaLabelOverride = applyOverride(`Open ${venueName}`, branding, SLUG, "cta_label", tokens);
  const subjectDefault = alreadyOnApp
    ? `The ${venueName} app is now live`
    : `Welcome to the ${venueName} app`;
  const subjectOverride = applyOverride(subjectDefault, branding, SLUG, "subject", tokens);
  const preheaderDefault = alreadyOnApp
    ? `You're set. Booking, door codes, pro shop — all in your pocket.`
    : `Today's the switchover. Here's the quick setup whenever you're ready.`;
  const preheaderOverride = applyOverride(preheaderDefault, branding, SLUG, "preheader", tokens);

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: alreadyOnApp
      ? `The ${venueName} app is now live`
      : `Welcome to the ${venueName} app`,
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: signInUrl ? { label: ctaLabelOverride, url: signInUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "See you out there.",
  });

  if (_preview) return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  return sendEmail({
    to, subject: subjectOverride, html, text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Payment failed: polite first-attempt reminder with Update Card CTA ---
//
// Fires from the invoice.payment_failed webhook when attempt_count === 1.
// Subsequent retries from Stripe's Smart Retries don't spam the member
// again — rely on Stripe's own customer emails (Stripe Dashboard →
// Settings → Customer emails) for the mid-cycle reminders, or add a
// second-touch here later.
//
// Tone: friendly, not accusatory. Card declines are usually banks being
// banks, not members not caring. The action the member takes is
// identical to any other card-update flow: /members/billing → Update
// Card → they re-enter a card via a Stripe Checkout session in setup
// mode. Stripe's Smart Retries will automatically try the new card.
export async function sendPaymentFailedEmail({
  tenantId, to, customerName, amount, description, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const dollars = (Number(amount || 0) / 100).toFixed(2);
  const billingUrl = resolvePortalUrl(portalUrl, "/members/billing");

  const tokens = {
    "{name}":        customerName || "there",
    "{venue}":       venueName,
    "{amount}":      dollars,
    "{description}": description || `${venueName} membership`,
  };

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">💳 <strong>$${dollars}</strong></p>
    <p style="margin: 0;">📄 <strong>${escapeHtml(description || `${venueName} membership`)}</strong></p>
  `;

  const SLUG = "payment-failed";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nYour most recent ${escapeHtml(venueName)} membership payment didn't go through — usually the card on file expired, the bank flagged it, or the limit was hit. Nothing's wrong on your end if you weren't expecting it.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    `Tap the button below to update your card. Once a new card is on file, we'll retry the charge automatically — you don't need to do anything else.\n\nYour access + booking window stay active while you sort this out. If we don't hear back we'll try the card again in a few days.`,
    branding, SLUG, "outro", tokens,
  );
  const outroHtml = outroOverride
    .split(/\n{2,}/)
    .map((para, i) => i === 0
      ? `<p style="margin: 14px 0 0 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`
      : `<p style="margin: 12px 0 0 0; font-size: 12px; color: #6B7A6F;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const ctaLabelOverride = applyOverride("Update card", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Update your card — ${venueName} payment declined`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`Update your card to keep your ${venueName} membership active.`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    ${outroHtml}
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Payment didn't go through",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: billingUrl ? { label: ctaLabelOverride, url: billingUrl } : null,
    footerText: tenantEmail?.email_footer_text,
    footerNote: "Questions? Reply to this email — a human reads every reply.",
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Pro-shop request: admin notification on new submission ---
export async function sendShopRequestAdminNotification({ tenantId, request, _preview }) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const notifyTo = tenantEmail?.email_notification_to;
  if (!notifyTo) {
    return { skipped: true, reason: "no_notification_email" };
  }
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const r = request || {};
  const optionalLines = [
    r.brand        && `<strong>Brand:</strong> ${escapeHtml(r.brand)}`,
    r.size         && `<strong>Size:</strong> ${escapeHtml(r.size)}`,
    r.color        && `<strong>Color:</strong> ${escapeHtml(r.color)}`,
    r.quantity > 1 && `<strong>Qty:</strong> ${Number(r.quantity)}`,
    r.budget_range && `<strong>Budget:</strong> ${escapeHtml(r.budget_range)}`,
    r.reference_url && `<strong>Reference:</strong> <a href="${escapeAttr(r.reference_url)}" style="color: #4C8D73;">${escapeHtml(r.reference_url)}</a>`,
  ].filter(Boolean).map((line) => `<p style="margin: 0 0 6px 0;">${line}</p>`).join("");

  const detailHtml = `
    <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>${escapeHtml(r.item_name)}</strong></p>
    ${optionalLines}
  `;

  const notesBlock = r.notes
    ? `<div style="margin-top: 12px; padding: 10px 12px; background: #F4F6F2; border-radius: 6px; font-size: 13px;"><strong>Notes:</strong> ${escapeHtml(r.notes)}</div>`
    : "";

  // If the member attached a photo, embed it inline (capped at 360px wide so
  // it renders cleanly on mobile mail clients) and link out to the full-size
  // asset. The image URL is validated at save time to point at our own
  // Supabase Storage shop bucket, so it's safe to render.
  const imageBlock = r.image_url
    ? `<div style="margin-top: 12px;"><a href="${escapeAttr(r.image_url)}" style="display: inline-block;"><img src="${escapeAttr(r.image_url)}" alt="Member-provided photo" style="max-width: 360px; width: 100%; height: auto; border-radius: 8px; border: 1px solid #E6EADF;"/></a></div>`
    : "";

  const tokens = {
    "{venue}":        venueName,
    "{item_name}":    r.item_name || "(unknown)",
    "{brand}":        r.brand || "",
    "{member_name}":  r.member_name || r.member_email || "(unknown)",
    "{member_email}": r.member_email || "",
  };

  const SLUG = "shop-request-admin";
  const introOverride = applyOverride(
    `${escapeHtml(r.member_name || r.member_email)} would like:`,
    branding, SLUG, "intro", tokens,
  );
  const outroOverride = applyOverride(
    `Contact: ${escapeHtml(r.member_email)}${r.member_phone ? ` / ${escapeHtml(r.member_phone)}` : ""}`,
    branding, SLUG, "outro", tokens,
  );
  const subjectOverride = applyOverride(`Pro Shop request: ${r.item_name}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(
    `${r.member_name || r.member_email}: ${r.item_name}`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    <p style="margin: 0 0 14px 0;">${escapeHtml(introOverride)}</p>
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    ${imageBlock}
    ${notesBlock}
    <p style="margin: 14px 0 0 0; font-size: 12px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Pro Shop request",
    preheader: preheaderOverride,
    bodyHtml,
    footerText: `${venueName} · Admin notification`,
    footerNote: "Manage requests in your admin dashboard.",
  });

  if (_preview) {
    return { preview: true, to: notifyTo, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to: notifyTo,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Pro-shop request: "ready for pickup" member notification ---
export async function sendShopRequestReadyEmail({
  tenantId, to, memberName, itemName, brand, size, color, quantity, adminResponse, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const detailBits = [
    brand && `Brand: ${brand}`,
    size  && `Size: ${size}`,
    color && `Color: ${color}`,
    quantity > 1 && `Qty: ${quantity}`,
  ].filter(Boolean).join(" · ");

  const detailHtml = `
    <p style="margin: 0 0 4px 0; font-size: 16px;"><strong>${escapeHtml(itemName)}</strong></p>
    ${detailBits ? `<p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(detailBits)}</p>` : ""}
  `;

  const adminBlock = adminResponse
    ? `<div style="margin-top: 12px; padding: 10px 12px; background: #F4F6F2; border-radius: 6px; font-size: 13px;"><strong>From ${escapeHtml(venueName)}:</strong> ${escapeHtml(adminResponse)}</div>`
    : "";

  const tokens = {
    "{name}":           memberName || "there",
    "{venue}":          venueName,
    "{item_name}":      itemName || "(item)",
    "{brand}":          brand || "",
    "{admin_response}": adminResponse || "",
  };

  const SLUG = "shop-request-ready";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(memberName || "there")},\n\nGood news — the item you requested is ready to pick up at ${escapeHtml(venueName)}.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    `Come grab it on your next visit. Thanks for letting us know what you wanted.`,
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride("Open Pro Shop", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Your ${venueName} request is ready: ${itemName}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`${itemName} ready for pickup at ${venueName}`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    ${adminBlock}
    <p style="margin: 14px 0 0 0;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Your item is in",
    preheader: preheaderOverride,
    bodyHtml,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// --- Shipment delivered ---
export async function sendShipmentDeliveredEmail({
  tenantId, to, trackingNumber, carrier, service, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const carrierLine = carrier ? `${carrier}${service ? ` ${service}` : ""}` : "your carrier";

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">📦 Shipped via <strong>${escapeHtml(carrierLine)}</strong></p>
    <p style="margin: 0;">🔢 Tracking <strong style="font-family: ui-monospace, Menlo, monospace;">${escapeHtml(trackingNumber || "")}</strong></p>
  `;

  const ordersUrl = resolvePortalUrl(portalUrl, "/members/shop");

  const tokens = {
    "{name}":            "there", // shipment-delivered receives no customerName today
    "{venue}":           venueName,
    "{tracking_number}": trackingNumber || "",
    "{carrier}":         carrierLine,
  };

  const SLUG = "shipment-delivered";
  const introOverride = applyOverride(
    `Good news — your ${escapeHtml(venueName)} order just arrived.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    `See all of your orders anytime in the ${escapeHtml(venueName)} portal.`,
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride("View orders", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Delivered: your ${venueName} order`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`Your ${venueName} order arrived`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Delivered",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: ordersUrl ? { label: ctaLabelOverride, url: ordersUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Password Reset ---
export async function sendPasswordResetEmail({
  tenantId, to, customerName, resetUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";

  const tokens = {
    "{name}":      customerName || "there",
    "{venue}":     venueName,
    "{reset_url}": resetUrl || "",
  };

  const SLUG = "password-reset";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nWe received a request to reset your password. Tap below to choose a new one.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    `This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.`,
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride("Reset password", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Reset your ${venueName} password`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`Reset your ${venueName} password (link expires in 1 hour)`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    <p style="margin: 14px 0 0 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Reset your password",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: resetUrl ? { label: ctaLabelOverride, url: resetUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// --- Pro Shop Order Notification (to admin) ---
export async function sendShopOrderNotification({
  tenantId, customerName, customerEmail, items, total, discountPct, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const notifyTo = tenantEmail?.email_notification_to;

  if (!notifyTo) {
    console.warn(`sendShopOrderNotification: no email_notification_to set for tenant ${tenantId}, skipping`);
    return { skipped: true, reason: "no_notification_email" };
  }

  const itemRows = items.map((li) =>
    `<tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E2E8DD;">${escapeHtml(li.title)}${li.size ? ` (${escapeHtml(li.size)})` : ""}${li.quantity > 1 ? ` ×${li.quantity}` : ""}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E2E8DD; text-align: right;">$${li.lineTotal.toFixed(2)}</td>
    </tr>`
  ).join("");

  const detailHtml = `
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${itemRows}
    </table>
    ${discountPct > 0 ? `<p style="margin: 8px 0 4px 0; font-size: 12px; color: #6B7A6F;">Member discount applied: ${discountPct}%</p>` : ""}
    <p style="margin: 8px 0 0 0; font-size: 16px; font-weight: 700;">Total: $${total.toFixed(2)}</p>
  `;

  const tokens = {
    "{venue}":           venueName,
    "{order_id}":        "(order)", // not present in this function signature today
    "{member_name}":     customerName || customerEmail || "(unknown)",
    "{member_email}":    customerEmail || "",
    "{total}":           total.toFixed(2),
    "{delivery_method}": "pickup", // default — in-person orders only today
  };

  const SLUG = "shop-order-notification";
  const introOverride = applyOverride(
    `${escapeHtml(customerName || customerEmail)} just placed an order.`,
    branding, SLUG, "intro", tokens,
  );
  const outroOverride = applyOverride(
    `Payment collected. Items ready for pickup at next visit.`,
    branding, SLUG, "outro", tokens,
  );
  const subjectOverride = applyOverride(
    `Pro Shop order: ${customerName || customerEmail} · $${total.toFixed(2)}`,
    branding, SLUG, "subject", tokens,
  );
  const preheaderOverride = applyOverride(
    `${customerName || customerEmail} · $${total.toFixed(2)}`,
    branding, SLUG, "preheader", tokens,
  );

  const bodyHtml = `
    <p style="margin: 0 0 14px 0;">${escapeHtml(introOverride)}</p>
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "New Pro Shop order",
    preheader: preheaderOverride,
    bodyHtml,
    footerText: `${venueName} · Admin notification`,
  });

  if (_preview) {
    return { preview: true, to: notifyTo, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to: notifyTo,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// Member-facing refund notice. Sent after /api/admin-refund-order
// successfully issues a Stripe refund. Non-fatal on send failure —
// the refund already fired, this is just a receipt-style courtesy.
export async function sendShopRefundNotice({
  tenantId, to, customerName, amountCents, reason, stripeRefundId, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const dollars = (Number(amountCents) / 100).toFixed(2);
  const ordersUrl = resolvePortalUrl(portalUrl, "/members/shop");

  const detailHtml = `
    <p style="margin: 0 0 6px 0;">💸 <strong>$${dollars}</strong> refunded to your card</p>
    ${reason ? `<p style="margin: 0 0 6px 0;">📝 <strong>${escapeHtml(reason)}</strong></p>` : ""}
    <p style="margin: 0; font-size: 12px; color: #6B7A6F;">Ref: ${escapeHtml(stripeRefundId || "—")}</p>
  `;

  const tokens = {
    "{name}":   customerName || "there",
    "{venue}":  venueName,
    "{amount}": dollars,
    "{reason}": reason || "",
  };

  const SLUG = "shop-refund";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nWe've issued a refund on your ${escapeHtml(venueName)} pro shop order.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    "It can take 5–10 business days for your bank to show the credit.",
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride("View your orders", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Refund: $${dollars} · ${venueName}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`$${dollars} refunded · ${venueName}`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Refund issued",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: ordersUrl ? { label: ctaLabelOverride, url: ordersUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}

// Abandoned-cart nudge. Fired by the daily /api/cron-abandoned-carts
// for members whose carts have been sitting for 48h+ without a
// recent reminder. Short, friendly; one CTA back to the shop.
export async function sendAbandonedCartEmail({
  tenantId, to, customerName, items, total, portalUrl, _preview,
}) {
  const { tenantEmail, branding } = await loadTenantContext(tenantId);
  const venueName = branding?.app_name || tenantEmail?.name || "Ourlee";
  const shopUrl = resolvePortalUrl(portalUrl, "/members/shop");

  const itemRows = (items || []).slice(0, 5).map((li) =>
    `<tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E2E8DD;">${escapeHtml(li.title)}${li.size ? ` (${escapeHtml(li.size)})` : ""}${li.quantity > 1 ? ` ×${li.quantity}` : ""}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #E2E8DD; text-align: right;">$${Number(li.lineTotal || 0).toFixed(2)}</td>
    </tr>`
  ).join("");
  const hiddenCount = Math.max(0, (items || []).length - 5);

  const detailHtml = `
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${itemRows}
    </table>
    ${hiddenCount > 0 ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #6B7A6F;">+${hiddenCount} more item${hiddenCount === 1 ? "" : "s"}</p>` : ""}
    <p style="margin: 8px 0 0 0; font-size: 16px; font-weight: 700;">Cart total: $${Number(total || 0).toFixed(2)}</p>
  `;

  const tokens = {
    "{name}":  customerName || "there",
    "{venue}": venueName,
    "{total}": Number(total || 0).toFixed(2),
  };

  const SLUG = "abandoned-cart";
  const introOverride = applyOverride(
    `Hey ${escapeHtml(customerName || "there")},\n\nYou left some good stuff in your ${escapeHtml(venueName)} pro shop cart.`,
    branding, SLUG, "intro", tokens,
  );
  const introHtml = introOverride
    .split(/\n{2,}/)
    .map((para) => `<p style="margin: 0 0 14px 0;">${para.split("\n").map(escapeHtml).join("<br/>")}</p>`)
    .join("");
  const outroOverride = applyOverride(
    "Stock is limited on drops — pick up where you left off.",
    branding, SLUG, "outro", tokens,
  );
  const ctaLabelOverride = applyOverride("Back to the shop", branding, SLUG, "cta_label", tokens);
  const subjectOverride = applyOverride(`Still thinking it over? · ${venueName}`, branding, SLUG, "subject", tokens);
  const preheaderOverride = applyOverride(`Your ${venueName} cart is waiting`, branding, SLUG, "preheader", tokens);

  const bodyHtml = `
    ${introHtml}
    ${renderDetailBox({ palette: { cream: branding?.cream_color || "#EDF3E3" }, bodyHtml: detailHtml })}
    <p style="margin: 0; font-size: 13px; color: #6B7A6F;">${escapeHtml(outroOverride)}</p>
  `;

  const { html, text } = await renderEmailLayout({
    tenantId,
    branding,
    title: "Still thinking it over?",
    preheader: preheaderOverride,
    bodyHtml,
    ctaButton: shopUrl ? { label: ctaLabelOverride, url: shopUrl } : null,
    footerText: tenantEmail?.email_footer_text,
  });

  if (_preview) {
    return { preview: true, to, from: tenantEmail?.email_from, subject: subjectOverride, html, text };
  }
  return sendEmail({
    to,
    subject: subjectOverride,
    html,
    text,
    fromOverride: tenantEmail?.email_from,
  });
}
