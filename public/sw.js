// Minimal service worker — just enables PWA install (standalone mode).
// Do NOT pre-cache pages or intercept navigation fetches, so members
// always see the latest deployed version immediately after sign-in.

// Bumping this string is the simplest trigger for the client-side
// "update available" banner — a byte-different sw.js makes the browser
// install a new SW, which the client (pages/_app.js) detects via
// `updatefound` and surfaces as a reload prompt.
const CACHE_NAME = "hourgolf-v4";

self.addEventListener("install", (event) => {
  // Activate this SW as soon as possible
  self.skipWaiting();
});

// Lets the client postMessage skipWaiting if the install handler hasn't
// already self-skipped (belt-and-suspenders for future SW versions that
// might want to wait for explicit user consent before activating).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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
