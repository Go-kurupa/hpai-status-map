// 死亡率の基準の知らせ（mortality_hit）の、1 農場の 1 日（記録の日）の上限（M-13、設計書 §6、§8）。
// すぐ送る経路（onDeathWritten → dispatchNotices）と送り直しの経路（digest の deliverQueued）は、どちらもここだけを通す。決まりは 1 つ:
// 1. 枠（farms/{farmId}/hitCounters/{記録の日}）は、実際に送る直前にトランザクションで確保する（reserveHitSlot）。
// 2. 送れなかったら（認証、上限、通信の停止、宛先なし）、その場で枠を返す。送れたかは送信の結果（メモリ）で決め、
//    sentNotices の状態では決めない（markSent が失敗しても、送った分は枠を使ったまま）。届いた会員も枠の文書に残す（settleHitSlot）。
// 3. 確保できなければ（その日の上限まで送れた後）、記録を capped にして送らず、運営者の箱に 1 日 1 件出す（capHitNotices）。
//    箱への登録が失敗したら、記録に cappedAlert: "pending" を残し、次の実行で登録し直す（retryCapAlerts）。
// ログに出すのは件数とエラーの code だけ（農場、鶏舎、宛先は出さない）。ルールは全拒否のまま（サーバーだけが書く）。
import { randomUUID } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { enqueueReview, reviewAlertId } from "../review/queue";
import { codeOf } from "./dispatch";

/** 1 農場の、記録の日 1 日あたりの基準の知らせの数（記録＝鶏舎の数）。偽の記録や入力の誤りで、共有の Gmail の上限を使い切らせない。 */
export const MAX_HIT_NOTICES_PER_FARM_DAY = 3;

/** 記録の id（date_houseId）の日付。読めなければ null（枠を確保できないので送らない）。 */
export function hitDateOf(recordId: string): string | null {
  const d = recordId.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && recordId.charAt(10) === "_" ? d : null;
}

interface Counter {
  /** 枠を使っている記録（最大 MAX_HIT_NOTICES_PER_FARM_DAY 件）。 */
  recordIds: string[];
  /** 記録ごとの、届いた会員。markSent が失敗した記録を送り直しで二度送らないために使う。 */
  delivered: Record<string, string[]>;
  /** 記録ごとの、いま枠を使って送っている実行の印。自分以外の印が残っていれば、送れなくても枠を返さない。 */
  holders: Record<string, string[]>;
}

function counterRef(db: Firestore, farmId: string, recordId: string): DocumentReference {
  const date = hitDateOf(recordId);
  if (date === null) throw new Error("基準の知らせの記録の id から日付を読めません");
  return db.collection("farms").doc(farmId).collection("hitCounters").doc(date);
}

function readLists(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof v === "object" && v !== null) {
    for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(list)) out[k] = list.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

function readCounter(data: unknown): Counter {
  const d = data as { recordIds?: unknown; delivered?: unknown; holders?: unknown } | undefined;
  const recordIds = Array.isArray(d?.recordIds) ? (d.recordIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { recordIds, delivered: readLists(d?.delivered), holders: readLists(d?.holders) };
}

/** 空の一覧を残さない。 */
function withList(map: Record<string, string[]>, key: string, list: readonly string[]): Record<string, string[]> {
  const { [key]: _old, ...rest } = map;
  return list.length > 0 ? { ...rest, [key]: [...list] } : rest;
}

/** 確保の結果。open のときだけ送ってよく、holder（この実行の印）を settleHitSlot に渡す。 */
export type HitReservation =
  | { kind: "open"; holder: string; fresh: boolean }
  | { kind: "delivered" }
  | { kind: "full" };

/**
 * 送る直前に枠を確保する（トランザクション）。確保できたら、その記録の holders にこの実行の印を足す。
 * - open（fresh）: 今回新しく枠を確保した
 * - open（fresh でない）: その記録はすでに枠を使っている（別の会員に届いた、別の実行が送っている、など）。同じ枠で送ってよい
 * - delivered: uid を渡したとき、その会員にはすでに届いている（記録の sent への書き込みが失敗していた）。送らずに sent にする
 * - full: その日の上限まで枠が埋まっている。送らずに capped にする
 */
export async function reserveHitSlot(db: Firestore, farmId: string, recordId: string, uid?: string): Promise<HitReservation> {
  const ref = counterRef(db, farmId, recordId);
  const holder = randomUUID();
  return db.runTransaction(async (tx): Promise<HitReservation> => {
    const c = readCounter((await tx.get(ref)).data());
    if (uid !== undefined && (c.delivered[recordId] ?? []).includes(uid)) return { kind: "delivered" };
    const held = c.recordIds.includes(recordId);
    if (!held && c.recordIds.length >= MAX_HIT_NOTICES_PER_FARM_DAY) return { kind: "full" };
    tx.set(ref, {
      recordIds: held ? c.recordIds : [...c.recordIds, recordId],
      delivered: c.delivered,
      holders: withList(c.holders, recordId, [...(c.holders[recordId] ?? []), holder]),
    });
    return { kind: "open", holder, fresh: !held };
  });
}

/**
 * 送ったあとの後始末（トランザクション）。自分の印（holder）だけを外す。投げない（失敗はログだけ。送ったメールは取り消せない）。
 * - 届いた会員がいれば: 枠を使ったまま、届いた会員を残す（枠が返っていたら付け直す。上限より 1 件多くなっても、送った分は数える）
 * - 届いた会員がいなければ: その記録がほかの実行で届いておらず、自分以外の印も残っていないときだけ、枠を返す
 *   （送り直しで同じ枠を使って送っている最中の実行がいれば返さない。印を残したまま打ち切られた実行の枠は返らず、届く数が減る側に倒れる）
 */
export async function settleHitSlot(
  db: Firestore,
  farmId: string,
  recordId: string,
  o: { holder: string; deliveredUids: readonly string[] },
): Promise<void> {
  try {
    const ref = counterRef(db, farmId, recordId);
    await db.runTransaction(async (tx) => {
      const c = readCounter((await tx.get(ref)).data());
      const others = (c.holders[recordId] ?? []).filter((h) => h !== o.holder);
      const holders = withList(c.holders, recordId, others);
      if (o.deliveredUids.length > 0) {
        const recordIds = c.recordIds.includes(recordId) ? c.recordIds : [...c.recordIds, recordId];
        const uids = [...new Set([...(c.delivered[recordId] ?? []), ...o.deliveredUids])].sort();
        tx.set(ref, { recordIds, delivered: { ...c.delivered, [recordId]: uids }, holders });
        return;
      }
      const keep = others.length > 0 || (c.delivered[recordId] ?? []).length > 0;
      const recordIds = keep ? c.recordIds : c.recordIds.filter((i) => i !== recordId);
      tx.set(ref, { recordIds, delivered: c.delivered, holders });
    });
  } catch (e) {
    console.error("[notify] 基準の知らせの枠の後始末に失敗しました", { code: codeOf(e), delivered: o.deliveredUids.length });
  }
}

/** 運営者の箱に、上限で止めたことを 1 日（記録の日）1 件出す。農場や鶏舎は書かない（運営者は農場のデータを見ない）。 */
async function enqueueCapAlert(date: string, now: Date): Promise<void> {
  await enqueueReview(
    { id: reviewAlertId("mortality_capped", date), kind: "alert", alert: "mortality_capped", prefCode: null, caseId: null, message: "基準の知らせが 1 農場の 1 日の上限で止まりました" },
    now,
  );
}

/**
 * 上限で止めた記録を capped にして（送らない）、運営者の箱に出す。投げない。
 * 箱への登録が失敗したら cappedAlert: "pending" を残し、retryCapAlerts が次の実行で登録し直す。
 * capped への書き込みが失敗した記録は queued か failed のままなので、送り直しが拾い、確保できずに capped にする。
 */
export async function capHitNotices(refs: readonly DocumentReference[], recordId: string, now: Date): Promise<void> {
  const marked: DocumentReference[] = [];
  for (const ref of refs) {
    try {
      await ref.update({ state: "capped", cappedAlert: "pending" });
      marked.push(ref);
    } catch (e) {
      console.error("[notify] 上限で止めた記録を書けませんでした", { code: codeOf(e) });
    }
  }
  const date = hitDateOf(recordId);
  if (date === null || marked.length === 0) return;
  try {
    await enqueueCapAlert(date, now);
  } catch (e) {
    console.error("[notify] 上限で止めたことを運営者の箱に出せませんでした（次の実行で出し直します）", { code: codeOf(e) });
    return;
  }
  for (const ref of marked) {
    try {
      await ref.update({ cappedAlert: FieldValue.delete() });
    } catch (e) {
      console.error("[notify] 記録の更新に失敗しました（cappedAlert）", { code: codeOf(e) }); // 次の実行で登録し直す（同じ id なので 1 件のまま）
    }
  }
}

/** 箱への登録が済んでいない capped の記録を拾って、登録し直す（送り直しと朝の実行の最初に呼ぶ）。投げない。 */
export async function retryCapAlerts(db: Firestore, now: Date): Promise<void> {
  try {
    const snap = await db.collection("sentNotices").where("cappedAlert", "==", "pending").get();
    const byDate = new Map<string, DocumentReference[]>();
    for (const d of snap.docs) {
      const data = d.data() as { subjectId?: unknown; state?: unknown };
      const date = typeof data.subjectId === "string" ? hitDateOf(data.subjectId) : null;
      if (date === null || data.state !== "capped") continue;
      const list = byDate.get(date) ?? [];
      list.push(d.ref);
      byDate.set(date, list);
    }
    for (const [date, refs] of byDate) {
      try {
        await enqueueCapAlert(date, now);
        for (const ref of refs) await ref.update({ cappedAlert: FieldValue.delete() });
      } catch (e) {
        console.error("[notify] 上限で止めたことを運営者の箱に出し直せませんでした", { code: codeOf(e) });
      }
    }
  } catch (e) {
    console.error("[notify] 箱への登録が残っている記録を読めませんでした", { code: codeOf(e) });
  }
}
