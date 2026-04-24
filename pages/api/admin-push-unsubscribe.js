import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";

// Delete the subscription row for this device. Body: { endpoint }.
// Scoped to (tenant_id, endpoint) so an admin on tenant A can't
// accidentally (or maliciously) delete a subscription on tenant B
// that happens to share the endpoint (extremely unlikely, but the
// scope is cheap).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_push_subscriptions?tenant_id=eq.${tenantId}&endpoint=eq.${encodeURIComponent(endpoint)}`,
      {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "return=minimal",
        },
      }
    );
    if (!r.ok && r.status !== 204) {
      const text = await r.text();
      throw new Error(text);
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("admin-push-unsubscribe error:", e?.message || e);
    return res.status(500).json({ error: "Unsubscribe failed", detail: e.message });
  }
}
