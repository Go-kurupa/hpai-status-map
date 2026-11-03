// 運営者へのメール（I-18、設計書 §9.7）。前回の知らせの後に増えた未解決の項目を 1 通にまとめる。
// 本文は種類ごとの件数と運営者の画面の URL だけ。項目の題や本文は入れない（外部の文章を、メールに流さない）。
// 送る口、宛先、URL、時計は引数で受ける（試験は偽物を渡す。Secret と設定は handler の中で読んで渡す）。
import { toJstIso } from "@hpai/shared/dates";
import type { ReviewItem } from "@hpai/shared/read/types";
import { db } from "../admin";
import type { SendMail } from "../notify/send";

export interface NotifyDeps {
  send: SendMail;
  /** 運営者のメールアドレス（OPERATOR_EMAIL）。 */
  to: string;
  /** 作品の URL（APP_URL）。末尾の / はあってもなくてもよい。 */
  appUrl: string;
  now(): Date;
}

const NOTICE_PATH = "usage/operatorNotice";

/** 種類の表示。上から順に本文へ並べる。 */
const LABELS: Array<{ key: string; label: string }> = [
  { key: "document", label: "文書の確認" },
  { key: "entrance_proposal", label: "入口の提案" },
  { key: "alert:national_missing", label: "国の発表との食い違い" },
  { key: "alert:app_only_confirmed", label: "国の一覧にない確定" },
  { key: "alert:case_stalled", label: "疑いのまま続報がない事例" },
  { key: "alert:negation_candidate", label: "否定の発表の確認" },
  { key: "alert:watch_failing", label: "見回りが止まっている県" },
  { key: "alert:agent_run_failed", label: "エージェントの実行の失敗" },
  { key: "alert:mail_failing", label: "メール配信の失敗" },
];

const keyOf = (i: ReviewItem): string => (i.kind === "alert" ? `alert:${i.alert}` : i.kind);

/** 件数を数える（上の表にない種類は「その他」）。 */
function tally(items: readonly ReviewItem[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(keyOf(i), (counts.get(keyOf(i)) ?? 0) + 1);
  const rows = LABELS.filter((l) => counts.has(l.key)).map((l) => ({ label: l.label, count: counts.get(l.key)! }));
  const known = new Set(LABELS.map((l) => l.key));
  const other = [...counts].filter(([k]) => !known.has(k)).reduce((n, [, c]) => n + c, 0);
  return other > 0 ? [...rows, { label: "その他", count: other }] : rows;
}

/**
 * 前回の知らせの後に増えた未解決の項目があれば、1 通送る。なければ何もしない。
 * 送れたときだけ lastNotifiedAt を進める（失敗したら進めず、例外を投げる。次の回に同じ項目を知らせる）。
 * 同じ項目を 2 度知らせない: 前回より後に作られた項目だけを数える。
 */
export async function notifyOperator(deps: NotifyDeps): Promise<{ sent: boolean; count: number }> {
  const noticeRef = db.doc(NOTICE_PATH);
  const last = ((await noticeRef.get()).data() as { lastNotifiedAt?: unknown } | undefined)?.lastNotifiedAt;
  const lastMs = typeof last === "string" && Number.isFinite(Date.parse(last)) ? Date.parse(last) : null;
  const now = deps.now();

  const snap = await db.collection("reviewQueue").where("resolvedAt", "==", null).get();
  const fresh = snap.docs
    .map((d) => d.data() as ReviewItem)
    .filter((i) => {
      const created = Date.parse(i.createdAt);
      return lastMs === null || !Number.isFinite(created) || created > lastMs; // 読めない時刻は新しいものとして知らせる
    });
  if (fresh.length === 0) return { sent: false, count: 0 };

  const rows = tally(fresh);
  const url = `${deps.appUrl.replace(/\/+$/, "")}/operator`;
  const text = [
    `運営者の確認が ${fresh.length} 件あります（前回の知らせの後に増えた、未解決の項目）。`,
    "",
    ...rows.map((r) => `- ${r.label}: ${r.count} 件`),
    "",
    `確認はこちらから: ${url}`,
  ].join("\n");

  await deps.send(deps.to, { subject: `運営者の確認が ${fresh.length} 件あります`, text });
  await noticeRef.set({ lastNotifiedAt: toJstIso(now) }, { merge: true });
  return { sent: true, count: fresh.length };
}
