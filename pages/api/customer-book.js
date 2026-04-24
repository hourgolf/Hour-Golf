import { SUPABASE_URL, getSupabaseKey, getTenantId, getRequestOrigin } from "../../lib/api-helpers";
import { sendBookingConfirmation } from "../../lib/email";

const TZ = "America/Los_Angeles";

// Bound the email send so a slow Resend response can't hold the
// booking confirmation hostage. 5s is conservative — a normal send
// completes in well under 1s. If the email loses the race, we log
// and return success on the booking anyway. The trailing email send
// keeps running in the background; on Vercel Node functions it
// usually finishes even after the response has been sent.
const EMAIL_TIMEOUT_MS = 5000;

// Give the function more headroom than Vercel's 10s default. The
// client fetch has a 30s AbortController; the function should fail
// cleanly within that window if Supabase + Resend pile up.
export const config = { maxDuration: 30 };

// Convert a date + time the user picked (in Pacific) to a proper UTC Date object.
function pacificToUTC(dateStr, timeStr) {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const utcD = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzD = new Date(naive.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(naive.getTime() + (utcD - tzD));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const tenantId = getTenantId(req);
  const { email, name, date, startTime, endTime, bay, terms_accepted } = req.body;
  if (!email || !date || !startTime || !endTime || !bay) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Non-member time restriction: 10 AM - 8 PM only
    const cleanEmail = email.toLowerCase().trim();
    let memberTier = "Non-Member";
    let hasPaymentMethod = false;
    try {
      const memberResp = await fetch(
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&select=tier,stripe_customer_id`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (memberResp.ok) {
        const rows = await memberResp.json();
        if (rows.length) {
          memberTier = rows[0].tier || "Non-Member";
          hasPaymentMethod = !!rows[0].stripe_customer_id;
        }
      }
    } catch (_) { /* default to Non-Member */ }

    // Require payment method on file
    if (!hasPaymentMethod) {
      return res.status(403).json({ error: "Please add a payment method before booking. Go to Billing to add a card." });
    }

    if (memberTier === "Non-Member") {
      if (startTime < "10:00" || endTime > "20:00") {
        return res.status(400).json({ error: "Non-member bookings are restricted to 10:00 AM - 8:00 PM. Upgrade your membership for 24/7 access." });
      }
    }

    const sD = pacificToUTC(date, startTime);
    const eD = pacificToUTC(date, endTime);

    // Reject bookings in the past
    if (sD < new Date()) {
      return res.status(400).json({ error: "Cannot book in the past. Please select a future time." });
    }

    // Reject bookings more than 7 days out
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 8); // 7 days + buffer for timezone
    if (sD > maxDate) {
      return res.status(400).json({ error: "Bookings can only be made up to 7 days in advance." });
    }

    const bookingStartISO = sD.toISOString();
    const bookingEndISO = eD.toISOString();

    // Check overlapping bookings within this tenant
    const conflicts = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?bay=eq.${encodeURIComponent(bay)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=lt.${bookingEndISO}&booking_end=gt.${bookingStartISO}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const conflictData = await conflicts.json();

    if (conflictData.length > 0) {
      return res.status(409).json({ error: "Time slot not available", detail: "That bay is already booked during the requested time." });
    }

    const record = {
      tenant_id: tenantId,
      booking_id: `portal_${Date.now()}`,
      customer_email: email.toLowerCase().trim(),
      customer_name: name || email,
      booking_start: bookingStartISO,
      booking_end: bookingEndISO,
      duration_hours: Math.round(Math.max(0, (eD - sD) / 3600000) * 100) / 100,
      bay,
      booking_status: "Confirmed",
      terms_accepted_at: terms_accepted ? new Date().toISOString() : null,
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify(record),
    });

    if (!resp.ok) throw new Error(await resp.text());

    const data = await resp.json();
    const booked = data[0];

    // Bounded email send. Resend occasionally takes 5-10s when their
    // service is degraded — long enough to push this entire response
    // past Vercel's function timeout, which made the client (especially
    // in flaky in-app browsers like the Google iOS app's webview) sit
    // forever at "loading." Race the email against a 5s timeout: if it
    // wins, we await it; if it loses, we send the booking response and
    // let the email finish in the background. Either way the booking
    // is committed and the client gets an immediate success.
    const emailPromise = sendBookingConfirmation({
      tenantId,
      to: booked.customer_email,
      customerName: booked.customer_name || booked.customer_email,
      bay: booked.bay,
      bookingStart: booked.booking_start,
      bookingEnd: booked.booking_end,
      portalUrl: getRequestOrigin(req),
    }).catch((e) => {
      console.error("Booking confirmation email failed:", e);
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve("__timeout__"), EMAIL_TIMEOUT_MS));
    const winner = await Promise.race([emailPromise, timeout]);
    if (winner === "__timeout__") {
      console.warn("Booking confirmation email exceeded 5s; returning booking + letting email finish in background");
    }

    return res.status(200).json({ success: true, booking: booked });
  } catch (e) {
    console.error("Customer book error:", e);
    return res.status(500).json({ error: "Booking failed", detail: e.message });
  }
}
