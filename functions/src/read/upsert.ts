// cases に書くのはこの 2 つだけ（契約 2.7、6.3）。確認中の事例は県名とリンクだけ公開する。
import type { Case } from "@hpai/shared/types";
import { db } from "../admin";

const REVIEWING_PREFIX = "rev-";

function assertDocId(id: string, what: string): void {
  if (id === "" || id.includes("/")) throw new RangeError(`${what}が不正です`);
}

/** 確認中の事例が、決められた欄（id、season、prefCode、sourceUrls、confirmState、updatedAt）以外に値を持っていれば、その欄の名前を返す。 */
function reviewingLeak(c: Case): string | null {
  if (c.muniCode !== null) return "muniCode";
  if (c.muniName !== null) return "muniName";
  if (c.headCount !== null) return "headCount";
  if (c.nationalNo !== null) return "nationalNo";
  if (c.prefNo !== null) return "prefNo";
  if (c.birdUse !== null) return "birdUse";
  if (c.housing !== null) return "housing";
  if (Object.keys(c.stages).length > 0) return "stages";
  if (c.radiiKm.length > 0) return "radiiKm";
  if (c.prefEstimates.shipment !== null || c.prefEstimates.movement !== null || c.prefEstimates.surveillance !== null) return "prefEstimates";
  if (c.negation !== "none" || c.negatedAt !== null) return "negation";
  return null;
}

/** 事例を cases/{id} に書く（置き換え）。確認中に読み取った値が混ざっていれば何も書かず reject する。 */
export async function upsertCase(c: Case): Promise<void> {
  assertDocId(c.id, "事例の id");
  if (c.confirmState === "reviewing") {
    if (!c.id.startsWith(REVIEWING_PREFIX)) throw new RangeError("確認中の事例の id は rev- で始めてください");
    const leak = reviewingLeak(c);
    if (leak !== null) throw new RangeError(`確認中の事例に読み取った値は入れられません: ${leak}`);
  } else {
    if (c.id.startsWith(REVIEWING_PREFIX)) throw new RangeError("確認中でない事例の id は rev- で始められません");
    if (c.muniCode === null || c.muniName === null) throw new RangeError("確認中でない事例には市町村が必要です");
  }
  await db.doc(`cases/${c.id}`).set(c);
}

/** 文書の確認中の事例（rev-{documentId}）を消す。本物の事例は消さない。無くてもエラーにしない。 */
export async function deleteReviewingCase(documentId: string): Promise<void> {
  assertDocId(documentId, "文書の id");
  await db.doc(`cases/${REVIEWING_PREFIX}${documentId}`).delete();
}
