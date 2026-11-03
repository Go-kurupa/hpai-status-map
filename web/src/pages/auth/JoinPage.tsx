import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { keptSearch } from "./emailLink";
import { InviteCodeForm } from "./InviteCodeForm";
import { SignInPanel } from "./SignInPanel";
import { useAuthUser } from "./useAuthUser";
import "./auth.css";

/** 招待リンク（/join/:code）。入って会員になり、農場の設定へ進む */
export default function JoinPage() {
  const { code = "" } = useParams();
  const auth = useAuthUser();
  const navigate = useNavigate();
  const [flow, setFlow] = useState(false);
  const toFarm = () => navigate({ pathname: "/settings/farm", search: keptSearch() });

  return (
    <section className="auth-page">
      <h1>招待コードで登録</h1>
      <p>招待されたので、メールのリンクか Google で入ります。パスワードはいりません</p>
      <p className="auth-note">LINE の中で開くと Google が使えないことがあります。そのときはメールのリンクで入ってください</p>
      {auth.loading ? (
        <p role="status">確かめています</p>
      ) : auth.user && !flow ? (
        <InviteCodeForm user={auth.user} initialCode={code} onJoined={toFarm} />
      ) : (
        <SignInPanel code={code || null} onFlow={setFlow} onDone={toFarm} />
      )}
    </section>
  );
}
