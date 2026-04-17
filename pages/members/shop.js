import MemberLayout from "../../components/members/MemberLayout";
import MemberShop from "../../components/members/MemberShop";

export default function ShopPage() {
  return (
    <MemberLayout activeTab="shop">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberShop
          member={member}
          tierConfig={tierConfig}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
