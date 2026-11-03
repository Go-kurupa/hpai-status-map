// draftForCase（声かけ文の下書き）を、模擬環境の Firestore と偽の client で確かめる（M-18）。実際の Claude は呼ばない。
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import { workerMessageTemplate } from "@hpai/shared/drafts";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import type { Case } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { DRAFT_MODEL } from "../../src/drafts/claude";
import { draftForCase } from "../../src/drafts/workerDraft";

const PROJECT = "demo-hpai";
const NOW = new Date("2025-12-22T03:30:00Z"); // 日本時間 12/22 12:30、使用量は usage/2025-12
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});
afterEach(() => vi.restoreAllMocks());

const GOOD_CONFIRMED = "12月19日、津山市で鳥インフルエンザの発生が確認されました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";
const GOOD_SUSPECT = "12月18日、津山市で鳥インフルエンザの疑いが出ました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";

function msg(message: string, o: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DRAFT_MODEL,
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify({ message }), citations: null }],
    usage: USAGE,
    ...o,
  } as unknown as Anthropic.Message;
}

type Reply = Anthropic.Message | Error | ((p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> | Anthropic.Message);
function fakeClient(reply: Reply) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(p);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(p) : reply;
  };
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}

function mkCase(o: Partial<Case> = {}): Case {
  return {
    id: "33203-2025-12-19-1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 12345,
    stages: { confirmed: { date: "2025-12-19", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.test/a"],
    updatedAt: "2025-12-19T12:00:00+09:00",
    ...o,
  };
}
const suspected = (): Case => mkCase({ stages: { suspected: { date: "2025-12-18", time: null } } });

const ID = "33203-2025-12-19-1";
const run = (client: Anthropic, c: Case | null | undefined, id = ID) => draftForCase(id, c, { client, now: () => NOW });
const draftOf = async (id = ID) => (await db.doc(`caseDrafts/${id}`).get()).data();
const monthOf = async () => (await db.doc("usage/2025-12").get()).data();

describe("作るとき", () => {
  it("確定から始まる事例も一度作る。2 度目は作らず、Claude も呼ばない", async () => {
    const f = fakeClient(msg(GOOD_CONFIRMED));
    expect(await run(f.client, mkCase())).toBe("created");
    expect(await draftOf()).toEqual({ caseId: ID, workerMessage: GOOD_CONFIRMED, source: "claude", createdAt: "2025-12-22T12:30:00+09:00" });
    expect(await run(f.client, mkCase())).toBe("skipped");
    expect(f.calls).toHaveLength(1);
  });

  it("疑いで一度だけ作り、確定になっても作り直さない", async () => {
    const f = fakeClient(msg(GOOD_SUSPECT));
    expect(await run(f.client, suspected())).toBe("created");
    expect((await draftOf())?.workerMessage).toBe(GOOD_SUSPECT);
    expect(await run(f.client, mkCase({ stages: { suspected: { date: "2025-12-18", time: null }, confirmed: { date: "2025-12-19", time: null } } }))).toBe("skipped");
    expect(f.calls).toHaveLength(1);
    expect((await draftOf())?.workerMessage).toBe(GOOD_SUSPECT);
  });

  it("Claude に渡すのは県、市町村、日付、段階だけ。農場を読まず、農場の名前も位置も渡さない", async () => {
    await db.doc("farms/f1").set({ name: "ひみつ養鶏場", meshCode: "51334567", muniCode: "33203", kahoContact: "00-0000-0000", memberUids: ["u1"] });
    await db.doc("farms/f1/deaths/2025-12-19_h1").set({ date: "2025-12-19", houseId: "h1", deaths: 77 });
    const paths: string[] = [];
    const doc = db.doc.bind(db);
    vi.spyOn(db, "doc").mockImplementation(((p: string) => (paths.push(p), doc(p))) as typeof db.doc);
    const collection = db.collection.bind(db);
    vi.spyOn(db, "collection").mockImplementation(((p: string) => (paths.push(p), collection(p))) as typeof db.collection);

    const f = fakeClient(msg(GOOD_CONFIRMED));
    await run(f.client, mkCase());
    expect(f.calls).toHaveLength(1);
    const p = f.calls[0]!;
    expect(JSON.parse(p.messages[0]!.content as string)).toEqual({ prefecture: "岡山県", municipality: "津山市", date: "2025-12-19", stage: "confirmed" });
    const wire = JSON.stringify(p);
    for (const secret of ["ひみつ養鶏場", "51334567", "00-0000-0000", "12345", "77"]) expect(wire).not.toContain(secret);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((x) => x.startsWith("farms"))).toEqual([]);
    expect([...new Set(paths.map((x) => x.split("/")[0]))].sort()).toEqual(["caseDrafts", "usage"]);
  });
});

describe("作らないとき", () => {
  const cases: Array<[string, Case | null | undefined]> = [
    ["削除（after がない）", null],
    ["after が undefined", undefined],
    ["確認中", mkCase({ confirmState: "reviewing" })],
    ["再現", mkCase({ confirmState: "replay" })],
    ["否定", mkCase({ negation: "negated" })],
    ["市町村なし", mkCase({ muniCode: null })],
    ["疑いも確定もない", mkCase({ stages: { culling_done: { date: "2025-12-20", time: null } } })],
  ];
  for (const [name, c] of cases) {
    it(`${name}: 作らず、Claude も呼ばず、費用も積まない`, async () => {
      const f = fakeClient(msg(GOOD_CONFIRMED));
      expect(await run(f.client, c)).toBe("skipped");
      expect(f.calls).toHaveLength(0);
      expect(await draftOf()).toBeUndefined();
      expect(await monthOf()).toBeUndefined();
    });
  }

  it("既にある下書きは上書きせず、Claude も呼ばない", async () => {
    await db.doc(`caseDrafts/${ID}`).set({ caseId: ID, workerMessage: "直した文", source: "template", createdAt: "2025-12-19T10:00:00+09:00" });
    const f = fakeClient(msg(GOOD_CONFIRMED));
    expect(await run(f.client, mkCase())).toBe("skipped");
    expect(f.calls).toHaveLength(0);
    expect((await draftOf())?.workerMessage).toBe("直した文");
  });

  it("同時に 2 回動いても、下書きは 1 つで、後の方は捨てる（費用は両方積む）", async () => {
    const f = fakeClient(msg(GOOD_CONFIRMED));
    const out = await Promise.all([run(f.client, mkCase()), run(f.client, mkCase())]);
    expect(out.filter((x) => x === "created")).toHaveLength(1);
    expect(await draftOf()).toMatchObject({ source: "claude", workerMessage: GOOD_CONFIRMED });
    const m = await monthOf();
    expect(m?.estimatedJpy).toBeCloseTo(estimateUsd(DRAFT_MODEL, USAGE) * DEFAULT_RUNTIME_SETTINGS.jpyPerUsd * f.calls.length, 10);
  });

  it("呼んでいる間に別の起動が先に作ったら、作らずに捨てる。費用は積む", async () => {
    const f = fakeClient(async () => {
      await db.doc(`caseDrafts/${ID}`).set({ caseId: ID, workerMessage: "先に作られた文", source: "claude", createdAt: "2025-12-22T12:29:00+09:00" });
      return msg(GOOD_CONFIRMED);
    });
    expect(await run(f.client, mkCase())).toBe("exists");
    expect((await draftOf())?.workerMessage).toBe("先に作られた文");
    expect((await monthOf())?.estimatedJpy).toBeGreaterThan(0);
  });
});

describe("雛形で残る", () => {
  const TEMPLATE = workerMessageTemplate({ muniName: "津山市", date: "2025-12-19", stage: "confirmed" });

  it("Claude が使えない（通信の失敗）: 雛形で残る", async () => {
    const f = fakeClient(Object.assign(new Error("down"), { status: 529 }));
    expect(await run(f.client, mkCase())).toBe("created");
    expect(await draftOf()).toMatchObject({ source: "template", workerMessage: TEMPLATE });
    expect(await monthOf()).toBeUndefined(); // 使用量がないので積まない
  });

  it("拒否: 雛形。拒否の費用は積む", async () => {
    const f = fakeClient(msg("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }));
    await run(f.client, mkCase());
    expect(await draftOf()).toMatchObject({ source: "template", workerMessage: TEMPLATE });
    expect((await monthOf())?.estimatedJpy).toBeGreaterThan(0);
  });

  it("途中で切れた／形が違う: 雛形", async () => {
    for (const reply of [msg("", { stop_reason: "max_tokens" }), { ...msg(""), content: [{ type: "text", text: "JSON ではない", citations: null }] }] as Anthropic.Message[]) {
      await db.doc(`caseDrafts/${ID}`).delete();
      await run(fakeClient(reply).client, mkCase());
      expect(await draftOf()).toMatchObject({ source: "template", workerMessage: TEMPLATE });
    }
  });

  it("検査に落ちる（煽る語、足した数字、核が無い）: 雛形", async () => {
    for (const bad of [`${GOOD_CONFIRMED}大変危険です。`, `${GOOD_CONFIRMED}約43万羽です。`, "津山市で12月19日に発生しました。気をつけてください。"]) {
      await db.doc(`caseDrafts/${ID}`).delete();
      await run(fakeClient(msg(bad)).client, mkCase());
      expect(await draftOf()).toMatchObject({ source: "template", workerMessage: TEMPLATE });
    }
  });

  it("疑いの段階なのに「疑い」がない: 雛形", async () => {
    const noSuspect = "12月18日、津山市で鳥インフルエンザの発表がありました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";
    await run(fakeClient(msg(noSuspect)).client, suspected());
    expect(await draftOf()).toMatchObject({ source: "template", workerMessage: workerMessageTemplate({ muniName: "津山市", date: "2025-12-18", stage: "suspected" }) });
  });

  it("予算の上限（stop）: Claude を呼ばず雛形", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: DEFAULT_RUNTIME_SETTINGS.hardLimitJpy });
    const f = fakeClient(msg(GOOD_CONFIRMED));
    expect(await run(f.client, mkCase())).toBe("created");
    expect(f.calls).toHaveLength(0);
    expect(await draftOf()).toMatchObject({ source: "template", workerMessage: TEMPLATE });
    expect((await monthOf())?.estimatedJpy).toBe(DEFAULT_RUNTIME_SETTINGS.hardLimitJpy);
  });

  it("設定で上限を下げていれば、その上限で止まる（usage/settings を読む）", async () => {
    await db.doc("usage/settings").set({ softLimitJpy: 50, hardLimitJpy: 100 });
    await db.doc("usage/2025-12").set({ estimatedJpy: 100 });
    const f = fakeClient(msg(GOOD_CONFIRMED));
    await run(f.client, mkCase());
    expect(f.calls).toHaveLength(0);
  });

  it("ソフトリミットを超えただけでは止めない（進捗報の見分けは使わない）", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: DEFAULT_RUNTIME_SETTINGS.softLimitJpy + 1 });
    const f = fakeClient(msg(GOOD_CONFIRMED));
    await run(f.client, mkCase());
    expect(f.calls).toHaveLength(1);
    expect(await draftOf()).toMatchObject({ source: "claude" });
  });
});

describe("費用", () => {
  it("下書きの費用が usage/{YYYY-MM} の estimatedJpy に積まれる（既存に足す）", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: 10, inputTokens: 5 });
    await run(fakeClient(msg(GOOD_CONFIRMED)).client, mkCase());
    const jpy = estimateUsd(DRAFT_MODEL, USAGE) * DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
    expect(jpy).toBeGreaterThan(0);
    const m = await monthOf();
    expect(m?.estimatedJpy).toBeCloseTo(10 + jpy, 10);
    expect(m?.inputTokens).toBe(5 + USAGE.input_tokens);
    expect(m?.outputTokens).toBe(USAGE.output_tokens);
  });

  it("使用量を積めなくても下書きは残る", async () => {
    const real = db.doc.bind(db);
    let monthReads = 0;
    vi.spyOn(db, "doc").mockImplementation(((p: string) => {
      // 1 回目は予算のための読み、2 回目が積む書き込み
      if (p === "usage/2025-12" && ++monthReads === 2) throw new Error("積めない");
      return real(p);
    }) as typeof db.doc);
    await run(fakeClient(msg(GOOD_CONFIRMED)).client, mkCase());
    expect(monthReads).toBe(2);
    expect(await draftOf()).toMatchObject({ source: "claude" });
  });
});
