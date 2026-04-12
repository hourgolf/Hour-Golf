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

function buildBookingConfirmationHtml(customerName, bay, bookingStart, bookingEnd) {
  const start = toPacific(bookingStart);
  const end = toPacific(bookingEnd);
  const durationHrs = Math.round(Math.max(0, (bookingEnd - bookingStart) / 3600000) * 10) / 10;

  return `
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
  <p style="margin: 0 0 16px 0; font-size: 14px; color: #666;">If you need to cancel or change your booking, please contact us.</p>
  <p style="margin: 0 0 4px 0;">See you soon!</p>
  <p style="margin: 0; color: #666; font-size: 14px;">\u2014 Hour Golf \u00b7 2526 NE 15th Ave, Portland</p>
</div>
`;
}

export async function sendBookingConfirmation({ to, customerName, bay, bookingStart, bookingEnd }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Hour Golf <onboarding@resend.dev>";

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping booking confirmation email");
    return { skipped: true, reason: "no_api_key" };
  }

  const start = toPacific(new Date(bookingStart));
  const html = buildBookingConfirmationHtml(
    customerName,
    bay,
    new Date(bookingStart),
    new Date(bookingEnd)
  );

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: `Booking Confirmed \u2705 ${start.date}`,
        html,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("Resend booking confirmation error:", data);
      return { error: true, detail: data.message || JSON.stringify(data) };
    }

    console.log(`Booking confirmation sent to ${to}, id: ${data.id}`);
    return { success: true, id: data.id };
  } catch (e) {
    console.error("Booking confirmation email failed:", e);
    return { error: true, detail: e.message };
  }
}
