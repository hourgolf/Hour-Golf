import MemberLayout from "../../components/members/MemberLayout";
import MemberAccount from "../../components/members/MemberAccount";

export default function AccountPage() {
  return (
    <MemberLayout activeTab="account">
      {({ member, tierConfig, refresh, showToast }) => (
        <MemberAccount
          member={member}
          tierConfig={tierConfig}
          refresh={refresh}
          showToast={showToast}
        />
      )}
    </MemberLayout>
  );
}
