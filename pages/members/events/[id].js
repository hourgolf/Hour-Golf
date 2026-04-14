import { useRouter } from "next/router";
import MemberLayout from "../../../components/members/MemberLayout";
import MemberEventDetail from "../../../components/members/MemberEventDetail";

export default function EventDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  return (
    <MemberLayout activeTab="events">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberEventDetail
          id={id}
          member={member}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}
