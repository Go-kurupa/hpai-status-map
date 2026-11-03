// Claude で文書を読む（契約 2.6、I-03）。`client.messages.create` と `decodeMessage` だけを使う。
// SDK の messages.parse は refusal、max_tokens、enum 違反で throw するので使わない。
// サンプリング引数、thinking、tool_choice、道具、citations は送らない。鍵は client を作る側が読む。
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import {
  READ_RESULT_JSON_SCHEMA,
  ReadResultSchema,
  SECOND_READ_RESULT_JSON_SCHEMA,
  SecondReadResultSchema,
} from "@hpai/shared/read/schema";
import type { ReadResult, SecondReadResult } from "@hpai/shared/read/types";
import type { RuntimeSettings } from "@hpai/shared/types";
import { PRIMARY_SYSTEM, SECOND_SYSTEM } from "./prompts";

export interface ReadInput {
  title: string;
  url: string;
  text: string | null;
  pdfBase64: string | null;
}

export type ReadAttempt<T> =
  | { ok: true; value: T; usage: Anthropic.Usage }
  | { ok: false; reason: "refusal" | "format_error" | "max_tokens" | "api_error"; detail: string; usage?: Anthropic.Usage }; // 拒否も課金されることがある

export const READ_MAX_TOKENS = 16000;

/**
 * 本文の中の <document> と </document>（大文字小文字、空白の混じりも）を、タグとして働かない形にする。
 * 先頭の < だけを全角の ＜ にする。normalizeForMatch（NFKC）が < に戻すので、引用の照合は崩れない。
 */
function defuse(s: string): string {
  return s.replace(/<(?=\s*\/?\s*document)/giu, "\uFF1C");
}

/** 文書を user の content にする。PDF と本文が両方あるときは PDF だけを送る。 */
function buildContent(doc: ReadInput): Anthropic.ContentBlockParam[] {
  const head: Anthropic.TextBlockParam = { type: "text", text: `題: ${defuse(doc.title)}\nURL: ${defuse(doc.url)}` };
  if (doc.pdfBase64 !== null) {
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.pdfBase64 } },
      head,
    ];
  }
  if (doc.text !== null) {
    return [head, { type: "text", text: `<document>\n${defuse(doc.text)}\n</document>` }];
  }
  throw new Error("読む中身（text か pdfBase64）がない");
}

export function buildPrimaryParams(doc: ReadInput, s: RuntimeSettings): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: s.primaryModel,
    max_tokens: READ_MAX_TOKENS,
    output_config: { effort: s.primaryEffort, format: { type: "json_schema", schema: READ_RESULT_JSON_SCHEMA } },
    system: [{ type: "text", text: PRIMARY_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildContent(doc) }],
  };
}

/** 別の読み手。主の結果を引数に持たない（先入観を入れない）。effort は送らない。 */
export function buildSecondParams(doc: ReadInput, s: RuntimeSettings): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: s.secondModel,
    max_tokens: READ_MAX_TOKENS,
    output_config: { format: { type: "json_schema", schema: SECOND_READ_RESULT_JSON_SCHEMA } },
    system: [{ type: "text", text: SECOND_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildContent(doc) }],
  };
}

/** detail には、項目の場所と zod の種類だけを入れる。値や引用は入れない。 */
function issueDetail(error: z.ZodError): string {
  const parts = error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}:${i.code}`);
  return parts.join(",") || "invalid";
}

/** 応答を読む。throw しない。 */
export function decodeMessage<T>(message: Anthropic.Message, schema: z.ZodType<T>): ReadAttempt<T> {
  const usage = message.usage;
  if (message.stop_reason === "refusal") {
    return { ok: false, reason: "refusal", detail: message.stop_details?.category ?? "unknown", usage };
  }
  if (message.stop_reason === "max_tokens") {
    return { ok: false, reason: "max_tokens", detail: "max_tokens", usage };
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    // 契約にない停止理由。json_parse に混ぜず、理由の名前だけ残す（本文や値は入れない）。
    return { ok: false, reason: "format_error", detail: "stop_reason=model_context_window_exceeded", usage };
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (text.trim() === "") return { ok: false, reason: "format_error", detail: "no_text", usage };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "format_error", detail: "json_parse", usage };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "format_error", detail: issueDetail(parsed.error), usage };
  return { ok: true, value: parsed.data, usage };
}

/** API の失敗の detail。状態の番号か例外の名前だけ（本文や応答の文を入れない）。 */
function apiErrorDetail(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `status=${status}`;
  return e instanceof Error ? e.name : "unknown";
}

async function readWith<T>(
  client: Anthropic,
  build: () => Anthropic.MessageCreateParamsNonStreaming,
  schema: z.ZodType<T>,
): Promise<ReadAttempt<T>> {
  let params: Anthropic.MessageCreateParamsNonStreaming;
  try {
    params = build();
  } catch {
    return { ok: false, reason: "api_error", detail: "empty_input" };
  }
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(params);
  } catch (e) {
    return { ok: false, reason: "api_error", detail: apiErrorDetail(e) };
  }
  return decodeMessage(message, schema);
}

export function readPrimary(client: Anthropic, doc: ReadInput, s: RuntimeSettings): Promise<ReadAttempt<ReadResult>> {
  return readWith(client, () => buildPrimaryParams(doc, s), ReadResultSchema);
}

export function readSecond(client: Anthropic, doc: ReadInput, s: RuntimeSettings): Promise<ReadAttempt<SecondReadResult>> {
  return readWith(client, () => buildSecondParams(doc, s), SecondReadResultSchema);
}
