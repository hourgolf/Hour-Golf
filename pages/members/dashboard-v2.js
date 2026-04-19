import MemberLayout from "../../components/members/MemberLayout";
import MemberDashboardV2 from "../../components/members/MemberDashboardV2";

// Prototype dashboard — sits alongside the production dashboard at
// /members/dashboard so we can A/B internally without disturbing live
// members. Same auth, same APIs, only the rendered surface differs.
export default function DashboardV2Page() {
  return (
    <MemberLayout activeTab="dashboard">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberDashboardV2
          member={member}
          tierConfig={tierConfig}
          refresh={refresh}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}

export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
