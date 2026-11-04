// checkAgentRuns と runEntranceAgent の中身を、模擬環境の Firestore と偽の API client で確かめる（X-14）。有料の API は呼ばない。
import { HttpsError } from "firebase-functions/v2/https";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decideReadBudget } from "@hpai/shared/budget";
import type { ReviewItem } from "@hpai/shared/read/types";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { db } from "../../src/admin";
import {
  handleCheckAgentRuns,
  handleRunEntranceAgent,
  MAX_SESSION_COST_CENTS,
  type IdleEventRecord,
  type RunRecord,
  type RunsClient,
  type SessionRecord,
} from "../../src/agent/runs";
import { readUsageMonth } from "../../src/usage/settings";
import { AGENT_BUDGET } from "../../../scripts/lib/agent-config";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const NOW = new Date("2026-11-05T03:00:00Z"); // 日本時間 2026-11-05 12:00
const DEPLOYMENT = "depl_test";
const RECENT = "2026-11-05T01:00:00Z"; // NOW の 2 時間前
const OLD_RUN = "2026-11-01T01:00:00Z"; // NOW の 4 日前

interface Fake {
  runs: RunRecord[];
  sessions: Record<string, SessionRecord>;
  /** セッションごとの最後の session.status_idle の停止の理由。無ければ idle の事象なし。 */
  idle: Record<string, string>;
}

function makeClient(f: Fake) {
  const pause = vi.fn(async () => ({}));
  const run = vi.fn(async () => ({}));
  const retrieve = vi.fn(async (id: string): Promise<SessionRecord> => f.sessions[id] as SessionRecord);
  const client: RunsClient = {
    beta: {
      deploymentRuns: {
        list: () =>
          (async function* () {
            for (const r of f.runs) yield r;
          })(),
      },
      sessions: {
        retrieve,
        events: {
          list: (id) =>
            (async function* (): AsyncGenerator<IdleEventRecord> {
              const reason = f.idle[id];
              if (reason !== undefined) yield { type: "session.status_idle", stop_reason: { type: reason } };
            })(),
        },
      },
      deployments: { pause, run },
    },
  };
  return { client, pause, run, retrieve };
}

const finished = (cents: string | null): SessionRecord => ({ status: "idle", usage: { list_cost: cents === null ? null : { amount: cents } } });
const queue = async () => (await db.collection("reviewQueue").get()).docs.map((d) => d.data() as ReviewItem);
const month = async () => (await readUsageMonth(NOW)).estimatedJpy;
const counted = async () => ((await db.doc("usage/agent").get()).data() as { countedRunIds?: string[] } | undefined)?.countedRunIds ?? [];
const check = (client: RunsClient) => handleCheckAgentRuns({ client, deploymentId: DEPLOYMENT, now: () => NOW });

describe("checkAgentRuns の費用", () => {
  it("終わった実行の list cost を usage/{YYYY-MM}.estimatedJpy に足し、同じ実行を 2 度足さない", async () => {
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "end_turn" } });
    const r1 = await check(f.client);
    expect(r1).toMatchObject({ counted: 1, addedJpy: 150, failures: 0, paused: false });
    expect(await month()).toBe(150);
    expect(await counted()).toEqual(["drun_1"]);

    const r2 = await check(f.client);
    expect(r2).toMatchObject({ counted: 0, addedJpy: 0 });
    expect(await month()).toBe(150);
    expect(f.retrieve).toHaveBeenCalledTimes(1); // 数え済みの実行はセッションを読まない
  });

  it("同時に 2 回走っても 1 度しか足さない", async () => {
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "end_turn" } });
    await Promise.all([check(f.client), check(f.client)]);
    expect(await month()).toBe(150);
    expect(await counted()).toEqual(["drun_1"]);
  });

  it("9,900 円に 150 円を足すと 10,050 円で、読み取りが止まる", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 9900 });
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "end_turn" } });
    await check(f.client);
    const m = await readUsageMonth(NOW);
    expect(m.estimatedJpy).toBe(10050);
    expect(decideReadBudget(m, DEFAULT_RUNTIME_SETTINGS, "題")).toBe("stop");
  });

  it("まだ終わっていない実行（running、停止の理由のない idle）は数えず、終わった次の回に数える", async () => {
    const fake: Fake = {
      runs: [
        { created_at: RECENT, id: "drun_run", session_id: "ses_run", error: null },
        { created_at: RECENT, id: "drun_new", session_id: "ses_new", error: null },
      ],
      sessions: { ses_run: { status: "running", usage: { list_cost: { amount: "50" } } }, ses_new: finished("20") },
      idle: {},
    };
    const f = makeClient(fake);
    expect(await check(f.client)).toMatchObject({ counted: 0, addedJpy: 0 });
    expect(await counted()).toEqual([]);

    fake.sessions.ses_run = finished("50");
    fake.idle = { ses_run: "end_turn", ses_new: "end_turn" };
    expect(await check(f.client)).toMatchObject({ counted: 2, addedJpy: 105 });
    expect(await month()).toBe(105);
  });

  it("terminated の実行も、費用が分かっていれば数える", async () => {
    const f = makeClient({
      runs: [{ created_at: RECENT, id: "drun_t", session_id: "ses_t", error: null }],
      sessions: { ses_t: { status: "terminated", usage: { list_cost: { amount: "40" } } } },
      idle: {},
    });
    expect(await check(f.client)).toMatchObject({ counted: 1, addedJpy: 60 });
    expect(await counted()).toEqual(["drun_t"]);
  });

  it("終わっても list cost が測れていない実行は 0 円で確定せず、数え済みにしない。分かった回に実額で数える", async () => {
    const fake: Fake = {
      runs: [{ created_at: RECENT, id: "drun_n", session_id: "ses_n", error: null }],
      sessions: { ses_n: finished(null) },
      idle: { ses_n: "end_turn" },
    };
    const f = makeClient(fake);
    expect(await check(f.client)).toMatchObject({ counted: 0, addedJpy: 0 });
    expect(await month()).toBe(0);
    expect(await counted()).toEqual([]);
    expect(await queue()).toEqual([]); // まだ待つ間は警告も出さない

    fake.sessions.ses_n = finished("40");
    expect(await check(f.client)).toMatchObject({ counted: 1, addedJpy: 60 });
    expect(await month()).toBe(60);
    expect(await counted()).toEqual(["drun_n"]);
  });

  it("形が想定外の list cost（小数、空）も測れていないものとして待つ", async () => {
    const f = makeClient({
      runs: [
        { created_at: RECENT, id: "drun_a", session_id: "ses_a", error: null },
        { created_at: RECENT, id: "drun_b", session_id: "ses_b", error: null },
      ],
      sessions: { ses_a: finished("1.5"), ses_b: finished("") },
      idle: { ses_a: "end_turn", ses_b: "end_turn" },
    });
    expect(await check(f.client)).toMatchObject({ counted: 0, addedJpy: 0 });
    expect(await counted()).toEqual([]);
  });

  it("3 日たっても測れていなければ、セッションの上限 1 ドルを最悪値として足して確定し、費用が測れない旨を 1 回だけ知らせる", async () => {
    const f = makeClient({
      runs: [{ created_at: OLD_RUN, id: "drun_old", session_id: "ses_old", error: null }],
      sessions: { ses_old: finished(null) },
      idle: { ses_old: "end_turn" },
    });
    expect(await check(f.client)).toMatchObject({ counted: 1, addedJpy: 150 });
    expect(await month()).toBe(150);
    expect(await counted()).toEqual(["drun_old"]);
    await check(f.client);
    expect(await month()).toBe(150);
    const alerts = await queue();
    expect(alerts.map((i) => i.id)).toEqual(["alert-agent_run_failed-cost-unknown-drun_old"]);
    expect(alerts[0]).toMatchObject({ kind: "alert", alert: "agent_run_failed", prefCode: null });
  });

  it("S-15: 3 日たっても終わらない実行（running、停止の理由のない idle、セッションのない実行）も、窓を出る前に最悪値の 1 ドルで数え、費用が測れない旨を 1 回だけ知らせる", async () => {
    const f = makeClient({
      runs: [
        { created_at: OLD_RUN, id: "drun_stuck", session_id: "ses_stuck", error: null },
        { created_at: OLD_RUN, id: "drun_idle", session_id: "ses_idle", error: null },
        { created_at: OLD_RUN, id: "drun_nosession", session_id: null, error: null },
        { created_at: RECENT, id: "drun_young", session_id: "ses_young", error: null },
      ],
      sessions: { ses_stuck: { status: "running", usage: { list_cost: { amount: "10" } } }, ses_idle: { status: "idle" }, ses_young: { status: "running" } },
      idle: {},
    });
    expect(await check(f.client)).toMatchObject({ counted: 3, addedJpy: 450, failures: 0 }); // 150 円 × 3。若い実行は待つ
    expect(await month()).toBe(450);
    expect([...(await counted())].sort()).toEqual(["drun_idle", "drun_nosession", "drun_stuck"]);
    await check(f.client); // 2 度目は足さない
    expect(await month()).toBe(450);
    expect((await queue()).map((i) => i.id).sort()).toEqual([
      "alert-agent_run_failed-cost-unknown-drun_idle",
      "alert-agent_run_failed-cost-unknown-drun_nosession",
      "alert-agent_run_failed-cost-unknown-drun_stuck",
    ]);
  });

  it("測れていない間も、失敗（refusal）は知らせる。費用は待つ", async () => {
    const f = makeClient({
      runs: [{ created_at: RECENT, id: "drun_r", session_id: "ses_r", error: null }],
      sessions: { ses_r: finished(null) },
      idle: { ses_r: "refusal" },
    });
    expect(await check(f.client)).toMatchObject({ counted: 0, failures: 1 });
    expect((await queue()).map((i) => i.id)).toEqual(["alert-agent_run_failed-drun_r"]);
    expect(await counted()).toEqual([]);
  });

  it("作成の失敗（セッションがない実行）は費用 0 円で確定する", async () => {
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_e", session_id: null, error: { type: "vault_not_found_error" } }], sessions: {}, idle: {} });
    expect(await check(f.client)).toMatchObject({ counted: 1, addedJpy: 0, failures: 1 });
    expect(await counted()).toEqual(["drun_e"]);
  });

  it("deployment の id が空なら何もしない", async () => {
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "end_turn" } });
    const list = vi.spyOn(f.client.beta.deploymentRuns, "list");
    expect(await handleCheckAgentRuns({ client: f.client, deploymentId: "", now: () => NOW })).toMatchObject({ counted: 0 });
    expect(list).not.toHaveBeenCalled();
  });
});

describe("最悪値の定数", () => {
  it("費用が測れないときに足す額は、セッションの上限（AGENT_BUDGET、セント）と同じ", () => {
    expect(String(MAX_SESSION_COST_CENTS)).toBe(AGENT_BUDGET.max_list_cost.amount);
  });
});

describe("checkAgentRuns の失敗", () => {
  it("失敗は agent_run_failed で箱に入り、何度走っても 2 度は作られない。end_turn は入らない", async () => {
    const f = makeClient({
      runs: [
        { created_at: RECENT, id: "drun_err", session_id: null, error: { type: "vault_not_found_error" } },
        { created_at: RECENT, id: "drun_ref", session_id: "ses_ref", error: null },
        { created_at: RECENT, id: "drun_ok", session_id: "ses_ok", error: null },
      ],
      sessions: { ses_ref: finished("30"), ses_ok: finished("30") },
      idle: { ses_ref: "refusal", ses_ok: "end_turn" },
    });
    expect((await check(f.client)).failures).toBe(2);
    await check(f.client);
    await check(f.client);
    const items = await queue();
    expect(items.map((i) => i.id).sort()).toEqual(["alert-agent_run_failed-drun_err", "alert-agent_run_failed-drun_ref"]);
    expect(items.every((i) => i.kind === "alert" && i.alert === "agent_run_failed" && i.prefCode === null && i.resolvedAt === null)).toBe(true);
    // 失敗した実行の費用も足す（refusal の 30 セント、end_turn の 30 セント）
    expect(await month()).toBe(90);
  });

  it("箱に入れられなければ数えず、次の回にやり直す", async () => {
    const f = makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "budget_reached" } });
    const spy = vi.spyOn(await import("../../src/review/queue"), "enqueueReview").mockRejectedValueOnce(new Error("down"));
    await expect(check(f.client)).rejects.toThrow();
    spy.mockRestore();
    expect(await month()).toBe(0);
    expect(await counted()).toEqual([]);
    await check(f.client);
    expect(await month()).toBe(150);
    expect((await queue()).map((i) => i.id)).toEqual(["alert-agent_run_failed-drun_1"]);
  });
});

describe("checkAgentRuns の費用の上限（hardLimitJpy 10,000 円）", () => {
  const oneRun = () => makeClient({ runs: [{ created_at: RECENT, id: "drun_1", session_id: "ses_1", error: null }], sessions: { ses_1: finished("100") }, idle: { ses_1: "end_turn" } });

  it("上限に届かなければ止めない", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 9000 });
    const f = oneRun();
    expect((await check(f.client)).paused).toBe(false);
    expect(f.pause).not.toHaveBeenCalled();
  });

  it("上限以上になったら deployments.pause を呼び、運営者に知らせる。同じ月に 1 回だけ", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 9900 });
    const f = oneRun();
    expect((await check(f.client)).paused).toBe(true);
    expect(f.pause).toHaveBeenCalledTimes(1);
    expect(f.pause).toHaveBeenCalledWith(DEPLOYMENT);
    expect((await check(f.client)).paused).toBe(false);
    expect(f.pause).toHaveBeenCalledTimes(1);
    const alerts = (await queue()).filter((i) => i.id === "alert-agent_run_failed-paused-2026-11");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "alert", alert: "agent_run_failed", prefCode: null, resolvedAt: null });
  });

  it("S-13: 同じ月でも、止めた後に運営者が上限を上げて戻し、費用がその新しい上限に届いたら、もう一度止める。同じ上限では 2 度止めない", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 10600 });
    const f = makeClient({ runs: [], sessions: {}, idle: {} });
    expect((await check(f.client)).paused).toBe(true); // 上限 10,000 円で止まる
    // 運営者が上限を 12,000 円に上げ、setup-agent --unpause で戻した（API 側の状態はこの試験の外）
    await db.doc("usage/settings").set({ ...DEFAULT_RUNTIME_SETTINGS, hardLimitJpy: 12000 });
    expect((await check(f.client)).paused).toBe(false); // 10,600 円は新しい上限の手前
    await db.doc("usage/2026-11").set({ estimatedJpy: 12100 });
    expect((await check(f.client)).paused).toBe(true); // 同じ月でも、新しい上限に届いたら止める
    expect(f.pause).toHaveBeenCalledTimes(2);
    expect((await check(f.client)).paused).toBe(false); // 同じ上限では 2 度止めない
    expect(f.pause).toHaveBeenCalledTimes(2);
    const ids = (await queue()).map((i) => i.id).sort();
    expect(ids).toEqual(["alert-agent_run_failed-paused-2026-11", "alert-agent_run_failed-paused-2026-11-jpy12000"]);
  });

  it("新しい実行がなくても、すでに上限以上なら止める", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 10600 });
    const f = makeClient({ runs: [], sessions: {}, idle: {} });
    expect((await check(f.client)).paused).toBe(true);
    expect(f.pause).toHaveBeenCalledTimes(1);
  });

  it("止めるのに失敗したら例外で、知らせも記録もしない。次の回にやり直す", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 10600 });
    const f = makeClient({ runs: [], sessions: {}, idle: {} });
    f.pause.mockRejectedValueOnce(new Error("api down"));
    await expect(check(f.client)).rejects.toThrow();
    expect((await queue()).length).toBe(0);
    expect((await check(f.client)).paused).toBe(true);
    expect(f.pause).toHaveBeenCalledTimes(2);
  });
});

describe("runEntranceAgent", () => {
  const operator = { uid: "u1", operator: true };
  const deps = (f: ReturnType<typeof makeClient>, deploymentId = DEPLOYMENT) => ({ client: f.client, deploymentId, now: () => NOW });
  const empty = () => makeClient({ runs: [], sessions: {}, idle: {} });
  const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as HttpsError).code;

  it("ログインなしは unauthenticated、operator でなければ permission-denied。どちらも実行しない", async () => {
    const f = empty();
    expect(await code(handleRunEntranceAgent(deps(f), null))).toBe("unauthenticated");
    expect(await code(handleRunEntranceAgent(deps(f), { uid: "u2", operator: false }))).toBe("permission-denied");
    expect(f.run).not.toHaveBeenCalled();
  });

  it("operator なら deployments.run を 1 回呼ぶ", async () => {
    const f = empty();
    expect(await handleRunEntranceAgent(deps(f), operator)).toEqual({ ok: true });
    expect(f.run).toHaveBeenCalledTimes(1);
    // 実行は冪等でないので、通信の失敗の再試行で二重に走らせない（1 回 1 ドル）。
    expect(f.run).toHaveBeenCalledWith(DEPLOYMENT, null, { maxRetries: 0 });
  });

  it("続けて押しても 1 回だけ（5 分たてばまた使える）", async () => {
    const f = empty();
    await handleRunEntranceAgent(deps(f), operator);
    expect(await code(handleRunEntranceAgent(deps(f), operator))).toBe("failed-precondition");
    expect(f.run).toHaveBeenCalledTimes(1);
    await handleRunEntranceAgent({ ...deps(f), now: () => new Date(NOW.getTime() + 6 * 60 * 1000) }, operator);
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it("同時に押しても 1 回だけ", async () => {
    const f = empty();
    const results = await Promise.allSettled([handleRunEntranceAgent(deps(f), operator), handleRunEntranceAgent(deps(f), operator)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it("今月の費用が上限以上なら実行しない（止めた後の手動の実行で 10,000 円を大きく超えないように）", async () => {
    await db.doc("usage/2026-11").set({ estimatedJpy: 10000 });
    const f = empty();
    expect(await code(handleRunEntranceAgent(deps(f), operator))).toBe("failed-precondition");
    expect(f.run).not.toHaveBeenCalled();
  });

  it("deployment が未設定なら実行しない。API の失敗は詳細を出さない", async () => {
    const f = empty();
    expect(await code(handleRunEntranceAgent(deps(f, ""), operator))).toBe("failed-precondition");
    f.run.mockRejectedValueOnce(Object.assign(new Error("secret-internal-detail"), { status: 500 }));
    const err = (await handleRunEntranceAgent(deps(f), operator).catch((e: unknown) => e)) as HttpsError;
    expect(err.code).toBe("unavailable");
    expect(err.message).not.toContain("secret-internal-detail");
  });
});
