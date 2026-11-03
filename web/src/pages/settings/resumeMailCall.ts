// 配信の再開（M-13 の onCall resumeMail）。本人が、自分の分だけ戻す。lazy の chunk だけが import する。
import { httpsCallable } from "firebase/functions";
import { getFirebase } from "../../firebase";

/** その農場での自分の配信停止を解く。失敗は例外（理由は画面に出さない） */
export async function resumeMailCall(farmId: string): Promise<void> {
  const { functions } = await getFirebase();
  await httpsCallable<{ farmId: string }, { resumed: true }>(functions, "resumeMail")({ farmId });
}
