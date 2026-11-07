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
      {/* 会員になると何ができるかを先に書く（2026-11-07 精査 J1）。LINE の注はメールの欄の上（SignInPanel） */}
      <p>入ると、農場の設定・死亡や消毒の記録・対策項目・AI への相談が使えます。パスワードはいりません</p>
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
