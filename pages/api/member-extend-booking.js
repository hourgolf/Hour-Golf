import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import { loadBranding } from "../../lib/branding";
import { loadSeamConfig } from "../../lib/seam-config";
import { requireSameOrigin } from "../../lib/security";

const TZ = "America/Los_Angeles";

// Member-initiated booking extension. Triggered by the dashboard hero
// "+15m" button while a booking is live or imminently upcoming. Extends
// in 15-minute increments (caller controls the value), enforcing four
// guardrails server-side:
//
//   1. Bay availability — the new end can't overlap with another
//      Confirmed booking on the same bay.
//   2. Tier window — the new end can't go past the tier's
//      booking_hours_end (members get 24/7, non-members hit 20:00).
//   3. Daily cap — tenant_branding.max_daily_hours_per_member, summed
//      across all of this member's bookings on the same calendar day.
//      Tenants who don't want a cap leave the column NULL.
//   4. Membership — only the booking's owner can extend it; same
//      session-cookie auth pattern as member-cancel.
//
// On success, also best-effort patches the active Seam access code's
// ends_at so the door code doesn't expire mid-extension.

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

// Hour-of-day in tenant timezone for the comparison against the tier's
// booking_hours_end. Returns a fractional hour (e.g. 20.5 for 8:30 PM)
// so half-hour windows can be enforced cleanly.
function hourOfDayInTZ(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get("hour") + get("minute") / 60;
}

// Pacific-zone YYYY-MM-DD for the daily-cap window.
function dayKeyInTZ(date) {
  return new Date(date).toLocaleDateString("en-CA", { timeZone: TZ });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const session = await getSessionWithMember({ token, tenantId, touch: true });
    if (!session) return res.status(401).json({ error: "Session expired" });
    const member = session.member;

    const { booking_id, additional_minutes } = req.body || {};
    const addMin = Number(additional_minutes);
    if (!booking_id) {
      return res.status(400).json({ error: "booking_id required" });
    }
    if (!Number.isFinite(addMin) || addMin <= 0 || addMin > 300 || addMin % 15 !== 0) {
      return res.status(400).json({ error: "additional_minutes must be a positive multiple of 15, up to 300" });
    }

    // Lookup the booking — confirm ownership + Confirmed status.
    const bResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&customer_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!bResp.ok) throw new Error("Booking lookup failed");
    const bookings = await bResp.json();
    if (!bookings.length) {
      return res.status(404).json({ error: "Booking not found" });
    }
    const booking = bookings[0];

    const now = new Date();
    const oldEnd = new Date(booking.booking_end);
    const start = new Date(booking.booking_start);

    // Only allow extension while the booking is actually in flight
    // (booking_start <= now < booking_end). The dashboard hero hides
    // the +15m button until the session starts, so a request outside
    // this window is either a stale tab or a direct API hit — reject
    // with a clear message rather than silently extending.
    const minsUntilStart = (start - now) / 60000;
    const minsUntilEnd = (oldEnd - now) / 60000;
    if (minsUntilEnd <= 0) {
      return res.status(400).json({ error: "This booking has already ended." });
    }
    if (minsUntilStart > 0) {
      return res.status(400).json({ error: "Extensions become available once the session starts." });
    }

    const newEnd = new Date(oldEnd.getTime() + addMin * 60_000);

    // Guardrail 2: tier window (booking_hours_end).
    let tierConfig = null;
    if (member.tier) {
      try {
        const tcResp = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}&select=booking_hours_end`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (tcResp.ok) {
          const rows = await tcResp.json();
          tierConfig = rows[0] || null;
        }
      } catch (_) { /* fall through to permissive default below */ }
    }
    const isNonMember = member.tier === "Non-Member";
    const tierEndHour = Number(
      tierConfig?.booking_hours_end != null
        ? tierConfig.booking_hours_end
        : (isNonMember ? 20 : 24)
    );
    const newEndHour = hourOfDayInTZ(newEnd);
    // Compare on the same calendar day; "24" means midnight wrap, so
    // any hour-of-day past tierEndHour is rejected. This treats 24 as
    // "open until midnight" which matches HG members' 24/7 expectation.
    if (tierEndHour < 24 && newEndHour > tierEndHour) {
      return res.status(400).json({
        error: `Extension would push the booking past ${tierEndHour}:00, which is outside your tier's booking window.`,
      });
    }

    // Guardrail 3: tenant daily cap.
    const branding = await loadBranding(tenantId);
    const dailyCap = branding?.max_daily_hours_per_member;
    if (dailyCap != null && Number.isFinite(Number(dailyCap))) {
      const cap = Number(dailyCap);
      // Sum the member's confirmed bookings on the same Pacific day,
      // with this booking's NEW duration substituted in.
      const dayStart = new Date(`${dayKeyInTZ(start)}T00:00:00`);
      const dayEnd = new Date(`${dayKeyInTZ(start)}T23:59:59.999`);
      const sameDayResp = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_start=gte.${dayStart.toISOString()}&booking_start=lte.${dayEnd.toISOString()}&select=booking_id,duration_hours`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!sameDayResp.ok) throw new Error("Daily-cap lookup failed");
      const sameDayRows = await sameDayResp.json();
      const newDurationHrs = Math.round(Math.max(0, (newEnd - start) / 3600000) * 100) / 100;
      const totalHrs = sameDayRows.reduce((s, b) => {
        if (b.booking_id === booking_id) return s + newDurationHrs;
        return s + Number(b.duration_hours || 0);
      }, 0);
      if (totalHrs > cap + 0.001) {
        return res.status(400).json({
          error: `Extending would put you at ${totalHrs.toFixed(2)}h today; the venue cap is ${cap}h per day.`,
        });
      }
    }

    // Guardrail 1: same-bay conflict. Find other Confirmed bookings on
    // the bay where booking_start < newEnd AND booking_end > oldEnd
    // (anything that starts inside the extension window or already
    // overlaps it). Excludes this same booking_id.
    const conflictsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?bay=eq.${encodeURIComponent(booking.bay)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&booking_id=neq.${encodeURIComponent(booking_id)}&booking_start=lt.${newEnd.toISOString()}&booking_end=gt.${oldEnd.toISOString()}&select=booking_id,booking_start,booking_end`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!conflictsResp.ok) throw new Error("Conflict lookup failed");
    const conflicts = await conflictsResp.json();
    if (conflicts.length > 0) {
      // Find the soonest-starting conflict so we can tell the member
      // exactly how far they CAN extend.
      conflicts.sort((a, b) => new Date(a.booking_start) - new Date(b.booking_start));
      const next = new Date(conflicts[0].booking_start);
      const maxExtMin = Math.max(0, Math.floor((next - oldEnd) / 60000));
      return res.status(409).json({
        error: maxExtMin > 0
          ? `Another booking starts at ${next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })}. You can extend by up to ${maxExtMin} minutes.`
          : `Another booking starts immediately after yours. No room to extend on this bay.`,
      });
    }

    // PATCH the booking. Recompute duration so the monthly_usage view
    // (and any reporting math) sees the new value immediately.
    const newDurationHrs = Math.round(Math.max(0, (newEnd - start) / 3600000) * 100) / 100;
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          booking_end: newEnd.toISOString(),
          duration_hours: newDurationHrs,
        }),
      }
    );
    if (!patchResp.ok) {
      const text = await patchResp.text();
      throw new Error(`Booking update failed: ${text}`);
    }

    // Best-effort: push the active Seam access code's ends_at forward
    // so the member's door code doesn't expire mid-extension. Mirrors
    // the cancel flow's pattern — failures here are logged but don't
    // fail the extension itself (members can fall back to the backup
    // access code if their tenant configured one).
    let seamPatchedAt = null;
    try {
      const jobResp = await fetch(
        `${SUPABASE_URL}/rest/v1/access_code_jobs?booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}&status=eq.sent&select=id,seam_access_code_id,code_end`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (jobResp.ok) {
        const jobs = await jobResp.json();
        for (const job of jobs) {
          // Push code_end to (newEnd + 10 min buffer) — same buffer
          // the cron-access-code job uses on initial issue.
          const newCodeEnd = new Date(newEnd.getTime() + 10 * 60_000);
          await fetch(
            `${SUPABASE_URL}/rest/v1/access_code_jobs?id=eq.${job.id}&tenant_id=eq.${tenantId}`,
            {
              method: "PATCH",
              headers: {
                apikey: key, Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ code_end: newCodeEnd.toISOString() }),
            }
          );
          if (job.seam_access_code_id) {
            try {
              const seamCfg = await loadSeamConfig(tenantId);
              if (seamCfg && seamCfg.enabled && seamCfg.api_key) {
                await fetch("https://connect.getseam.com/access_codes/update", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${seamCfg.api_key}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    access_code_id: job.seam_access_code_id,
                    ends_at: newCodeEnd.toISOString(),
                  }),
                });
                seamPatchedAt = newCodeEnd.toISOString();
              }
            } catch (e) {
              console.error(`extend-booking: Seam update failed for ${job.seam_access_code_id}:`, e.message);
            }
          }
        }
      }
    } catch (e) {
      console.error("extend-booking: access_code_jobs patch failed:", e.message);
    }

    return res.status(200).json({
      success: true,
      new_end: newEnd.toISOString(),
      new_duration_hours: newDurationHrs,
      seam_code_extended_to: seamPatchedAt,
    });
  } catch (e) {
    console.error("Member extend-booking error:", e);
    return res.status(500).json({ error: "Internal error", detail: e.message });
  }
}
