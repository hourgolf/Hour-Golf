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
