import { SUPABASE_URL, getSupabaseKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const { email, name, date, startTime, endTime, bay } = req.body;
  if (!email || !date || !startTime || !endTime || !bay) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const bookingStart = `${date}T${startTime}:00`;
    const bookingEnd = `${date}T${endTime}:00`;

    // Check overlapping bookings
    const conflicts = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?bay=eq.${encodeURIComponent(bay)}&booking_status=eq.Confirmed&booking_start=lt.${bookingEnd}&booking_end=gt.${bookingStart}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const conflictData = await conflicts.json();

    if (conflictData.length > 0) {
      return res.status(409).json({ error: "Time slot not available", detail: "That bay is already booked during the requested time." });
    }

    const sD = new Date(bookingStart);
    const eD = new Date(bookingEnd);

    const record = {
      booking_id: `portal_${Date.now()}`,
      customer_email: email.toLowerCase().trim(),
      customer_name: name || email,
      booking_start: sD.toISOString(),
      booking_end: eD.toISOString(),
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
    return res.status(200).json({ success: true, booking: data[0] });
  } catch (e) {
    console.error("Customer book error:", e);
    return res.status(500).json({ error: "Booking failed", detail: e.message });
  }
}
