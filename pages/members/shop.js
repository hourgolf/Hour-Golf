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
