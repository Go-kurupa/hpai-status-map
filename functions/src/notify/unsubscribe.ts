// 配信停止のリンク（M-13、設計書 §12）。メールの `${appUrl}/unsubscribe?farm=&uid=&sig=` を GET で開くと、その会員とその農場だけ止まる。
// 署名は HMAC（定数時間で比べる）。返す HTML は固定で、受け取った値を埋め込まない。止めても画面の表示は止まらない（索引 Q10）。
// 戻すのは resumeMail（本人だけ）。
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import type { Farm } from "@hpai/shared/types";
import { db } from "../admin";
import { UNSUBSCRIBE_SECRET } from "../secrets";
import { codeOf } from "./dispatch";
import { verifyUnsubscribe } from "./unsubscribeSig";

function page(title: string, lines: readonly string[]): string {
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${title}</title>`,
    "<style>body{font-family:sans-serif;max-width:36em;margin:2em auto;padding:0 16px;line-height:1.7}</style>",
    "</head><body>",
    `<h1>${title}</h1>`,
    ...lines.map((l) => `<p>${l}</p>`),
    "</body></html>",
  ].join("\n");
}

const STOPPED_HTML = page("配信を止めました", [
  "この農場あてのメールを止めました。発生の知らせ、野鳥の知らせ、朝のまとめが届かなくなります。",
  "基準に当たった知らせと期限の知らせも止まります。画面の表示は止まりません。",
  "また受け取りたいときは、ログインして、知らせの設定で戻せます。",
  '<a href="/settings/notify">知らせの設定へ</a>',
]);
const NO_FARM_HTML = page("この農場は見つかりません", ["この農場のデータは消えています。これ以上、この農場あてのメールは届きません。"]);
const NOT_MEMBER_HTML = page("この農場の会員ではありません", ["この農場の会員ではないため、この農場あてのメールは届きません。"]);
const BAD_LINK_HTML = page("このリンクは使えません", ["メールの配信停止のリンクを、そのまま開き直してください。"]);
const ERROR_HTML = page("止められませんでした", ["しばらくしてから、もう一度開いてください。"]);
const METHOD_HTML = page("このリンクは開くだけで使えます", ["メールの配信停止のリンクを開いてください。"]);

/** 要求の query から文字列の値だけを取る（配列、入れ子、数は捨てる）。 */
export function queryOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * 署名が合えば、その農場のその会員だけを unsubscribedUids に足す（arrayUnion。2 回開いても 1 回分）。
 * 署名が違う、欄が足りない: 403。農場が消えている、会員でない: 200（何も変えない）。
 */
export async function handleUnsubscribe(firestore: Firestore, query: Record<string, string>, key: string): Promise<{ status: number; html: string }> {
  const { farm, uid, sig } = query;
  if (typeof farm !== "string" || typeof uid !== "string" || typeof sig !== "string" || !verifyUnsubscribe(farm, uid, sig, key)) {
    return { status: 403, html: BAD_LINK_HTML };
  }
  const ref = firestore.collection("farms").doc(farm);
  const snap = await ref.get();
  if (!snap.exists) return { status: 200, html: NO_FARM_HTML };
  const data = snap.data() as Partial<Farm>;
  if (!Array.isArray(data.memberUids) || !data.memberUids.includes(uid)) return { status: 200, html: NOT_MEMBER_HTML };
  if (Array.isArray(data.unsubscribedUids) && data.unsubscribedUids.includes(uid)) return { status: 200, html: STOPPED_HTML };
  try {
    await ref.update({ unsubscribedUids: FieldValue.arrayUnion(uid) });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 5) return { status: 200, html: NO_FARM_HTML }; // 開いている間に農場が消えた（NOT_FOUND）
    throw e;
  }
  return { status: 200, html: STOPPED_HTML };
}

/** メールのリンクを開く GET。HEAD では何もしない。 */
export const unsubscribe = onRequest(
  { invoker: "public", timeoutSeconds: 60, memory: "256MiB", secrets: [UNSUBSCRIBE_SECRET] },
  async (req, res) => {
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    if (req.method !== "GET") {
      res.status(405).set("Allow", "GET, HEAD").send(METHOD_HTML);
      return;
    }
    try {
      const r = await handleUnsubscribe(db, queryOf(req.query), UNSUBSCRIBE_SECRET.value());
      res.status(r.status).send(r.html);
    } catch (e) {
      console.error("[unsubscribe] 止められませんでした", { code: codeOf(e) });
      res.status(500).send(ERROR_HTML);
    }
  },
);
