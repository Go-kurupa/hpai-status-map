// 対策の見直し相談: 候補の選び方。プログラムの順で決め、Claude には選ばせない。
import type { ConsultCard, ConsultProfile, ConsultQuestion, Evidence } from "./types";

export interface Candidate {
  card: ConsultCard;
  score: number;
  // 答えた選択肢の tags のうち、カードの conditionTags と重なったもの。
  matchedTags: string[];
}

// 条件が 1 つ重なるごとの点。
const TAG_POINT = 10;

// 根拠の重み。
const EVIDENCE_WEIGHT: Record<Evidence, number> = {
  obligation: 6,
  "outbreak-finding": 5,
  "study-association": 4,
  recommendation: 2,
  "expert-estimate": 1,
  "study-no-difference": 0,
};

// 答えた選択肢の tags を集める。答えのない問い、存在しない選択肢の id は無視する。
function answeredTags(questions: ConsultQuestion[], profile: ConsultProfile): Set<string> {
  const tags = new Set<string>();
  for (const q of questions) {
    if (!Object.prototype.hasOwnProperty.call(profile, q.id)) continue;
    const option = q.options.find((o) => o.id === profile[q.id]);
    if (!option) continue;
    for (const t of option.tags) tags.add(t);
  }
  return tags;
}

// 文字コードの順。ロケールで揺れないようにする。
function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function selectCandidates(
  cards: ConsultCard[],
  questions: ConsultQuestion[],
  profile: ConsultProfile,
  max = 12,
): Candidate[] {
  if (!(max > 0)) return [];
  const answered = answeredTags(questions, profile);

  const scored: Candidate[] = [];
  for (const card of cards) {
    // 確認済みだけ。「効果が測られていない」は単独の行にせず、注意として別に付ける。
    if (!card.approved || card.evidence === "study-no-difference") continue;
    const matchedTags = [...new Set(card.conditionTags.filter((t) => answered.has(t)))];
    scored.push({
      card,
      score: matchedTags.length * TAG_POINT + EVIDENCE_WEIGHT[card.evidence],
      matchedTags,
    });
  }

  scored.sort((a, b) => b.score - a.score || compareId(a.card.id, b.card.id));

  // 同じ origin は先頭の 1 枚だけ（分割したカードの重複を避ける）。
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of scored) {
    if (seen.has(c.card.origin)) continue;
    seen.add(c.card.origin);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
