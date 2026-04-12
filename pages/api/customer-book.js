import { SUPABASE_URL, getSupabaseKey } from "../../lib/api-helpers";

const TZ = "America/Los_Angeles";

// Convert a date + time the user picked (in Pacific) to a proper UTC Date object.
// On Vercel the server runs in UTC, so new Date("2026-04-12T10:30:00") would be
// interpreted as 10:30 UTC instead of 10:30 Pacific. This function fixes that.
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

  const { email, name, date, startTime, endTime, bay } = req.body;
  if (!email || !date || !startTime || !endTime || !bay) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const sD = pacificToUTC(date, startTime);
    const eD = pacificToUTC(date, endTime);
    const bookingStartISO = sD.toISOString();
    const bookingEndISO = eD.toISOString();

    // Check overlapping bookings
    const conflicts = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?bay=eq.${encodeURIComponent(bay)}&booking_status=eq.Confirmed&booking_start=lt.${bookingEndISO}&booking_end=gt.${bookingStartISO}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const conflictData = await conflicts.json();

    if (conflictData.length > 0) {
      return res.status(409).json({ error: "Time slot not available", detail: "That bay is already booked during the requested time." });
    }

    const record = {
      booking_id: `portal_${Date.now()}`,
      customer_email: email.toLowerCase().trim(),
      customer_name: name || email,
      booking_start: bookingStartISO,
      booking_end: bookingEndISO,
      duration_hours: Math.round(Math.max(0, (eD - sD) / 3600000) * 100) / 100,
      bay,
      booking_status: "Confirmed",
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

    // Send booking confirmation email (fire-and-forget)
    try {
      const sDate = new Date(booked.booking_start);
      const eDate = new Date(booked.booking_end);
      await fetch(`${req.headers.origin || "http://localhost:3000"}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_key: "booking_confirmation",
          to_email: booked.customer_email,
          variables: {
            customer_name: booked.customer_name || booked.customer_email,
            date: sDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: TZ }),
            start_time: sDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }),
            end_time: eDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }),
            bay: booked.bay,
            duration: Number(booked.duration_hours).toFixed(1),
          },
        }),
      });
    } catch (_) { /* email is best-effort, don't fail the booking */ }

    return res.status(200).json({ success: true, booking: booked });
  } catch (e) {
    console.error("Customer book error:", e);
    return res.status(500).json({ error: "Booking failed", detail: e.message });
  }
}
