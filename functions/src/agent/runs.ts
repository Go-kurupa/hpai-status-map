// エージェントの実行の見張り（X-14）。毎朝の checkAgentRuns と、運営者の画面のボタンが呼ぶ runEntranceAgent の中身。
// Claude の API の client は引数で受ける（試験は偽物を渡す）。鍵は index.ts の handler の中で読む。
//
// 費用の約束: 1 回の実行は 1 ドル（セッションの上限、X-01）。週 1 回の定期実行で月に約 150 円 × 4〜5 回。
// 止める線 hardLimitJpy（2,500 円）に週 1 回の 150 円が足されても、3,000 円を超えない。止めた後は運営者が `--unpause` で戻す。
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { toJstIso } from "@hpai/shared/dates";
import type { IsoDateTime } from "@hpai/shared/types";
import { db } from "../admin";
import { enqueueReview, reviewAlertId } from "../review/queue";
import type { Caller } from "../review/resolve";
import { readRuntimeSettings, readUsageMonth, usageMonthKey } from "../usage/settings";

/** usage/agent。lastAuthedCallAt は mcpInternal が、countedRunIds と pausedMonth は checkAgentRuns が、lastManualRunAt は runEntranceAgent が書く。 */
export interface AgentHeartbeat {
  lastAuthedCallAt: IsoDateTime | null;
  /** 費用を足した実行の id。同じ実行を 2 度足さない。 */
  countedRunIds: string[];
  /** 費用の上限で定期実行を止めた月（YYYY-MM）。同じ月に 2 度止めない。 */
  pausedMonth?: string;
  lastManualRunAt?: IsoDateTime;
}

/** 実行 1 回の見え方。checkAgentRuns が API の応答から作る。 */
export interface AgentRunView {
  runId: string;
  /** 実行の作成の失敗の種類（セッションが作れなかったとき）。なければ null。 */
  errorType: string | null;
  /** セッションが終わった（idle で停止の理由が読めた、または terminated、または作成の失敗）。 */
  finished: boolean;
  /** 最後の session.status_idle の stop_reason.type。読めなければ null。 */
  stopReason: string | null;
  /** セッションの list 費用（セント）。測れていなければ null。 */
  listCostCents: number | null;
}

const FAILING_STOP_REASONS: ReadonlySet<string> = new Set(["budget_reached", "requires_action", "refusal", "retries_exhausted"]);
const SAFE_WORD = /^[A-Za-z0-9_.-]{1,64}$/;

/** API が返す語は、決まった形のときだけ文に入れる（外の文を箱に流さない）。 */
const word = (s: string | null): string => (s !== null && SAFE_WORD.test(s) ? s : "unknown");

/** 失敗した実行。失敗は、作成の失敗（errorType）と、終わった実行の停止の理由が budget_reached、requires_action、refusal、retries_exhausted のとき。end_turn と、まだ終わっていない実行は失敗でない。 */
export function detectAgentRunFailures(runs: readonly AgentRunView[]): Array<{ key: string; message: string }> {
  const out: Array<{ key: string; message: string }> = [];
  for (const r of runs) {
    // 箱の id に使えない文字（「/」など）は入れない
    const key = r.runId.replace(/[^A-Za-z0-9_-]/g, "_");
    if (r.errorType !== null) {
      out.push({ key, message: `入口を直すエージェントの実行が始められませんでした（${word(r.errorType)}）。実行の記録: ${key}` });
    } else if (r.finished && r.stopReason !== null && FAILING_STOP_REASONS.has(r.stopReason)) {
      out.push({ key, message: `入口を直すエージェントの実行が途中で止まりました（${word(r.stopReason)}）。実行の記録: ${key}` });
    }
  }
  return out;
}

/** セント → 円。測れていない（null）は 0。 */
export function agentCostJpy(cents: number | null, jpyPerUsd: number): number {
  return cents === null ? 0 : (cents / 100) * jpyPerUsd;
}

// ── API の client（使うメソッドだけ。本物の new Anthropic() がそのまま入り、試験は偽物を渡す）──

export interface RunRecord {
  id: string;
  /** 実行を記録した時刻（RFC 3339）。費用が測れないままの実行を、何日待ったかの数え方に使う。 */
  created_at: string;
  session_id: string | null;
  error: { type: string } | null;
}
export interface SessionRecord {
  status: string;
  usage?: { list_cost?: { amount: string } | null };
}
/** 事象の一覧は種類の絞り込みをかけても型の上では全種類の和なので、stop_reason は無いことがある側で受ける。 */
export interface IdleEventRecord {
  type: string;
  stop_reason?: { type: string };
}
export interface RunsClient {
  beta: {
    deploymentRuns: { list(params: { deployment_id: string; "created_at[gte]": string }): AsyncIterable<RunRecord> };
    sessions: {
      retrieve(sessionId: string): Promise<SessionRecord>;
      events: { list(sessionId: string, params: { types: ["session.status_idle"]; order: "desc" }): AsyncIterable<IdleEventRecord> };
    };
    deployments: { pause(deploymentId: string): Promise<unknown>; run(deploymentId: string, params: null, options: { maxRetries: number }): Promise<unknown> };
  };
}

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** 終わった実行の費用が測れないまま、この日数がたったら最悪値で確定する。 */
const COST_WAIT_MS = 3 * 24 * 60 * 60 * 1000;
/** セッション 1 回の上限（セント）。scripts/lib/agent-config.ts の AGENT_BUDGET と同じ値（試験で揃えを確かめる）。 */
export const MAX_SESSION_COST_CENTS = 100;
const MAX_RUNS = 200;
const MAX_COUNTED_IDS = 500;
const MANUAL_RUN_COOLDOWN_MS = 5 * 60 * 1000;

export interface CheckDeps {
  client: RunsClient;
  /** AGENT_DEPLOYMENT_ID。空なら何もしない。 */
  deploymentId: string;
  now(): Date;
}

export interface CheckResult {
  /** 今回、費用を足した実行の数。 */
  counted: number;
  addedJpy: number;
  failures: number;
  paused: boolean;
}

interface RunInspection {
  view: AgentRunView;
  /** 費用が分かっている（または、待たずに確定してよい）。false なら数え済みにせず、次の回に取り直す。 */
  costSettled: boolean;
  /** 最悪値で確定した（費用が測れないまま待ちきった）。 */
  costGuessed: boolean;
}

/** 実行 1 件の見え方を作る。セッションがまだ終わっていなければ null（次の回に見る）。 */
async function inspect(client: RunsClient, run: RunRecord, now: Date): Promise<RunInspection | null> {
  if (run.error !== null) {
    return { view: { runId: run.id, errorType: run.error.type, finished: true, stopReason: null, listCostCents: null }, costSettled: true, costGuessed: false };
  }
  if (run.session_id === null) return null;

  const session = await client.beta.sessions.retrieve(run.session_id);
  if (session.status !== "idle" && session.status !== "terminated") return null;

  let stopReason: string | null = null;
  for await (const ev of client.beta.sessions.events.list(run.session_id, { types: ["session.status_idle"], order: "desc" })) {
    stopReason = ev.stop_reason?.type ?? null;
    break; // 最後の 1 件だけ
  }
  // idle は始まる前の状態でもある。停止の理由がまだ無い idle は、終わったとは見ない。
  if (session.status === "idle" && stopReason === null) return null;

  const amount = session.usage?.list_cost?.amount;
  const measured = typeof amount === "string" && /^\d{1,12}$/.test(amount) ? Number(amount) : null;
  if (measured !== null) {
    return { view: { runId: run.id, errorType: null, finished: true, stopReason, listCostCents: measured }, costSettled: true, costGuessed: false };
  }
  // 費用が測れていない（list_cost が無い、または形が想定外）。0 円で確定せず、次の回に取り直す。
  // 待ちきったら、セッションの上限を最悪値として足す（不明を 0 としない）。作成日時が読めないときも待ちきったものとして扱う。
  const waited = !(now.getTime() - Date.parse(run.created_at) < COST_WAIT_MS);
  return {
    view: { runId: run.id, errorType: null, finished: true, stopReason, listCostCents: waited ? MAX_SESSION_COST_CENTS : null },
    costSettled: waited,
    costGuessed: waited,
  };
}

/**
 * 直近 14 日の実行のうち、まだ数えていないものを数える。
 * - 失敗は運営者の箱に agent_run_failed で入れる（id は実行ごと。2 度は作られない）。箱に入れてから数えるので、失敗したら次の回にやり直す。
 * - 費用は今月の usage/{YYYY-MM}.estimatedJpy に足す。数えた id の記録（countedRunIds）と同じ取引で書くので、同じ実行を 2 度足さない。
 * - 足した後、今月の費用が hardLimitJpy 以上なら、定期実行を止める（deployments.pause）。同じ月に 1 回だけ。
 */
export async function handleCheckAgentRuns(deps: CheckDeps): Promise<CheckResult> {
  const { client, deploymentId } = deps;
  const none: CheckResult = { counted: 0, addedJpy: 0, failures: 0, paused: false };
  if (deploymentId === "") return none;

  const now = deps.now();
  const settings = await readRuntimeSettings();
  const stateRef = db.doc("usage/agent");
  const counted = new Set(((await stateRef.get()).data() as Partial<AgentHeartbeat> | undefined)?.countedRunIds ?? []);

  const inspected: RunInspection[] = [];
  let seen = 0;
  for await (const run of client.beta.deploymentRuns.list({ deployment_id: deploymentId, "created_at[gte]": new Date(now.getTime() - LOOKBACK_MS).toISOString() })) {
    if (++seen > MAX_RUNS) break;
    if (counted.has(run.id)) continue;
    const v = await inspect(client, run, now);
    if (v !== null) inspected.push(v);
  }
  const views = inspected.map((i) => i.view);

  // 失敗は、費用がまだ測れていなくても知らせる（id は実行ごとで、何度走っても 1 件）。
  const failures = detectAgentRunFailures(views);
  for (const f of failures) {
    await enqueueReview({ id: reviewAlertId("agent_run_failed", f.key), kind: "alert", alert: "agent_run_failed", prefCode: null, caseId: null, message: f.message }, now);
  }
  // 費用が測れないまま待ちきった実行は、最悪値で足すことを知らせる。
  for (const g of inspected.filter((i) => i.costGuessed)) {
    const key = g.view.runId.replace(/[^A-Za-z0-9_-]/g, "_");
    await enqueueReview(
      {
        id: reviewAlertId("agent_run_failed", `cost-unknown-${key}`),
        kind: "alert",
        alert: "agent_run_failed",
        prefCode: null,
        caseId: null,
        message: `入口を直すエージェントの実行（${key}）の費用を測れないまま${COST_WAIT_MS / 86_400_000}日たちました。セッションの上限（${MAX_SESSION_COST_CENTS / 100}ドル）を最悪値として足しました。`,
      },
      now,
    );
  }

  // 数える。取引の中で数え済みの id をもう一度読み、足すのは費用が確定した未計上の実行だけ。
  const settled = inspected.filter((i) => i.costSettled).map((i) => i.view);
  const monthRef = db.doc(`usage/${usageMonthKey(now)}`);
  const added = await db.runTransaction(async (tx) => {
    const ids = ((await tx.get(stateRef)).data() as Partial<AgentHeartbeat> | undefined)?.countedRunIds ?? [];
    const have = new Set(ids);
    const fresh = settled.filter((v) => !have.has(v.runId));
    if (fresh.length === 0) return { n: 0, jpy: 0 };
    const jpy = fresh.reduce((sum, v) => sum + agentCostJpy(v.listCostCents, settings.jpyPerUsd), 0);
    tx.set(stateRef, { countedRunIds: [...ids, ...fresh.map((v) => v.runId)].slice(-MAX_COUNTED_IDS) }, { merge: true });
    if (jpy > 0) tx.set(monthRef, { estimatedJpy: FieldValue.increment(jpy) }, { merge: true });
    return { n: fresh.length, jpy };
  });

  const paused = await pauseIfOverLimit(deps, now, settings.hardLimitJpy);
  return { counted: added.n, addedJpy: added.jpy, failures: failures.length, paused };
}

/** 今月の費用が止める線以上なら、定期実行を止めて運営者に知らせる。同じ月に 1 回だけ。止めたら true。 */
async function pauseIfOverLimit(deps: CheckDeps, now: Date, hardLimitJpy: number): Promise<boolean> {
  const month = await readUsageMonth(now);
  if (month.estimatedJpy < hardLimitJpy) return false;

  const key = usageMonthKey(now);
  const stateRef = db.doc("usage/agent");
  if (((await stateRef.get()).data() as Partial<AgentHeartbeat> | undefined)?.pausedMonth === key) return false;

  // 止めるのが先。止められなければ例外のまま終わり、次の回にやり直す。
  await deps.client.beta.deployments.pause(deps.deploymentId);
  await enqueueReview(
    {
      id: reviewAlertId("agent_run_failed", `paused-${key}`),
      kind: "alert",
      alert: "agent_run_failed",
      prefCode: null,
      caseId: null,
      message: `今月の費用が上限（${hardLimitJpy}円）に達したため、入口を直すエージェントの定期実行を止めました。戻すときは scripts/setup-agent.ts の --unpause を使います。`,
    },
    now,
  );
  await stateRef.set({ pausedMonth: key }, { merge: true });
  logger.warn("agent deployment paused: monthly cost limit");
  return true;
}

// ── 運営者の画面のボタン（I-07）──

export interface RunDeps {
  client: { beta: Pick<RunsClient["beta"], "deployments"> };
  deploymentId: string;
  now(): Date;
}

/** 入口を直すエージェントを手動で 1 回実行する。運営者だけ。 */
export async function handleRunEntranceAgent(deps: RunDeps, caller: Caller | null): Promise<{ ok: true }> {
  if (!caller) throw new HttpsError("unauthenticated", "ログインしてください");
  if (!caller.operator) throw new HttpsError("permission-denied", "運営者だけが使えます");
  if (deps.deploymentId === "") throw new HttpsError("failed-precondition", "エージェントがまだ設定されていません");

  const now = deps.now();
  // 止めた後でも手動の実行は通ってしまうので、費用の上限は画面の側でも確かめる。
  const [settings, month] = await Promise.all([readRuntimeSettings(), readUsageMonth(now)]);
  if (month.estimatedJpy >= settings.hardLimitJpy) throw new HttpsError("failed-precondition", "今月の費用が上限に達しています");

  // 続けて押しても 1 回だけ（1 回 1 ドルかかる）。
  const stateRef = db.doc("usage/agent");
  await db.runTransaction(async (tx) => {
    const last = ((await tx.get(stateRef)).data() as Partial<AgentHeartbeat> | undefined)?.lastManualRunAt;
    if (last !== undefined && now.getTime() - Date.parse(last) < MANUAL_RUN_COOLDOWN_MS) {
      throw new HttpsError("failed-precondition", "さきほど実行したばかりです。数分たってからやり直してください");
    }
    tx.set(stateRef, { lastManualRunAt: toJstIso(now) }, { merge: true });
  });

  try {
    // 実行は冪等でない。通信の失敗の再試行で二重に走り、費用が二重にならないよう、再試行しない。
    await deps.client.beta.deployments.run(deps.deploymentId, null, { maxRetries: 0 });
  } catch (e) {
    // 原因の文には入力の一部が入りうるので、種類と HTTP の状態だけを残す。
    const status = (e as { status?: unknown } | null)?.status;
    logger.error("runEntranceAgent failed", { type: e instanceof Error ? e.name : "Error", status: typeof status === "number" ? status : null });
    throw new HttpsError("unavailable", "実行できませんでした");
  }
  return { ok: true };
}
