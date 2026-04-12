// /pages/api/booking-webhook.js
// Zapier calls this instead of Supabase directly.
// This endpoint handles the insert and lets Supabase triggers do duration calc.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Auth: accept either a shared secret or the Supabase anon key
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const webhookSecret = process.env.WEBHOOK_SECRET || process.env.SUPABASE_ANON_KEY;
  if (token !== webhookSecret && req.headers["x-webhook-secret"] !== webhookSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxpkqbioxoezjmcoylkw.supabase.co";
  // Use the service role key so writes succeed even after RLS is enabled.
  // Falls back to the anon key during the migration window.
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    // Accept single booking or array
    const bookings = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const b of bookings) {
      const record = {
        booking_id: String(b.booking_id || ""),
        customer_email: (b.customer_email || "").toLowerCase().trim(),
        customer_name: b.customer_name || "",
        booking_start: b.booking_start,
        booking_end: b.booking_end,
        // Send whatever duration — the Supabase trigger will override with correct calc
        duration_hours: parseFloat(b.duration_hours) || 0,
        bay: b.bay || b.space_name || "",
        booking_status: b.booking_status || "Confirmed",
      };

      if (!record.booking_id || !record.customer_email || !record.booking_start) {
        results.push({ booking_id: record.booking_id, status: "skipped", reason: "missing required fields" });
        continue;
      }

      // Upsert: insert or update if booking_id already exists
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
        const booked = data[0];
        results.push({ booking_id: record.booking_id, status: "ok", duration_hours: booked?.duration_hours });

        // Send booking confirmation email (fire-and-forget)
        if (booked && record.booking_status === "Confirmed") {
          try {
            const TZ = "America/Los_Angeles";
            const sDate = new Date(booked.booking_start);
            const eDate = new Date(booked.booking_end);
            const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || "https://hour-golf.vercel.app";
            fetch(`${origin}/api/send-email`, {
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
            }).catch(() => {});
          } catch (_) { /* email is best-effort */ }
        }
      } else {
        const err = await resp.text();
        results.push({ booking_id: record.booking_id, status: "error", error: err });
      }
    }

    const ok = results.filter(r => r.status === "ok").length;
    const failed = results.filter(r => r.status === "error").length;

    return res.status(200).json({
      success: true,
      processed: results.length,
      ok,
      failed,
      results,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Webhook failed", detail: err.message });
  }
}
