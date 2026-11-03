// 運営者の画面から呼ぶ Cloud Functions（onCall）。lazy の chunk だけが import する。
import type { ResolveRequest, ResolveResponse, ReviewDetail } from "@hpai/shared/read/review";
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "../../firebase";

/** 項目を 1 件解決する（運営者だけ。サーバーが claim を確かめる）。失敗は例外 */
export async function resolveCall(req: ResolveRequest): Promise<ResolveResponse> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<ResolveRequest, ResolveResponse>(functions, "resolveReviewItem")(req);
  return res.data;
}

/** 文書の項目の詳細（読み取った値と検査の結果。引用は含まれない） */
export async function getDetailCall(itemId: string): Promise<ReviewDetail> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ itemId: string }, ReviewDetail>(functions, "getReviewDetail")({ itemId });
  return res.data;
}

/** 入口を直すエージェントを手動で 1 回実行する（X-14 の runEntranceAgent。運営者だけ） */
export async function runAgentCall(): Promise<void> {
  const { functions } = await getFirebase();
  await httpsCallable<Record<string, never>, unknown>(functions, "runEntranceAgent")({});
}
