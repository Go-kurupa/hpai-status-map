// 本番で使う NotifyDeps（M-13）。値は handler の中で呼ばれたときに読む（トップレベルでは読まない）。
import { getAuth } from "firebase-admin/auth";
import { db } from "../admin";
import { APP_URL, UNSUBSCRIBE_SECRET } from "../secrets";
import type { NotifyDeps } from "./dispatch";
import { sendMail } from "./send";

/** メールを送る関数（鍵を宣言した関数の中でだけ呼ぶ）。 */
export function liveDeps(): NotifyDeps {
  return {
    db,
    mailer: sendMail,
    emailOf: async (uid) => {
      try {
        return (await getAuth().getUser(uid)).email ?? null;
      } catch {
        return null;
      }
    },
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
