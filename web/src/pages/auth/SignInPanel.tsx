import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { getFirebase } from "../../firebase";
import { redeemInviteCall } from "./callables";
import { afterSignIn, completeEmailLink, looksLikeEmailLink, sendInviteLink, signInWithGoogle } from "./emailLink";
import { CODE_REFUSED } from "./InviteCodeForm";
import "./auth.css";

const GOOGLE_FAILED = "メールのリンクで入ってください";
const GOOGLE_BLOCKED = "ログインの画面を開けませんでした。もう一度「Google で入る」を押してください";
const GOOGLE_CLOSED = "ログインをやめました";
const SEND_FAILED = "メールを送れませんでした。メールアドレスを確かめて、もう一度試してください";
const LINK_FAILED = "このリンクは使えません。もう一度、リンクを送ってください";
// Google の窓が開かない場面の注。メールのリンクの欄の上に置き、Google がだめならここから入れると分かるようにする
const LINE_NOTE = "LINE の中で開くと Google が使えないことがあります。そのときはメールのリンクで入ってください";
// 送った後の文。小さく見落とされないよう枠付き・太字にし、届かないときの見どころも添える（2026-11-07 精査 J2）
const SENT = "メールを送りました。届いたリンクを押してください。届かないときは迷惑メールも見てください";

type FirebaseAuth = Awaited<ReturnType<typeof getFirebase>>["auth"];

/** Firebase の失敗の符号（auth/popup-blocked など）。auth/ で始まる文字列だけ。メールなど別の値は拾わない */
function authCode(e: unknown): string | null {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^auth\/[a-z0-9-]+$/.test(code) ? code : null;
}

/**
 * Google かメールのリンクで入る。招待コード（code）があれば、入った後に会員にする。
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
  const readyAuth = useRef<FirebaseAuth | null>(null); // 表示のときに用意しておく。押したらすぐ窓を開くため
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

  // Google の窓は、押した操作のすぐ後に開かないと止められることがある。通信を待たずに済むよう、先に用意する
  useEffect(() => {
    getFirebase().then(
      ({ auth }) => {
        readyAuth.current = auth;
      },
      () => {}, // 失敗は、押したときにもう一度試して、その結果を出す
    );
  }, []);

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
    const ready = readyAuth.current; // await の前に取る。用意済みなら、窓をその場で開く
    void enter(async () => {
      let user;
      try {
        user = await (ready ? signInWithGoogle(ready) : getFirebase().then(({ auth }) => signInWithGoogle(auth)));
      } catch (e) {
        // ポップアップが止められた・閉じられた、使えない場面（LINE の中など）。例外にしない
        const code = authCode(e);
        if (code) console.warn("Google でのログインに失敗", code);
        if (code === "auth/popup-blocked") setError(`${GOOGLE_BLOCKED}（${code}）`);
        else if (code === "auth/popup-closed-by-user") setError(GOOGLE_CLOSED);
        else if (code === "auth/cancelled-popup-request") setError(null); // 別の窓に置き換わっただけ
        else setError(code ? `${GOOGLE_FAILED}（${code}）` : GOOGLE_FAILED);
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
        <p className="auth-note">別の端末やブラウザでリンクを開いたので、メールアドレスをもう一度入力してください。</p>
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

  // いちばん手早い Google を主のボタンにして先に置き、メールのリンクは「または」の後（2026-11-07 精査 J1）
  return (
    <div>
      <div className="auth-form">
        <Button variant="primary" onClick={google} disabled={busy}>
          Google で入る
        </Button>
      </div>
      <p className="auth-or">または</p>
      <form className="auth-form" onSubmit={sendLink}>
        <p className="auth-note">{LINE_NOTE}</p>
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
        <Button type="submit" disabled={busy || email.trim() === ""}>
          ログインのリンクを送る
        </Button>
        {sent ? (
          <p className="auth-sent" role="status">
            {SENT}
          </p>
        ) : null}
      </form>
      {busy ? <p role="status">確かめています</p> : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
