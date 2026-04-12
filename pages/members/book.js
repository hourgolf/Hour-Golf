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
