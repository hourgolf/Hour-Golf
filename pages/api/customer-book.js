import { SUPABASE_URL, getSupabaseKey, getTenantId } from "../../lib/api-helpers";
import { sendBookingConfirmation } from "../../lib/email";

const TZ = "America/Los_Angeles";

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

    // Await the confirmation email. Previously this was fire-and-forget
    // with a swallowed catch, but Vercel can freeze/terminate the
    // serverless process the moment res.json() returns — the Resend
    // fetch then never completes and the email silently vanishes.
    // Caught errors are logged but don't fail the booking response.
    try {
      await sendBookingConfirmation({
        tenantId,
        to: booked.customer_email,
        customerName: booked.customer_name || booked.customer_email,
        bay: booked.bay,
        bookingStart: booked.booking_start,
        bookingEnd: booked.booking_end,
      });
    } catch (emailErr) {
      console.error("Booking confirmation email failed:", emailErr);
    }

    return res.status(200).json({ success: true, booking: booked });
  } catch (e) {
    console.error("Customer book error:", e);
    return res.status(500).json({ error: "Booking failed", detail: e.message });
  }
}
