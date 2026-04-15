import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const { token, email, password } = req.body || {};
  if (!token || !email || !password) {
    return res.status(400).json({ error: "Token, email, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1) Look up member by email with valid reset token
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&password_reset_expires_at=gt.${new Date().toISOString()}&select=email,password_reset_token`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Member lookup failed");
    const members = await memberResp.json();

    if (!members.length || !members[0].password_reset_token) {
      return res.status(400).json({ error: "Reset link has expired. Please request a new one." });
    }

    const member = members[0];

    // 2) Verify token against stored hash
    const valid = await bcrypt.compare(token, member.password_reset_token);
    if (!valid) {
      return res.status(400).json({ error: "Invalid reset link. Please request a new one." });
    }

    // 3) Hash new password and update, clear reset token
    const newHash = await bcrypt.hash(password, 10);
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
          password_hash: newHash,
          password_reset_token: null,
          password_reset_expires_at: null,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!updateResp.ok) throw new Error("Failed to update password");

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Reset password error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
