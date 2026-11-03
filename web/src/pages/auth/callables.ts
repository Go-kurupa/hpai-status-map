// 会員の画面から呼ぶ Cloud Functions（onCall）。lazy の chunk だけが import する。
import type { NeighborAudience, NeighborDraftResult } from "@hpai/shared/drafts";
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "../../firebase";

/** 招待コードを使って会員になる。失敗は例外（理由は画面に出さない） */
export async function redeemInviteCall(code: string): Promise<{ farmId: string | null }> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ code: string }, { farmId: string | null }>(functions, "redeemInvite")({ code });
  return res.data;
}

/** 農場の全データを消す（その農場の会員だけ。取り消せない）。農場の名前が合わなければ失敗する */
export async function deleteFarmDataCall(farmId: string, confirmName: string): Promise<void> {
  const { functions } = await getFirebase();
  await httpsCallable<{ farmId: string; confirmName: string }, { deleted: true }>(functions, "deleteFarmData")({
    farmId,
    confirmName,
  });
}

/** 農場に会員を足す招待リンクを作る（その農場の会員だけ） */
export async function createFarmInviteCall(farmId: string): Promise<{ code: string; url: string }> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ farmId: string }, { code: string; url: string }>(functions, "createFarmInvite")({ farmId });
  return res.data;
}

/** 近隣への説明文を下書きする。本人が入力した文と宛先の種類だけが Claude に渡る（会員だけ） */
export async function draftNeighborExplainerCall(measures: string, audience: NeighborAudience): Promise<NeighborDraftResult> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ measures: string; audience: NeighborAudience }, NeighborDraftResult>(
    functions,
    "draftNeighborExplainer",
    // 既定は 70 秒。サーバーは Claude に最長 90 秒待つので、その後の雛形の返しまで待つ（途中で諦めると、サーバーだけ課金されて作り直しになる）
    { timeout: 130_000 },
  )({ measures, audience });
  return res.data;
}
