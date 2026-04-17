import MemberLayout from "../../components/members/MemberLayout";
import MemberDashboard from "../../components/members/MemberDashboard";

export default function DashboardPage() {
  return (
    <MemberLayout activeTab="dashboard">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberDashboard
          member={member}
          tierConfig={tierConfig}
          refresh={refresh}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
