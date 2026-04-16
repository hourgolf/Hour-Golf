import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";
import { generateVerifyToken } from "./verify-member";

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
    // Lookup member by session token where not expired
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?session_token=eq.${encodeURIComponent(token)}&session_expires_at=gt.${new Date().toISOString()}&select=*`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) throw new Error("Session lookup failed");
    const members = await resp.json();

    if (!members.length) {
      return res.status(401).json({ error: "Session expired or invalid" });
    }

    const member = members[0];

    // Load tier config
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

    const needsAccountSetup = !member.password_hash || !member.terms_accepted_at;

    return res.status(200).json({
      member: {
        email: member.email,
        name: member.name,
        tier: member.tier,
        phone: member.phone || "",
        hasPaymentMethod: !!member.stripe_customer_id,
        shop_credit_balance: Number(member.shop_credit_balance || 0),
        verify_token: generateVerifyToken(member.email),
        needsAccountSetup,
      },
      tierConfig,
    });
  } catch (e) {
    console.error("Member session error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
