import MemberLayout from "../../components/members/MemberLayout";
import MemberBilling from "../../components/members/MemberBilling";

export default function BillingPage() {
  return (
    <MemberLayout activeTab="billing">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberBilling
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
