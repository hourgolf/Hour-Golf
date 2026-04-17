import { useEffect } from "react";
import { useRouter } from "next/router";
import MemberLayout from "../../components/members/MemberLayout";

function RedirectToDashboard() {
  const router = useRouter();
  useEffect(() => { router.replace("/members/dashboard"); }, []);
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
