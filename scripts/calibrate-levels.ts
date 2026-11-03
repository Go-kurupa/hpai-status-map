// 過去 6 シーズンの事例で段階の回数を数え、docs/level-calibration.md に書く（F-08）。
//
//   npx tsx scripts/calibrate-levels.ts [--history data/history/cases.json] [--out docs/level-calibration.md]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { HistoryCase } from "@hpai/shared/types";
import { calibrateHistory, renderCalibrationDoc } from "./lib/calibrate";
import { loadScriptGeoStore } from "./lib/geoStore";

const ROOT = path.resolve(import.meta.dirname, "..");

export async function runCalibrateLevels(argv: string[], write: (s: string) => void): Promise<number> {
  let values: { history?: string; out?: string };
  try {
    values = parseArgs({ args: argv, options: { history: { type: "string" }, out: { type: "string" } }, strict: true }).values;
  } catch (e) {
    write(`${(e as Error).message}\n`);
    return 2;
  }
  const history = path.resolve(values.history ?? path.join(ROOT, "data", "history", "cases.json"));
  const out = path.resolve(values.out ?? path.join(ROOT, "docs", "level-calibration.md"));
  try {
    const rows = JSON.parse(fs.readFileSync(history, "utf8")) as HistoryCase[];
    const result = await calibrateHistory(rows, await loadScriptGeoStore());
    fs.writeFileSync(out, renderCalibrationDoc(result));
    const t = result.totals;
    write(`地点 ${result.pointCount} × 事例 ${result.caseCount}: ① ${t.level1}、② ${t.level2}、③ ${t.level3}、④ ${t.level4}。${out} に書きました\n`);
    return 0;
  } catch (e) {
    write(`数えられません: ${(e as Error).message}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCalibrateLevels(process.argv.slice(2), (s) => process.stdout.write(s)).then((code) => process.exit(code));
}
