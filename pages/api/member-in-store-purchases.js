// GET /api/member-in-store-purchases
// Returns the authenticated member's recent Square POS purchases so
// the dashboard can render a "Recent in-store" card. Rows come from
// the shared payments table filtered to source='square_pos'.

import { SUPABASE_URL, getServiceKey, getTenantId } from "../../lib/api-helpers";
import { getSessionWithMember } from "../../lib/member-session";

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

  const tenantId = getTenantId(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["hg-member-token"];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const session = await getSessionWithMember({ token, tenantId, touch: false });
    if (!session) return res.status(401).json({ error: "Session expired or invalid" });
    const member = session.member;

    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?tenant_id=eq.${tenantId}&member_email=eq.${encodeURIComponent(member.email)}&source=eq.square_pos&select=id,amount_cents,billing_month,description,status,receipt_url,receipt_number,payment_method,card_last_4,card_brand&order=billing_month.desc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!resp.ok) return res.status(500).json({ error: "Purchase lookup failed" });
    const rows = await resp.json();

    return res.status(200).json({
      purchases: rows.map((r) => ({
        id: r.id,
        amount_cents: Number(r.amount_cents || 0),
        occurred_at: r.billing_month,
        description: r.description || "In-store purchase",
        status: r.status,
        receipt_url: r.receipt_url || null,
        receipt_number: r.receipt_number || null,
        payment_method: r.payment_method || null,
        card_last_4: r.card_last_4 || null,
        card_brand: r.card_brand || null,
      })),
    });
  } catch (e) {
    console.error("member-in-store-purchases error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
