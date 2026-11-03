// 入口を直すエージェントを Managed Agents に作る（X-01 Step 5、利用者が実行する。実行は人の作業の後）。
//
//   FIREBASE_PROJECT=<プロジェクト> ANTHROPIC_API_KEY=<運用の鍵> npx tsx scripts/setup-agent.ts
//
// 順序: environments.create → agents.create → vaults.create → vaults.credentials.create（static_bearer）→ deployments.create。
// 作った ID は ~/.config/hpai/agent-ids.json（mode 600）に 1 つ作るごとに控え、あれば作り直さない。
// 最後に functions/.env.<project> の AGENT_DEPLOYMENT_ID を書く。値（ID、鍵、トークン）は画面に出さない。
//
// 定期実行の操作（X-14。作った後に使う。控えの deploymentId を使い、環境や agent は作らない）:
//   npx tsx scripts/setup-agent.ts --schedule "<5 項目の cron>"   受け入れ用に一時的に実行の時刻を替える（タイムゾーンは Asia/Tokyo）
//   npx tsx scripts/setup-agent.ts --restore-schedule            毎週月曜 07:00 JST に戻す
//   npx tsx scripts/setup-agent.ts --unpause                     費用の上限で止まった定期実行を、運営者が戻す
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SCHEDULE,
  buildAgentParams,
  buildCredentialParams,
  buildDeploymentParams,
  buildEnvironmentParams,
  buildVaultParams,
  mcpInternalUrl,
  upsertEnvLine,
} from "./lib/agent-config";

/** 控え（agent-ids.json）の中身。ID は秘密ではないが、控えは mode 600 で置く。 */
export interface SetupIds {
  /** 控えを作ったときの関数の URL。プロジェクトを取り違えて他のプロジェクトの ID を使わないための印。 */
  mcpUrl?: string;
  environmentId?: string;
  agentId?: string;
  vaultId?: string;
  credentialId?: string;
  deploymentId?: string;
}

/** 使う SDK のメソッドだけ。本物の client（new Anthropic()）がそのまま入り、試験では偽物を渡せる。 */
export interface SetupClient {
  beta: {
    environments: { create(params: Anthropic.Beta.Environments.EnvironmentCreateParams): Promise<{ id: string }> };
    agents: { create(params: Anthropic.Beta.Agents.AgentCreateParams): Promise<{ id: string }> };
    vaults: {
      create(params: Anthropic.Beta.Vaults.VaultCreateParams): Promise<{ id: string }>;
      credentials: { create(vaultId: string, params: Anthropic.Beta.Vaults.Credentials.CredentialCreateParams): Promise<{ id: string }> };
    };
    deployments: {
      create(params: Anthropic.Beta.Deployments.DeploymentCreateParams): Promise<{ id: string; schedule?: { upcoming_runs_at?: string[] } | null }>;
    };
  };
}

export interface SetupDeps {
  env: Record<string, string | undefined>;
  client: SetupClient;
  readIds: () => SetupIds | null;
  writeIds: (ids: SetupIds) => void;
  /** INTERNAL_MCP_TOKEN の控え。無ければ null。credential を作るときだけ読む。 */
  readToken: () => string | null;
  /** functions/.env.<project>。無ければ null。 */
  readEnvFile: () => string | null;
  writeEnvFile: (text: string) => void;
  write: (s: string) => void;
}

/** 0: 成功、2: 前提が足りない（何も作っていない）。API の失敗は例外のまま投げる（控えにはそこまでの ID が残る）。 */
export async function runSetup(deps: SetupDeps): Promise<number> {
  const { env, client, write } = deps;

  const project = env.FIREBASE_PROJECT;
  if (!project) {
    write("FIREBASE_PROJECT を設定してください\n");
    return 2;
  }
  if (!env.ANTHROPIC_API_KEY) {
    write("ANTHROPIC_API_KEY（運用の鍵）をこの実行の環境に入れてください（表示はしません）\n");
    return 2;
  }
  let mcpUrl: string;
  try {
    mcpUrl = mcpInternalUrl(project);
  } catch (e) {
    write(`${(e as Error).message}\n`);
    return 2;
  }

  const ids: SetupIds = { ...(deps.readIds() ?? {}) };
  if (ids.mcpUrl !== undefined && ids.mcpUrl !== mcpUrl) {
    write("控え（agent-ids.json）は別のプロジェクトのものです。何も作らず止めました。確かめてから控えを移すか消してください\n");
    return 2;
  }
  // トークンは、credential をこれから作るときだけ要る。何かを作る前に確かめる。
  const token = ids.credentialId ? null : deps.readToken();
  if (!ids.credentialId && !token) {
    write("~/.config/hpai/internal-mcp-token がありません。bash scripts/set-ops-token.sh を先に実行してください\n");
    return 2;
  }

  ids.mcpUrl = mcpUrl;
  const save = () => deps.writeIds(ids);

  if (ids.environmentId) write("環境: 控えがあるので作り直しません\n");
  else {
    ids.environmentId = (await client.beta.environments.create(buildEnvironmentParams())).id;
    save();
    write("環境: 作りました\n");
  }

  if (ids.agentId) write("エージェント: 控えがあるので作り直しません\n");
  else {
    ids.agentId = (await client.beta.agents.create(buildAgentParams(mcpUrl))).id;
    save();
    write("エージェント: 作りました\n");
  }

  if (ids.vaultId) write("vault: 控えがあるので作り直しません\n");
  else {
    ids.vaultId = (await client.beta.vaults.create(buildVaultParams())).id;
    save();
    write("vault: 作りました\n");
  }

  if (ids.credentialId) write("credential: 控えがあるので作り直しません\n");
  else {
    ids.credentialId = (await client.beta.vaults.credentials.create(ids.vaultId, buildCredentialParams(mcpUrl, token as string))).id;
    save();
    write("credential: 作りました\n");
  }

  if (ids.deploymentId) write("定期実行: 控えがあるので作り直しません\n");
  else {
    const deployment = await client.beta.deployments.create(
      buildDeploymentParams({ agentId: ids.agentId, environmentId: ids.environmentId, vaultId: ids.vaultId }),
    );
    ids.deploymentId = deployment.id;
    save();
    write("定期実行: 作りました\n");
    const upcoming = deployment.schedule?.upcoming_runs_at ?? [];
    write(`次の実行（upcoming_runs_at。月曜 07:00 JST になっているか確かめる）: ${upcoming.length ? upcoming.join(", ") : "（返りませんでした）"}\n`);
  }

  const existing = deps.readEnvFile();
  const after = upsertEnvLine(existing ?? "", "AGENT_DEPLOYMENT_ID", ids.deploymentId);
  if (existing === null || after !== existing) deps.writeEnvFile(after);
  write("AGENT_DEPLOYMENT_ID: 設定済み（functions/.env.$FIREBASE_PROJECT）\n");
  return 0;
}

// ── 定期実行の操作（X-14）──

export type ScheduleCommand = { kind: "schedule"; cron: string } | { kind: "restore" } | { kind: "unpause" };

/** 使う SDK のメソッドだけ（SetupClient とは別。setup の試験の偽物を変えないため）。 */
export interface ScheduleClient {
  beta: {
    deployments: {
      update(deploymentId: string, params: Anthropic.Beta.Deployments.DeploymentUpdateParams): Promise<{ status?: string; schedule?: { upcoming_runs_at?: string[] } | null }>;
      unpause(deploymentId: string): Promise<{ status?: string; schedule?: { upcoming_runs_at?: string[] } | null }>;
    };
  };
}

export interface ScheduleDeps {
  client: ScheduleClient;
  readIds: () => SetupIds | null;
  write: (s: string) => void;
}

/** 5 項目（分 時 日 月 曜日）の cron だけ。@daily などの略記と、秒や年の項目は API が受けない。 */
const CRON_FIELD = /^[0-9*/,-]+$/;
export function isFiveFieldCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}

/** コマンドの引数から操作を読む。操作の指定がなければ null（通常の setup）。指定が誤っていれば error。 */
export function parseScheduleArgs(argv: readonly string[]): ScheduleCommand | { error: string } | null {
  const has = (f: string) => argv.includes(f);
  const chosen = ["--schedule", "--restore-schedule", "--unpause"].filter(has);
  if (chosen.length === 0) return null;
  if (chosen.length > 1) return { error: `${chosen.join("、")} は同時に使えません` };
  if (has("--restore-schedule")) return { kind: "restore" };
  if (has("--unpause")) return { kind: "unpause" };
  const i = argv.indexOf("--schedule");
  const cron = argv[i + 1];
  if (cron === undefined || cron.startsWith("--") || !isFiveFieldCron(cron)) return { error: '--schedule には 5 項目の cron を 1 つ渡してください（例: --schedule "30 15 4 11 *"）' };
  return { kind: "schedule", cron: cron.trim().replace(/\s+/g, " ") };
}

const showUpcoming = (write: (s: string) => void, d: { schedule?: { upcoming_runs_at?: string[] } | null }) => {
  const upcoming = d.schedule?.upcoming_runs_at ?? [];
  write(`次の実行（upcoming_runs_at）: ${upcoming.length ? upcoming.join(", ") : "（返りませんでした）"}\n`);
};

/** 0: 成功、2: 前提が足りない（何も変えていない）。API の失敗は例外のまま投げる。 */
export async function runScheduleCommand(deps: ScheduleDeps, cmd: ScheduleCommand): Promise<number> {
  const { client, write } = deps;
  const id = deps.readIds()?.deploymentId;
  if (!id) {
    write("控え（agent-ids.json）に定期実行の ID がありません。先に引数なしで setup-agent を実行してください\n");
    return 2;
  }
  if (cmd.kind === "unpause") {
    const d = await client.beta.deployments.unpause(id);
    write(`定期実行を戻しました（状態: ${d.status ?? "不明"}）\n`);
    showUpcoming(write, d);
    return 0;
  }
  const expression = cmd.kind === "restore" ? AGENT_SCHEDULE.expression : cmd.cron;
  const d = await client.beta.deployments.update(id, { schedule: { type: "cron", expression, timezone: AGENT_SCHEDULE.timezone } });
  write(cmd.kind === "restore" ? "実行の時刻を毎週月曜 07:00 JST に戻しました\n" : `実行の時刻を替えました（cron: ${expression}、Asia/Tokyo）。確かめた後は --restore-schedule で戻してください\n`);
  showUpcoming(write, d);
  return 0;
}

// ── 実物の入口（import や typecheck では動かさない）──

const CONFIG_DIR = path.join(os.homedir(), ".config", "hpai");

function writePrivate(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const project = process.env.FIREBASE_PROJECT ?? "";
  const idsFile = path.join(CONFIG_DIR, "agent-ids.json");
  const envFile = path.join(repoRoot, "functions", `.env.${project}`);
  const command = parseScheduleArgs(process.argv.slice(2));
  if (command !== null && "error" in command) {
    process.stderr.write(`${command.error}\n`);
    process.exit(2);
  }
  // SDK は鍵を環境から読む。コードに鍵を持たない。
  let client: SetupClient & ScheduleClient;
  try {
    client = new Anthropic();
  } catch {
    process.stderr.write("Anthropic の client を作れませんでした。運用の鍵が環境に入っているか確かめてください（表示はしません）\n");
    process.exit(2);
  }
  const readIds = () => {
    const text = readIfExists(idsFile);
    return text === null ? null : (JSON.parse(text) as SetupIds);
  };
  const onFail = (e: unknown) => {
    // 原因の文には入力の一部が入りうるので、種類と HTTP の状態だけを出す。
    const status = (e as { status?: unknown } | null)?.status;
    process.stderr.write(`失敗しました（${e instanceof Error ? e.name : "Error"}${typeof status === "number" ? ` HTTP ${status}` : ""}）。${command === null ? "控えにはここまでの ID が残っています" : "何も変わっていない可能性があります。状態を確かめてください"}\n`);
    process.exit(1);
  };
  if (command !== null) {
    runScheduleCommand({ client, readIds, write: (s) => process.stdout.write(s) }, command).then((code) => process.exit(code), onFail);
  } else {
    runSetup({
      env: process.env,
      client,
      readIds,
      writeIds: (ids) => writePrivate(idsFile, `${JSON.stringify(ids, null, 2)}\n`),
      readToken: () => readIfExists(path.join(CONFIG_DIR, "internal-mcp-token"))?.trim() || null,
      readEnvFile: () => readIfExists(envFile),
      writeEnvFile: (text) => fs.writeFileSync(envFile, text),
      write: (s) => process.stdout.write(s),
    }).then((code) => process.exit(code), onFail);
  }
}
