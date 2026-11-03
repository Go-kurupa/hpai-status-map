// 読み取りの試行（I-03 Step 4）。**有料の Claude API を呼ぶ**。人が支払いの上限を置いた後にだけ実行する。
//
//   npx tsx scripts/smoke-read.ts --yes
//
// 文書: 作った 2 本（確定、作った否定。実在の発表ではない）と、
// data/private/fixtures/smoke/ に控えた実物（.html .txt .pdf。あるだけ）。
// 主（設定のモデル）と別の読み手の両方に渡し、次のものだけを出す:
//   kind、municipality.value、primaryDate、usage（output_tokens が 16000 のどれだけか）、stop_reason、失敗の reason と detail
// 本文、引用、鍵は出さない。拒否（refusal）が出たらそこで止めて、文書と件数を出す（索引 Q9）。
// 鍵は SDK が環境から読む。ここでは読まず、表示もしない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { estimateUsd } from "@hpai/shared/budget";
import { ReadResultSchema, SecondReadResultSchema } from "@hpai/shared/read/schema";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { READ_MAX_TOKENS, buildPrimaryParams, buildSecondParams, decodeMessage } from "../functions/src/read/claude";
import type { ReadInput } from "../functions/src/read/claude";
import { decodeBody, extractHtml } from "../functions/src/watch/extract";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "data", "private", "fixtures", "smoke");

// 作った文。実在の発表ではない。県名と市名も架空。
const MADE_UP: ReadInput[] = [
  {
    title: "【試験用の作り文】試験県で高病原性鳥インフルエンザの疑似患畜を確認",
    url: "https://example.test/made-up/confirmed",
    pdfBase64: null,
    text: [
      "試験県で高病原性鳥インフルエンザの疑似患畜を確認しました",
      "試験県は、令和8年11月3日（火）午前9時、試験市の採卵鶏農場（飼養羽数約12,000羽、ウインドレス鶏舎）において、",
      "遺伝子検査の結果、高病原性鳥インフルエンザの疑似患畜であることを確認しました。",
      "県内の事例は、今シーズン1例目、国内では今シーズン3例目です。",
      "発生農場の周囲半径3km以内を移動制限区域、半径3kmから10km以内を搬出制限区域とします。",
      "区域の外の農場には、野鳥の侵入を防ぐなど、飼養衛生管理の徹底を要請します。",
    ].join("\n"),
  },
  {
    title: "【試験用の作り文】疑われる事例に係る遺伝子検査の結果について",
    url: "https://example.test/made-up/negated",
    pdfBase64: null,
    text: [
      "疑われる事例に係る遺伝子検査の結果について",
      "11月2日に簡易検査で陽性となった試験市の農場の鶏について、国の検査機関で遺伝子検査を行った結果、",
      "高病原性鳥インフルエンザのウイルス遺伝子は検出されず、陰性でした。",
      "このため、同日付けの疑われる事例は取り消し、設置していた消毒ポイントを撤去します。",
    ].join("\n"),
  },
];

function loadFixtures(): ReadInput[] {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  const out: ReadInput[] = [];
  for (const name of fs.readdirSync(FIXTURE_DIR).sort()) {
    const file = path.join(FIXTURE_DIR, name);
    const ext = path.extname(name).toLowerCase();
    const title = `fixture:${name}`;
    const url = `https://example.test/fixture/${encodeURIComponent(name)}`;
    if (ext === ".pdf") out.push({ title, url, text: null, pdfBase64: fs.readFileSync(file).toString("base64") });
    else if (ext === ".html" || ext === ".htm") {
      const html = decodeBody(fs.readFileSync(file), "text/html");
      out.push({ title, url, text: extractHtml(html, url).text, pdfBase64: null });
    } else if (ext === ".txt") out.push({ title, url, text: fs.readFileSync(file, "utf8"), pdfBase64: null });
  }
  return out;
}

function usageLine(u: Anthropic.Usage) {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    outputOfMax: `${((u.output_tokens / READ_MAX_TOKENS) * 100).toFixed(1)}%`,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  const docs = [...MADE_UP, ...loadFixtures()];
  const s = DEFAULT_RUNTIME_SETTINGS;
  if (!values.yes) {
    console.log(`有料の呼び出しを ${docs.length * 2} 回します（文書 ${docs.length} 本 × 主と別の 2 つ）。人が支払いの上限を置いた後に --yes を付けて実行してください。`);
    return 2;
  }

  const client = new Anthropic();
  let refusals = 0;
  let usd = 0;
  for (const doc of docs) {
    for (const role of ["primary", "second"] as const) {
      const params = role === "primary" ? buildPrimaryParams(doc, s) : buildSecondParams(doc, s);
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(params);
      } catch (e) {
        const status = (e as { status?: unknown } | null)?.status;
        console.log(JSON.stringify({ doc: doc.title, role, ok: false, reason: "api_error", detail: typeof status === "number" ? `status=${status}` : e instanceof Error ? e.name : "unknown" }));
        return 1; // 同じ呼び出しを繰り返さない。原因を見てから
      }
      usd += estimateUsd(params.model, message.usage);
      const attempt = role === "primary" ? decodeMessage(message, ReadResultSchema) : decodeMessage(message, SecondReadResultSchema);
      const base = { doc: doc.title, role, model: params.model, stop_reason: message.stop_reason, usage: usageLine(message.usage) };
      if (attempt.ok) {
        const v = attempt.value;
        const m = v.municipality;
        const municipality = m === null || typeof m === "string" ? m : m.value;
        console.log(JSON.stringify({ ...base, ok: true, kind: v.kind, municipality, primaryDate: v.primaryDate }));
      } else {
        console.log(JSON.stringify({ ...base, ok: false, reason: attempt.reason, detail: attempt.detail }));
        if (attempt.reason === "refusal") {
          refusals += 1;
          console.log(JSON.stringify({ stopped: "refusal", doc: doc.title, refusals }));
          return 1; // 索引 Q9: 拒否が 1 件でも出たら止めて報告する
        }
      }
    }
  }
  console.log(JSON.stringify({ done: true, docs: docs.length, refusals, estimatedUsd: Number(usd.toFixed(4)), estimatedJpy: Math.round(usd * s.jpyPerUsd) }));
  return 0;
}

main().then((code) => process.exit(code));
