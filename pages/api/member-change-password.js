import bcrypt from "bcryptjs";
import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";

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

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  try {
    // 1) Look up member by session token within this tenant
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,password_hash`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) throw new Error("Session lookup failed");
    const members = await resp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];

    // 2) Verify current password
    if (!member.password_hash) {
      return res.status(400).json({ error: "No password set on this account" });
    }
    const valid = await bcrypt.compare(currentPassword, member.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // 3) Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 10);
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
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
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!updateResp.ok) throw new Error("Failed to update password");

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("Change password error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
