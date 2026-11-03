// 町の過去の発生を 1 文にする（契約 2.1 の「related:true を見るのは describePast だけ」、設計書 §15）。
// 過去の記録は事実の報告で、これからを予測しない。関連農場は件数に入れず、ここで「関連農場」と明示する。
// 関連農場の日付は、本体の日付を借りている行がある（F-08）。日付は表に出さない（出すときは本体の日付として出す）。
import type { GeoStore } from "./geo";
import { seasonAgoLabel } from "./season";
import type { HistoryCase, IsoDate, MuniCode, Season } from "./types";

export interface PastHit extends HistoryCase {
  /** 昨季 / 2 年前 … */
  ago: string;
  relation: "same" | "adjacent";
  /**
   * 関連農場（related:true）のとき、本体（同じ season と no の related:false）の発生日。本体が history にないと null。
   * 関連農場の行は、原本に個別の発生日がなく本体の日付を借りたものがある（F-08）。画面は h.date ではなくこちらを
   * 「本体の日付」として出す。related:false のときは null。
   */
  parentDate: IsoDate | null;
}

export interface PastSummary {
  sentence: string;
  /** sentence の元になった記録。本体があれば本体のうち最も新しいもの。なければ関連農場。何もなければ null */
  latest: PastHit | null;
  /** 新しい順。同じ日はこの町、次に本体を先にする */
  hits: PastHit[];
}

export const PAST_NONE = "過去の記録に、この町と隣町の発生はありません（記録）";

function order(a: PastHit, b: PastHit): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.relation !== b.relation) return a.relation === "same" ? -1 : 1;
  if (a.related !== b.related) return a.related ? 1 : -1;
  return b.no - a.no;
}

/**
 * この町と隣町の過去の発生。今季とそれより先のシーズンは数えない（再現の今季が 2025 なら 2025 も数えない）。
 * 知らない市町村コードは隣がない扱い。入力は並べ替えない。
 */
export function describePast(
  muniCode: MuniCode,
  history: readonly HistoryCase[],
  geo: Pick<GeoStore, "adjacency">,
  current: Season,
): PastSummary {
  const neighbors = new Set(geo.adjacency[muniCode] ?? []);
  // 本体は町が離れていて hits に入らないことがあるので、history 全体から探す
  const parentOf = new Map<string, IsoDate>();
  for (const h of history) if (!h.related) parentOf.set(`${h.season}-${h.no}`, h.date);
  const hits: PastHit[] = [];
  for (const h of history) {
    if (h.season >= current) continue; // seasonAgoLabel が先のシーズンで投げるのも、ここで避ける
    const relation = h.muniCode === muniCode ? "same" : neighbors.has(h.muniCode) ? "adjacent" : null;
    if (relation === null) continue;
    const parentDate = h.related ? (parentOf.get(`${h.season}-${h.no}`) ?? null) : null;
    hits.push({ ...h, ago: seasonAgoLabel(h.season, current), relation, parentDate });
  }
  hits.sort(order);

  const latest = hits.find((h) => !h.related) ?? hits[0] ?? null;
  if (latest === null) return { sentence: PAST_NONE, latest: null, hits };
  const where = latest.relation === "same" ? "この町" : "隣町";
  const what = latest.related ? "関連農場がありました" : "発生しました";
  return { sentence: `${latest.ago}に${where}で${what}（記録）`, latest, hits };
}
