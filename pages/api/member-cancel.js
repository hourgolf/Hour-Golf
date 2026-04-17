import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { sendCancellationEmail } from "../../lib/email";

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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  // Validate session
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Get member from session within this tenant
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,name`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Session lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];
    const { booking_id } = req.body || {};
    if (!booking_id) return res.status(400).json({ error: "booking_id required" });

    // Fetch the booking — must belong to this member + tenant and be Confirmed
    const bookingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&customer_email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}&booking_status=eq.Confirmed&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!bookingResp.ok) throw new Error("Booking lookup failed");
    const bookings = await bookingResp.json();
    if (!bookings.length) return res.status(404).json({ error: "Booking not found or already cancelled" });

    const booking = bookings[0];

    // 6-hour rule: members can only cancel MORE than 6 hours before start
    const hoursUntil = (new Date(booking.booking_start) - new Date()) / 3600000;
    if (hoursUntil <= 6) {
      return res.status(403).json({
        error: "Bookings within 6 hours of start time can only be cancelled by staff. Please contact us.",
      });
    }

    // Cancel the booking (soft delete)
    const cancelResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ booking_status: "Cancelled" }),
      }
    );
    if (!cancelResp.ok) throw new Error("Failed to cancel booking");

    // Cancel any pending access code jobs for this booking
    try {
      // First check if there's an access code job
      const jobResp = await fetch(
        `${SUPABASE_URL}/rest/v1/access_code_jobs?booking_id=eq.${encodeURIComponent(booking_id)}&tenant_id=eq.${tenantId}&select=id,status,seam_access_code_id`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (jobResp.ok) {
        const jobs = await jobResp.json();
        for (const job of jobs) {
          if (job.status === "pending" || job.status === "failed" || job.status === "processing") {
            // Not yet sent — just mark cancelled
            await fetch(
              `${SUPABASE_URL}/rest/v1/access_code_jobs?id=eq.${job.id}&tenant_id=eq.${tenantId}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=representation",
                },
                body: JSON.stringify({ status: "cancelled", processed_at: new Date().toISOString() }),
              }
            );
          } else if (job.status === "sent" && job.seam_access_code_id) {
            // Access code already created — delete it from Seam
            const SEAM_API_KEY = process.env.SEAM_API_KEY;
            if (SEAM_API_KEY) {
              try {
                await fetch("https://connect.getseam.com/access_codes/delete", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${SEAM_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ access_code_id: job.seam_access_code_id }),
                });
              } catch (_) { /* best effort */ }
            }
            await fetch(
              `${SUPABASE_URL}/rest/v1/access_code_jobs?id=eq.${job.id}&tenant_id=eq.${tenantId}`,
              {
                method: "PATCH",
                headers: {
                  apikey: key, Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "return=representation",
                },
                body: JSON.stringify({ status: "cancelled", processed_at: new Date().toISOString() }),
              }
            );
          }
        }
      }
    } catch (_) { /* access code cleanup is best-effort */ }

    // Send cancellation email (fire-and-forget)
    sendCancellationEmail({
      tenantId,
      to: member.email,
      customerName: member.name || member.email,
      bay: booking.bay,
      bookingStart: booking.booking_start,
      bookingEnd: booking.booking_end,
    }).catch(() => {});

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Member cancel error:", e);
    return res.status(500).json({ error: "Cancellation failed", detail: e.message });
  }
}
