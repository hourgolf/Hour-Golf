/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Note: the /manifest.json -> /api/manifest rewrite used to live here.
  // Moved into middleware.js because any `rewrites()` config in this file
  // makes Vercel attach `x-vercel-enable-rewrite-caching: 1` to every
  // response, which caches the HTML at the Edge regardless of
  // Cache-Control: no-store. Per-tenant SSR pages must not be Edge-cached.
  // `NextResponse.rewrite()` in middleware avoids that header. Pages also
  // opt out of the Edge cache via getServerSideProps (see lib/no-cache-ssr.js).
};

module.exports = nextConfig;
