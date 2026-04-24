// Admin PWA service worker — minimal, parallel to the member sw.js.
// Does NOT pre-cache pages or intercept navigation fetches, so
// operators always see the latest deployed build immediately after a
// sign-in. Activation alone enables standalone install; the cache
// name is here only as a version sentinel that triggers the
// "update available" banner when bumped.
//
// Separate cache namespace ("hgc-admin-v*") so this SW and the member
// sw.js ("hourgolf-v*") don't collide on the same origin.

const CACHE_NAME = "hgc-admin-v1";

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
