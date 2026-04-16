import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((c) => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k] = v.join("=");
  });
  return cookies;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Hour Golf <onboarding@resend.dev>";

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  // Verify session within this tenant
  const mResp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,name`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const members = mResp.ok ? await mResp.json() : [];
  if (!members.length) return res.status(401).json({ error: "Session expired" });
  const member = members[0];

  try {
    // GET — list comments for an event
    if (req.method === "GET") {
      const eventId = req.query.event_id;
      if (!eventId) return res.status(400).json({ error: "Missing event_id" });

      const cResp = await fetch(
        `${SUPABASE_URL}/rest/v1/event_comments?event_id=eq.${eventId}&tenant_id=eq.${tenantId}&order=created_at.desc&select=id,member_email,comment_text,created_at`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const comments = cResp.ok ? await cResp.json() : [];

      // Get member names within this tenant
      const emails = [...new Set(comments.map((c) => c.member_email))];
      const nameMap = {};
      if (emails.length > 0) {
        const nResp = await fetch(
          `${SUPABASE_URL}/rest/v1/members?tenant_id=eq.${tenantId}&select=email,name`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        (nResp.ok ? await nResp.json() : []).forEach((m) => { nameMap[m.email] = m.name || m.email; });
      }

      const enriched = comments.map((c) => ({
        ...c,
        member_name: nameMap[c.member_email] || c.member_email,
      }));

      return res.status(200).json(enriched);
    }

    // POST — add a comment
    if (req.method === "POST") {
      const { event_id, comment_text } = req.body;
      if (!event_id || !comment_text?.trim()) return res.status(400).json({ error: "Missing event_id or comment_text" });

      // Get event title for email within this tenant
      const evResp = await fetch(
        `${SUPABASE_URL}/rest/v1/events?id=eq.${event_id}&tenant_id=eq.${tenantId}&select=title`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const events = evResp.ok ? await evResp.json() : [];
      const eventTitle = events[0]?.title || "Unknown Event";

      // Insert comment
      await fetch(`${SUPABASE_URL}/rest/v1/event_comments`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          event_id,
          member_email: member.email,
          comment_text: comment_text.trim(),
        }),
      });

      // Send email notification to admin
      if (RESEND_API_KEY) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: FROM_EMAIL,
              to: ["starter@hour.golf"],
              subject: `New comment on "${eventTitle}" from ${member.name || member.email}`,
              html: `
                <div style="font-family: sans-serif; max-width: 500px;">
                  <h3 style="color: #4C8D73;">New Event Comment</h3>
                  <p><strong>Event:</strong> ${eventTitle}</p>
                  <p><strong>From:</strong> ${member.name || member.email} (${member.email})</p>
                  <div style="background: #f5f5f5; padding: 12px 16px; border-radius: 8px; margin: 12px 0;">
                    <p style="margin: 0;">${comment_text.trim().replace(/\n/g, "<br>")}</p>
                  </div>
                  <p style="font-size: 12px; color: #888;">Reply to this member at ${member.email}</p>
                </div>
              `,
            }),
          });
        } catch (_) { /* email is best-effort */ }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (e) {
    console.error("member-event-comments error:", e);
    return res.status(500).json({ error: e.message });
  }
}
