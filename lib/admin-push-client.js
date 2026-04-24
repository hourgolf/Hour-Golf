// Browser-side helpers for the admin push flow. Counterpart to
// lib/admin-push.js (server-side). Used by AdminPushButton.

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toBase64Url(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pushSupported() {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
  );
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/admin/");
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Subscribes the current device to push and POSTs the resulting
// subscription to /api/admin-push-subscribe. Returns the subscription
// on success, null on failure (caller surfaces an error message).
export async function enablePush(apiKey) {
  if (!pushSupported()) throw new Error("Push isn't supported on this browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications permission denied.");

  // Fetch the VAPID public key.
  const vapidResp = await fetch("/api/admin-push-public-key");
  if (!vapidResp.ok) throw new Error("Push isn't configured on the server yet.");
  const { publicKey } = await vapidResp.json();
  if (!publicKey) throw new Error("No VAPID key available.");

  // The admin SW is registered at scope "/admin/" (see pages/_app.js).
  // Use the existing registration so we don't create a second one.
  const reg = await navigator.serviceWorker.getRegistration("/admin/");
  if (!reg) throw new Error("Admin service worker isn't active yet — reload the page and try again.");

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // Server re-upserts idempotently, so pushing the existing
    // subscription again is safe and refreshes last_used_at.
    await postSubscription(apiKey, existing);
    return existing;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await postSubscription(apiKey, sub);
  return sub;
}

async function postSubscription(apiKey, sub) {
  const json = sub.toJSON();
  // Some browsers return raw ArrayBuffers instead of base64url strings;
  // normalize here so the server always gets consistent keys.
  if (!json.keys?.p256dh && sub.getKey) {
    json.keys = {
      p256dh: toBase64Url(sub.getKey("p256dh")),
      auth: toBase64Url(sub.getKey("auth")),
    };
    json.endpoint = sub.endpoint;
  }
  const r = await fetch("/api/admin-push-subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      subscription: json,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || "Failed to register subscription");
  }
}

// Revokes the browser's push subscription and deletes the row
// server-side. Called from the "Disable notifications" button.
export async function disablePush(apiKey) {
  const sub = await getExistingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* best-effort */ }
  try {
    await fetch("/api/admin-push-unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ endpoint }),
    });
  } catch { /* swallow — server will prune on next failed send */ }
}
