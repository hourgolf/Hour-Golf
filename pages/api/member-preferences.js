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

async function getMemberFromToken(key, token, tenantId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&tenant_id=eq.${tenantId}&session_expires_at=gt.${new Date().toISOString()}&select=email,name,phone`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const member = await getMemberFromToken(key, token, tenantId);
  if (!member) return res.status(401).json({ error: "Session expired" });

  const email = member.email;

  if (req.method === "GET") {
    // Return member profile + preferences
    let prefs = null;
    try {
      const prefResp = await fetch(
        `${SUPABASE_URL}/rest/v1/member_preferences?email=eq.${encodeURIComponent(email)}&tenant_id=eq.${tenantId}`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (prefResp.ok) {
        const rows = await prefResp.json();
        prefs = rows[0] || null;
      }
    } catch (_) { /* ignore */ }

    return res.status(200).json({
      profile: { name: member.name, phone: member.phone || "", email },
      preferences: prefs || {
        email_booking_confirmations: true,
        email_reminders: true,
        email_billing: true,
      },
    });
  }

  if (req.method === "PATCH") {
    const { name, phone, preferences } = req.body || {};

    try {
      // Update member profile if name or phone changed
      if (name !== undefined || phone !== undefined) {
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        updates.updated_at = new Date().toISOString();

        await fetch(
          `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(email)}&tenant_id=eq.${tenantId}`,
          {
            method: "PATCH",
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify(updates),
          }
        );
      }

      // Upsert preferences
      if (preferences) {
        await fetch(`${SUPABASE_URL}/rest/v1/member_preferences`, {
          method: "POST",
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Prefer: "return=representation,resolution=merge-duplicates",
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            email,
            ...preferences,
            updated_at: new Date().toISOString(),
          }),
        });
      }

      return res.status(200).json({ success: true });
    } catch (e) {
      console.error("Member preferences update error:", e);
      return res.status(500).json({ error: "Failed to update" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
