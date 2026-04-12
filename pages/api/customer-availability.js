import { getSupabaseKey, supaFetch } from "../../lib/api-helpers";

const TZ = "America/Los_Angeles";

// Convert Pacific midnight boundaries to UTC for accurate querying.
function pacificToUTC(dateStr, timeStr) {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const utcD = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzD = new Date(naive.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(naive.getTime() + (utcD - tzD));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date parameter required (YYYY-MM-DD)" });

  try {
    // Convert Pacific day boundaries to UTC so the query matches correctly
    const dayStartUTC = pacificToUTC(date, "00:00").toISOString();
    const dayEndUTC = pacificToUTC(date, "23:59").toISOString();

    const bookings = await supaFetch(key, "bookings",
      `?booking_status=eq.Confirmed&booking_start=gte.${dayStartUTC}&booking_start=lte.${dayEndUTC}&order=booking_start.asc&select=booking_start,booking_end,bay`
    );

    return res.status(200).json({ date, bookings });
  } catch (e) {
    console.error("Availability error:", e);
    return res.status(500).json({ error: "Failed", detail: e.message });
  }
}
