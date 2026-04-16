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

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const eventId = req.query.id;
  if (!eventId) return res.status(400).json({ error: "Missing event id" });

  try {
    // Verify session within this tenant
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const members = mResp.ok ? await mResp.json() : [];
    if (!members.length) return res.status(401).json({ error: "Session expired" });
    const memberEmail = members[0].email;

    // Get the event within this tenant
    const evResp = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&tenant_id=eq.${tenantId}&is_published=eq.true`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const events = evResp.ok ? await evResp.json() : [];
    if (!events.length) return res.status(404).json({ error: "Event not found" });
    const event = events[0];

    // Interest count + member status
    const intResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_interests?event_id=eq.${eventId}&tenant_id=eq.${tenantId}&select=member_email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const interests = intResp.ok ? await intResp.json() : [];

    // Registration count + member status
    const regResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_registrations?event_id=eq.${eventId}&tenant_id=eq.${tenantId}&select=member_email,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const regs = regResp.ok ? await regResp.json() : [];

    return res.status(200).json({
      ...event,
      interest_count: interests.length,
      registration_count: regs.length,
      is_interested: interests.some((i) => i.member_email === memberEmail),
      registration_status: regs.find((r) => r.member_email === memberEmail)?.status || null,
    });
  } catch (e) {
    console.error("member-event-detail error:", e);
    return res.status(500).json({ error: e.message });
  }
}
