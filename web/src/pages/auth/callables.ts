// 会員の画面から呼ぶ Cloud Functions（onCall）。lazy の chunk だけが import する。
import type { ConsultAskResponse, ConsultFarmCondition, ConsultTurn } from "@hpai/shared/consult/types";
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

/**
 * AIに対策を相談で聞く。話題か文のどちらか一方を渡す。judge が true なら、ログインなしの審査員の入口（全体の回数に上限）。
 * 渡るのは本人が入れた問いと、続けて聞くときの同じ相談の前の往復（問いと AI の答え、直前の数往復）だけ。農場の名前、位置、記録は送らない。
 */
export async function consultAskCall(
  input: { question: string } | { topicId: string },
  judge: boolean,
  history: ConsultTurn[] = [],
  // 本人が「この飼い方で相談する」を選んだときだけ渡す、登録した飼育目的と飼い方。なければ送らない
  farm: ConsultFarmCondition | null = null,
): Promise<ConsultAskResponse> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ question?: string; topicId?: string; judge?: boolean; history?: ConsultTurn[]; farm?: ConsultFarmCondition }, ConsultAskResponse>(
    functions,
    "consultAsk",
    // 既定は 70 秒。サーバーは Claude を待つので、返しまで待つ（draftNeighborExplainerCall と同じ）
    { timeout: 130_000 },
  )({ ...input, ...(judge ? { judge: true } : {}), ...(history.length > 0 ? { history } : {}), ...(farm ? { farm } : {}) });
  return res.data;
}
