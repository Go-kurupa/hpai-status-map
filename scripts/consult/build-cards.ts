// 対策カードの確定（対策の見直し相談）。下書きから、公開する data/consult/cards.json を作る。
//
//   npx tsx scripts/consult/build-cards.ts [--in private/consult/cards-draft.json] [--out data/consult/cards.json]
//
// 作者が使わないと決めたカードを外し、補助の項目を落とし、approved: true にする。
// 使われなくなった資料は sources からも外す。並びは資料の id 順、カードの id 順。毎回同じ出力になる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCardsFile } from "@hpai/shared/consult/types";
import { normalizeDraft } from "./verify-cards";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * 作者が外すと決めたカード。
 * maff-M19b: 引用が対策の文ではない。okayama-OK3: 図の中の文で、PDL1.0 の外にある。
 */
export const EXCLUDED_CARD_IDS: readonly string[] = ["maff-M19b", "okayama-OK3"];

// コードの順（ロケールに依らない）で比べる。
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 下書きから cards.json の中身を作る。入力は書き換えない。外す id が下書きになければ throw する。 */
export function buildCards(rawDraft: unknown, excluded: readonly string[] = EXCLUDED_CARD_IDS): ConsultCardsFile {
  const draft = parseCardsFile(normalizeDraft(rawDraft));
  const ids = new Set(draft.cards.map((c) => c.id));
  const missing = excluded.filter((id) => !ids.has(id));
  if (missing.length > 0) throw new Error(`外すカードが下書きにありません: ${missing.join(", ")}`);

  const drop = new Set(excluded);
  const cards = draft.cards
    .filter((c) => !drop.has(c.id))
    .map((c) => ({ ...c, approved: true }))
    .sort(byId);
  const used = new Set(cards.map((c) => c.sourceId));
  const sources = draft.sources.filter((s) => used.has(s.id)).sort(byId);
  // 出力の形も同じ検査に通す。
  return parseCardsFile({ sources, cards });
}

/** 2 字下げの JSON、末尾に改行 1 つ。 */
export function serializeCards(file: ConsultCardsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function runBuildCards(argv: string[], write: (s: string) => void): number {
  let values: { in?: string; out?: string };
  try {
    values = parseArgs({ args: argv, options: { in: { type: "string" }, out: { type: "string" } }, allowPositionals: false, strict: true }).values;
  } catch (e) {
    write(`${(e as Error).message}\n`);
    return 2;
  }
  const input = path.resolve(values.in ?? path.join(ROOT, "private", "consult", "cards-draft.json"));
  const output = path.resolve(values.out ?? path.join(ROOT, "data", "consult", "cards.json"));
  if (!fs.existsSync(input)) {
    write(`下書きがありません: ${input}\n`);
    return 2;
  }
  let result: ConsultCardsFile;
  try {
    result = buildCards(JSON.parse(fs.readFileSync(input, "utf8")));
  } catch (e) {
    write(`作れませんでした: ${(e as Error).message}\n`);
    return 1;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serializeCards(result));
  write(`カード ${result.cards.length} 枚、資料 ${result.sources.length} 件を書き出しました: ${output}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runBuildCards(process.argv.slice(2), (s) => process.stdout.write(s)));
}
