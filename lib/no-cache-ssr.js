// Shared getServerSideProps for every page that renders tenant branding.
//
// Why this exists:
// Vercel's Edge CDN caches SSG-optimized page output for minutes, even with
// Cache-Control: no-store, Vercel-CDN-Cache-Control: no-store, or CDN-Cache-
// Control: no-store set via middleware or next.config.js headers(). The only
// Next.js primitive that reliably opts a page out of Edge caching is
// getServerSideProps. Pages that use it are rendered per request and are
// not stored in Vercel's rewrite-cache layer.
//
// Every page in this app bakes tenant branding into its HTML (colors, logo
// URL, bg URL, fonts) via _document.js injection. All of those pages need
// to render per request so admin brand edits appear immediately.
//
// Usage:
//   export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";
//
// The handler returns empty props — pages read their data client-side via
// hooks (useAuth, useData, etc.). This is purely about opting out of static
// optimization.

export async function noCacheSSR({ res }) {
  // Belt-and-suspenders: the getServerSideProps opt-out does the heavy
  // lifting, but setting the header makes the intent obvious to browsers
  // and intermediate caches too.
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "private, no-store");
  }
  return { props: {} };
}
