import MemberLayout from "../../components/members/MemberLayout";
import MemberAccount from "../../components/members/MemberAccount";

export default function AccountPage() {
  return (
    <MemberLayout activeTab="account">
      {({ member, tierConfig, refresh, showToast, onLogout }) => (
        <MemberAccount
          member={member}
          tierConfig={tierConfig}
          refresh={refresh}
          showToast={showToast}
          onLogout={onLogout}
        />
      )}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
