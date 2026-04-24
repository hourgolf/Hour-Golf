// Root path now redirects to /admin so the admin PWA can scope cleanly
// to /admin/* (distinct from /members/* for the member PWA). Query
// string is preserved so email CTAs like /?view=customers still land
// in the right place after the hop.
//
// Members use /members/* directly; public surfaces (/shop, /book, /app,
// /join/<slug>) don't pass through here. This redirect only affects
// operators typing or bookmarking the bare tenant root.

export async function getServerSideProps({ req, res }) {
  const originalUrl = req.url || "/";
  // Strip the leading "/" then reattach under /admin so /?view=today
  // becomes /admin?view=today with the query preserved intact.
  const qIndex = originalUrl.indexOf("?");
  const query = qIndex >= 0 ? originalUrl.slice(qIndex) : "";
  return {
    redirect: {
      destination: `/admin${query}`,
      permanent: false, // 307 — keeps operator bookmarks flexible while we watch the new route
    },
  };
}

export default function RootRedirect() {
  // Never rendered — getServerSideProps returns a redirect.
  return null;
}
