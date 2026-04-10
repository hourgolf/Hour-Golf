// /pages/api/booking-webhook.js
// Zapier calls this to sync bookings into Supabase.
// Auth: accepts Bearer token, x-webhook-secret header, ?secret= query param, or no auth if WEBHOOK_SECRET not set.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Flexible auth: check multiple methods, skip if no secret configured
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace("Bearer ", "");
    const headerSecret = req.headers["x-webhook-secret"];
    const querySecret = req.query.secret;
    const bodySecret = req.body?.webhook_secret;

    const authorized =
      bearerToken === webhookSecret ||
      bearerToken === process.env.SUPABASE_ANON_KEY ||
      headerSecret === webhookSecret ||
      querySecret === webhookSecret ||
      bodySecret === webhookSecret;

    if (!authorized) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const SUPABASE_URL = "https://uxpkqbioxoezjmcoylkw.supabase.co";
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_KEY) {
    return res.status(500).json({ error: "SUPABASE_ANON_KEY not configured" });
  }

  try {
    const bookings = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const b of bookings) {
      const record = {
        booking_id: String(b.booking_id || ""),
        customer_email: (b.customer_email || "").toLowerCase().trim(),
        customer_name: b.customer_name || "",
        booking_start: b.booking_start,
        booking_end: b.booking_end,
        duration_hours: parseFloat(b.duration_hours) || 0,
        bay: b.bay || b.space_name || "",
        booking_status: b.booking_status || "Confirmed",
      };

      if (!record.booking_id || !record.customer_email || !record.booking_start) {
        results.push({ booking_id: record.booking_id, status: "skipped", reason: "missing fields" });
        continue;
      }

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(record),
      });

      if (resp.ok) {
        const data = await resp.json();
        results.push({ booking_id: record.booking_id, status: "ok", duration: data[0]?.duration_hours });
      } else {
        const err = await resp.text();
        results.push({ booking_id: record.booking_id, status: "error", error: err });
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      ok: results.filter(r => r.status === "ok").length,
      failed: results.filter(r => r.status === "error").length,
      results,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
