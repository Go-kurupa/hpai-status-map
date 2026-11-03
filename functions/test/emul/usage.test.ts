import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { recordUsage } from "../../src/usage/record";
import { readRuntimeSettings, readUsageMonth } from "../../src/usage/settings";

const PROJECT = "demo-hpai";
const S = DEFAULT_RUNTIME_SETTINGS;

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

// 2026-11-30 23:30 UTC = 2026-12-01 08:30 JST。月の境は日本時間で見る。
const JST_DEC_1 = new Date("2026-11-30T23:30:00Z");
const NOV_15 = new Date("2026-11-15T03:00:00Z");

describe("readRuntimeSettings", () => {
  it("文書がなければ既定値", async () => {
    expect(await readRuntimeSettings()).toEqual(S);
  });

  it("文書があれば既定値に重ねる。型の違う値は既定値のまま", async () => {
    await db.doc("usage/settings").set({ softLimitJpy: 1500, autoPublishEnabled: true, primaryEffort: "high", hardLimitJpy: "高い", unknownKey: 1 });
    const s = await readRuntimeSettings();
    expect(s).toEqual({ ...S, softLimitJpy: 1500, autoPublishEnabled: true, primaryEffort: "high" });
  });

  it("effort が 5 値の外なら既定値", async () => {
    await db.doc("usage/settings").set({ primaryEffort: "ultra" });
    expect((await readRuntimeSettings()).primaryEffort).toBe(S.primaryEffort);
  });
});

describe("readRuntimeSettings の不正な値", () => {
  it("0 や負の上限、数でない上限は既定値のまま", async () => {
    for (const bad of [0, -100, Number.NaN, "2000"]) {
      await db.doc("usage/settings").set({ softLimitJpy: bad, hardLimitJpy: bad });
      const s = await readRuntimeSettings();
      expect(s.softLimitJpy).toBe(S.softLimitJpy);
      expect(s.hardLimitJpy).toBe(S.hardLimitJpy);
    }
  });

  it("soft が hard を超える組は両方とも既定値", async () => {
    await db.doc("usage/settings").set({ softLimitJpy: 3000, hardLimitJpy: 2800 });
    const s = await readRuntimeSettings();
    expect(s.softLimitJpy).toBe(S.softLimitJpy);
    expect(s.hardLimitJpy).toBe(S.hardLimitJpy);
  });

  it("片方だけ重ねても soft <= hard が崩れるなら既定値", async () => {
    await db.doc("usage/settings").set({ softLimitJpy: 12000 }); // 既定の hard 10000 を超える
    const s = await readRuntimeSettings();
    expect(s.softLimitJpy).toBe(S.softLimitJpy);
    expect(s.hardLimitJpy).toBe(S.hardLimitJpy);
  });

  it("soft == hard は受け入れる。為替が 0 や負なら既定値", async () => {
    await db.doc("usage/settings").set({ softLimitJpy: 1000, hardLimitJpy: 1000, jpyPerUsd: 0 });
    const s = await readRuntimeSettings();
    expect(s.softLimitJpy).toBe(1000);
    expect(s.hardLimitJpy).toBe(1000);
    expect(s.jpyPerUsd).toBe(S.jpyPerUsd);
  });
});

describe("readUsageMonth", () => {
  it("文書がなければ全部 0", async () => {
    expect(await readUsageMonth(NOV_15)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedJpy: 0 });
  });
});

describe("recordUsage", () => {
  it("費用を usage/{YYYY-MM} に積む", async () => {
    const u = { input_tokens: 5000, output_tokens: 1500, cache_read_input_tokens: 200, cache_creation_input_tokens: 300 };
    await recordUsage("claude-opus-5-5", u, NOV_15, S);
    const month = await readUsageMonth(NOV_15);
    expect(month.inputTokens).toBe(5000);
    expect(month.outputTokens).toBe(1500);
    expect(month.cacheReadTokens).toBe(200);
    expect(month.cacheWriteTokens).toBe(300);
    expect(month.estimatedJpy).toBeCloseTo(estimateUsd("claude-opus-5-5", u) * S.jpyPerUsd, 8);
  });

  it("同時に呼んでも失わず積む", async () => {
    const n = 25;
    await Promise.all(Array.from({ length: n }, () => recordUsage("claude-opus-5-5", { input_tokens: 1000, output_tokens: 100 }, NOV_15, S)));
    const month = await readUsageMonth(NOV_15);
    expect(month.inputTokens).toBe(1000 * n);
    expect(month.outputTokens).toBe(100 * n);
    expect(month.estimatedJpy).toBeCloseTo(n * estimateUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 100 }) * S.jpyPerUsd, 6);
  });

  it("月は日本時間で分ける", async () => {
    await recordUsage("claude-haiku-5-5", { input_tokens: 10, output_tokens: 10 }, JST_DEC_1, S);
    expect((await db.doc("usage/2026-12").get()).exists).toBe(true);
    expect((await db.doc("usage/2026-11").get()).exists).toBe(false);
  });

  it("キャッシュの項目が null でも積める。ほかの月に混ざらない", async () => {
    await recordUsage("claude-opus-5-5", { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null }, NOV_15, S);
    expect((await readUsageMonth(NOV_15)).cacheReadTokens).toBe(0);
    expect((await readUsageMonth(JST_DEC_1)).inputTokens).toBe(0);
  });

  it("settings の文書とは別の文書に書く", async () => {
    await recordUsage("claude-opus-5-5", { input_tokens: 10, output_tokens: 10 }, NOV_15, S);
    expect((await db.doc("usage/settings").get()).exists).toBe(false);
  });
});
