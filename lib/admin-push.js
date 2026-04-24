// Server-side push-notification dispatch for admin PWAs.
//
// Usage:
//   import { notifyTenantAdmins, safePush } from "./admin-push";
//   await safePush(tenantId, {
//     title: "Booking conflict",
//     body: "Thu 3pm Bay 2 overlaps a Skedda booking",
//     url: "/admin?view=inbox",
//     tag: "conflict-<bookingId>",   // dedupe identifier (optional)
//   });
//
// `safePush` is the fire-and-forget wrapper that ALWAYS resolves and
// NEVER throws. All trigger-site code should use it (not the raw
// notifyTenantAdmins) so a push failure can't break the caller.
//
// Subscription maintenance: endpoints return 404 or 410 when a user
// has revoked the subscription on their device. We delete those rows
// on the fly so the subscription table stays clean.

import webpush from "web-push";
import { SUPABASE_URL, getServiceKey } from "./api-helpers";

let vapidConfigured = false;

// Configure once per process. Missing env vars → push is effectively
// disabled; notifications are silently dropped with a single warn log.
// This lets the app keep running before VAPID keys are provisioned.
function ensureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@hour.golf";
  if (!publicKey || !privateKey) {
    console.warn("[admin-push] VAPID keys not configured — push disabled");
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.warn("[admin-push] setVapidDetails failed:", e?.message || e);
    return false;
  }
}

// Low-level: send to every admin subscription for this tenant.
// Returns { sent, failed, pruned } counts.
export async function notifyTenantAdmins(tenantId, payload) {
  if (!ensureVapid()) return { sent: 0, failed: 0, pruned: 0 };
  if (!tenantId || !payload) return { sent: 0, failed: 0, pruned: 0 };

  const key = getServiceKey();
  if (!key) return { sent: 0, failed: 0, pruned: 0 };

  // Look up all subscriptions for this tenant. Service-role bypasses RLS.
  let rows = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_push_subscriptions?tenant_id=eq.${tenantId}&select=id,endpoint,p256dh_key,auth_key`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (r.ok) rows = await r.json();
  } catch (e) {
    console.warn("[admin-push] subscription lookup failed:", e?.message || e);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  if (rows.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const body = JSON.stringify({
    title: payload.title || "Hour Golf",
    body: payload.body || "",
    url: payload.url || "/admin",
    tag: payload.tag || undefined,
    badge: payload.badge || undefined,
    icon: payload.icon || "/icons/admin/icon.png",
  });

  let sent = 0;
  let failed = 0;
  const staleIds = [];

  await Promise.all(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh_key, auth: row.auth_key },
      };
      try {
        await webpush.sendNotification(subscription, body, { TTL: 60 });
        sent++;
      } catch (e) {
        failed++;
        const sc = e?.statusCode;
        // 404/410 = subscription is dead, clean it up so the next run
        // doesn't keep retrying a gone endpoint.
        if (sc === 404 || sc === 410) staleIds.push(row.id);
        else console.warn("[admin-push] send failed:", sc, e?.message || e);
      }
    })
  );

  let pruned = 0;
  if (staleIds.length > 0) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/admin_push_subscriptions?id=in.(${staleIds.join(",")})`,
        {
          method: "DELETE",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "return=minimal",
          },
        }
      );
      pruned = staleIds.length;
    } catch (e) {
      console.warn("[admin-push] prune failed:", e?.message || e);
    }
  }

  return { sent, failed, pruned };
}

// Fire-and-forget: always resolves, never throws. Trigger sites use
// this so a push infrastructure failure can't bubble into the main
// webhook / mutation path.
export async function safePush(tenantId, payload) {
  try {
    return await notifyTenantAdmins(tenantId, payload);
  } catch (e) {
    console.warn("[admin-push] safePush caught:", e?.message || e);
    return { sent: 0, failed: 0, pruned: 0 };
  }
}
