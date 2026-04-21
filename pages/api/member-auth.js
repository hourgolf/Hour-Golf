import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { createMemberSession } from "../../lib/member-session";
import { enforceRateLimit, requireSameOrigin } from "../../lib/security";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!requireSameOrigin(req, res)) return;
  // Credential-stuffing throttle: 10 login attempts / 10 min / IP. Keeps a
  // real user with typo fingers below the ceiling while breaking bot rigs.
  if (!enforceRateLimit(req, res, { bucket: "login", limit: 10, windowMs: 10 * 60 * 1000 })) return;

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
    // 7d default, 90d on Remember-me — tuned up from 24h / 30d on 2026-04-17
    // after members complained about frequent relogs. Tier 2 (2026-04-17)
    // replaced the single-scalar-per-member pattern with a member_sessions
    // table so one member can hold concurrent sessions across devices.
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const sessionDuration = rememberMe ? NINETY_DAYS_MS : SEVEN_DAYS_MS;
    const expiresAt = new Date(Date.now() + sessionDuration).toISOString();

    // 4a) Insert into member_sessions (new multi-device storage)
    const userAgent = (req.headers["user-agent"] || "").slice(0, 500) || null;
    const ipAddress =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      null;
    try {
      await createMemberSession({
        memberId: member.id,
        tenantId,
        token: sessionToken,
        expiresAt,
        userAgent,
        ipAddress,
      });
    } catch (e) {
      // Don't fail the login if the new table write fails — we still have
      // the scalar fallback below. But log loudly so we catch drift.
      console.error("member_sessions insert failed (falling back to scalar):", e.message);
    }

    // 4b) Dual-write the scalar columns so legacy readers (19 files not
    // yet migrated) keep working. Once Tier 2 PR 2 ships, this block and
    // the columns themselves go away.
    //
    // Also stamp app-login timestamps so the admin "Launch adoption"
    // KPI works. first_app_login_at is preserved after the first login
    // by only setting it when the existing member row has it null.
    const nowIso = new Date().toISOString();
    const isFirstLogin = !member.first_app_login_at;
    const scalarPatch = {
      session_token: sessionToken,
      session_expires_at: expiresAt,
      last_app_login_at: nowIso,
    };
    if (isFirstLogin) scalarPatch.first_app_login_at = nowIso;

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
        body: JSON.stringify(scalarPatch),
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
