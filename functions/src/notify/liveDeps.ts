// 本番で使う NotifyDeps（M-13）。値は handler の中で呼ばれたときに読む（トップレベルでは読まない）。
import { getAuth } from "firebase-admin/auth";
import { db } from "../admin";
import { APP_URL, UNSUBSCRIBE_SECRET } from "../secrets";
import type { NotifyDeps } from "./dispatch";
import { sendMail } from "./send";

/**
 * 会員のメールアドレスを取る関数を作る。
 * ユーザーが存在しない（auth/user-not-found。退会など）とアドレスがないときだけ null（宛先の不備として数える）。
 * それ以外の例外（Auth の一時的な障害）は投げる。呼ぶ側は、その回は飛ばして次の回に送り直す（回数に数えない）。
 */
export function makeEmailOf(getUser: (uid: string) => Promise<{ email?: string | null }>): (uid: string) => Promise<string | null> {
  return async (uid) => {
    try {
      const email = (await getUser(uid)).email;
      return typeof email === "string" && email !== "" ? email : null;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "auth/user-not-found") return null;
      throw e;
    }
  };
}

/** メールを送る関数（鍵を宣言した関数の中でだけ呼ぶ）。 */
export function liveDeps(): NotifyDeps {
  return {
    db,
    mailer: sendMail,
    emailOf: makeEmailOf((uid) => getAuth().getUser(uid)),
    appUrl: APP_URL.value(),
    unsubscribeSecret: UNSUBSCRIBE_SECRET.value(),
    now: () => new Date(),
  };
}

/**
 * 記録（queued）を作るだけの関数用。メールは送らず、署名の鍵も読まない（鍵を宣言しない関数で .value() を呼ばないため）。
 * 朝に送る知らせ（timing が morning）だけを dispatchNotices に渡すこと。
 */
export function queueOnlyDeps(): NotifyDeps {
  return {
    db,
    mailer: () => Promise.reject(new Error("この関数ではメールを送りません")),
    emailOf: () => Promise.resolve(null),
    appUrl: APP_URL.value(),
    unsubscribeSecret: "",
    now: () => new Date(),
  };
}
