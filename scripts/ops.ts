// 手元から本番を管理する（契約 1.7）。opsAdmin を ~/.config/hpai/ops-token の Bearer で呼ぶ。トークンは表示しない。
//
//   npx tsx scripts/ops.ts set-claims --email <メール> --operator [--member]
//   npx tsx scripts/ops.ts create-invite --kind signup --max-uses 5   # 平文のコードは 1 度だけ出る
//   npx tsx scripts/ops.ts seed-sources
//   npx tsx scripts/ops.ts set-setting <キー> <値>
//
// 呼び先は FIREBASE_PROJECT から作る。別の呼び先は OPS_URL で指定する。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { OpRequest } from "../functions/src/ops/handlers";

const USAGE = `使い方:
  ops.ts set-claims --email <メール> --operator [--member]
  ops.ts create-invite --kind signup --max-uses <回数>
  ops.ts seed-sources
  ops.ts set-setting <キー> <値>`;

/** コマンドの引数から opsAdmin への本文を作る。足りなければ例外。 */
export function buildRequest(argv: string[]): OpRequest {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "set-claims": {
      const { values } = parseArgs({
        args: rest,
        options: { email: { type: "string" }, operator: { type: "boolean" }, member: { type: "boolean" } },
        strict: true,
      });
      if (!values.email) throw new Error("--email が要ります");
      if (!values.operator && !values.member) throw new Error("--operator か --member が要ります");
      return {
        op: "set-claims",
        email: values.email,
        ...(values.operator ? { operator: true } : {}),
        ...(values.member ? { member: true } : {}),
      };
    }
    case "create-invite": {
      const { values } = parseArgs({
        args: rest,
        options: { kind: { type: "string" }, "max-uses": { type: "string" } },
        strict: true,
      });
      if (values.kind !== "signup") throw new Error("--kind signup が要ります");
      const maxUses = Number(values["max-uses"]);
      if (!values["max-uses"] || !Number.isInteger(maxUses)) throw new Error("--max-uses に整数が要ります");
      return { op: "create-invite", kind: "signup", maxUses };
    }
    case "seed-sources": {
      parseArgs({ args: rest, options: {}, strict: true });
      return { op: "seed-sources" };
    }
    case "set-setting": {
      const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true, strict: true });
      const [key, raw] = positionals;
      if (positionals.length !== 2 || key === undefined || raw === undefined) throw new Error("<キー> <値> が要ります");
      return { op: "set-setting", key, value: parseValue(raw) };
    }
    default:
      throw new Error(cmd ? `知らない操作です: ${cmd}` : "操作を指定してください");
  }
}

/** JSON として読めれば（true、1500）その型、読めなければ文字列のまま。 */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface OpsDeps {
  env: Record<string, string | undefined>;
  /** 控えを読む。無ければ null。 */
  readToken: () => string | null;
  fetch: typeof fetch;
  write: (s: string) => void;
}

export async function runOps(argv: string[], deps: OpsDeps): Promise<number> {
  let body: OpRequest;
  try {
    body = buildRequest(argv);
  } catch (e) {
    deps.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const url =
    deps.env.OPS_URL ??
    (deps.env.FIREBASE_PROJECT ? `https://asia-northeast1-${deps.env.FIREBASE_PROJECT}.cloudfunctions.net/opsAdmin` : null);
  if (!url) {
    deps.write("FIREBASE_PROJECT（または OPS_URL）を設定してください\n");
    return 2;
  }
  const token = deps.readToken();
  if (!token) {
    deps.write("~/.config/hpai/ops-token がありません。bash scripts/set-ops-token.sh を先に実行してください\n");
    return 2;
  }

  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    deps.write("opsAdmin に届きませんでした\n");
    return 1;
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON でない応答は中身を出さない
  }
  if (!res.ok || !json || (json as { ok?: unknown }).ok !== true) {
    const message = (json as { error?: unknown } | null)?.error;
    deps.write(`失敗しました（HTTP ${res.status}）${typeof message === "string" ? `: ${message}` : ""}\n`);
    return 1;
  }
  deps.write(`${JSON.stringify(json, null, 2)}\n`);
  return 0;
}

function readTokenFile(): string | null {
  try {
    return fs.readFileSync(path.join(os.homedir(), ".config", "hpai", "ops-token"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOps(process.argv.slice(2), {
    env: process.env,
    readToken: readTokenFile,
    fetch,
    write: (s) => process.stdout.write(s),
  }).then((code) => process.exit(code));
}
