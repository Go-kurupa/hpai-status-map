// handleNeighborDraft の費用の積み方と予算の止め方を、模擬環境の Firestore で確かめる（M-19）。実際の Claude は呼ばない。
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import { neighborTemplate } from "@hpai/shared/drafts";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { DRAFT_MODEL } from "../../src/drafts/claude";
import { handleNeighborDraft, type NeighborDraftDeps } from "../../src/drafts/neighborDraft";
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

  it("今月の費用が上限（hard）以上なら Claude を呼ばず、雛形を返し、費用は増えない", async () => {
    const hard = DEFAULT_RUNTIME_SETTINGS.hardLimitJpy;
    await db.doc("usage/2026-11").set({ estimatedJpy: hard });
    const { d, create } = deps(GOOD);
    const r = await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    expect(r).toMatchObject({ source: "template", farmPart: neighborTemplate(MEASURES, "meeting"), failures: ["budget_stop"] });
    expect(create).not.toHaveBeenCalled();
    expect((await db.doc("usage/2026-11").get()).get("estimatedJpy")).toBe(hard);
  });

  it("この下書きは、入力した文も農場も Firestore に書かない（usage 以外の文書が増えない）", async () => {
    const { d } = deps(GOOD);
    await handleNeighborDraft(d, MEMBER, { measures: MEASURES, audience: "meeting" });
    const collections = (await db.listCollections()).map((c) => c.id);
    expect(collections).toEqual(["usage"]);
  });
});
