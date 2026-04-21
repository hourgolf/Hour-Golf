import { useEffect } from "react";
import { useRouter } from "next/router";
import MemberLayout from "../../components/members/MemberLayout";

// Post-auth redirect. Default target is the member dashboard, but if
// the /book public page funneled them here (from=book with bay/date/
// start params), send them straight to /members/book with the slot
// carried forward so the booking form lands pre-selected. Also
// stashes the intended slot in sessionStorage so a billing round-trip
// (add a card) doesn't drop it — MemberBooking reads from both URL
// and storage on mount.
function RedirectToDashboard() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (
      qs.get("from") === "book" &&
      qs.get("bay") &&
      qs.get("date") &&
      qs.get("start")
    ) {
      const bay = qs.get("bay");
      const date = qs.get("date");
      const start = qs.get("start");
      try {
        sessionStorage.setItem(
          "hg-intended-slot",
          JSON.stringify({ bay, date, start, stashedAt: Date.now() })
        );
      } catch { /* private mode may throw; non-fatal */ }
      const forward = new URLSearchParams({ bay, date, start });
      router.replace(`/members/book?${forward.toString()}`);
      return;
    }
    router.replace("/members/dashboard");
  }, []);
  return <div className="mem-loading">Redirecting...</div>;
}

export default function MembersIndex() {
  return (
    <MemberLayout activeTab="dashboard">
      {() => <RedirectToDashboard />}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
