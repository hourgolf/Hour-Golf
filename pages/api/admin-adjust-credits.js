import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", reason });

  const key = getServiceKey();
  const { member_email, amount, reason: adjustReason } = req.body || {};

  if (!member_email) return res.status(400).json({ error: "member_email required" });
  if (typeof amount !== "number" || amount === 0) {
    return res.status(400).json({ error: "amount must be a non-zero number" });
  }

  try {
    // Get current balance within this tenant
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member_email)}&tenant_id=eq.${tenantId}&select=email,shop_credit_balance`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Member lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(404).json({ error: "Member not found" });

    const current = Number(members[0].shop_credit_balance || 0);
    const newBalance = Math.max(0, Math.round((current + amount) * 100) / 100);

    // Update balance
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member_email)}&tenant_id=eq.${tenantId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          shop_credit_balance: newBalance,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!patchResp.ok) throw new Error("Failed to update credit balance");

    // Log the credit transaction
    const logResp = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_credits`,
      {
        method: "POST",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          member_email,
          amount: Math.abs(amount),
          type: amount > 0 ? "credit" : "debit",
          reason: adjustReason || (amount > 0 ? "Admin credit" : "Admin deduction"),
          admin_note: `Adjusted by admin: ${amount > 0 ? "+" : ""}$${amount.toFixed(2)}`,
        }),
      }
    );
    if (!logResp.ok) console.error("Failed to log credit transaction");

    console.log(
      `Admin adjusted pro shop credits for ${member_email}: $${current.toFixed(2)} → $${newBalance.toFixed(2)} (${amount > 0 ? "+" : ""}$${amount.toFixed(2)}) reason: ${adjustReason || "none"}`
    );

    return res.status(200).json({ success: true, previous: current, new_balance: newBalance });
  } catch (e) {
    console.error("Admin adjust credits error:", e);
    return res.status(500).json({ error: "Failed to adjust credits", detail: e.message });
  }
}
