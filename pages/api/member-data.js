import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  // Validate session
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Lookup member by session token
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Session lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];
    const cleanEmail = member.email;

    // Load tier config
    let tierConfig = null;
    if (member.tier) {
      try {
        const rows = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        ).then((r) => r.json());
        tierConfig = rows[0] || null;
      } catch (_) { /* ignore */ }
    }

    // Build billing month window
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    // Upcoming confirmed bookings
    let upcoming = [];
    try {
      upcoming = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&booking_status=eq.Confirmed&booking_start=gte.${now.toISOString()}&order=booking_start.asc&limit=20`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      ).then((r) => r.json());
    } catch (_) { upcoming = []; }

    // This month's confirmed bookings
    let monthBookings = [];
    try {
      monthBookings = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&booking_status=eq.Confirmed&booking_start=gte.${monthStart}&booking_start=lt.${monthEnd}&order=booking_start.asc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      ).then((r) => r.json());
    } catch (_) { monthBookings = []; }

    // Compute usage
    const totalHours = monthBookings.reduce((sum, b) => sum + Number(b.duration_hours || 0), 0);
    const includedHours = Number(tierConfig?.included_hours || 0);
    const overageHours = Math.max(0, totalHours - includedHours);
    const overageRate = Number(tierConfig?.overage_rate || 60);
    const overageCharge = overageHours * overageRate;

    return res.status(200).json({
      usage: {
        total_hours: totalHours,
        included_hours: includedHours,
        overage_hours: overageHours,
        overage_charge: overageCharge,
      },
      upcomingBookings: upcoming,
      monthBookings,
      billingMonth,
    });
  } catch (e) {
    console.error("Member data error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
