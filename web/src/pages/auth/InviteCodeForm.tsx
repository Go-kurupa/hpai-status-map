import type { User } from "firebase/auth";
import { useState } from "react";
import { Button } from "../../ui/Button";
import { redeemInviteCall } from "./callables";
import { afterSignIn } from "./emailLink";
import "./auth.css";

/** コードが使えない理由は 1 つの文にまとめる（存在しない、期限切れ、回数の上限、試しすぎ）。コードの有無を推測させない */
export const CODE_REFUSED = "このコードは使えません";

/**
 * 招待コードを入れて会員になる。ログイン済みで claim がない人の入口
 * （/login、/join/:code を開き直した人、API でアカウントだけ作った人）。
 */
export function InviteCodeForm({
  user,
  initialCode = "",
  onJoined,
}: {
  user: User;
  initialCode?: string;
  onJoined: () => void | Promise<void>;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setRefused(false);
    try {
      await afterSignIn(user, trimmed, redeemInviteCall);
    } catch {
      setRefused(true);
      setBusy(false);
      return;
    }
    await onJoined();
    setBusy(false);
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="invite-code">招待コード</label>
      <input
        id="invite-code"
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy || code.trim() === ""}>
        このコードで入る
      </Button>
      {refused ? (
        <p className="auth-error" role="alert">
          {CODE_REFUSED}
        </p>
      ) : null}
    </form>
  );
}
