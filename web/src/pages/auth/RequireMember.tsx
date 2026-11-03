import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useRecordStore } from "../../data/context";
import { keptSearch } from "./emailLink";
import { InviteCodeForm } from "./InviteCodeForm";
import { useAuthUser } from "./useAuthUser";

function Gate({ children }: { children: ReactNode }) {
  const auth = useAuthUser();
  const location = useLocation();

  if (auth.loading) return <p role="status">確かめています</p>;
  if (auth.error) {
    return (
      <p role="alert">
        ログインの状態を確かめられませんでした。通信を確かめて、ページを読み込み直してください。
      </p>
    );
  }
  // ?emulator=1 などを保って /login へ
  if (!auth.user) return <Navigate to={{ pathname: "/login", search: keptSearch(location.search) }} replace />;
  if (!auth.member) {
    return (
      <section className="auth-page">
        <h1>招待コードを入れてください</h1>
        <p>この画面は、招待された方だけが使えます。</p>
        <InviteCodeForm user={auth.user} onJoined={auth.refresh} />
      </section>
    );
  }
  return <>{children}</>;
}

/**
 * 会員だけの画面を包む。見本の農場（sample）は素通しで、Firebase を読まない。
 * 未ログインは /login、claim がなければ招待コードの入力欄。
 */
export function RequireMember({ children }: { children: ReactNode }) {
  const store = useRecordStore();
  if (store.mode === "sample") return <>{children}</>;
  return <Gate>{children}</Gate>;
}
