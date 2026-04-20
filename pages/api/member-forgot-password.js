import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { sendPasswordResetEmail } from "../../lib/email";
import { enforceRateLimit, requireSameOrigin } from "../../lib/security";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!requireSameOrigin(req, res)) return;
  // Spam vector: hit this on an arbitrary address and we send a reset email.
  // 3/hour per IP blocks email-bombing without inconveniencing a real user
  // who mistyped their email a couple of times.
  if (!enforceRateLimit(req, res, { bucket: "pwreset", limit: 3, windowMs: 60 * 60 * 1000 })) return;

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1) Look up member within this tenant
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&select=email,name`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Member lookup failed");
    const members = await memberResp.json();

    // Always return success to prevent email enumeration
    if (!members.length) {
      return res.status(200).json({ success: true });
    }

    const member = members[0];

    // 2) Generate reset token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // 3) Store hashed token in DB
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
          password_reset_token: tokenHash,
          password_reset_expires_at: expiresAt,
        }),
      }
    );
    if (!updateResp.ok) throw new Error("Failed to store reset token");

    // 4) Build reset URL
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://hourgolf.vercel.app");
    const resetUrl = `${baseUrl}/members/reset-password?token=${rawToken}&email=${encodeURIComponent(cleanEmail)}`;

    // 5) Send email
    await sendPasswordResetEmail({
      tenantId,
      to: cleanEmail,
      customerName: member.name,
      resetUrl,
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Forgot password error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
