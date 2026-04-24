// Admin PWA service worker — minimal, parallel to the member sw.js.
// Does NOT pre-cache pages or intercept navigation fetches, so
// operators always see the latest deployed build immediately after a
// sign-in. Activation alone enables standalone install; the cache
// name is here only as a version sentinel that triggers the
// "update available" banner when bumped.
//
// Separate cache namespace ("hgc-admin-v*") so this SW and the member
// sw.js ("hourgolf-v*") don't collide on the same origin.

// v3 (2026-04-24 later): scope fix — registration scope moved from
// "/admin/" (trailing slash) to "/admin" so the SW controls the
// exact URL "/admin" (without trailing slash) that the Dashboard
// serves at. Prior scope left the main admin URL out-of-scope,
// which broke pushManager.subscribe on desktop Chrome.
// v2: initial push + notificationclick handlers.
const CACHE_NAME = "hgc-admin-v3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Only wipe our own cache namespace — leaves the member sw.js
          // cache (hourgolf-v*) alone even though both SWs share origin.
          .filter((k) => k.startsWith("hgc-admin-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// No fetch handler — navigation goes straight to the network.

// ── Push notifications ───────────────────────────────────────────
// Payload shape (see lib/admin-push.js):
//   { title, body, url, tag?, badge?, icon? }
// url is the admin-app path the notification deep-links to; when
// the user taps, we focus an existing admin window at that path or
// open a new one.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }

  const title = payload.title || "HGC Office";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/admin/icon.png",
    badge: payload.badge || "/icons/admin/icon.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/admin" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin";
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    // Prefer focusing an existing admin tab and navigating it to
    // the deep-link URL. Avoids opening duplicate PWA instances.
    for (const client of allClients) {
      if (client.url.includes("/admin") && "focus" in client) {
        client.navigate(url).catch(() => {});
        return client.focus();
      }
    }
    // No admin tab open — launch one.
    if (self.clients.openWindow) {
      return self.clients.openWindow(url);
    }
  })());
});
