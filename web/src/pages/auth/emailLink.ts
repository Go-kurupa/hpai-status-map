// ログインの部品。メールのリンクと Google。パスワードは使わない（設計書 §8）。
// このファイルは firebase/auth を静的に読むので、会員の画面（lazy の chunk）だけが import する。
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";

/** メールのリンクを開く端末が同じなら、メールを聞き直さずに済ませる置き場。ログインが済んだら消す */
export const EMAIL_STORAGE_KEY = "hpai.emailForSignIn";

function readStoredEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_STORAGE_KEY, email);
  } catch {
    // 置けなくても、リンクを開いた先でメールを聞き直せる
  }
}
function forgetEmail(): void {
  try {
    localStorage.removeItem(EMAIL_STORAGE_KEY);
  } catch {
    // 何もしない
  }
}

/** Firebase がリンクに足す項目。次のリンクや画面の移動へ持ち越さない（持ち越すと、古い oobCode が先に読まれる） */
const LINK_PARAMS = ["oobCode", "mode", "apiKey", "lang", "continueUrl"];

/** location.search から、メールのリンクの項目を除いたもの（?emulator=1 などは残す）。"" か "?..." */
export function keptSearch(search: string = location.search): string {
  const params = new URLSearchParams(search);
  for (const key of LINK_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}

/**
 * ログインのリンクをメールで送る。リンクの先は /join/:code（招待コードがあるとき）か /login。
 * ?emulator=1 などの location.search を保つ（保たないと、リンクを開いた先が本番の設定を読みに行く）。
 */
export async function sendInviteLink(auth: Auth, email: string, code: string | null): Promise<void> {
  const path = code ? `/join/${encodeURIComponent(code)}` : "/login";
  await sendSignInLinkToEmail(auth, email, {
    url: `${location.origin}${path}${keptSearch()}`,
    handleCodeInApp: true,
  });
  storeEmail(email); // 送れたときだけ置く
}

/** この href がメールのログインのリンクか。画面が Firebase を読む前の、安い下見 */
export function looksLikeEmailLink(href: string): boolean {
  return /[?&]oobCode=/.test(href);
}

/**
 * メールのリンクから入る。リンクでなければ null。
 * 端末にメールがなければ（別の端末や別のブラウザで開いたとき）askEmail で聞く。
 */
export async function completeEmailLink(
  auth: Auth,
  href: string,
  askEmail: () => Promise<string>,
): Promise<User | null> {
  if (!isSignInWithEmailLink(auth, href)) return null;
  const email = (readStoredEmail() ?? (await askEmail())).trim();
  const cred = await signInWithEmailLink(auth, email, href);
  forgetEmail(); // 入れたら端末から消す。失敗したときは残して、もう一度試せるようにする
  return cred.user;
}

/** Google のポップアップで入る。ポップアップが使えない場面（LINE の中など）は例外になる */
export async function signInWithGoogle(auth: Auth): Promise<User> {
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return cred.user;
}

/**
 * ログインの後。招待コードがあれば会員にし（redeem）、そのあと ID トークンを取り直す
 * （claim の member は、取り直すまで画面に届かない）。メールのリンクと Google で共用する。
 */
export async function afterSignIn(
  user: User,
  code: string | null,
  redeem: (code: string) => Promise<unknown>,
): Promise<void> {
  if (code) await redeem(code);
  await user.getIdToken(true);
}
