import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", reason });

  const key = getServiceKey();
  const { member_email, adjustment, reason: adjustReason } = req.body || {};

  if (!member_email) return res.status(400).json({ error: "member_email required" });
  if (typeof adjustment !== "number" || adjustment === 0) {
    return res.status(400).json({ error: "adjustment must be a non-zero number" });
  }

  try {
    // Get current bonus_hours
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member_email)}&select=email,bonus_hours`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!memberResp.ok) throw new Error("Member lookup failed");
    const members = await memberResp.json();
    if (!members.length) return res.status(404).json({ error: "Member not found" });

    const current = Number(members[0].bonus_hours || 0);
    const newBalance = Math.max(0, current + adjustment);

    // Update bonus_hours
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/members?email=eq.${encodeURIComponent(member_email)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          bonus_hours: newBalance,
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (!patchResp.ok) throw new Error("Failed to update bonus hours");

    console.log(
      `Admin adjusted bonus hours for ${member_email}: ${current} → ${newBalance} (${adjustment > 0 ? "+" : ""}${adjustment}) reason: ${adjustReason || "none"}`
    );

    return res.status(200).json({ success: true, previous: current, new_balance: newBalance });
  } catch (e) {
    console.error("Admin adjust hours error:", e);
    return res.status(500).json({ error: "Failed to adjust hours", detail: e.message });
  }
}
