import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const { email, password, rememberMe } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1) Lookup member within this tenant
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&select=*`,
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

    // 3) Generate session token.
    // Tuned up from 24h / 30d on 2026-04-17 after members complained about
    // frequent relogs. 7 days is the "didn't check Remember me" floor (still
    // long enough that weekly-active members don't relog); 90 days is the
    // explicit-opt-in ceiling (matches Gmail/Slack-style sticky sessions).
    // Single-token-per-member remains a known limitation — cross-device login
    // still invalidates the other device. Tracked as Tier 2 follow-up.
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const sessionDuration = rememberMe ? NINETY_DAYS_MS : SEVEN_DAYS_MS;
    const expiresAt = new Date(Date.now() + sessionDuration).toISOString();

    // 4) Store token in members table
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}`,
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
          `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}&tenant_id=eq.${tenantId}`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
        if (tierResp.ok) {
          const rows = await tierResp.json();
          tierConfig = rows[0] || null;
        }
      } catch (_) { /* ignore */ }
    }

    // 6) Set httpOnly cookie (Max-Age mirrors sessionDuration above so the
    // cookie and DB row expire in lockstep)
    const isSecure = process.env.NODE_ENV === "production";
    const cookieMaxAge = Math.floor(sessionDuration / 1000);
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
