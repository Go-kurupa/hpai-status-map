import { describe, expect, it } from "vitest";
import { CONSULT_TOPICS } from "../src/consult/topics";
import { isOutOfScopeQuestion } from "../src/consult/scope";
import { findWordingViolations } from "../src/wording";

describe("相談の話題", () => {
  it("設計書 14 章の 7 つ。label はこの順", () => {
    expect(CONSULT_TOPICS.map((t) => t.label)).toEqual([
      "長靴・服",
      "防鳥ネット・鶏舎の破れ",
      "ネズミ・ネコ・ハエ",
      "水辺と野鳥",
      "人と車の出入り",
      "死んだ鶏・堆肥",
      "毎日の観察と家保",
    ]);
  });

  it("id は英小文字とハイフンで、重ならない", () => {
    for (const t of CONSULT_TOPICS) expect(t.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/u);
    expect(new Set(CONSULT_TOPICS.map((t) => t.id)).size).toBe(CONSULT_TOPICS.length);
  });

  it("長靴・服の question は決まった文", () => {
    expect(CONSULT_TOPICS.find((t) => t.label === "長靴・服")?.question).toBe("長靴と服の履き替え・消毒で、まず見直すとよいことは？");
  });

  it("question は「〜で、まず見直すとよいことは？」の形で、300 字以内。禁句と範囲外の語を含まない", () => {
    for (const t of CONSULT_TOPICS) {
      expect(t.question).toMatch(/で、まず見直すとよいことは？$/u);
      expect(Array.from(t.question).length).toBeLessThanOrEqual(300);
      expect(findWordingViolations(t.question)).toEqual([]);
      expect(isOutOfScopeQuestion(t.question)).toBe(false);
    }
  });
});
