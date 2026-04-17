/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Route /manifest.json to the dynamic tenant-aware handler.
  // The static public/manifest.json sits underneath as a last-resort
  // fallback if the rewrite ever breaks. Installed PWAs that already
  // have /manifest.json bookmarked continue to work transparently.
  async rewrites() {
    return [
      {
        source: "/manifest.json",
        destination: "/api/manifest",
      },
    ];
  },
};

module.exports = nextConfig;
