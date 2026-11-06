// 対策の見直し相談の測定（Task 7）。本番と同じ要求（buildPlanRequest）を、下書きのカード全部から選んだ候補で 1 回だけ測る。
//
//   bash scripts/with-dev-key.sh npx tsx scripts/consult/measure.ts --count   入力のトークン数の数え（無料）と、費用の見積もり
//   bash scripts/with-dev-key.sh npx tsx scripts/consult/measure.ts --yes     **有料**。messages.create を 1 回だけ呼ぶ
//
// 入力は private/consult/cards-draft.json。ファイルは書き換えず、メモリの中だけで全カードを approved: true にする。
// 問いの確定版はまだないので、カードに多く出る conditionTags 4 つから「はい／いいえ」の問いを 4 つ作り、4 問とも「はい」と答えたことにする。
// 鍵は SDK が環境変数 ANTHROPIC_API_KEY から読む。ここでは読まず、表示もしない。
// 返事の中身は出さない。出すのは、秒数、usage、stop_reason、費用、validatePlan の行数と source、失敗の符号だけ。
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import { selectCandidates } from "@hpai/shared/consult/select";
import type { ConsultCard, ConsultProfile, ConsultQuestion } from "@hpai/shared/consult/types";
import { validatePlan } from "@hpai/shared/consult/validate";
import { buildPlanRequest, CONSULT_EFFORT, CONSULT_MAX_TOKENS, CONSULT_MODEL } from "../../functions/src/consult/claude";
import { decodeMessage } from "../../functions/src/read/claude";
import { normalizeDraft } from "./verify-cards";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DRAFT_PATH = path.join(ROOT, "private", "consult", "cards-draft.json");

// Opus 5.5 の料金（ドル／100 万トークン）。
const USD_INPUT = 4;
const USD_CACHE_WRITE = USD_INPUT * 1.25;
const USD_CACHE_READ = 0.2;
const USD_OUTPUT = 20;
const JPY_PER_USD = 155;
// --count の見積もりで仮定する出力のトークン数。
const ASSUMED_OUTPUT_TOKENS = 2000;
const MEASURE_QUESTION_COUNT = 4;
const CANDIDATE_MAX = 12;

const usd = (n: number): string => `$${n.toFixed(4)}`;
const jpy = (n: number): string => `${(n * JPY_PER_USD).toFixed(1)} 円`;
const money = (n: number): string => `${usd(n)}（${jpy(n)}）`;
const fmt = (n: number): string => n.toLocaleString("en-US");

/** 下書きを読み、メモリの中だけで全カードを approved: true にして検査に通す。 */
function loadCards(): ConsultCard[] {
  const raw = normalizeDraft(JSON.parse(fs.readFileSync(DRAFT_PATH, "utf8"))) as { cards: Record<string, unknown>[] };
  const approved = { ...raw, cards: raw.cards.map((c) => ({ ...c, approved: true })) };
  return parseCardsFile(approved).cards;
}

/** 多く出る tag を 4 つ（同数なら文字コードの順）。測定用の問いと、4 問とも「はい」の答えを作る。 */
function buildMeasureInput(cards: ConsultCard[]): { questions: ConsultQuestion[]; profile: ConsultProfile; tags: string[] } {
  const counts = new Map<string, number>();
  for (const c of cards) for (const t of new Set(c.conditionTags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MEASURE_QUESTION_COUNT)
    .map(([t]) => t);
  const questions: ConsultQuestion[] = tags.map((tag, i) => ({
    id: `m${i + 1}`,
    text: `測定用の問い（条件 ${tag}）に当てはまりますか`,
    options: [
      { id: "yes", label: "はい", tags: [tag] },
      { id: "no", label: "いいえ", tags: [] },
    ],
  }));
  const profile: ConsultProfile = Object.fromEntries(questions.map((q) => [q.id, "yes"]));
  return { questions, profile, tags };
}

/** API の失敗の符号。状態の番号か例外の名前だけ（本文や応答の文は出さない）。 */
function errorCode(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `status=${status}`;
  return e instanceof Error ? e.name : "unknown";
}

async function runCount(client: Anthropic, params: Anthropic.MessageCreateParamsNonStreaming, cardCount: number, candidateCount: number): Promise<number> {
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

  // カードは候補だけを user に入れる（キャッシュなし）。入力は全部、通常の料金で見積もる。
  const cost = (inputTokens * USD_INPUT + ASSUMED_OUTPUT_TOKENS * USD_OUTPUT) / 1_000_000;
  console.log(`モデル: ${CONSULT_MODEL}  effort: ${CONSULT_EFFORT}  max_tokens: ${fmt(CONSULT_MAX_TOKENS)}`);
  console.log(`カード: ${cardCount} 枚（全部 approved にして候補を選ぶ）  候補: ${candidateCount} 件（この分だけを user に入れる）`);
  console.log(`countTokens で外した引数: ${dropped.length === 0 ? "なし" : dropped.join(", ")}${dropped.length > 0 ? "（出力の形の指定の分だけ、実際より少なく数えている）" : ""}`);
  console.log(`入力のトークン数: ${fmt(inputTokens)}`);
  console.log(`見積もり（出力 ${fmt(ASSUMED_OUTPUT_TOKENS)} トークンと仮定。キャッシュなし: 入力 $${USD_INPUT}/MTok、出力 $${USD_OUTPUT}/MTok、1 ドル ${JPY_PER_USD} 円）: ${money(cost)}`);
  return 0;
}

async function runYes(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  candidates: ReturnType<typeof selectCandidates>,
  cards: ConsultCard[],
): Promise<number> {
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

  // 返事の中身は出さない。復号と検査の結果の符号だけ。
  const attempt = decodeMessage(message, z.unknown());
  if (!attempt.ok) {
    console.log(`復号の失敗: ${attempt.reason}（${attempt.detail}）`);
    return 1;
  }
  const result = validatePlan(attempt.value, candidates, cards);
  console.log(`validatePlan: 行数=${result.rows.length} source=${result.source} 失敗の符号=${result.failures.length === 0 ? "なし" : result.failures.join(",")}`);
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
  const { questions, profile, tags } = buildMeasureInput(cards);
  const candidates = selectCandidates(cards, questions, profile, CANDIDATE_MAX);
  const params = buildPlanRequest(cards, questions, profile, candidates);
  console.log(`測定用の条件（4 問とも「はい」）: ${tags.join(", ")}`);

  const client = new Anthropic(); // 鍵は SDK が ANTHROPIC_API_KEY から読む
  return values.yes ? runYes(client, params, candidates, cards) : runCount(client, params, cards.length, candidates.length);
}

main().then((code) => process.exit(code));
