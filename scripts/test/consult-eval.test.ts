import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isOutOfScopeQuestion } from "@hpai/shared/consult/scope";
import { CONSULT_TOPICS } from "@hpai/shared/consult/topics";
import { filterByKind, judge, questionOf, type EvalCase, type Outcome } from "../consult/eval";

const cases = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../evals/consult/cases.json"), "utf8")) as EvalCase[];
const byKind = (k: string) => cases.filter((c) => c.kind === k);

describe("cases.json", () => {
  it("22 問、kind ごとの数", () => {
    expect(cases).toHaveLength(22);
    expect(byKind("in_scope")).toHaveLength(8);
    expect(byKind("not_in_cards")).toHaveLength(4);
    expect(byKind("forbidden")).toHaveLength(6);
    expect(byKind("injection")).toHaveLength(4);
    expect(new Set(cases.map((c) => c.id)).size).toBe(22);
  });
  it("話題 7 つを全部含む", () => {
    const ids = cases.flatMap((c) => ("topicId" in c.input ? [c.input.topicId] : []));
    expect(new Set(ids)).toEqual(new Set(CONSULT_TOPICS.map((t) => t.id)));
  });
  it("scopeGuardHit が実際の isOutOfScopeQuestion と一致し、forbidden は当たる 3 問と当たらない 3 問", () => {
    for (const c of cases) expect(isOutOfScopeQuestion(questionOf(c)), c.id).toBe(c.scopeGuardHit);
    expect(byKind("forbidden").filter((c) => c.scopeGuardHit)).toHaveLength(3);
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
    expect(filterByKind(cases, undefined)).toHaveLength(22);
    expect(filterByKind(cases, "forbidden").map((c) => c.kind)).toEqual(Array(6).fill("forbidden"));
    expect(filterByKind(cases, "injection")).toHaveLength(4);
    expect(() => filterByKind(cases, "nope")).toThrow();
  });
});
