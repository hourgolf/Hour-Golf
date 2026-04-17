import MemberLayout from "../../components/members/MemberLayout";
import MemberEvents from "../../components/members/MemberEvents";

export default function EventsPage() {
  return (
    <MemberLayout activeTab="events">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberEvents
          member={member}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}

// Per-request render so Vercel Edge CDN does not cache tenant branding.
// See lib/no-cache-ssr.js.
export { noCacheSSR as getServerSideProps } from "../../lib/no-cache-ssr";
