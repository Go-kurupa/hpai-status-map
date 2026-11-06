// shared を lib/index.js に同梱し、data の公開してよい部分を lib/data/ へコピーする（取り決め 1.3）。
// 実行時の読み込みは path.join(__dirname, "data", ...)。
//
//   node scripts/bundle.mjs [--entry <file>] [--outdir <dir>] [--data-root <dir>]
//
// 既定は functions/src/index.ts → functions/lib/index.js、<repo>/data。引数は試験用。
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const functionsDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(functionsDir, "..");

const { values } = parseArgs({
  options: {
    entry: { type: "string", default: path.join(functionsDir, "src", "index.ts") },
    outdir: { type: "string", default: path.join(functionsDir, "lib") },
    "data-root": { type: "string", default: path.join(repoRoot, "data") },
  },
});
const entry = path.resolve(values.entry);
const outdir = path.resolve(values.outdir);
const dataRoot = path.resolve(values["data-root"]);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  packages: "external",
  alias: { "@hpai/shared": path.join(repoRoot, "shared", "src") },
  outfile: path.join(outdir, "index.js"),
  logLevel: "warning",
});

// data/ が無くても通る。無いものは飛ばす。
const dataOut = path.join(outdir, "data");
fs.rmSync(dataOut, { recursive: true, force: true });
const copies = [
  ["geo", "geo"],
  [path.join("history", "cases.json"), path.join("history", "cases.json")],
  ["sources.json", "sources.json"],
  [path.join("consult", "cards.json"), path.join("consult", "cards.json")],
];
for (const [from, to] of copies) {
  const src = path.join(dataRoot, from);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(path.join(dataOut, to)), { recursive: true });
  fs.cpSync(src, path.join(dataOut, to), { recursive: true });
}
