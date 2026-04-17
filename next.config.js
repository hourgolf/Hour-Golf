/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Note: the /manifest.json -> /api/manifest rewrite used to live here.
  // Moved into middleware.js because any `rewrites()` config in this file
  // makes Vercel attach `x-vercel-enable-rewrite-caching: 1` to every
  // response, which caches the HTML at the Edge for minutes regardless of
  // Cache-Control: no-store. Per-tenant SSR pages must not be Edge-cached.
  // `NextResponse.rewrite()` in middleware avoids that header.

  // Disable Vercel's Edge CDN cache for every page that renders tenant
  // branding. Setting Vercel-CDN-Cache-Control from middleware did not
  // affect Vercel's cache-insertion decision (verified: age climbed
  // unbounded despite the header being set on the response). `headers()`
  // in next.config.js is applied at the Vercel infrastructure layer,
  // before runtime, and is documented as the authoritative way to set
  // CDN cache headers.
  //
  // Scoped to everything NOT under /api/* — API handlers keep control of
  // their own caching. Static assets under /_next/static/ already have
  // their own cache policies and are excluded by the source pattern.
  async headers() {
    return [
      {
        source: "/((?!api/|_next/).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
          { key: "CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
