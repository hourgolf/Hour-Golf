// Minimal service worker — just enables PWA install (standalone mode).
// Do NOT pre-cache pages or intercept navigation fetches, so members
// always see the latest deployed version immediately after sign-in.

const CACHE_NAME = "hourgolf-v3";

self.addEventListener("install", (event) => {
  // Activate this SW as soon as possible
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clear any caches from older SW versions that pre-cached pages
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Intentionally no fetch handler — browser handles all requests normally,
// so new deployments are always picked up on the next page load.
