import crypto from "crypto";
import { SUPABASE_URL, getServiceKey } from "../../lib/api-helpers";

// Verify a member's QR token. The token is a HMAC of the member's email
// using a server-side secret — no database lookup for the token itself,
// just validate the signature and fetch the member.

const SECRET = process.env.QR_VERIFY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "hg-verify";

export function generateVerifyToken(email) {
  return crypto.createHmac("sha256", SECRET).update(email.toLowerCase().trim()).digest("hex").slice(0, 24);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token required" });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  try {
    // Find member whose email produces this token
    const memResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?select=email,name,tier,shop_credit_balance&tier=neq.Non-Member`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memResp.ok) throw new Error("Member lookup failed");
    const members = await memResp.json();

    const member = members.find((m) => generateVerifyToken(m.email) === token);
    if (!member) return res.status(404).json({ error: "Member not found" });

    // Get tier discount
    let discount = 0;
    if (member.tier) {
      const tcResp = await fetch(
        `${SUPABASE_URL}/rest/v1/tier_config?tier=eq.${encodeURIComponent(member.tier)}&select=pro_shop_discount`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const tc = tcResp.ok ? await tcResp.json() : [];
      if (tc.length > 0) discount = Number(tc[0].pro_shop_discount || 0);
    }

    return res.status(200).json({
      name: member.name,
      tier: member.tier,
      discount,
      credit_balance: Number(member.shop_credit_balance || 0),
    });
  } catch (e) {
    console.error("Verify member error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
