// 審査員用のリンク（/judge#<秘密の文字列>。2026-11-08 豪さんとの相談）。提出フォームの審査員向けの欄のリンクで開く。
// # の後ろはサーバーへ送られない。読んだらすぐ # を消し（?emulator=1 などの search は残す）、関数 judgeSignIn で確かめて
// 審査員の会員（JUDGE_UID）のトークンを受け取り、ログインして会員の印を付け、トップへ移る。
// 別の人がログイン中なら、先にログアウトする（本物の会員の農場を審査員に見せない）。失敗の理由と文字列は画面に出さない。
import { JUDGE_UID } from "@hpai/shared/judge";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { writeMemberMark } from "../../data/memberMark";
import { getFirebase } from "../../firebase";
import { judgeSignInCall } from "./callables";
import { keptSearch } from "./emailLink";
import "./auth.css";

export const JUDGE_TEXT = {
  entering: "審査員用の見本の農場に入っています…",
  failed: "このリンクは使えません。提出フォームのリンクをもう一度開いてください。",
  toTop: "今季の発生を見る",
} as const;

/** 画面の URL の # を消す。search と、router が持つ履歴の状態はそのまま */
function dropHash(): void {
  if (!window.location.hash) return;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
}

export default function JudgePage() {
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  // 最初の描画の # を持っておく（# は effect の中ですぐ消すので、後の描画では読めない）
  const [token] = useState(() => hash.replace(/^#/, ""));
  const [failed, setFailed] = useState(false);
  // 開発の StrictMode で effect が 2 回走っても、関数は 1 回だけ呼ぶ
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    dropHash();
    if (token === "") {
      setFailed(true);
      return;
    }
    let signedOut = false;
    void (async () => {
      try {
        const { customToken } = await judgeSignInCall(token);
        const { auth } = await getFirebase();
        if (auth.currentUser && auth.currentUser.uid !== JUDGE_UID) {
          await signOut(auth);
          signedOut = true;
        }
        await signInWithCustomToken(auth, customToken);
        writeMemberMark(true);
        void navigate({ pathname: "/", search: keptSearch(search) }, { replace: true });
      } catch {
        // ログアウトした後に入れなかったときは、前の会員の印を残さない（メニューに会員の画面を出さない）
        if (signedOut) writeMemberMark(false);
        setFailed(true);
      }
    })();
    // 最初の 1 回だけ（token と search は最初の描画の値を使う）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!failed) return <p role="status">{JUDGE_TEXT.entering}</p>;
  return (
    <section className="auth-page">
      <p role="alert">{JUDGE_TEXT.failed}</p>
      <p>
        <Link to="/" className="tap-link">
          {JUDGE_TEXT.toTop}
        </Link>
      </p>
    </section>
  );
}
