// 野鳥の書き込みで知らせる（M-13、設計書 §6）。高病原性が確定したときだけ、10km 以内の会員へ朝のまとめで送る。
// ここでは記録（queued）を作るだけで、メールは送らない（送るのは朝の実行）。そのため鍵を宣言しない。
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import type { GeoStore } from "@hpai/shared/geo";
import { diffDays, jstDateOf } from "@hpai/shared/dates";
import { prefsToLoad } from "@hpai/shared/level";
import { wildBirdNotices } from "@hpai/shared/notices";
import { currentSeason } from "@hpai/shared/season";
import type { Farm, WildBird } from "@hpai/shared/types";
import { loadGeoStore } from "../geo/loadGeo";
import { dispatchNotices, type NotifyDeps } from "./dispatch";
import { queueOnlyDeps } from "./liveDeps";
import { MAX_EVENT_AGE_DAYS } from "./onCaseWritten";

/**
 * 野鳥の変化で出す知らせを記録する。
 * 出すのは、高病原性の確定に変わった書き込みだけ（検査中、否定、すでに確定だった書き込みでは出さない）。
 * 今季の鳥だけを渡す（wildBirdsNotifiable はシーズンを見ない）。見つけた日が 14 日より前の鳥は出さない（初回の取り込みで過去の鳥を一斉に知らせない）。
 */
export async function handleWildBirdWrite(deps: NotifyDeps, before: WildBird | null, after: WildBird | null, geo: GeoStore): Promise<void> {
  if (after === null || after.test !== "hpai_confirmed" || before?.test === "hpai_confirmed") return;
  const now = deps.now();
  if (after.season !== currentSeason(now)) return;
  try {
    if (diffDays(jstDateOf(now), after.date) > MAX_EVENT_AGE_DAYS) return;
  } catch {
    return; // 日付が読めない鳥は知らせない
  }

  await geo.ensurePrefs(prefsToLoad([], [after]));
  const farms = (await deps.db.collection("farms").get()).docs.map((d) => ({ id: d.id, ...(d.data() as Farm) }));
  const notices = wildBirdNotices({ bird: after, farms, geo });
  if (notices.length > 0) await dispatchNotices(deps, notices);
}

/** wildBirds/{birdId} の作成、更新、削除。再試行しない（取りこぼしは作り直しの書き込みで拾う）。 */
export const onWildBirdWritten = onDocumentWritten(
  { document: "wildBirds/{birdId}", retry: false, timeoutSeconds: 120, memory: "512MiB" },
  async (event) => {
    const read = (snap: { exists: boolean; data(): unknown } | undefined): WildBird | null =>
      snap?.exists ? { ...(snap.data() as WildBird), id: event.params.birdId } : null;
    await handleWildBirdWrite(queueOnlyDeps(), read(event.data?.before), read(event.data?.after), await loadGeoStore());
  },
);
