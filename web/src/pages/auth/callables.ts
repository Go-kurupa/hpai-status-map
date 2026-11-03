// 会員の画面から呼ぶ Cloud Functions（onCall）。lazy の chunk だけが import する。
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "../../firebase";

/** 招待コードを使って会員になる。失敗は例外（理由は画面に出さない） */
export async function redeemInviteCall(code: string): Promise<{ farmId: string | null }> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ code: string }, { farmId: string | null }>(functions, "redeemInvite")({ code });
  return res.data;
}

/** 農場に会員を足す招待リンクを作る（その農場の会員だけ） */
export async function createFarmInviteCall(farmId: string): Promise<{ code: string; url: string }> {
  const { functions } = await getFirebase();
  const res = await httpsCallable<{ farmId: string }, { code: string; url: string }>(functions, "createFarmInvite")({ farmId });
  return res.data;
}
