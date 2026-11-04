// 事例にすでにある段階の日付を、運営者が直す（Q-n、設計書 §10.2、§9.6）。「AI は下書き、人が確かめて確定する」の人の側。
// 読み手の経路は、食い違う日付を拒んで正しい日付を守る（打ち間違いを上書きしない）。その結果、誤った日付が載ったとき直す手段がなかった。
// ここは、画面の確認の段を経た運営者だけが、理由つきで直せるようにする。claim はここで確かめる（画面の表示だけで守らない）。
// 直すのは「すでにある段階の日付」だけ（段階を足したり消したりしない）。cases に書くのは upsertCaseIn だけ（契約 2.7）。
// 直した記録（元の値、新しい値、理由、運営者、時刻）は reviewQueue に解決済みの項目として残す（cases は誰でも読めるので載せない）。
// 声かけ文の下書き（caseDrafts）に古い日付が残らないよう、下書きの日付か段階が変わるときだけ同じトランザクションで消す。
// 段階の増減がないので、事例の出来事（diffCaseEvents）は出ず、会員へのメールは出ない。解除の見込みは段階から表示のたびに計算するので、自然に変わる。
import { randomBytes } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { jstDateOf, toJstIso } from "@hpai/shared/dates";
import { draftFactsOf } from "@hpai/shared/drafts";
import { checkStageDateFix } from "@hpai/shared/read/correctedCheck";
import { parseCorrectStageRequest, type CorrectStageResponse, type StageCorrectionRecord } from "@hpai/shared/read/review";
import type { Case } from "@hpai/shared/types";
import { upsertCaseIn } from "../read/upsert";
import { assertOperator, type Caller, type ResolveDeps } from "./resolve";

export async function handleCorrectCaseStage(deps: ResolveDeps, caller: Caller | null, data: unknown): Promise<CorrectStageResponse> {
  assertOperator(caller);
  const parsed = parseCorrectStageRequest(data);
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.message);
  const req = parsed.request;

  const now = deps.now();
  const nowJst = toJstIso(now);
  const today = jstDateOf(now);

  return deps.db.runTransaction(async (tx): Promise<CorrectStageResponse> => {
    // 読みを先に済ませる
    const snap = await tx.get(deps.db.doc(`cases/${req.caseId}`));
    if (!snap.exists) throw new HttpsError("not-found", "事例が見つかりません");
    const c: Case = { ...(snap.data() as Case), id: snap.id };
    if (c.confirmState === "reviewing" || c.confirmState === "replay") {
      throw new HttpsError("failed-precondition", "確認中の事例と再現の事例は、日付を直せません");
    }
    const stamp = c.stages[req.stage];
    if (stamp === undefined) throw new HttpsError("failed-precondition", "その段階は、この事例にありません。段階を足す操作ではありません");
    if (stamp.date !== req.expectedDate) {
      throw new HttpsError("failed-precondition", `事例の日付が変わっています（いまは ${stamp.date}）。開き直して、もう一度確かめてください`);
    }
    const checked = checkStageDateFix(req, { today, season: c.season, stages: c.stages });
    if (!checked.ok) throw new HttpsError(checked.code, checked.message);

    // 書き。日付だけ変える（時刻、ほかの段階、番号、id は変えない。id は知らせの記録や下書きの結びつきなので振り直さない）
    const next: Case = {
      ...c,
      stages: { ...c.stages, [req.stage]: { date: req.newDate, time: stamp.time } },
      confirmState: "operator", // 人が決めた印。のちの自動の読み取りで、この日付を黙って戻させない
      updatedAt: nowJst,
    };
    // 同じ事例を同じ瞬間に 2 度直しても、記録が衝突しない（2 度目は日付が変わっているので拒まれるが、id は別にしておく）
    const recordId = `corr-${c.id}-${now.getTime()}-${randomBytes(3).toString("hex")}`;
    const record: StageCorrectionRecord = {
      id: recordId,
      kind: "stage_correction",
      createdAt: nowJst,
      resolvedAt: nowJst,
      resolvedBy: caller.uid,
      resolvedAction: "correct_stage_date",
      caseId: c.id,
      stage: req.stage,
      reason: req.reason,
      resolution: {
        before: { date: stamp.date, time: stamp.time, confirmState: c.confirmState },
        after: { date: req.newDate, time: stamp.time, confirmState: "operator" },
      },
    };
    // 声かけ文の下書きは事例ごとに一度だけ作り、作り直さない。下書きの元になる日付か段階が変わるときだけ消す。
    // 消すと、この書き込みの後の draftOnCaseWritten が新しい日付で作り直す（費用の止め線の内側）。
    const factsBefore = draftFactsOf(c);
    const factsAfter = draftFactsOf(next);
    const draftChanged = factsBefore?.date !== factsAfter?.date || factsBefore?.stage !== factsAfter?.stage;
    upsertCaseIn(tx, next);
    if (draftChanged) tx.delete(deps.db.doc(`caseDrafts/${c.id}`));
    tx.create(deps.db.doc(`reviewQueue/${recordId}`), record);
    return { ok: true, caseId: c.id, recordId };
  });
}
