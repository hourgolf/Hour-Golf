import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import { pacificMonthWindow, pacificMonthTag, pacificMonthWindowFor } from "../../lib/format";

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

  const tenantId = getTenantId(req);
  // Validate session
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Lookup member by session token within this tenant
    const session = await getSessionWithMember({ token, tenantId, touch: true });
    if (!session) return res.status(401).json({ error: "Session expired" });
    const member = session.member;
    const cleanEmail = member.email;

    // Load tier config
    let tierConfig = null;
    if (member.tier) {
      try {
        const rows = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        ).then((r) => r.json());
        tierConfig = rows[0] || null;
      } catch (_) { /* ignore */ }
    }

    // Build billing month window in Pacific time. Members live in PT;
    // a session that starts at 9pm PT on March 31 (= April 1 04:00 UTC)
    // belongs in March, not April. Bucketing by PT keeps this endpoint
    // in lockstep with the monthly_usage view (rebuilt with PT bucketing
    // in migration 20260419030000) so admin overage + member dashboard
    // never disagree on the same data.
    const now = new Date();
    const billingMonth = pacificMonthTag(now);
    const { startISO: monthStart, endISO: monthEnd } = pacificMonthWindow(now);

    // Upcoming + currently-live confirmed bookings.
    //
    // Filter on booking_end (not booking_start) so a session that has
    // already started but hasn't ended yet still comes back. Filtering
    // on booking_start dropped live bookings from the response and
    // made the dashboard hero fall back to the empty "Ready to ..."
    // state on reload mid-session.
    let upcoming = [];
    try {
      upcoming = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_end=gte.${now.toISOString()}&order=booking_start.asc&limit=20`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      ).then((r) => r.json());
    } catch (_) { upcoming = []; }

    // Attach Seam access codes for upcoming bookings whose access-code
    // job has reached the `sent` state. Members get the code on the
    // dashboard the moment the cron run issues it (~10 min before
    // start) — saves them flipping back to email. Best-effort: failure
    // here just means the dashboard renders without the inline code.
    if (Array.isArray(upcoming) && upcoming.length > 0) {
      try {
        const ids = upcoming
          .map((b) => b.booking_id)
          .filter((id) => typeof id === "string" && id.length > 0)
          .map((id) => `"${id.replace(/"/g, '\\"')}"`);
        if (ids.length > 0) {
          const codeRows = await fetch(
            `${SUPABASE_URL}/rest/v1/access_code_jobs?tenant_id=eq.${tenantId}&status=eq.sent&booking_id=in.(${ids.join(",")})&select=booking_id,access_code,code_start,code_end`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          ).then((r) => r.json());
          const byId = new Map();
          for (const r of codeRows || []) {
            if (r?.booking_id && r?.access_code) byId.set(r.booking_id, r);
          }
          upcoming = upcoming.map((b) => {
            const job = byId.get(b.booking_id);
            return job
              ? { ...b, access_code: job.access_code, access_code_start: job.code_start, access_code_end: job.code_end }
              : b;
          });
        }
      } catch (_) { /* best-effort attach */ }
    }

    // This month's confirmed bookings
    let monthBookings = [];
    try {
      monthBookings = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${monthStart}&booking_start=lt.${monthEnd}&order=booking_start.asc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      ).then((r) => r.json());
    } catch (_) { monthBookings = []; }

    // Tier values needed for both reconciliation and current month calc
    const includedHours = Number(tierConfig?.included_hours || 0);
    const overageRate = Number(tierConfig?.overage_rate || 60);

    // --- Lazy reconciliation: deduct bonus hours consumed in previous months ---
    let bonusHours = Number(member.bonus_hours || 0);
    const currentMonth = billingMonth; // "YYYY-MM"
    const reconMonth = member.bonus_reconciled_month || null;

    if (bonusHours > 0 && reconMonth && reconMonth < currentMonth) {
      try {
        // Walk through each unreconciled month
        let [ry, rm] = reconMonth.split("-").map(Number);
        let totalDeducted = 0;

        while (bonusHours - totalDeducted > 0) {
          rm++;
          if (rm > 12) { rm = 1; ry++; }
          const checkMonth = `${ry}-${String(rm).padStart(2, "0")}`;
          if (checkMonth >= currentMonth) break; // don't reconcile current month

          // Use Pacific-time month bounds so this matches monthly_usage
          // (the view that the admin sees + the current-month query
          // above). Walking by UTC bounds attributed PT-late-night
          // bookings to the wrong month and over- or under-counted
          // overage when consuming bonus hours.
          const { startISO: pmStart, endISO: pmEnd } = pacificMonthWindowFor(checkMonth);
          const pmBookings = await fetch(
            `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${pmStart}&booking_start=lt.${pmEnd}&select=duration_hours`,
            { headers: { apikey: key, Authorization: `Bearer ${key}` } }
          ).then((r) => r.json()).catch(() => []);

          const pmUsed = pmBookings.reduce((s, b) => s + Number(b.duration_hours || 0), 0);
          const pmOverage = Math.max(0, pmUsed - includedHours);
          const pmBonusConsumed = Math.min(pmOverage, bonusHours - totalDeducted);
          totalDeducted += pmBonusConsumed;
        }

        if (totalDeducted > 0 || reconMonth < currentMonth) {
          bonusHours = Math.max(0, bonusHours - totalDeducted);
          // Reconciled month = month before current
          const [cy, cm] = currentMonth.split("-").map(Number);
          const prevM = cm === 1 ? 12 : cm - 1;
          const prevY = cm === 1 ? cy - 1 : cy;
          const newRecon = `${prevY}-${String(prevM).padStart(2, "0")}`;
          await fetch(
            `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: {
                apikey: key, Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({ bonus_hours: bonusHours, bonus_reconciled_month: newRecon }),
            }
          );
        }
      } catch (e) {
        console.warn("Bonus reconciliation error (non-fatal):", e.message);
      }
    }

    // Compute usage with bonus hours
    const totalHours = monthBookings.reduce((sum, b) => sum + Number(b.duration_hours || 0), 0);

    const monthlyRemaining = Math.max(0, includedHours - totalHours);
    const overageBeforeBonus = Math.max(0, totalHours - includedHours);
    const bonusUsedThisMonth = Math.min(overageBeforeBonus, bonusHours);
    const effectiveBonusRemaining = bonusHours - bonusUsedThisMonth;
    const effectiveOverage = overageBeforeBonus - bonusUsedThisMonth;
    const overageCharge = effectiveOverage * overageRate;

    return res.status(200).json({
      usage: {
        total_hours: totalHours,
        included_hours: includedHours,
        overage_hours: effectiveOverage,
        overage_charge: overageCharge,
        bonus_hours: bonusHours,
        bonus_used_this_month: bonusUsedThisMonth,
        effective_bonus_remaining: effectiveBonusRemaining,
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
