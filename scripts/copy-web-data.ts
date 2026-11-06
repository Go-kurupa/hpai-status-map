// 公開してよい data を web/public/ へコピーする（取り決め 1.1）。無い入力は飛ばす。
//   tsx scripts/copy-web-data.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// [コピー元, コピー先]（root からの相対）
const COPIES: ReadonlyArray<readonly [string, string]> = [
  ["data/geo", "web/public/geo"],
  ["data/history/cases.json", "web/public/history/cases.json"],
  ["data/replay", "web/public/replay"],
  ["evals/results/summary.json", "web/public/evals/summary.json"],
  ["data/trends/summary.json", "web/public/trends/summary.json"],
  ["data/migration/summary.json", "web/public/migration/summary.json"],
  ["data/migration/routes", "web/public/migration/routes"],
  ["data/consult/cards.json", "web/public/consult/cards.json"],
];

export function copyWebData(root: string): void {
  for (const [from, to] of COPIES) {
    const src = path.join(root, from);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(root, to);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyWebData(path.resolve(import.meta.dirname, ".."));
}
