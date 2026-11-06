// 対策の相談の測定。本番と同じ要求（buildAskRequest）を、下書きのカード全部（approved にして）と決まった質問で 1 回だけ測る。
//
//   bash scripts/with-dev-key.sh npx tsx scripts/consult/measure.ts --count   入力のトークン数の数え（無料）と、費用の見積もり
//   bash scripts/with-dev-key.sh npx tsx scripts/consult/measure.ts --yes     **有料**。messages.create を 1 回だけ呼ぶ
//
// 入力は private/consult/cards-draft.json。ファイルは書き換えず、メモリの中だけで全カードを approved: true にする。
// 質問は話題「長靴・服」の文（MEASURE_QUESTION）。カードは索引（cardId, action, appliesTo, evidence）だけを渡す。
// 鍵は SDK が環境変数 ANTHROPIC_API_KEY から読む。ここでは読まず、表示もしない。
// 返事の中身は画面に出さない。出すのは、秒数、usage、stop_reason、費用、validateFollowup の結果（outOfScope、カード数、failures の符号）と、
// 生の返事の数（outOfScope、cardIds の数、一覧にない id の数、答えの字数）だけ。
// 生の返事（message 全体）は、公開しない場所（RAW_DIR、日時つきの JSON）に保存する。もう 1 回払わずに後から読めるように。
// 下書きから外す 2 枚（EXCLUDED_IDS）は、R2 で cards.json ができるまでの間、本番と同じ 103 枚にそろえるため。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCard } from "@hpai/shared/consult/types";
import { validateFollowup } from "@hpai/shared/consult/validate";
import { buildAskRequest, CONSULT_EFFORT, CONSULT_MAX_CARDS, CONSULT_MAX_TOKENS, CONSULT_MODEL } from "../../functions/src/consult/claude";
import { decodeMessage } from "../../functions/src/read/claude";
import { normalizeDraft } from "./verify-cards";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DRAFT_PATH = path.join(ROOT, "private", "consult", "cards-draft.json");
// 生の返事の保存先（private/ は .gitignore 済み。公開しない）。
const RAW_DIR = path.join(ROOT, "private", "consult", "raw");
// 本番の cards.json に入れないカード（付け間違いと、図の中の文）。
const EXCLUDED_IDS = new Set(["maff-M19b", "okayama-OK3"]);

// Opus 5.5 の料金（ドル／100 万トークン）。
const USD_INPUT = 4;
const USD_CACHE_WRITE = USD_INPUT * 1.25;
const USD_CACHE_READ = 0.2;
const USD_OUTPUT = 20;
const JPY_PER_USD = 155;
// --count の見積もりで仮定する出力のトークン数。
const ASSUMED_OUTPUT_TOKENS = 2000;
// 測定用の質問（話題「長靴・服」の文）。
const MEASURE_QUESTION = "長靴と服の履き替え・消毒で、まず見直すとよいことは？";

const usd = (n: number): string => `$${n.toFixed(4)}`;
const jpy = (n: number): string => `${(n * JPY_PER_USD).toFixed(1)} 円`;
const money = (n: number): string => `${usd(n)}（${jpy(n)}）`;
const fmt = (n: number): string => n.toLocaleString("en-US");

/** 下書きを読み、メモリの中だけで全カードを approved: true にして検査に通す。 */
function loadCards(): ConsultCard[] {
  const raw = normalizeDraft(JSON.parse(fs.readFileSync(DRAFT_PATH, "utf8"))) as { cards: Record<string, unknown>[] };
  const approved = { ...raw, cards: raw.cards.filter((c) => !EXCLUDED_IDS.has(String(c["id"]))).map((c) => ({ ...c, approved: true })) };
  return parseCardsFile(approved).cards;
}

/** API の失敗の符号。状態の番号か例外の名前だけ（本文や応答の文は出さない）。 */
function errorCode(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `status=${status}`;
  return e instanceof Error ? e.name : "unknown";
}

async function runCount(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming, cardCount: number): Promise<number> {
  // countTokens が受け付ける引数だけ渡す。output_config を受け付けない（400）ときは外してやり直す（1 回だけ）。
  const base = { model: params.model, system: params.system, messages: params.messages };
  const dropped: string[] = [];
  let inputTokens: number;
  try {
    inputTokens = (await client.messages.countTokens({ ...base, output_config: params.output_config })).input_tokens;
  } catch (e) {
    if ((e as { status?: unknown } | null)?.status !== 400) {
      console.log(`countTokens の失敗: ${errorCode(e)}`);
      return 1;
    }
    dropped.push("output_config");
    try {
      inputTokens = (await client.messages.countTokens(base)).input_tokens;
    } catch (e2) {
      console.log(`countTokens の失敗（output_config を外した後）: ${errorCode(e2)}`);
      return 1;
    }
  }

  // カードは索引を user に入れる（キャッシュなし）。入力は全部、通常の料金で見積もる。
  const cost = (inputTokens * USD_INPUT + ASSUMED_OUTPUT_TOKENS * USD_OUTPUT) / 1_000_000;
  console.log(`モデル: ${CONSULT_MODEL}  effort: ${CONSULT_EFFORT}  max_tokens: ${fmt(CONSULT_MAX_TOKENS)}`);
  console.log(`カード: ${cardCount} 枚（全部 approved にして、索引を user に入れる）`);
  console.log(`countTokens で外した引数: ${dropped.length === 0 ? "なし" : dropped.join(", ")}${dropped.length > 0 ? "（出力の形の指定の分だけ、実際より少なく数えている）" : ""}`);
  console.log(`入力のトークン数: ${fmt(inputTokens)}`);
  console.log(`見積もり（出力 ${fmt(ASSUMED_OUTPUT_TOKENS)} トークンと仮定。キャッシュなし: 入力 $${USD_INPUT}/MTok、出力 $${USD_OUTPUT}/MTok、1 ドル ${JPY_PER_USD} 円）: ${money(cost)}`);
  return 0;
}

/** 生の返事（message 全体）を日時つきの JSON で保存する。保存先は公開しない場所。保存したファイルの path を返す。 */
function saveRaw(message: Anthropic.Message): string {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, `consult-raw-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ question: MEASURE_QUESTION, message }, null, 2)}\n`, "utf8");
  return file;
}

async function runYes(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming, cards: ConsultCard[]): Promise<number> {
  console.log(`messages.create を 1 回だけ呼びます（${CONSULT_MODEL}、effort ${CONSULT_EFFORT}、max_tokens ${fmt(CONSULT_MAX_TOKENS)}）`);
  const started = Date.now();
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(params);
  } catch (e) {
    console.log(`呼び出しの失敗（${((Date.now() - started) / 1000).toFixed(1)} 秒）: ${errorCode(e)}`);
    return 1; // 同じ呼び出しを繰り返さない。原因を見てから
  }
  const seconds = (Date.now() - started) / 1000;
  const u = message.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cost = (u.input_tokens * USD_INPUT + cacheWrite * USD_CACHE_WRITE + cacheRead * USD_CACHE_READ + u.output_tokens * USD_OUTPUT) / 1_000_000;

  console.log(`かかった時間: ${seconds.toFixed(1)} 秒${seconds > 60 ? "（60 秒を超えた）" : ""}`);
  console.log(`stop_reason: ${message.stop_reason}`);
  console.log(
    `usage: input_tokens=${fmt(u.input_tokens)} output_tokens=${fmt(u.output_tokens)} cache_creation_input_tokens=${fmt(cacheWrite)} cache_read_input_tokens=${fmt(cacheRead)}`,
  );
  console.log(`出力は max_tokens の ${((u.output_tokens / CONSULT_MAX_TOKENS) * 100).toFixed(1)}%`);
  console.log(`費用: ${money(cost)}`);

  // 生の返事は先に保存する（復号に失敗しても読めるように）。
  const rawPath = saveRaw(message);
  console.log(`生の返事の保存先: ${rawPath}`);

  // 返事の中身は画面に出さない。復号と検査の結果の符号と数だけ。
  const attempt = decodeMessage(message, z.unknown());
  if (!attempt.ok) {
    console.log(`復号の失敗: ${attempt.reason}（${attempt.detail}）`);
    return 1;
  }
  const ids = cards.map((c) => c.id);
  const result = validateFollowup(attempt.value, ids, cards, CONSULT_MAX_CARDS, MEASURE_QUESTION);
  console.log(`validateFollowup: outOfScope=${result.outOfScope} カード数=${result.cardIds.length} 答えの字数=${Array.from(result.answer).length}`);
  console.log(`failures: ${result.failures.length === 0 ? "なし" : result.failures.join(",")}`);
  const rawValue = attempt.value as { outOfScope?: unknown; cardIds?: unknown; answer?: unknown } | null;
  const rawIds = Array.isArray(rawValue?.cardIds) ? (rawValue.cardIds as unknown[]) : [];
  const known = new Set(ids);
  const unknownIds = rawIds.filter((id) => typeof id !== "string" || !known.has(id)).length;
  console.log(
    `生の返事: outOfScope=${String(rawValue?.outOfScope)} cardIds=${rawIds.length} 件（一覧にない id ${unknownIds} 件） 答えの字数=${typeof rawValue?.answer === "string" ? Array.from(rawValue.answer).length : "なし"}`,
  );
  return 0;
}

async function main(): Promise<number> {
  let values: { count?: boolean; yes?: boolean };
  try {
    values = parseArgs({ options: { count: { type: "boolean" }, yes: { type: "boolean" } }, strict: true }).values;
  } catch (e) {
    console.log((e as Error).message);
    return 2;
  }
  if (values.count && values.yes) {
    console.log("--count と --yes は同時に付けられません");
    return 2;
  }

  const cards = loadCards();
  const params = buildAskRequest(cards, MEASURE_QUESTION);
  console.log(`測定用の質問: ${MEASURE_QUESTION}`);

  const client = new Anthropic(); // 鍵は SDK が ANTHROPIC_API_KEY から読む
  return values.yes ? runYes(client, params, cards) : runCount(client, params, cards.length);
}

main().then((code) => process.exit(code));
