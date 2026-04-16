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

  const { newEmail, password } = req.body || {};
  if (!newEmail || !password) {
    return res.status(400).json({ error: "New email and password are required" });
  }

  const cleanEmail = newEmail.toLowerCase().trim();

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  try {
    // 1) Look up current member by session token within this tenant
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,password_hash`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) throw new Error("Session lookup failed");
    const members = await resp.json();
    if (!members.length) return res.status(401).json({ error: "Session expired" });

    const member = members[0];

    // 2) Verify password
    if (!member.password_hash) {
      return res.status(400).json({ error: "No password set on this account" });
    }
    const valid = await bcrypt.compare(password, member.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    // 3) Check if new email is already in use within this tenant
    if (cleanEmail !== member.email) {
      const existResp = await fetch(
        `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(cleanEmail)}&tenant_id=eq.${tenantId}&select=email`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (existResp.ok) {
        const existing = await existResp.json();
        if (existing.length > 0) {
          return res.status(409).json({ error: "An account with that email already exists" });
        }
      }
    }

    // 4) Update email in members table
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
          email: cleanEmail,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!updateResp.ok) throw new Error("Failed to update email");

    // 5) Also update email in member_preferences if a row exists
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/member_preferences?email=eq.${encodeURIComponent(member.email)}&tenant_id=eq.${tenantId}`,
        {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: cleanEmail }),
        }
      );
    } catch (_) { /* best effort */ }

    return res.status(200).json({ success: true, email: cleanEmail });
  } catch (e) {
    console.error("Change email error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
