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

  images: {
    // Vercel's built-in image optimizer: on-the-fly format negotiation
    // (AVIF first, then WebP, then the original), responsive sizing based
    // on the client's viewport, aggressive caching, served from Vercel's
    // Edge. Free on Pro up to the plan quota. This block configures what
    // the optimizer is allowed to fetch and in what formats.
    formats: ["image/avif", "image/webp"],
    // Whitelist every host we accept remote image URLs from. Supabase
    // Storage serves every tenant's logo / bg / shop image / event image
    // under the public/ prefix of the project's own domain.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "uxpkqbioxoezjmcoylkw.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Responsive breakpoints the optimizer emits. Next picks the smallest
    // size that fits the client's viewport and serves AVIF/WebP when the
    // browser accepts them.
    deviceSizes: [360, 640, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 240, 384],
  },
};

module.exports = nextConfig;
