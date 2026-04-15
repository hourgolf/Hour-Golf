import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { email, password, rememberMe } = req.body || {};
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
      return res.status(404).json({ error: "No account found with that email" });
    }
    const member = members[0];

    // 2) Password verification
    if (member.password_hash) {
      // Member has a password — require it
      if (!password) {
        return res.status(401).json({ error: "Password required" });
      }
      const valid = await bcrypt.compare(password, member.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Incorrect password" });
      }
    }
    // If no password_hash, allow login (legacy member — will be prompted to set password)

    // 3) Generate session token — 30 days if rememberMe, else 24 hours
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionDuration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + sessionDuration).toISOString();

    // 4) Store token in members table
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

    // 5) Load tier config
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

    // 6) Set httpOnly cookie
    const isSecure = process.env.NODE_ENV === "production";
    const cookieMaxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
    const cookie = [
      `hg-member-token=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${cookieMaxAge}`,
    ];
    if (isSecure) cookie.push("Secure");
    res.setHeader("Set-Cookie", cookie.join("; "));

    // 7) Check if legacy member needs account setup
    const needsAccountSetup = !member.password_hash || !member.terms_accepted_at;

    // 8) Return member data
    return res.status(200).json({
      member: {
        email: member.email,
        name: member.name,
        tier: member.tier,
        phone: member.phone || "",
        hasPaymentMethod: !!member.stripe_customer_id,
        needsAccountSetup,
      },
      tierConfig,
    });
  } catch (e) {
    console.error("Member auth error:", e);
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
}
