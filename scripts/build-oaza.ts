// 国土交通省「大字・町丁目位置参照情報」の CSV（県ごと、Shift_JIS）から、data/oaza/{県コード}.json を作る。
//
//   npx tsx scripts/build-oaza.ts --input <CSV を置いたフォルダ> [--out-dir data/oaza]
//
// 入力は、位置参照情報ダウンロードサービスの「大字・町丁目」令和 7 年（版 19.0b）の 47 都道府県の ZIP から取り出した
// {県コード}_2025.csv。取り方は docs/data-sources.md。地図の市町村の一覧にない市町村があれば、書かずに終了コード 1。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildOazaPref } from "./lib/oaza";

const USAGE = `使い方:
  build-oaza.ts --input <CSV のフォルダ> [--out-dir <フォルダ>]`;

const ROOT = path.resolve(import.meta.dirname, "..");

/** 戻り値は終了コード: 0 成功、1 対応しない市町村がある、2 引数か入力の誤り。 */
export function runBuildOaza(argv: string[], write: (s: string) => void): number {
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
  const outDir = path.resolve(ROOT, values["out-dir"] ?? "data/oaza");
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data/geo/muni-index.json"), "utf8")) as Record<string, unknown>;
  const known = new Set(Object.keys(index));
  const files = fs.readdirSync(values.input).filter((f) => /^\d{2}_\d{4}\.csv$/u.test(f)).sort();
  if (files.length !== 47) {
    write(`47 都道府県の CSV が要ります（見つかったのは ${files.length}）\n`);
    return 2;
  }
  const decoder = new TextDecoder("shift_jis");
  const out = new Map<string, string>();
  const unmatched: string[] = [];
  let rows = 0;
  for (const f of files) {
    const csv = decoder.decode(fs.readFileSync(path.join(values.input, f)));
    const { pref, unmatched: u } = buildOazaPref(csv, known);
    unmatched.push(...u);
    rows += Object.values(pref).reduce((n, list) => n + list.length, 0);
    out.set(f.slice(0, 2), JSON.stringify(pref));
  }
  if (unmatched.length > 0) {
    write(`地図の市町村の一覧にない市町村があります（${unmatched.length}）:\n${unmatched.join("\n")}\n`);
    return 1;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [code, json] of out) fs.writeFileSync(path.join(outDir, `${code}.json`), json);
  write(`${out.size} 県、${rows} 地区を ${path.relative(ROOT, outDir)} に書きました\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runBuildOaza(process.argv.slice(2), (s) => process.stdout.write(s));
}
