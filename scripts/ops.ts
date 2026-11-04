// 手元から本番を管理する（契約 1.7）。opsAdmin を ~/.config/hpai/ops-token の Bearer で呼ぶ。トークンは表示しない。
//
//   npx tsx scripts/ops.ts set-claims --email <メール> --operator [--member]
//   npx tsx scripts/ops.ts create-invite --kind signup --max-uses 5   # 平文のコードは 1 度だけ出る
//   npx tsx scripts/ops.ts seed-sources
//   npx tsx scripts/ops.ts set-setting <キー> <値>
//   npx tsx scripts/ops.ts watch-detail   # 入口ごとの確認の状態（読むだけ。ホスト名まで）
//   npx tsx scripts/ops.ts send-test-mail   # 運営者（OPERATOR_EMAIL）にだけ試しのメールを送る。1 日 5 回まで
//   npx tsx scripts/ops.ts run-watch-now [--group 0|1|2]   # 見回りを今すぐ回す（既定は 3 組すべて。数分かかる。1 日 3 回まで）
//   npx tsx scripts/ops.ts probe --permanent <tsv> --entrances <tsv>   # 全入口への到達試験（docs/reachability.md を更新）
//   npx tsx scripts/ops.ts probe --from-sources
//
// 呼び先は FIREBASE_PROJECT から作る。別の呼び先は OPS_URL で指定する。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { OpRequest } from "../functions/src/ops/handlers";
import { PROJECT_REFUSED, functionUrl, isAllowedOpsUrl, urlRefused } from "./lib/opsUrl";
import { runProbe } from "./lib/reachability";

export { isAllowedOpsUrl };

const USAGE = `使い方:
  ops.ts set-claims --email <メール> --operator [--member]
  ops.ts create-invite --kind signup --max-uses <回数>
  ops.ts seed-sources
  ops.ts set-setting <キー> <値>
  ops.ts watch-detail
  ops.ts send-test-mail
  ops.ts run-watch-now [--group 0|1|2]
  ops.ts probe --permanent <tsv> --entrances <tsv>
  ops.ts probe --from-sources`;

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
    case "watch-detail": {
      parseArgs({ args: rest, options: {}, strict: true });
      return { op: "watch-detail" };
    }
    case "send-test-mail": {
      parseArgs({ args: rest, options: {}, strict: true }); // 宛先は受け取らない
      return { op: "send-test-mail" };
    }
    case "run-watch-now": {
      const { values } = parseArgs({ args: rest, options: { group: { type: "string" } }, strict: true });
      if (values.group === undefined) return { op: "run-watch-now" };
      if (values.group !== "0" && values.group !== "1" && values.group !== "2") throw new Error("--group は 0、1、2 のどれかです");
      return { op: "run-watch-now", group: Number(values.group) as 0 | 1 | 2 };
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
  if (argv[0] === "probe") {
    // PROBE_URL の scheme の検査は、Bearer を付ける直前（runProbe の中）で行う。
    return runProbe(argv.slice(1), {
      env: deps.env,
      readToken: deps.readToken,
      fetch: deps.fetch,
      write: deps.write,
      repoRoot: path.resolve(import.meta.dirname, ".."),
      now: () => new Date(),
    });
  }
  let body: OpRequest;
  try {
    body = buildRequest(argv);
  } catch (e) {
    deps.write(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const target = functionUrl(deps.env.OPS_URL, deps.env.FIREBASE_PROJECT, "opsAdmin");
  if (!target.ok) {
    deps.write(target.reason === "bad_project" ? `${PROJECT_REFUSED}\n` : "FIREBASE_PROJECT（または OPS_URL）を設定してください\n");
    return 2;
  }
  const url = target.url;
  if (!isAllowedOpsUrl(url)) {
    // 値は出さない（URL に何が入っているか分からない）。Bearer を平文で出さないため、送らずに止まる。
    deps.write(`${urlRefused("OPS_URL")}\n`);
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
      redirect: "error", // 別のホストへ転送されても Bearer を渡さない
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

/** 今月の費用と止める線（opsAdmin の usage-status）。 */
export interface UsageStatus {
  month: string;
  estimatedJpy: number;
  hardLimitJpy: number;
}

/**
 * opsAdmin の usage-status を呼ぶ。読めなかったとき（URL や控えがない、通信の失敗、形が違う）は null。呼び側は null を「確かめられない」として扱う。
 * Bearer を付ける直前に、URL の scheme を検査する（OPS_URL と同じ）。値は出さない。
 */
export async function fetchUsageStatus(deps: Pick<OpsDeps, "env" | "readToken" | "fetch">): Promise<UsageStatus | null> {
  const target = functionUrl(deps.env.OPS_URL, deps.env.FIREBASE_PROJECT, "opsAdmin");
  if (!target.ok || !isAllowedOpsUrl(target.url)) return null;
  const url = target.url;
  const token = deps.readToken();
  if (!token) return null;
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ op: "usage-status" } satisfies OpRequest),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown> | null;
    if (!j || j.ok !== true || j.op !== "usage-status") return null;
    const { month, estimatedJpy, hardLimitJpy } = j;
    if (typeof month !== "string" || typeof estimatedJpy !== "number" || typeof hardLimitJpy !== "number") return null;
    if (!Number.isFinite(estimatedJpy) || !Number.isFinite(hardLimitJpy)) return null;
    return { month, estimatedJpy, hardLimitJpy };
  } catch {
    return null;
  }
}

export function readTokenFile(): string | null {
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
