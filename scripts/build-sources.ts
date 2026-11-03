// data/sources.json を作る（F-09）。
//
//   npx tsx scripts/build-sources.ts --permanent private/research/pref-feeds/permanent-pages-20261103.tsv
//   npx tsx scripts/build-sources.ts --permanent <tsv> --reach data/private/reach/probe-YYYYMMDD.ndjson [--reach <別のファイル>]
//
// --reach なし: 全部の行の confirmedOn は調査の日（2026-11-03）。
// --reach あり: 届いた行の confirmedOn を実行日（日本時間）にし、未到達の行は残して note に「未到達（日付）」を書く。
// 出力先は --out（既定は data/sources.json）。毎回、表から作り直すので、note は重ならない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { toJstIso } from "@hpai/shared/dates";
import { parseNdjson } from "./lib/reachability";
import { buildSources } from "./lib/sources";

const USAGE = `使い方:
  build-sources.ts --permanent <tsv> [--reach <ndjson>]... [--out <json>]`;

export interface BuildSourcesIo {
  write: (s: string) => void;
  now: () => Date;
}

const ROOT = path.resolve(import.meta.dirname, "..");

/** 戻り値は終了コード: 0 成功、1 方針で取れない行がある、2 引数か入力の誤り。 */
export function runBuildSources(argv: string[], io: BuildSourcesIo): number {
  let values: { permanent?: string; reach?: string[]; out?: string };
  try {
    values = parseArgs({
      args: argv,
      options: { permanent: { type: "string" }, reach: { type: "string", multiple: true }, out: { type: "string" } },
      strict: true,
    }).values;
  } catch (e) {
    io.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (values.permanent === undefined) {
    io.write(`--permanent が要ります\n${USAGE}\n`);
    return 2;
  }
  const out = path.resolve(values.out ?? path.join(ROOT, "data", "sources.json"));

  let result;
  try {
    const reach = (values.reach ?? []).flatMap((file) => parseNdjson(fs.readFileSync(file, "utf8")));
    result = buildSources(fs.readFileSync(values.permanent, "utf8"), {
      ...(values.reach ? { reach } : {}),
      today: toJstIso(io.now()).slice(0, 10),
    });
  } catch (e) {
    io.write(`作れません: ${(e as Error).message}\n`);
    return 2;
  }

  const { seeds, report } = result;
  if (report.policyDenied.length > 0) {
    io.write(
      `方針で取れない入口があります（robots.txt の禁止か、許可していないホスト）。表を直してから作り直してください。何も書きませんでした\n${report.policyDenied.map((u) => `  ${u}\n`).join("")}`,
    );
    return 1;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(seeds, null, 2)}\n`);
  io.write(`${seeds.length} 行を ${path.relative(process.cwd(), out) || out} に書きました\n`);
  if (values.reach) {
    io.write(
      `届いた ${report.reached}、クラウドから未到達 ${report.cloudUnreached}、古い TLS で未到達 ${report.tlsUnreached}、届いたが内容が違う ${report.noContent.length}\n`,
    );
    for (const u of report.noContent) io.write(`  届いたが内容が違う（行は動かしていません）: ${u}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runBuildSources(process.argv.slice(2), { write: (s) => process.stdout.write(s), now: () => new Date() }));
}
