// Shared email sending logic. Calls the Resend API directly — no self-fetch needed.

const TZ = "America/Los_Angeles";

function toPacific(dt) {
  const date = dt.toLocaleDateString("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
  });
  const time = dt.toLocaleTimeString("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
  });
  return { date, time };
}

// --- Shared send helper ---
async function sendEmail({ to, subject, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Hour Golf <onboarding@resend.dev>";

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return { skipped: true, reason: "no_api_key" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
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
export async function sendBookingConfirmation({ to, customerName, bay, bookingStart, bookingEnd }) {
  const start = toPacific(new Date(bookingStart));
  const end = toPacific(new Date(bookingEnd));
  const durationHrs = Math.round(Math.max(0, (new Date(bookingEnd) - new Date(bookingStart)) / 3600000) * 10) / 10;

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
  <div style="background: #006044; color: #ffffff; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px 0;">
    <p style="margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;">You\u2019ll receive your access code closer to your booking time.</p>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">You can cancel from your member portal up to 6 hours before your booking.</p>
  <p style="margin: 0 0 4px 0;">See you soon!</p>
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>`;

  return sendEmail({ to, subject: `Booking Confirmed \u2705 ${start.date}`, html });
}

// --- Cancellation Confirmation ---
export async function sendCancellationEmail({ to, customerName, bay, bookingStart, bookingEnd }) {
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
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>`;

  return sendEmail({ to, subject: `Booking Cancelled \u2014 ${start.date}`, html });
}

// --- Welcome Email (new membership) ---
export async function sendWelcomeEmail({ to, customerName, tier, monthlyFee, includedHours }) {
  const isUnlimited = Number(includedHours) >= 99999;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Welcome to Hour Golf! \u26f3</h2>
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
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>`;

  return sendEmail({ to, subject: `Welcome to Hour Golf! \u26f3 ${tier} Member`, html });
}

// --- Payment Receipt ---
export async function sendPaymentReceiptEmail({ to, customerName, amount, description, date }) {
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Payment Receipt \ud83d\udce7</h2>
  <p style="margin: 0 0 16px 0;">Hey ${customerName || "there"},</p>
  <p style="margin: 0 0 16px 0;">Here\u2019s your receipt:</p>
  <div style="background: #e7efd8; border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
    <p style="margin: 0 0 8px 0;">\ud83d\udcb3 <strong>$${(Number(amount) / 100).toFixed(2)}</strong></p>
    <p style="margin: 0 0 8px 0;">\ud83d\udcc4 <strong>${description || "Hour Golf Payment"}</strong></p>
    <p style="margin: 0;">\ud83d\udcc5 <strong>${date || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong></p>
  </div>
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">View your full billing history in the member portal.</p>
  <p style="margin: 0 0 4px 0;">Thanks,</p>
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>`;

  return sendEmail({ to, subject: `Payment Receipt \u2014 $${(Number(amount) / 100).toFixed(2)}`, html });
}

// --- Password Reset ---
export async function sendPasswordResetEmail({ to, customerName, resetUrl }) {
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
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>`;

  return sendEmail({ to, subject: "Reset Your Password \u2014 Hour Golf", html });
}
