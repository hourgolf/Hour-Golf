import { getSupabaseKey, supaFetch, getTenantId } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getSupabaseKey(req);
  if (!key) return res.status(401).json({ error: "API key required" });

  const tenantId = getTenantId(req);
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1) Lookup member within this tenant
    const members = await supaFetch(key, "members", `?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}`);
    if (!members.length) {
      return res.status(404).json({ error: "No member found with that email" });
    }
    const member = members[0];

    // 2) Load tier config within this tenant (might be null, tolerate it)
    let tierCfg = null;
    if (member.tier) {
      try {
        const rows = await supaFetch(key, "tier_config", `?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}`);
        tierCfg = rows[0] || null;
      } catch (_) { /* ignore */ }
    }

    // 3) Build billing month window
    const now = new Date();
    const billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    // 4) Upcoming confirmed bookings
    let upcoming = [];
    try {
      upcoming = await supaFetch(
        key,
        "bookings",
        `?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${now.toISOString()}&order=booking_start.asc&limit=20`
      );
    } catch (_) { upcoming = []; }

    // 5) This month's confirmed bookings
    let monthBookings = [];
    try {
      monthBookings = await supaFetch(
        key,
        "bookings",
        `?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${monthStart}&booking_start=lt.${monthEnd}&order=booking_start.asc`
      );
    } catch (_) { monthBookings = []; }

    // 6) Compute usage from month bookings
    const totalHours = monthBookings.reduce((sum, b) => sum + Number(b.duration_hours || 0), 0);
    const includedHours = Number(tierCfg?.included_hours || 0);
    const overageHours = Math.max(0, totalHours - includedHours);
    const overageRate = Number(tierCfg?.overage_rate || 60);
    const overageCharge = overageHours * overageRate;

    const usage = {
      total_hours: totalHours,
      included_hours: includedHours,
      overage_hours: overageHours,
      overage_charge: overageCharge,
    };

    return res.status(200).json({
      member: {
        email: member.email,
        name: member.name,
        tier: member.tier,
        phone: member.phone,
      },
      tierConfig: tierCfg,
      usage,
      upcomingBookings: upcoming,
      monthBookings,
      billingMonth,
    });
  } catch (e) {
    console.error("Customer auth error:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
