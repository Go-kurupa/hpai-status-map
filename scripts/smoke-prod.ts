// 本番の動作確認と、公開前の確認。
//
//   npx tsx scripts/smoke-prod.ts --pre-publish     公開の前の確認（ファイルを読むだけ。ネットワークへ出ない）
//   npx tsx scripts/smoke-prod.ts                   本番の確認（FIREBASE_PROJECT から URL を組む）
//   npx tsx scripts/smoke-prod.ts --base-url https://<プロジェクト>.web.app --internal-mcp-url https://asia-northeast1-<プロジェクト>.cloudfunctions.net/mcpInternal
//
// 終了コード: 0 全部通った、1 1 つでも落ちた、2 引数や URL の誤り。
// 本番の確認は読むだけの要求で、Authorization は送らない。結果の文に応答の本文や設定の値を出さない。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { allPassed, runPrePublishChecks, runSmoke, type FetchLike, type SmokeResult } from "./lib/smoke";
import { PROJECT_ID_PATTERN } from "./lib/opsUrl";

const ROOT = path.resolve(import.meta.dirname, "..");

const USAGE = `使い方:
  smoke-prod.ts --pre-publish
  smoke-prod.ts [--base-url <https://…>] [--internal-mcp-url <https://…>]
  （URL を省くと、環境変数 FIREBASE_PROJECT から組みます）`;

export interface SmokeProdDeps {
  fetch: FetchLike;
  write: (s: string) => void;
  /** 公開前の確認が読む作業ツリー */
  root: string;
  env: Record<string, string | undefined>;
}

/** https か、ローカルの http だけ許す。 */
function allowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function show(results: readonly SmokeResult[], write: (s: string) => void) {
  for (const r of results) write(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}\n`);
  const bad = results.filter((r) => !r.pass).length;
  write(bad === 0 ? `すべて通りました（${results.length} 件）\n` : `${bad} 件が落ちました（${results.length} 件中）\n`);
}

export async function runSmokeProd(argv: string[], deps: SmokeProdDeps): Promise<number> {
  let values: { "pre-publish"?: boolean; "base-url"?: string; "internal-mcp-url"?: string };
  try {
    values = parseArgs({
      args: argv,
      options: { "pre-publish": { type: "boolean" }, "base-url": { type: "string" }, "internal-mcp-url": { type: "string" } },
      strict: true,
    }).values;
  } catch (e) {
    deps.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }

  if (values["pre-publish"]) {
    const results = runPrePublishChecks(deps.root);
    show(results, deps.write);
    return allPassed(results) ? 0 : 1;
  }

  const project = deps.env.FIREBASE_PROJECT;
  if ((values["base-url"] === undefined || values["internal-mcp-url"] === undefined) && (!project || !PROJECT_ID_PATTERN.test(project))) {
    deps.write(`${project ? "FIREBASE_PROJECT の形が正しくありません（小文字の英数字とハイフンだけ）" : "--base-url と --internal-mcp-url を渡すか、環境変数 FIREBASE_PROJECT を設定してください"}\n${USAGE}\n`);
    return 2;
  }
  const baseUrl = values["base-url"] ?? `https://${project}.web.app`;
  const internalUrl = values["internal-mcp-url"] ?? `https://asia-northeast1-${project}.cloudfunctions.net/mcpInternal`;
  for (const [name, url] of [["--base-url", baseUrl], ["--internal-mcp-url", internalUrl]] as const) {
    if (!allowedUrl(url)) {
      deps.write(`${name} は https:// で始まる URL にしてください（ローカルの確認は http://localhost か http://127.0.0.1 だけ）\n`);
      return 2;
    }
  }

  const results = await runSmoke(baseUrl, internalUrl, deps.fetch);
  show(results, deps.write);
  return allPassed(results) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmokeProd(process.argv.slice(2), {
    fetch: (input, init) => fetch(input, init),
    write: (s) => process.stdout.write(s),
    root: ROOT,
    env: process.env,
  }).then((code) => process.exit(code));
}
