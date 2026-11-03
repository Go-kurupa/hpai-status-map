// 過去 6 シーズンの事例を市町村に対応づけて data/history/ に書く（F-08）。
//
//   npx tsx scripts/build-history.ts --input private/research/cases-6seasons.json [--out-dir data/history]
//
// 入力は読むだけ。1 件でも対応しない行があれば unmatched.md だけを書いて終了コード 1（cases.json は書かない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadScriptGeoStore } from "./lib/geoStore";
import { buildHistory, parseRawCases, renderUnmatchedMd } from "./lib/history";

const USAGE = `使い方:
  build-history.ts --input <cases-6seasons.json> [--out-dir <フォルダ>]`;

const ROOT = path.resolve(import.meta.dirname, "..");

/** 戻り値は終了コード: 0 成功、1 対応しない行がある、2 引数か入力の誤り。 */
export async function runBuildHistory(argv: string[], write: (s: string) => void): Promise<number> {
  let values: { input?: string; "out-dir"?: string };
  try {
    values = parseArgs({ args: argv, options: { input: { type: "string" }, "out-dir": { type: "string" } }, strict: true }).values;
  } catch (e) {
    write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (values.input === undefined) {
    write(`--input が要ります\n${USAGE}\n`);
    return 2;
  }
  const outDir = path.resolve(values["out-dir"] ?? path.join(ROOT, "data", "history"));

  let result;
  try {
    const rows = parseRawCases(JSON.parse(fs.readFileSync(values.input, "utf8")) as unknown);
    result = buildHistory(rows, await loadScriptGeoStore());
  } catch (e) {
    write(`作れません: ${(e as Error).message}\n`);
    return 2;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "unmatched.md"), renderUnmatchedMd(result.unmatched));
  if (result.unmatched.length > 0) {
    write(`対応づかない事例が ${result.unmatched.length} 件あります。unmatched.md を見てください。cases.json は書いていません\n`);
    return 1;
  }
  fs.writeFileSync(path.join(outDir, "cases.json"), `${JSON.stringify(result.cases, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "name-map.json"), `${JSON.stringify(result.nameMap, null, 2)}\n`);
  const main = result.cases.filter((c) => !c.related).length;
  write(`${result.cases.length} 行（本体 ${main}、関連農場 ${result.cases.length - main}）を ${outDir} に書きました。名前の対応 ${Object.keys(result.nameMap).length} 件\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runBuildHistory(process.argv.slice(2), (s) => process.stdout.write(s)).then((code) => process.exit(code));
}
