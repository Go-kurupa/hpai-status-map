// 47 都道府県の見回り先に今届くかを 1 件ずつ点検し、表にする（F-09。スキル entrance-check が使う）。
//
//   npx tsx scripts/check-entrances.ts
//
// 取得はすべて politeFetch を通す（名乗り、robots.txt、同じホストへ 1.2 秒以上、再試行なし、TLS の設定は下げない）。
// 105 件ほどを順に取るので数分かかる。結果は標準出力と docs/entrance-check-<日付>.md に書く。見回り先は変えない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { toJstIso } from "@hpai/shared/dates";
import type { SourceSeed } from "@hpai/shared/types";
import { tlsHandshake } from "../functions/src/probe/run";
import { politeFetch } from "../functions/src/watch/politeFetch";
import { checkEntrances, formatEntranceTable, type CheckDeps } from "./lib/entrance-table";

const ROOT = path.resolve(import.meta.dirname, "..");

const USAGE = `使い方:
  check-entrances.ts [--sources <json>] [--docs-dir <dir>]`;

export type CheckEntrancesDeps = CheckDeps & { write: (s: string) => void };

/** 同じ日の 2 回目以降は -2、-3 を付け、前の結果を上書きしない。 */
function nextDocPath(dir: string, day: string): string {
  for (let n = 1; ; n++) {
    const file = path.join(dir, `entrance-check-${day}${n === 1 ? "" : `-${n}`}.md`);
    if (!fs.existsSync(file)) return file;
  }
}

/** 戻り値は終了コード: 0 点検できた（確認できない入口があっても 0）、2 引数か sources.json の誤り。 */
export async function runCheckEntrances(argv: string[], deps: CheckEntrancesDeps): Promise<number> {
  let values: { sources?: string; "docs-dir"?: string };
  try {
    values = parseArgs({
      args: argv,
      options: { sources: { type: "string" }, "docs-dir": { type: "string" } },
      strict: true,
    }).values;
  } catch (e) {
    deps.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }

  let seeds: SourceSeed[];
  try {
    seeds = JSON.parse(fs.readFileSync(values.sources ?? path.join(ROOT, "data", "sources.json"), "utf8")) as SourceSeed[];
    if (!Array.isArray(seeds)) throw new Error("配列ではありません");
  } catch (e) {
    deps.write(`sources.json を読めません: ${(e as Error).message}\n`);
    return 2;
  }

  const rows = await checkEntrances(seeds, deps);
  const table = formatEntranceTable(rows);

  const docsDir = path.resolve(values["docs-dir"] ?? path.join(ROOT, "docs"));
  fs.mkdirSync(docsDir, { recursive: true });
  const file = nextDocPath(docsDir, toJstIso(deps.now()).slice(0, 10));
  fs.writeFileSync(file, table);
  deps.write(table);
  deps.write(`${file} に書きました\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCheckEntrances(process.argv.slice(2), {
    fetcher: politeFetch,
    handshake: tlsHandshake,
    now: () => new Date(),
    write: (s) => process.stdout.write(s),
  }).then((code) => process.exit(code));
}
