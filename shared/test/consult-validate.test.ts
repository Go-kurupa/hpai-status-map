import { describe, expect, it } from "vitest";
import { OUT_OF_SCOPE_TEXT } from "../src/consult/scope";
import { validateFollowup } from "../src/consult/validate";
import type { ConsultCard } from "../src/consult/types";

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

const a = makeCard({ id: "a", quote: "網目は 2 cm 以下", appliesTo: "100 羽以上の鶏舎", action: "防鳥ネットを張る", conditionTags: ["water-near"] });
const b = makeCard({ id: "b", conditionTags: ["wild-seen"] });

describe("validateFollowup", () => {
  const cards = [a, b];
  const ok = { answer: "網目は 2 cm 以下とされています。", cardIds: ["a"], outOfScope: false };

  it("検査を通った答えはそのまま返す", () => {
    expect(validateFollowup(ok, ["a", "b"], cards)).toEqual({ answer: ok.answer, cardIds: ["a"], outOfScope: false });
  });

  it("outOfScope: true のとき、決まった文を返す", () => {
    const r = validateFollowup({ answer: "何か", cardIds: ["a"], outOfScope: true }, ["a"], cards);
    expect(r).toEqual({ answer: OUT_OF_SCOPE_TEXT, cardIds: [], outOfScope: true });
  });

  it("形が違う、cardIds が空、許された id がないときは、決まった文を返す", () => {
    for (const raw of [null, "x", {}, { answer: 1, cardIds: ["a"] }, { answer: "答え", cardIds: [] }, { answer: "答え", cardIds: ["zzz"] }, { answer: "答え", cardIds: "a" }]) {
      expect(validateFollowup(raw, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    }
  });

  it("cardIds は許された id だけに絞る", () => {
    const r = validateFollowup({ answer: "答え", cardIds: ["zzz", "b", "b"] }, ["a", "b"], cards);
    expect(r.cardIds).toEqual(["b"]);
    expect(r.outOfScope).toBe(false);
  });

  it("400 字を超える答え、URL を含む答えは、決まった文を返す", () => {
    expect(validateFollowup({ answer: "あ".repeat(401), cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    expect(validateFollowup({ answer: "あ".repeat(400), cardIds: ["a"] }, ["a"], cards).answer).toBe("あ".repeat(400));
    expect(validateFollowup({ answer: "https://evil.example を見て", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
  });

  it("引いたカードにない数字を含む答えは、決まった文を返す", () => {
    expect(validateFollowup({ answer: "3 倍になります", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    // 引いていない別のカードの数字も不可
    expect(validateFollowup({ answer: "網目は 2 cm 以下", cardIds: ["b"] }, ["a", "b"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
  });

  it("カードにない三倍を含む答えは落ち、十分には落ちない", () => {
    expect(validateFollowup({ answer: "被害は三倍になります", cardIds: ["a"] }, ["a"], cards).answer).toBe(OUT_OF_SCOPE_TEXT);
    expect(validateFollowup({ answer: "十分に離してください", cardIds: ["a"] }, ["a"], cards).answer).toBe("十分に離してください");
  });

  it("カードの一覧を渡さないときは、数字を確かめられないので数字を含む答えを通さない", () => {
    expect(validateFollowup(ok, ["a"]).answer).toBe(OUT_OF_SCOPE_TEXT);
    expect(validateFollowup({ answer: "網目は細かいほどよい", cardIds: ["a"] }, ["a"]).answer).toBe("網目は細かいほどよい");
  });

  it("maxCards を渡すと、絞った後の先頭の maxCards 枚だけを使う（同じ id と許されない id は数えない）", () => {
    const many = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) => makeCard({ id }));
    const ids = many.map((c) => c.id);
    const r = validateFollowup({ answer: "答え", cardIds: ["zzz", "c1", "c1", "c2", "c3", "c4", "c5", "c6", "c7"] }, ids, many, 5);
    expect(r.cardIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(r.outOfScope).toBe(false);
    // 渡さないときは絞らない
    expect(validateFollowup({ answer: "答え", cardIds: ids }, ids, many).cardIds).toEqual(ids);
  });

  it("数字の検査は、使う maxCards 枚のカードだけで行う（外れた 6 枚目の数字は通らない）", () => {
    const six = [1, 2, 3, 4, 5].map((n) => makeCard({ id: `c${n}` }));
    const sixth = makeCard({ id: "c6", action: "7 日ごとに見直す" });
    const all = [...six, sixth];
    const ids = all.map((c) => c.id);
    expect(validateFollowup({ answer: "7 日ごとに見直します", cardIds: ids }, ids, all, 5).answer).toBe(OUT_OF_SCOPE_TEXT);
  });
});
