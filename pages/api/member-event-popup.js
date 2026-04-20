import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";
import { requireSameOrigin } from "../../lib/security";

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
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (!requireSameOrigin(req, res)) return;
  }

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  // Verify session within this tenant
  const session = await getSessionWithMember({ token, tenantId, touch: true });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const memberEmail = session.member.email;

  try {
    // GET — return undismissed popup events
    if (req.method === "GET") {
      const evResp = await fetch(
        `${SUPABASE_URL}/rest/v1/events?tenant_id=eq.${tenantId}&show_popup=eq.true&is_published=eq.true&order=created_at.desc&select=id,title,subtitle,image_url,start_date`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const events = evResp.ok ? await evResp.json() : [];
      if (!events.length) return res.status(200).json([]);

      const disResp = await fetch(
        `${SUPABASE_URL}/rest/v1/event_popup_dismissals?member_email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}&select=event_id`,
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
        body: JSON.stringify({ tenant_id: tenantId, event_id, member_email: memberEmail }),
      });

      return res.status(200).json({ dismissed: true });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (e) {
    console.error("member-event-popup error:", e);
    return res.status(500).json({ error: e.message });
  }
}
