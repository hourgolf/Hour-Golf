import { getSupabaseKey, supaFetch } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date parameter required (YYYY-MM-DD)" });

  try {
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;

    const bookings = await supaFetch(key, "bookings",
      `?booking_status=eq.Confirmed&booking_start=gte.${dayStart}&booking_start=lte.${dayEnd}&order=booking_start.asc&select=booking_start,booking_end,bay`
    );

    return res.status(200).json({ date, bookings });
  } catch (e) {
    console.error("Availability error:", e);
    return res.status(500).json({ error: "Failed", detail: e.message });
  }
}
