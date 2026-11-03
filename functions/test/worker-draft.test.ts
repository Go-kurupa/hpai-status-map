// M-18: 声かけ文の下書き。Claude の呼び方と、返事を雛形に戻す判断。実際の Claude は呼ばない（偽の client）。
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { dateNumbers, workerMessageTemplate } from "@hpai/shared/drafts";
import { DRAFT_MODEL, DRAFT_SYSTEM, buildDraftUser, callDraft } from "../src/drafts/claude";
import { decideDraft } from "../src/drafts/workerDraft";

const FACTS = { muniName: "津山市", date: "2025-12-19", stage: "confirmed" as const };
const SUSPECT = { ...FACTS, stage: "suspected" as const };
const USAGE = { input_tokens: 300, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as unknown as Anthropic.Usage;

function msg(text: string, o: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DRAFT_MODEL,
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    content: [{ type: "text", text, citations: null }],
    usage: USAGE,
    ...o,
  } as unknown as Anthropic.Message;
}
const wire = (message: string) => JSON.stringify({ message });

/** 偽の client。parse は呼ばれたら投げる（messages.parse を使わない約束の確認）。 */
function fake(reply: Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const parse = vi.fn(() => {
    throw new Error("messages.parse は呼ばない");
  });
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { client: { messages: { create, parse } } as unknown as Anthropic, calls, create, parse };
}

describe("DRAFT_SYSTEM と buildDraftUser", () => {
  it("system は固定の文", () => {
    expect(DRAFT_SYSTEM).toBe(
      "あなたは養鶏場の経営者が働く人へ送る短い声かけ文を下書きします。渡された事実だけを使います。伝えることは「発生地の近くに行かない」「出勤の前後に消毒と着替え」の 2 つです。3 文以内で、やさしい言葉で書きます。市町村名と日付（M月D日）を入れます。疑いの段階なら「疑い」と書きます。数字を足しません。人の健康について書きません。不安をあおる語を使いません。",
    );
  });
  it("user は県、市町村、日付、段階の JSON だけ", () => {
    const u = JSON.parse(buildDraftUser("33", FACTS)) as Record<string, unknown>;
    expect(u).toEqual({ prefecture: "岡山県", municipality: "津山市", date: "2025-12-19", stage: "confirmed" });
    expect(Object.keys(u).sort()).toEqual(["date", "municipality", "prefecture", "stage"]);
  });
});

describe("callDraft", () => {
  it("決まった形で呼び、道具もサンプリングの引数も送らず、parse を呼ばない", async () => {
    const f = fake(msg(wire("本文")));
    const user = buildDraftUser("33", FACTS);
    const r = await callDraft(f.client, DRAFT_SYSTEM, user);
    expect(r).toEqual({ ok: true, value: { message: "本文" }, usage: USAGE });
    expect(f.calls).toHaveLength(1);
    const p = f.calls[0]!;
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(DRAFT_MODEL).toBe("claude-sonnet-5-5");
    expect(p.max_tokens).toBe(16000);
    expect(p.system).toBe(DRAFT_SYSTEM);
    expect(p.messages).toEqual([{ role: "user", content: user }]);
    expect(p.output_config?.effort).toBe("medium");
    expect(p.output_config?.format).toMatchObject({
      type: "json_schema",
      schema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false },
    });
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools", "citations"]) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).not.toContain('"citations"');
    expect(f.parse).not.toHaveBeenCalled();
  });

  it("拒否は refusal（使用量つき）", async () => {
    const f = fake(msg("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } } as never));
    const r = await callDraft(f.client, DRAFT_SYSTEM, "{}");
    expect(r).toMatchObject({ ok: false, reason: "refusal", usage: USAGE });
  });
  it("途中で切れたら max_tokens", async () => {
    const r = await callDraft(fake(msg("", { stop_reason: "max_tokens" })).client, DRAFT_SYSTEM, "{}");
    expect(r).toMatchObject({ ok: false, reason: "max_tokens", usage: USAGE });
  });
  it("形が違えば format_error（JSON でない、message がない、message が文字列でない）", async () => {
    for (const body of ["これは JSON ではない", JSON.stringify({ text: "x" }), JSON.stringify({ message: 3 }), ""]) {
      const r = await callDraft(fake(msg(body)).client, DRAFT_SYSTEM, "{}");
      expect(r).toMatchObject({ ok: false, reason: "format_error" });
    }
  });
  it("通信の失敗は api_error（投げない。detail に状態の番号だけ）", async () => {
    const e = Object.assign(new Error("secret body"), { status: 529 });
    const r = await callDraft(fake(e).client, DRAFT_SYSTEM, "{}");
    expect(r).toEqual({ ok: false, reason: "api_error", detail: "status=529" });
  });
});

describe("decideDraft（Claude の返事を採るか、雛形に戻すか）", () => {
  const ok = (message: string) => ({ ok: true as const, value: { message }, usage: USAGE });
  const GOOD_CONFIRMED = "12月19日、津山市で鳥インフルエンザの発生が確認されました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";
  const GOOD_SUSPECT = "12月19日、津山市で鳥インフルエンザの疑いが出ました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";

  it("合格なら Claude の文（前後の空白は落とす）", () => {
    expect(decideDraft(FACTS, ok(`  ${GOOD_CONFIRMED}\n`))).toEqual({ message: GOOD_CONFIRMED, source: "claude" });
    expect(decideDraft(SUSPECT, ok(GOOD_SUSPECT))).toEqual({ message: GOOD_SUSPECT, source: "claude" });
  });
  it("検査に落ちれば雛形", () => {
    const bad = GOOD_CONFIRMED.replace("消毒と着替え", "消毒");
    const d = decideDraft(FACTS, ok(bad));
    expect(d.source).toBe("template");
    expect(d.message).toBe(workerMessageTemplate(FACTS));
    expect(d.failures).toContain("missing_core_disinfect");
  });
  it("煽る語と事実にない数字は雛形", () => {
    expect(decideDraft(FACTS, ok(`${GOOD_CONFIRMED}大変危険です。`)).source).toBe("template");
    expect(decideDraft(FACTS, ok(`${GOOD_CONFIRMED}約43万羽です。`)).source).toBe("template");
  });
  it("疑いの段階なのに「疑い」がなければ雛形", () => {
    const noSuspect = "12月19日、津山市で鳥インフルエンザの発表がありました。発生地の近くには行かないでください。出勤の前後に消毒と着替えをお願いします。";
    const d = decideDraft(SUSPECT, ok(noSuspect));
    expect(d).toMatchObject({ source: "template", message: workerMessageTemplate(SUSPECT), failures: ["missing_suspected_word"] });
    // 確定の段階では「疑い」を求めない
    expect(decideDraft(FACTS, ok(noSuspect)).source).toBe("claude");
  });
  it("refusal、max_tokens、format_error、api_error のすべてで雛形", () => {
    for (const reason of ["refusal", "max_tokens", "format_error", "api_error"] as const) {
      const d = decideDraft(FACTS, { ok: false, reason, detail: "x" });
      expect(d).toEqual({ message: workerMessageTemplate(FACTS), source: "template", failures: [`claude:${reason}`] });
    }
  });
  it("Claude を呼ばなかった（null）ときも雛形", () => {
    expect(decideDraft(FACTS, null)).toEqual({ message: workerMessageTemplate(FACTS), source: "template", failures: [] });
  });
  it("雛形は自分の検査に通る数字を使う（年をまたぐ 1 月）", () => {
    const f = { muniName: "津山市", date: "2026-01-05", stage: "confirmed" as const };
    expect(dateNumbers(f.date)).toEqual(["2026", "1", "5"]);
    expect(decideDraft(f, null).message).toContain("1月5日");
  });
});
