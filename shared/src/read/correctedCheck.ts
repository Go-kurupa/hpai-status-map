// 運営者が直した段階と日付の検査（I-07 の修正）。読み手の経路（verify.ts）と同じ決まりを、運営者の経路にも当てる。
// 未来の日付、シーズン外（年の打ち間違い）、既にある段階の日付との食い違い・順序の逆転を拒む。
// 既にある段階の日付と違うものは上書きせず、運営者に確かめさせる。純粋関数（today は引数）。
import { seasonOf } from "../season";
import type { CaseStage, IsoDate, Season, StageDates } from "../types";
import { stagesConflict } from "./verify";

export type CorrectedCheck = { ok: true } | { ok: false; code: "invalid-argument" | "failed-precondition"; message: string };

export function checkCorrectedStage(
  v: { stage: CaseStage; date: IsoDate },
  ctx: { today: IsoDate; season: Season; previousStages: StageDates | null },
): CorrectedCheck {
  if (v.date > ctx.today) return { ok: false, code: "invalid-argument", message: `${v.date} は未来の日付です。日付を確かめてください` };
  if (seasonOf(v.date) !== ctx.season) {
    return { ok: false, code: "invalid-argument", message: `${v.date} は、この文書のシーズン（${ctx.season} 年 6 月〜翌年 5 月）の外です。年を確かめてください` };
  }
  for (const [stage, stamp] of Object.entries(ctx.previousStages ?? {}) as Array<[CaseStage, { date: IsoDate }]>) {
    if (stagesConflict({ stage: v.stage, date: v.date }, { stage, date: stamp.date })) {
      return {
        ok: false,
        code: "failed-precondition",
        message: `事例にすでにある段階の日付（${stamp.date}）と合いません（食い違い、または順序の逆転）。正しい日付を確かめてから入れ直してください`,
      };
    }
  }
  return { ok: true };
}
