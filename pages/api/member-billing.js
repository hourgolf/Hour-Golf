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
    // Lookup member
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=email`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Session lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const email = members[0].email;

    // Get payments for this member
    const paymentsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?member_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=50`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const payments = paymentsResp.ok ? await paymentsResp.json() : [];

    return res.status(200).json({ payments });
  } catch (e) {
    console.error("Member billing error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
