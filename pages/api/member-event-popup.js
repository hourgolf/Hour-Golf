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
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  // Verify session
  const mResp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=email`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const members = mResp.ok ? await mResp.json() : [];
  if (!members.length) return res.status(401).json({ error: "Session expired" });
  const memberEmail = members[0].email;

  try {
    // GET — return undismissed popup events
    if (req.method === "GET") {
      const evResp = await fetch(
        `${SUPABASE_URL}/rest/v1/events?show_popup=eq.true&is_published=eq.true&order=created_at.desc&select=id,title,subtitle,image_url,start_date`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const events = evResp.ok ? await evResp.json() : [];
      if (!events.length) return res.status(200).json([]);

      const disResp = await fetch(
        `${SUPABASE_URL}/rest/v1/event_popup_dismissals?member_email=eq.${encodeURIComponent(memberEmail)}&select=event_id`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const dismissed = new Set((disResp.ok ? await disResp.json() : []).map((d) => d.event_id));

      const undismissed = events.filter((e) => !dismissed.has(e.id));
      return res.status(200).json(undismissed);
    }

    // POST — dismiss a popup
    if (req.method === "POST") {
      const { event_id } = req.body;
      if (!event_id) return res.status(400).json({ error: "Missing event_id" });

      await fetch(`${SUPABASE_URL}/rest/v1/event_popup_dismissals`, {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify({ event_id, member_email: memberEmail }),
      });

      return res.status(200).json({ dismissed: true });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (e) {
    console.error("member-event-popup error:", e);
    return res.status(500).json({ error: e.message });
  }
}
