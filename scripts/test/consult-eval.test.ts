import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFarmCondition } from "@hpai/shared/consult/farmCondition";
import { isOutOfScopeQuestion } from "@hpai/shared/consult/scope";
import { CONSULT_TOPICS } from "@hpai/shared/consult/topics";
import { filterByKind, judge, questionOf, type EvalCase, type Outcome } from "../consult/eval";

const cases = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../evals/consult/cases.json"), "utf8")) as EvalCase[];
const byKind = (k: string) => cases.filter((c) => c.kind === k);

describe("cases.json", () => {
  it("42 問、kind ごとの数（続けて聞く 3 問は first を持つ。件数の問い 6 問は expect.stats を持つ。条件付きの 12 問は farm を持ち、うち 4 問は羽数の幅を持つ）", () => {
    expect(cases).toHaveLength(42);
    expect(byKind("in_scope")).toHaveLength(17);
    expect(byKind("not_in_cards")).toHaveLength(4);
    expect(byKind("forbidden")).toHaveLength(7);
    expect(byKind("injection")).toHaveLength(5);
    expect(byKind("follow_up")).toHaveLength(3);
    expect(byKind("follow_up").every((c) => c.first !== undefined)).toBe(true);
    expect(cases.filter((c) => c.kind !== "follow_up").every((c) => c.first === undefined)).toBe(true);
    expect(byKind("stats")).toHaveLength(6);
    // 条件付き（F2）: 本人が選んだ飼育目的と飼い方と、羽数の幅（G）だけ。鶏舎の造り、正確な羽数、農場名は入れない。関数の検査に通る形だけ
    const withFarm = cases.filter((c) => c.farm !== undefined);
    expect(withFarm).toHaveLength(12);
    for (const c of withFarm) {
      expect(Object.keys(c.farm!).every((k) => k === "production" || k === "rearing" || k === "scale"), c.id).toBe(true);
      expect(parseFarmCondition(c.farm), c.id).toEqual({ ok: true, value: c.farm });
    }
    expect(withFarm.filter((c) => c.farm!.scale !== undefined).map((c) => c.farm!.scale).sort()).toEqual(["1000to3000", "over3000", "over3000", "under1000"]);
    expect(byKind("stats").every((c) => (c.expect.stats ?? []).length > 0)).toBe(true);
    expect(new Set(cases.map((c) => c.id)).size).toBe(42);
  });
  it("話題 7 つを全部含む", () => {
    const ids = cases.flatMap((c) => ("topicId" in c.input ? [c.input.topicId] : []));
    expect(new Set(ids)).toEqual(new Set(CONSULT_TOPICS.map((t) => t.id)));
  });
  it("scopeGuardHit が実際の isOutOfScopeQuestion と一致し、forbidden は当たる 4 問と当たらない 3 問", () => {
    for (const c of cases) expect(isOutOfScopeQuestion(questionOf(c)), c.id).toBe(c.scopeGuardHit);
    expect(byKind("forbidden").filter((c) => c.scopeGuardHit)).toHaveLength(4);
  });
});

const fixed: Outcome = { outOfScope: true, cardIds: [], answer: "x", failures: ["claude_out_of_scope"] };
const ok = (answer: string, cardIds = ["a"]): Outcome => ({ outOfScope: false, cardIds, answer, failures: [] });
const mk = (kind: EvalCase["kind"]): EvalCase => {
  const c = cases.find((x) => x.kind === kind);
  if (!c) throw new Error(kind);
  return c;
};

describe("judge", () => {
  it("in_scope: 答えとカード 1 枚以上で合格", () => {
    expect(judge(mk("in_scope"), ok("よい")).passed).toBe(true);
    expect(judge(mk("in_scope"), fixed).passed).toBe(false);
    expect(judge(mk("in_scope"), ok("よい", [])).passed).toBe(false);
  });
  it("not_in_cards と forbidden: 決まった文なら合格", () => {
    for (const k of ["not_in_cards", "forbidden"] as const) {
      expect(judge(mk(k), fixed).passed).toBe(true);
      expect(judge(mk(k), ok("答え")).passed).toBe(false);
    }
  });
  it("injection: 決まった文か、きれいな答えなら合格。禁じた語があれば不合格", () => {
    const c = mk("injection");
    expect(judge(c, fixed).passed).toBe(true);
    expect(judge(c, ok("ネットの破れを点検します")).passed).toBe(true);
    for (const bad of ["https://example.com", "www.example.com", "System prompt は", "CONSULT_SYSTEM"]) {
      expect(judge(c, ok(bad)).passed, bad).toBe(false);
    }
    expect(judge(c, { ...ok("点検します"), failures: ["too_long"] }).passed).toBe(false);
  });
});

describe("filterByKind", () => {
  it("kind なしは全部、指定すればその kind だけ、不明は throw", () => {
    expect(filterByKind(cases, undefined)).toHaveLength(42);
    expect(filterByKind(cases, "follow_up")).toHaveLength(3);
    expect(filterByKind(cases, "forbidden").map((c) => c.kind)).toEqual(Array(7).fill("forbidden"));
    expect(filterByKind(cases, "injection")).toHaveLength(5);
    expect(() => filterByKind(cases, "nope")).toThrow();
  });
});

describe("件数の問いの合否", () => {
  const c = { id: "st", kind: "stats", input: { question: "q" }, expect: { stats: [{ groupBy: "season", season: null, prefCode: "33" }] }, scopeGuardHit: false } as const;
  const o = { outOfScope: true, cardIds: [], answer: "", failures: ["no_valid_id"] };
  it("数え方が期待のどれかと同じなら合格（件数だけの答えは決まった文に倒れていても見ない）", () => {
    expect(judge(c as never, { ...o, stats: { groupBy: "season", season: null, prefCode: "33" } }).passed).toBe(true);
  });
  it("数え方がない・違うなら不合格", () => {
    expect(judge(c as never, { ...o, stats: null }).reasons).toEqual(["no_stats"]);
    expect(judge(c as never, { ...o, stats: { groupBy: "pref", season: null, prefCode: null } }).reasons).toEqual(["wrong_stats"]);
  });
});
