// 既にある確認中の見直し（設計書 §9.6）。読み取りの判断と同じ条件（notPoultryHereReasons）を、出ている「確認中」と運営者の箱の項目に当てる。
// Claude は呼ばない。documents に残した二人の読み（primary、second）と本文（raw/{id}.txt）だけで決める。
// - 自動で載せる設定が入: 文書を捨てる（discarded）。公開の札（rev-）があれば外し、箱の開いた項目は「自動で解決」の印を付けて箱から出す（項目は消さず、理由を足す）。
// - 切: 公開の札だけを外し、文書は非公開の確認中に、箱の項目は「公開していない」に替えて理由を足す（箱には残す）。
// 迷うとき（読みが無い、本文を読めない、箱に開いた項目が無い、途中で状態が変わった）は何もしない。
// cases に書くのは deleteReviewingCaseIn だけ（契約 2.7）。札の削除は知らせの処理が無視する（取り消しのメールは出ない）。
import { logger } from "firebase-functions";
import { toJstIso } from "@hpai/shared/dates";
import { notPoultryHereReasons } from "@hpai/shared/read/publish";
import type { DocumentRecord, ReadState, ReviewItem } from "@hpai/shared/read/types";
import type { Case } from "@hpai/shared/types";
import { bucket, db } from "../admin";
import { readRuntimeSettings } from "../usage/settings";
import { deleteReviewingCaseIn } from "./upsert";

/** 1 回の見直しで調べる札と箱の項目の、それぞれの上限。残りは次の回（突き合わせは 6 時間ごと）。 */
export const MAX_DISMISS_CHECKS = 200;
/** 自動で解決した項目の resolvedBy と resolvedAction（運営者の uid と操作の名前とは重ならない。見回りの自動の閉じ方と同じ "system"）。 */
export const AUTO_RESOLVED_BY = "system";
export const AUTO_RESOLVED_ACTION = "auto_not_poultry_here";

const REVIEWING_PREFIX = "rev-";

export interface DismissResult {
  /** 設定が入: 捨てて、箱から出した文書の id。 */
  discarded: string[];
  /** 設定が切: 公開の札を外し、非公開の確認中に下げた文書の id。 */
  lowered: string[];
  /** 1 件ごとの失敗（残りは続ける）。 */
  errors: unknown[];
}

/** 本文。読めなければ null（空の本文と区別する。読めないときは外さない）。 */
async function bodyOrNull(id: string): Promise<string | null> {
  try {
    return (await bucket().file(`raw/${id}.txt`).download())[0].toString("utf8");
  } catch {
    return null;
  }
}

const merge = (cur: unknown, add: readonly string[]): string[] => [...new Set([...(Array.isArray(cur) ? (cur as string[]) : []), ...add])];

/** 文書 1 件を見直す。捨てたら "discarded"、下げたら "lowered"、何もしなければ null。 */
async function dismissOne(documentId: string, auto: boolean, now: Date): Promise<"discarded" | "lowered" | null> {
  const docRef = db.doc(`documents/${documentId}`);
  const rec = (await docRef.get()).data() as DocumentRecord | undefined;
  const states: readonly ReadState[] = auto ? ["review_public", "review_private"] : ["review_public"];
  if (rec === undefined || !states.includes(rec.readState)) return null;
  const body = await bodyOrNull(documentId);
  if (body === null) return null;
  const reasons = notPoultryHereReasons({
    read: rec.primary ?? null,
    second: rec.second ?? null,
    hasTextLayer: rec.hasTextLayer === true,
    bodyAvailable: body.trim() !== "",
    docText: `${rec.title}\n${body}`,
  });
  if (reasons === null) return null;

  return db.runTransaction(async (tx) => {
    // 読み: 札、文書、箱の項目。判断の後に運営者が解決した、読み直した、などで状態が変わっていれば何もしない
    const caseSnap = await tx.get(db.doc(`cases/${REVIEWING_PREFIX}${documentId}`));
    const docSnap = await tx.get(docRef);
    const items = await tx.get(db.collection("reviewQueue").where("documentId", "==", documentId));
    if (docSnap.data()?.readState !== rec.readState) return null;
    const open = items.docs.filter((d) => {
      const item = d.data() as ReviewItem;
      return item.kind === "document" && (item.resolvedAt ?? null) === null;
    });
    if (open.length === 0) return null; // 箱に開いた項目が無いものは、運営者の操作の途中かもしれないので触れない
    const hasRev = caseSnap.exists && (caseSnap.data() as Case).confirmState === "reviewing";
    if (!auto && !hasRev) return null;

    // 書き
    if (hasRev) deleteReviewingCaseIn(tx, documentId);
    if (auto) {
      tx.update(docRef, { readState: "discarded", reasons: merge(docSnap.data()?.reasons, reasons) });
      for (const d of open) {
        tx.update(d.ref, {
          resolvedAt: toJstIso(now),
          resolvedBy: AUTO_RESOLVED_BY,
          resolvedAction: AUTO_RESOLVED_ACTION,
          hasOutbreakWords: false,
          reasons: merge(d.data().reasons, reasons),
        });
      }
      return "discarded";
    }
    tx.update(docRef, { readState: "review_private", reasons: merge(docSnap.data()?.reasons, reasons) });
    for (const d of open) tx.update(d.ref, { hasOutbreakWords: false, reasons: merge(d.data().reasons, reasons) });
    return "lowered";
  });
}

/**
 * 確認中を見直し、その県の家きんの発生・疑いでないことがはっきりしたものを、人の確認から外す。
 * 見るのは公開の札（rev-）の文書と、設定が入なら箱の開いた文書の項目の文書。1 件の失敗で残りを止めない（失敗は errors に返す）。
 */
export async function dismissNotPoultry(now: Date): Promise<DismissResult> {
  const auto = (await readRuntimeSettings()).autoPublishEnabled;
  const ids = new Set<string>();
  const revs = await db.collection("cases").where("confirmState", "==", "reviewing").limit(MAX_DISMISS_CHECKS).get();
  for (const c of revs.docs) if (c.id.startsWith(REVIEWING_PREFIX)) ids.add(c.id.slice(REVIEWING_PREFIX.length));
  if (auto) {
    const open = await db.collection("reviewQueue").where("resolvedAt", "==", null).limit(MAX_DISMISS_CHECKS).get();
    for (const d of open.docs) {
      const item = d.data() as Partial<ReviewItem> & { documentId?: unknown };
      if (item.kind === "document" && typeof item.documentId === "string" && item.documentId !== "") ids.add(item.documentId);
    }
  }

  const result: DismissResult = { discarded: [], lowered: [], errors: [] };
  for (const id of [...ids].sort()) {
    try {
      const r = await dismissOne(id, auto, now);
      if (r === null) continue;
      result[r].push(id);
      logger.info("その県の家きんの発生ではないと二人が読んだ確認中を、人の確認から外しました", { documentId: id, action: r });
    } catch (e) {
      result.errors.push(e);
      logger.error("確認中を見直せませんでした", { documentId: id, message: e instanceof Error ? `${e.name}: ${e.message}` : "unknown" });
    }
  }
  return result;
}
