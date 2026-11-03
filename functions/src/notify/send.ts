// メールを送る唯一の口（I-18 が作り、以後の所有者は M。M-02 は import する）。
// 送る手段は Gmail のアプリパスワード（Secret）。値は handler の中で .value() で読み、ログにも画面にも出さない。
// 試験は makeSender に偽の transport を渡して確かめる（実際には送らない）。
import { createTransport, type Transporter } from "nodemailer";
import { GMAIL_APP_PASSWORD, GMAIL_USER } from "../secrets";

export type SendMail = (to: string, mail: { subject: string; text: string }) => Promise<void>;

/** 差出人の表示名。 */
export const SENDER_NAME = "鳥インフル発生状況マップ";

/** 改行を空白にする（件名や宛先に改行を入れてヘッダーを増やされない）。 */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();

/** transport と差出人（"表示名" <アドレス> の形）から、送る関数を作る。失敗は throw する。 */
export function makeSender(transport: Pick<Transporter, "sendMail">, from: string): SendMail {
  return async (to, mail) => {
    await transport.sendMail({ from, to: oneLine(to), subject: oneLine(mail.subject), text: mail.text });
  };
}

/** SMTP の接続、挨拶、無通信の待ちの上限（ミリ秒）。nodemailer の既定は分単位で、関数の打ち切り（300 秒）まで待ってしまう。 */
export const SMTP_TIMEOUT_MS = 20_000;

/** Gmail の transport の設定。待ちに短い上限を付ける。 */
export function gmailTransportOptions(user: string, pass: string) {
  return {
    service: "Gmail",
    auth: { user, pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  };
}

/** Gmail で送る。Secret と設定は呼ばれたときに読む（handler の中でだけ呼ぶこと）。 */
export const sendMail: SendMail = (to, mail) => {
  const user = GMAIL_USER.value();
  const transport = createTransport(gmailTransportOptions(user, GMAIL_APP_PASSWORD.value()));
  return makeSender(transport, `"${SENDER_NAME}" <${user}>`)(to, mail);
};
