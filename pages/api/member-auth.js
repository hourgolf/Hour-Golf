import crypto from "crypto";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1) Lookup member
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Member lookup failed");
    const members = await memberResp.json();
    if (!members.length) {
      return res.status(404).json({ error: "No member found with that email" });
    }
    const member = members[0];

    // 2) Generate session token
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 3) Store token in members table
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          session_token: sessionToken,
          session_expires_at: expiresAt,
        }),
      }
    );
    if (!updateResp.ok) throw new Error("Failed to create session");

    // 4) Load tier config
    let tierConfig = null;
    if (member.tier) {
      try {
        const tierResp = await fetch(
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (tierResp.ok) {
          const rows = await tierResp.json();
          tierConfig = rows[0] || null;
        }
      } catch (_) { /* ignore */ }
    }

    // 5) Set httpOnly cookie
    const isSecure = process.env.NODE_ENV === "production";
    const cookie = [
      `hg-member-token=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${24 * 60 * 60}`,
    ];
    if (isSecure) cookie.push("Secure");
    res.setHeader("Set-Cookie", cookie.join("; "));

    // 6) Return member data
    return res.status(200).json({
      member: {
        email: member.email,
        name: member.name,
        tier: member.tier,
        phone: member.phone || "",
      },
      tierConfig,
    });
  } catch (e) {
    console.error("Member auth error:", e);
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
}
