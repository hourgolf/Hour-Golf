import MemberLayout from "../../components/members/MemberLayout";
import MemberBooking from "../../components/members/MemberBooking";

export default function BookPage() {
  return (
    <MemberLayout activeTab="book">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberBooking
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
