import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { getFirebase } from "../../firebase";
import { redeemInviteCall } from "./callables";
import { afterSignIn, completeEmailLink, looksLikeEmailLink, sendInviteLink, signInWithGoogle } from "./emailLink";
import { CODE_REFUSED } from "./InviteCodeForm";
import "./auth.css";

const GOOGLE_FAILED = "メールのリンクで入ってください";
const SEND_FAILED = "メールを送れませんでした。メールアドレスを確かめて、もう一度試してください";
const LINK_FAILED = "このリンクは使えません。もう一度、リンクを送ってください";

/**
 * メールのリンクか Google で入る。招待コード（code）があれば、入った後に会員にする。
 * メールのリンクから戻ってきたとき（URL に oobCode がある）は、ここで入りを完了する。
 * 終わったら onDone。入っている間は onFlow(true)。
 */
export function SignInPanel({
  code,
  onDone,
  onFlow,
}: {
  code: string | null;
  onDone: () => void | Promise<void>;
  onFlow?: (active: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<null | ((email: string) => void)>(null);
  const [askValue, setAskValue] = useState("");
  const started = useRef(false);
  const latest = useRef({ code, onDone, onFlow });
  latest.current = { code, onDone, onFlow };

  async function enter(run: () => Promise<boolean>) {
    latest.current.onFlow?.(true);
    setBusy(true);
    setError(null);
    let done = false;
    try {
      done = await run();
    } finally {
      setBusy(false);
      latest.current.onFlow?.(false);
    }
    if (done) await latest.current.onDone();
  }

  /** 入った後の仕上げ。コードが使えなければその文だけを出し、会員にはならない */
  async function finish(user: Parameters<typeof afterSignIn>[0]): Promise<boolean> {
    try {
      await afterSignIn(user, latest.current.code, redeemInviteCall);
      return true;
    } catch {
      setError(CODE_REFUSED);
      return false;
    }
  }

  // メールのリンクから戻ってきたとき
  useEffect(() => {
    if (started.current || !looksLikeEmailLink(window.location.href)) return;
    started.current = true;
    void enter(async () => {
      const { auth } = await getFirebase();
      let user;
      try {
        user = await completeEmailLink(auth, window.location.href, () => {
          setBusy(false);
          return new Promise<string>((resolve) => setAsking(() => resolve));
        });
      } catch {
        setError(LINK_FAILED);
        return false;
      }
      return user ? finish(user) : false;
    });
    // 戻ってきたとき 1 度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendLink(e: { preventDefault(): void }) {
    e.preventDefault();
    const address = email.trim();
    if (address === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { auth } = await getFirebase();
      await sendInviteLink(auth, address, code);
      setSent(true);
    } catch {
      setError(SEND_FAILED);
    }
    setBusy(false);
  }

  function google() {
    void enter(async () => {
      let user;
      try {
        const { auth } = await getFirebase();
        user = await signInWithGoogle(auth);
      } catch {
        setError(GOOGLE_FAILED); // ポップアップが閉じられた、使えない場面（LINE の中など）。例外にしない
        return false;
      }
      return finish(user);
    });
  }

  function answerAsk(e: { preventDefault(): void }) {
    e.preventDefault();
    const resolve = asking;
    if (!resolve || askValue.trim() === "") return;
    setAsking(null);
    setBusy(true);
    resolve(askValue.trim());
  }

  if (asking) {
    return (
      <form className="auth-form" onSubmit={answerAsk}>
        <label htmlFor="ask-email">ログインに使うメールアドレス</label>
        <p className="auth-note">別の端末やブラウザでリンクを開いたので、もう一度入れてください。</p>
        <input
          id="ask-email"
          type="email"
          autoComplete="email"
          value={askValue}
          onChange={(e) => setAskValue(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={askValue.trim() === ""}>
          つづける
        </Button>
      </form>
    );
  }

  return (
    <div>
      <form className="auth-form" onSubmit={sendLink}>
        <label htmlFor="login-email">メールアドレス</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(false);
          }}
        />
        <Button type="submit" variant="primary" disabled={busy || email.trim() === ""}>
          ログインのリンクを送る
        </Button>
        {sent ? (
          <p role="status">メールを送りました。届いたメールのリンクをおしてください。</p>
        ) : null}
      </form>
      <p className="auth-or">または</p>
      <div className="auth-form">
        <Button onClick={google} disabled={busy}>
          Google で入る
        </Button>
      </div>
      {busy ? <p role="status">確かめています</p> : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
