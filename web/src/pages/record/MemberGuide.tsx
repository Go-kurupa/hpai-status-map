// 会員のログイン状態に合わせた案内（農場がないとき）。useAuthUser は Firebase を読むので、見本の農場と再現の画面からは import しない。
// disinfectionLog.tsx が lazy で必要なときだけ読む。
import { Link } from "react-router";
import { TODO_TEXT } from "../todo/texts";
import { useAuthUser } from "../auth/useAuthUser";

export default function MemberGuide() {
  const auth = useAuthUser();
  if (auth.loading) return null;
  if (auth.error) return <p role="alert">{TODO_TEXT.recordAuthError}</p>;
  if (!auth.member) {
    return (
      <p>
        {TODO_TEXT.recordNeedInvite}。 <Link to="/login">{TODO_TEXT.loginLink}</Link>
      </p>
    );
  }
  return (
    <p>
      {TODO_TEXT.recordNeedFarm}。 <Link to="/settings/farm">{TODO_TEXT.setFarmLink}</Link>
    </p>
  );
}
