import type { IsoDate } from "@hpai/shared/types";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { keptSearch } from "./emailLink";
import { InviteCodeForm } from "./InviteCodeForm";
import { NoCodeNote } from "./NoCodeNote";
import { SignInPanel } from "./SignInPanel";
import { useAuthUser } from "./useAuthUser";
import "./auth.css";

/**
 * この画面の説明を確かめた日。null は確認前。
 * Google の「アプリ内ブラウザでは使えない」の扱いは、確認のときに最新の説明と突き合わせる（注の文は SignInPanel の LINE_NOTE）。
 */
export const LOGIN_TEXT_CHECKED_ON: IsoDate | null = "2026-11-05";

/** 説明の文。確認日は試験で値を差し替えるために引数にしている */
export function LoginText({ checkedOn }: { checkedOn: IsoDate | null }) {
  return (
    <div>
      <p>Google かメールのリンクで入ります。パスワードはいりません</p>
      {/* LINE の注はメールの欄の上（SignInPanel。2026-11-07 精査 J1） */}
      {checkedOn === null ? (
        <p className="auth-note">文面は確認中です。確認日はまだありません。</p>
      ) : (
        <p className="auth-note">確認日 {checkedOn}</p>
      )}
    </div>
  );
}

/** ログイン。会員なら /todo へ、claim がなければ招待コードの入力欄へ進む */
export default function LoginPage() {
  const auth = useAuthUser();
  const navigate = useNavigate();
  const [flow, setFlow] = useState(false);

  useEffect(() => {
    if (!auth.loading && auth.user && auth.member) void navigate({ pathname: "/todo", search: keptSearch() }, { replace: true });
  }, [auth.loading, auth.user, auth.member, navigate]);

  return (
    <section className="auth-page">
      <h1>ログイン</h1>
      <LoginText checkedOn={LOGIN_TEXT_CHECKED_ON} />
      {auth.loading ? (
        <p role="status">確かめています</p>
      ) : auth.user && !flow ? (
        auth.member ? (
          <p role="status">ログインしています</p>
        ) : (
          <>
            <h2>招待コードを入れてください</h2>
            <InviteCodeForm user={auth.user} onJoined={() => navigate({ pathname: "/settings/farm", search: keptSearch() })} />
            <NoCodeNote />
          </>
        )
      ) : (
        <SignInPanel code={null} onFlow={setFlow} onDone={auth.refresh} />
      )}
    </section>
  );
}
