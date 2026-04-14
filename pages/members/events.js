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
