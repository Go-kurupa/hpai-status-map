import { describe, expect, it } from "vitest";
import { selectCandidates } from "../src/consult/select";
import type { ConsultCard, ConsultProfile, ConsultQuestion, Evidence } from "../src/consult/types";

function makeCard(over: Partial<ConsultCard> & { id: string }): ConsultCard {
  return {
    origin: `出どころ-${over.id}`,
    action: "対策",
    appliesTo: "条件",
    evidence: "recommendation",
    evidenceNote: "メモ",
    quote: "引用",
    sourceId: "src-1",
    locator: "第1章",
    caveats: [],
    conditionTags: [],
    approved: true,
    ...over,
  };
}

const questions: ConsultQuestion[] = [
  {
    id: "water",
    text: "水辺は近いですか",
    options: [
      { id: "near", label: "100m 以内", tags: ["water-near"] },
      { id: "far", label: "遠い", tags: ["water-far"] },
    ],
  },
  {
    id: "wild",
    text: "野生動物の跡は",
    options: [
      { id: "yes", label: "ある", tags: ["wild-seen", "wild-any"] },
      { id: "no", label: "ない", tags: [] },
    ],
  },
];

describe("selectCandidates", () => {
  it("水辺 100m 以内と答えると water-near のカードが上位に来る", () => {
    const cards = [
      makeCard({ id: "a-obligation", evidence: "obligation", conditionTags: ["wild-seen"] }),
      makeCard({ id: "b-water", evidence: "recommendation", conditionTags: ["water-near"] }),
      makeCard({ id: "c-far", evidence: "recommendation", conditionTags: ["water-far"] }),
    ];
    const out = selectCandidates(cards, questions, { water: "near" });
    expect(out[0]?.card.id).toBe("b-water");
    expect(out[0]?.score).toBe(12);
    expect(out[0]?.matchedTags).toEqual(["water-near"]);
    // 重ならない義務(6)は、重なる推奨(12)より下。
    expect(out.map((c) => c.card.id)).toEqual(["b-water", "a-obligation", "c-far"]);
  });

  it("重なる tag が複数あれば 1 つにつき 10 点で足す", () => {
    const cards = [
      makeCard({ id: "x", evidence: "expert-estimate", conditionTags: ["wild-seen", "wild-any", "other"] }),
    ];
    const out = selectCandidates(cards, questions, { wild: "yes" });
    expect(out[0]?.score).toBe(21);
    expect(out[0]?.matchedTags).toEqual(["wild-seen", "wild-any"]);
  });

  it("同じ tag が重複していても 1 回だけ数える", () => {
    const cards = [makeCard({ id: "x", evidence: "expert-estimate", conditionTags: ["water-near", "water-near"] })];
    const out = selectCandidates(cards, questions, { water: "near" });
    expect(out[0]?.score).toBe(11);
    expect(out[0]?.matchedTags).toEqual(["water-near"]);
  });

  it("何も重ならないときは根拠の重みの順になる", () => {
    const order: Evidence[] = [
      "expert-estimate",
      "recommendation",
      "study-association",
      "outbreak-finding",
      "obligation",
    ];
    const cards = order.map((evidence, i) => makeCard({ id: `c${i}`, evidence }));
    const out = selectCandidates(cards, questions, {});
    expect(out.map((c) => c.card.evidence)).toEqual([...order].reverse());
    expect(out.map((c) => c.score)).toEqual([6, 5, 4, 2, 1]);
    expect(out.every((c) => c.matchedTags.length === 0)).toBe(true);
  });

  it("未確認（approved: false）のカードは出ない", () => {
    const cards = [
      makeCard({ id: "ok", evidence: "obligation" }),
      makeCard({ id: "ng", evidence: "obligation", approved: false, conditionTags: ["water-near"] }),
    ];
    const out = selectCandidates(cards, questions, { water: "near" });
    expect(out.map((c) => c.card.id)).toEqual(["ok"]);
  });

  it("study-no-difference は単独の行にならない", () => {
    const cards = [
      makeCard({ id: "no-diff", evidence: "study-no-difference", conditionTags: ["water-near"] }),
      makeCard({ id: "rec", evidence: "recommendation" }),
    ];
    const out = selectCandidates(cards, questions, { water: "near" });
    expect(out.map((c) => c.card.id)).toEqual(["rec"]);
  });

  it("max を守る（既定は 12）", () => {
    const cards = Array.from({ length: 20 }, (_, i) =>
      makeCard({ id: `c${String(i).padStart(2, "0")}`, evidence: "recommendation" }),
    );
    expect(selectCandidates(cards, questions, {})).toHaveLength(12);
    expect(selectCandidates(cards, questions, {}, 3).map((c) => c.card.id)).toEqual(["c00", "c01", "c02"]);
    expect(selectCandidates(cards, questions, {}, 0)).toEqual([]);
  });

  it("同点は id の順になる", () => {
    const cards = [
      makeCard({ id: "b", evidence: "recommendation" }),
      makeCard({ id: "a", evidence: "recommendation" }),
      makeCard({ id: "C", evidence: "recommendation" }),
    ];
    // 文字コードの順（大文字が先）。ロケールで揺れない。
    expect(selectCandidates(cards, questions, {}).map((c) => c.card.id)).toEqual(["C", "a", "b"]);
  });

  it("同じ origin は先頭の 1 枚だけにする", () => {
    const cards = [
      makeCard({ id: "part-1", origin: "同じ資料", evidence: "recommendation" }),
      makeCard({ id: "part-2", origin: "同じ資料", evidence: "recommendation", conditionTags: ["water-near"] }),
      makeCard({ id: "other", origin: "別の資料", evidence: "expert-estimate" }),
    ];
    const out = selectCandidates(cards, questions, { water: "near" });
    // 点が高い part-2 が残り、part-1 は落ちる。
    expect(out.map((c) => c.card.id)).toEqual(["part-2", "other"]);
  });

  it("同じ入力なら、入力の並びを変えても同じ順になる", () => {
    const cards = [
      makeCard({ id: "a", evidence: "obligation", conditionTags: ["water-near"] }),
      makeCard({ id: "b", evidence: "outbreak-finding" }),
      makeCard({ id: "c", evidence: "recommendation", conditionTags: ["wild-seen"] }),
      makeCard({ id: "d", evidence: "recommendation" }),
    ];
    const profile: ConsultProfile = { water: "near", wild: "yes" };
    const first = selectCandidates(cards, questions, profile);
    const again = selectCandidates(cards, questions, profile);
    const reversed = selectCandidates([...cards].reverse(), questions, profile);
    expect(again).toEqual(first);
    expect(reversed).toEqual(first);
  });

  it("入力の配列を書き換えない", () => {
    const cards = [makeCard({ id: "b" }), makeCard({ id: "a" })];
    const copy = structuredClone(cards);
    selectCandidates(cards, questions, {});
    expect(cards).toEqual(copy);
  });

  it("答えにない問い、存在しない問いや選択肢の id は無視する（throw しない）", () => {
    const cards = [makeCard({ id: "x", evidence: "recommendation", conditionTags: ["water-near"] })];
    const profile: ConsultProfile = { nothing: "x", water: "no-such-option" };
    const out = selectCandidates(cards, questions, profile);
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(2);
    expect(out[0]?.matchedTags).toEqual([]);
  });
});
