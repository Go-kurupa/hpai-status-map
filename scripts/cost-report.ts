// 費用の実測と計算を出す（X-09）。読むだけで、Claude も外のサイトも呼ばず、何も書かない。
//   npx tsx scripts/cost-report.ts
// 実測の記録（data/replay/measured-usage.json、evals/results/summary.json）が無い間は「未計測」「未実測」と出す。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCostReport } from "./lib/cost";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(runCostReport(ROOT));
