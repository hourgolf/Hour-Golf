import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";

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
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const { event_id } = req.body;
  if (!event_id) return res.status(400).json({ error: "Missing event_id" });

  try {
    // Verify session within this tenant
    const session = await getSessionWithMember({ token, tenantId, touch: true });
    if (!session) return res.status(401).json({ error: "Session expired" });
    const memberEmail = session.member.email;

    // Check if already interested
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/event_interests?event_id=eq.${event_id}&member_email=eq.${encodeURIComponent(memberEmail)}&tenant_id=eq.${tenantId}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const existing = checkResp.ok ? await checkResp.json() : [];

    if (existing.length > 0) {
      // Remove interest (toggle off)
      await fetch(
        `${SUPABASE_URL}/rest/v1/event_interests?id=eq.${existing[0].id}&tenant_id=eq.${tenantId}`,
        { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      return res.status(200).json({ interested: false });
    } else {
      // Add interest (toggle on)
      await fetch(`${SUPABASE_URL}/rest/v1/event_interests`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, event_id, member_email: memberEmail }),
      });
      return res.status(200).json({ interested: true });
    }
  } catch (e) {
    console.error("member-event-interest error:", e);
    return res.status(500).json({ error: e.message });
  }
}
