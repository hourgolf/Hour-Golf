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

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    // Verify session
    const mResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!mResp.ok) throw new Error("Session lookup failed");
    const members = await mResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });
    const memberEmail = members[0].email;

    // Get published events
    const evResp = await fetch(
      `${SUPABASE_URL}/rest/v1/events?is_published=eq.true&order=start_date.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const events = evResp.ok ? await evResp.json() : [];

    // Get this member's interests
    const intResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_interests?member_email=eq.${encodeURIComponent(memberEmail)}&select=event_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const myInterests = new Set((intResp.ok ? await intResp.json() : []).map((i) => i.event_id));

    // Get this member's registrations
    const regResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_registrations?member_email=eq.${encodeURIComponent(memberEmail)}&select=event_id,status`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const myRegs = {};
    (regResp.ok ? await regResp.json() : []).forEach((r) => { myRegs[r.event_id] = r.status; });

    const enriched = events.map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      image_url: e.image_url,
      cost: e.cost,
      start_date: e.start_date,
      end_date: e.end_date,
      is_interested: myInterests.has(e.id),
      registration_status: myRegs[e.id] || null,
    }));

    return res.status(200).json(enriched);
  } catch (e) {
    console.error("member-events error:", e);
    return res.status(500).json({ error: e.message });
  }
}
