// handleNeighborDraft の費用の積み方と予算の止め方を、模擬環境の Firestore で確かめる（M-19）。実際の Claude は呼ばない。
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import { neighborTemplate } from "@hpai/shared/drafts";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { DRAFT_MODEL } from "../../src/drafts/claude";
import { neighborCallPath, reserveNeighborCall } from "../../src/drafts/dailyLimit";
import { NEIGHBOR_DAILY_LIMIT, handleNeighborDraft, type NeighborDraftDeps } from "../../src/drafts/neighborDraft";
import { recordUsage } from "../../src/usage/record";
import { readRuntimeSettings, readUsageMonth } from "../../src/usage/settings";

const PROJECT = "demo-hpai";
const NOW = new Date("2026-11-07T03:00:00Z"); // 日本時間 11/7 12:00、使用量は usage/2026-11
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const MEASURES = "入口で長靴を履き替え、消毒しています。";
const GOOD = "鶏舎の入口で長靴を履き替え、消毒をしています。";
const MEMBER = { uid: "u1", member: true };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});
afterEach(() => vi.restoreAllMocks());

function deps(message: string, extra: Partial<Anthropic.Message> = {}) {
  const create = vi.fn(
    async () =>
      ({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: DRAFT_MODEL,
        stop_reason: "end_turn",
        stop_details: null,
        stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify({ message }), citations: null }],
        usage: USAGE,
        ...extra,
      }) as unknown as Anthropic.Message,
  );
  const d: NeighborDraftDeps = {
    client: () => ({ messages: { create } }) as unknown as Anthropic,
    now: () => NOW,
    settings: readRuntimeSettings,
    month: readUsageMonth,
    record: recordUsage,
    reserve: (uid, now) => reserveNeighborCall(uid, now, NEIGHBOR_DAILY_LIMIT),
  };
  return { d, create };
}

describe("費用と予算（Firestore）", () => {
  it("呼んだ費用が usage/{YYYY-MM} の estimatedJpy に積まれる（二度呼べば二度分）", async () => {
    const { d } = deps(GOOD);
    const r = await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    expect(r.source).toBe("claude");
    const one = estimateUsd(DRAFT_MODEL, USAGE) * DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
    const snap = await db.doc("usage/2026-11").get();
    expect(snap.get("estimatedJpy")).toBeCloseTo(one, 6);
    expect(snap.get("inputTokens")).toBe(1000);
    await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "circular" });
    expect((await db.doc("usage/2026-11").get()).get("estimatedJpy")).toBeCloseTo(one * 2, 6);
  });

  it("雛形に戻した呼び出しも積む（課金されているので）", async () => {
    const { d } = deps(`${GOOD}約 43 万羽です。`);
    const r = await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    expect(r.source).toBe("template");
    expect((await db.doc("usage/2026-11").get()).get("estimatedJpy")).toBeGreaterThan(0);
  });

  it("今月の費用が soft の上限以上なら Claude を呼ばず、雛形を返し、費用も回数も増えない", async () => {
    const hard = DEFAULT_RUNTIME_SETTINGS.softLimitJpy;
    await db.doc("usage/2026-11").set({ estimatedJpy: hard });
    const { d, create } = deps(GOOD);
    const r = await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    expect(r).toMatchObject({ source: "template", farmPart: neighborTemplate(MEASURES, "meeting"), failures: ["budget_stop"] });
    expect(create).not.toHaveBeenCalled();
    expect((await db.doc("usage/2026-11").get()).get("estimatedJpy")).toBe(hard);
    expect((await db.doc(neighborCallPath("u1", NOW)).get()).exists).toBe(false);
  });

  it("1 日 10 回を越えた 11 回目は Claude を呼ばず雛形（今日はこれ以上作れない）", async () => {
    const { d, create } = deps(GOOD);
    for (let i = 0; i < NEIGHBOR_DAILY_LIMIT; i++) {
      expect((await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" })).source).toBe("claude");
    }
    const r = await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    expect(r).toMatchObject({ source: "template", failures: ["daily_limit"] });
    expect(create).toHaveBeenCalledTimes(NEIGHBOR_DAILY_LIMIT);
    // 別の会員は別に数える
    expect((await handleNeighborDraft(d, { uid: "u2", member: true }, { measures: MEASURES, audience: "meeting" })).source).toBe("claude");
  });

  it("この下書きは、入力した文も農場も Firestore に書かない（usage 以外の文書が増えない）", async () => {
    const { d } = deps(GOOD);
    await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    const collections = (await db.listCollections()).map((c) => c.id);
    expect(collections).toEqual(["usage"]);
  });
});

describe("reserveNeighborCall（取引で数える）", () => {
  it("同時に 25 回確保しても、成功は上限の 10 回ちょうど", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveNeighborCall("u1", NOW, 10)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect((await db.doc(neighborCallPath("u1", NOW)).get()).get("count")).toBe(10);
  });
  it("日付は日本時間で変わる。翌日は 0 から数える", async () => {
    for (let i = 0; i < 10; i++) await reserveNeighborCall("u1", NOW, 10);
    expect(await reserveNeighborCall("u1", NOW, 10)).toBe(false);
    const sameJstDay = new Date("2026-11-07T14:59:00Z"); // 日本時間 11/7 23:59
    expect(await reserveNeighborCall("u1", sameJstDay, 10)).toBe(false);
    const nextJstDay = new Date("2026-11-07T15:00:00Z"); // 日本時間 11/8 0:00
    expect(await reserveNeighborCall("u1", nextJstDay, 10)).toBe(true);
  });
  it("uid と日付と回数だけを持つ", async () => {
    await reserveNeighborCall("u1", NOW, 10);
    expect((await db.doc(neighborCallPath("u1", NOW)).get()).data()).toEqual({ count: 1, date: "2026-11-07", uid: "u1" });
  });
  it("uid が空や / を含むときは投げる", async () => {
    await expect(reserveNeighborCall("", NOW, 10)).rejects.toThrow(RangeError);
    await expect(reserveNeighborCall("a/b", NOW, 10)).rejects.toThrow(RangeError);
  });
});
