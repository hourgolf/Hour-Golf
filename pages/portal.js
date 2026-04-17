import { useEffect } from "react";
import { useRouter } from "next/router";

export default function PortalRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Preserve any query params (e.g. ?purchased=5 from Stripe)
    const query = window.location.search;
    router.replace(`/members/dashboard${query}`);
  }, []);

  return (
    <div style={{ padding: "100px 24px", textAlign: "center", fontFamily: "Inter, sans-serif", color: "#888" }}>
      Redirecting to member portal...
    </div>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../lib/no-cache-ssr";
