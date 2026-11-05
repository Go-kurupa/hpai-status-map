// やること画面の計算。距離の前に必ず ensurePrefs を待つ（契約 3.2）。
// 県の形の読み込みに失敗したときは投げる（呼び出し側が「読めませんでした」を出す。④にしない）。
import { draftFactsOf, type DraftFacts } from "@hpai/shared/drafts";
import type { GeoStore } from "@hpai/shared/geo";
import { computeLevelWithoutBand, prefsToLoad } from "@hpai/shared/level";
import { computeLiftEstimate, type LiftEstimate } from "@hpai/shared/lift";
import type { Case, FarmPoint, LevelResult, Season } from "@hpai/shared/types";

export interface CaseLift {
  caseId: string;
  muniName: string;
  estimate: LiftEstimate;
}

export interface TodoResult {
  level: LevelResult;
  /** 段階①の事例ごとの解除の見込み（それ以外の段階では空） */
  lifts: CaseLift[];
  /** 声かけ文の元になる事例（近くの発生のうち、段階が高く下書きを作れる最初の事例）。近くの発生がなければ null */
  workerCase: { caseId: string; facts: DraftFacts } | null;
}

export async function resolveTodo(i: { spot: FarmPoint; cases: readonly Case[]; season: Season; geo: GeoStore }): Promise<TodoResult> {
  const cases = i.cases.filter((c) => c.season === i.season);
  await i.geo.ensurePrefs(prefsToLoad(cases));
  // 距離の帯は確認リストと声かけを増やさない（帯だけの農場は今までの④と同じ）
  const level = computeLevelWithoutBand(i.spot, cases, i.season, i.geo);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const lifts: CaseLift[] = [];
  for (const r of level.reasons) {
    if (r.level !== 1) continue;
    const c = byId.get(r.caseId);
    if (c) lifts.push({ caseId: c.id, muniName: c.muniName ?? "", estimate: computeLiftEstimate(c, cases, i.geo) });
  }
  let workerCase: TodoResult["workerCase"] = null;
  for (const r of level.reasons) {
    const c = byId.get(r.caseId);
    const facts = c ? draftFactsOf(c) : null;
    if (c && facts) {
      workerCase = { caseId: c.id, facts };
      break;
    }
  }
  return { level, lifts, workerCase };
}
