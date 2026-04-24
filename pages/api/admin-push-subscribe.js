import { SUPABASE_URL, getServiceKey, verifyAdmin } from "../../lib/api-helpers";

// Upsert-by-endpoint: register (or refresh) a push subscription for
// the signed-in admin on this device. The same admin on multiple
// devices = multiple rows, each keyed by its own endpoint.
//
// Body: { subscription: { endpoint, keys: { p256dh, auth } },
//         user_agent? }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { user, tenantId, reason } = await verifyAdmin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized", detail: reason });

  const key = getServiceKey();
  if (!key) return res.status(500).json({ error: "Server configuration error" });

  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription payload" });
  }

  const row = {
    tenant_id: tenantId,
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh_key: sub.keys.p256dh,
    auth_key: sub.keys.auth,
    user_agent: (req.body?.user_agent || req.headers["user-agent"] || "").slice(0, 500) || null,
    last_used_at: new Date().toISOString(),
  };

  try {
    // Upsert on endpoint — same device re-registering just refreshes
    // the keys + timestamp without duplicate rows.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_push_subscriptions?on_conflict=endpoint`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(row),
      }
    );
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text);
    }
    const rows = await r.json();
    return res.status(200).json({ success: true, id: rows[0]?.id });
  } catch (e) {
    console.error("admin-push-subscribe error:", e?.message || e);
    return res.status(500).json({ error: "Subscribe failed", detail: e.message });
  }
}
