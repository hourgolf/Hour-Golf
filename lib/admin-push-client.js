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

// Human-readable hint for a non-granted permission state.
// "denied" vs "default" are distinct: denied means the user (or
// browser heuristics) have explicitly blocked; default means the
// prompt was dismissed or never shown. Desktop Chrome's "quiet UI"
// can also leave permission at "default" without a visible prompt.
export function permissionHint() {
  if (typeof window === "undefined") return "";
  const p = Notification.permission;
  if (p === "denied") {
    return "Notifications are blocked for this site. Open site settings in your browser (click the padlock next to the URL on desktop, or Site Settings on mobile) and set Notifications to Allow. Then reload and try again.";
  }
  if (p === "default") {
    return "The browser didn't show the permission prompt — Chrome does this when it thinks you've dismissed similar prompts before. Try clicking the padlock next to the URL and manually enabling notifications, or try again in a different browser.";
  }
  return "";
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  try {
    // Scope is "/admin" (no trailing slash). getRegistration without
    // an argument returns whatever SW controls the current page,
    // which is the right thing when this is called from inside the
    // admin app. Falling back to the scoped lookup handles the case
    // where the current page isn't controlled yet but the reg exists.
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.getRegistration("/admin");
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
  if (perm !== "granted") {
    const hint = permissionHint();
    throw new Error(hint || `Notifications permission ${perm}.`);
  }

  // Fetch the VAPID public key.
  const vapidResp = await fetch("/api/admin-push-public-key");
  if (!vapidResp.ok) throw new Error("Push isn't configured on the server yet.");
  const { publicKey } = await vapidResp.json();
  if (!publicKey) throw new Error("No VAPID key available.");

  // The admin SW is registered at scope "/admin" (see pages/_app.js).
  // Use whichever registration controls this page — falling back to
  // the scoped lookup if the SW hasn't claimed the page yet (brand-
  // new installs can race the first render).
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.getRegistration("/admin");
  if (!reg) {
    // Wait up to 2s for the SW to finish registering, then retry.
    await new Promise((r) => setTimeout(r, 2000));
    reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.getRegistration("/admin");
  }
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
