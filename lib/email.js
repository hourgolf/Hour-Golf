// Shared email sending logic. Calls the Resend API directly — no
// self-fetch needed.

import { loadFeatures, isFeatureEnabled } from "./tenant-features";
//
// Every exported email function takes `tenantId` as its first arg and
// injects the tenant's name + footer into the template. Admin-facing
// emails (e.g. Pro Shop order notifications) land in the tenant's
// configured notification inbox, not Hour Golf's.
//
// Config source: public.tenants columns `name`, `email_from`,
// `email_notification_to`, `email_footer_text` (see migration
// 20260417220000_tenants_email_config.sql). Fallbacks when a field is
// null are documented per-field below.
//
// Cache: module-scope 60s TTL, mirroring lib/branding.js. Warm Vercel
// instances skip the lookup on subsequent calls within the window.

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
    const resolved = {
      name: row.name || "Ourlee",
      email_from: row.email_from || `${row.name || "Ourlee"} <onboarding@resend.dev>`,
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

// Build the standard footer line. Keeps formatting in one place so
// every email looks consistent across templates.
function renderFooter(tenantEmail) {
  const text = tenantEmail?.email_footer_text || "Ourlee";
  return `<p style="margin: 0; color: #666; font-size: 14px;">\u2014 ${text}</p>`;
}

// --- Shared send helper ---
async function sendEmail({ to, subject, html, fromOverride }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const envFallbackFrom =
    process.env.RESEND_FROM_EMAIL || "Ourlee <onboarding@resend.dev>";
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
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
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

// --- Booking Confirmation ---
export async function sendBookingConfirmation({
  tenantId, to, customerName, bay, bookingStart, bookingEnd,
}) {
  const tenant = await loadTenantEmail(tenantId);
  // Access-code feature gates the "You'll receive your access code"
  // promise. Tenants without a keypad/smart-lock integration skip that
  // paragraph entirely so members aren't waiting for a code that will
  // never arrive.
  const features = await loadFeatures(tenantId);
  const accessCodesOn = isFeatureEnabled(features, "access_codes");

  const start = toPacific(new Date(bookingStart));
  const end = toPacific(new Date(bookingEnd));
  const durationHrs =
    Math.round(Math.max(0, (new Date(bookingEnd) - new Date(bookingStart)) / 3600000) * 10) / 10;

  const accessBlock = accessCodesOn
    ? `<div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;">You\u2019ll receive your access code closer to your booking time.</p>
  </div>`
    : "";

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Booking Confirmed \u2705</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">Your bay is booked! Here are your details:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <p style="margin: 0 0 8px 0;">\ud83d\udcc5 <strong>${start.date}</strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udd50 <strong>${start.time} \u2013 ${end.time}</strong></p>
    ${bay ? `<p style="margin: 0 0 8px 0;">\ud83d\udccd <strong>${bay}</strong></p>` : ""}
    <p style="margin: 0;">\u23f1 <strong>${durationHrs} hour${durationHrs !== 1 ? "s" : ""}</strong></p>
  </div>
  ${accessBlock}
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">You can cancel from your member portal up to 6 hours before your booking.</p>
  <p style="margin: 0 0 4px 0;">See you soon!</p>
  ${renderFooter(tenant)}
</div>`;

  return sendEmail({
    to,
    subject: `Booking Confirmed \u2705 ${start.date}`,
    html,
    fromOverride: tenant?.email_from,
  });
}

// --- Cancellation Confirmation ---
export async function sendCancellationEmail({
  tenantId, to, customerName, bay, bookingStart, bookingEnd,
}) {
  const tenant = await loadTenantEmail(tenantId);
  const start = toPacific(new Date(bookingStart));
  const end = toPacific(new Date(bookingEnd));

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Booking Cancelled</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">Your booking has been cancelled:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0; opacity: 0.7;">
    <p style="margin: 0 0 8px 0;">\ud83d\udcc5 <strong><s>${start.date}</s></strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udd50 <strong><s>${start.time} \u2013 ${end.time}</s></strong></p>
    ${bay ? `<p style="margin: 0;"><strong><s>${bay}</s></strong></p>` : ""}
  </div>
  <div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0; font-size: 15px; font-weight: 600;">Want to rebook? Visit your member portal.</p>
  </div>
  <p style="margin: 0 0 4px 0;">Thanks,</p>
  ${renderFooter(tenant)}
</div>`;

  return sendEmail({
    to,
    subject: `Booking Cancelled \u2014 ${start.date}`,
    html,
    fromOverride: tenant?.email_from,
  });
}

// --- Welcome Email (new membership) ---
export async function sendWelcomeEmail({
  tenantId, to, customerName, tier, monthlyFee, includedHours,
}) {
  const tenant = await loadTenantEmail(tenantId);
  const isUnlimited = Number(includedHours) >= 99999;
  const venueName = tenant?.name || "us";

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Welcome to ${venueName}! \u26f3</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">You\u2019re officially a <strong>${tier}</strong> member. Here\u2019s your plan:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <p style="margin: 0 0 8px 0;">\ud83c\udfc6 <strong>${tier} Membership</strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udcb3 <strong>$${Number(monthlyFee).toFixed(0)}/month</strong></p>
    <p style="margin: 0;">\u23f0 <strong>${isUnlimited ? "Unlimited" : includedHours + " hours/month"}</strong></p>
  </div>
  <div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0; font-size: 15px; font-weight: 600;">Book your first bay from the member portal!</p>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">You can manage your membership, book bays, and view your usage anytime from your portal.</p>
  <p style="margin: 0 0 4px 0;">Welcome aboard!</p>
  ${renderFooter(tenant)}
</div>`;

  return sendEmail({
    to,
    subject: `Welcome to ${venueName}! \u26f3 ${tier} Member`,
    html,
    fromOverride: tenant?.email_from,
  });
}

// --- Payment Receipt ---
export async function sendPaymentReceiptEmail({
  tenantId, to, customerName, amount, description, date,
}) {
  const tenant = await loadTenantEmail(tenantId);
  const venueName = tenant?.name || "Ourlee";

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Payment Receipt \ud83d\udce7</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">Here\u2019s your receipt:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <p style="margin: 0 0 8px 0;">\ud83d\udcb3 <strong>$${(Number(amount) / 100).toFixed(2)}</strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udcc4 <strong>${description || `${venueName} Payment`}</strong></p>
    <p style="margin: 0;">\ud83d\udcc5 <strong>${date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong></p>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">View your full billing history in the member portal.</p>
  <p style="margin: 0 0 4px 0;">Thanks,</p>
  ${renderFooter(tenant)}
</div>`;

  return sendEmail({
    to,
    subject: `Payment Receipt \u2014 $${(Number(amount) / 100).toFixed(2)}`,
    html,
    fromOverride: tenant?.email_from,
  });
}

// --- Password Reset ---
export async function sendPasswordResetEmail({
  tenantId, to, customerName, resetUrl,
}) {
  const tenant = await loadTenantEmail(tenantId);
  const venueName = tenant?.name || "Ourlee";

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Reset Your Password</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">We received a request to reset your password. Click the button below to choose a new one:</p>
  <div style="text-align: center; margin: 0 0 24px 0;">
    <a href="${resetUrl}" style="display: inline-block; background: #006044; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px;">Reset Password</a>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">This link will expire in <strong>1 hour</strong>. If you didn\u2019t request a password reset, you can safely ignore this email.</p>
  <p style="margin: 0 0 4px 0;">Thanks,</p>
  ${renderFooter(tenant)}
</div>`;

  return sendEmail({
    to,
    subject: `Reset Your Password \u2014 ${venueName}`,
    html,
    fromOverride: tenant?.email_from,
  });
}

// --- Pro Shop Order Notification (to admin) ---
export async function sendShopOrderNotification({
  tenantId, customerName, customerEmail, items, total, discountPct,
}) {
  const tenant = await loadTenantEmail(tenantId);
  const venueName = tenant?.name || "Ourlee";
  const notifyTo = tenant?.email_notification_to;

  // No notification inbox configured for this tenant — skip cleanly
  // instead of defaulting to another tenant's admin.
  if (!notifyTo) {
    console.warn(`sendShopOrderNotification: no email_notification_to set for tenant ${tenantId}, skipping`);
    return { skipped: true, reason: "no_notification_email" };
  }

  const itemRows = items.map((li) =>
    `<tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${li.title}${li.size ? ` (${li.size})` : ""}${li.quantity > 1 ? ` x${li.quantity}` : ""}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align: right;">$${li.lineTotal.toFixed(2)}</td>
    </tr>`
  ).join("");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">New Pro Shop Order \ud83d\uded2</h2>
  <p style="margin: 0 0 16px 0;"><strong>${customerName || customerEmail}</strong> just placed an order.</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${itemRows}
    </table>
    ${discountPct > 0 ? `<p style="margin: 8px 0 4px 0; font-size: 12px; color: #666;">Member discount: ${discountPct}%</p>` : ""}
    <p style="margin: 8px 0 0 0; font-size: 16px; font-weight: 700;">Total: $${total.toFixed(2)}</p>
  </div>
  <div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0; font-size: 15px; font-weight: 600;">Payment collected. Items ready for pickup at next visit.</p>
  </div>
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 ${venueName} Pro Shop</p>
</div>`;

  return sendEmail({
    to: notifyTo,
    subject: `Pro Shop Order \u2014 ${customerName || customerEmail} ($${total.toFixed(2)})`,
    html,
    fromOverride: tenant?.email_from,
  });
}
