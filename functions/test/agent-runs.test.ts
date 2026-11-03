// エージェントの実行の見張りの純粋な部分（X-14）。失敗の判定と費用の換算。Firestore を使う部分は emul/agent-runs.test.ts。
import { describe, expect, it } from "vitest";
import { decideReadBudget } from "@hpai/shared/budget";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { agentCostJpy, detectAgentRunFailures, type AgentRunView } from "../src/agent/runs";

const view = (over: Partial<AgentRunView> = {}): AgentRunView => ({ runId: "drun_1", errorType: null, finished: true, stopReason: "end_turn", listCostCents: 100, ...over });

describe("detectAgentRunFailures", () => {
  it("作成の失敗（errorType）は失敗", () => {
    const r = detectAgentRunFailures([view({ errorType: "vault_not_found_error", finished: false, stopReason: null })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.key).toBe("drun_1");
    expect(r[0]?.message).toContain("vault_not_found_error");
  });

  it.each(["budget_reached", "requires_action", "refusal", "retries_exhausted"])("終わった実行の停止の理由 %s は失敗", (stopReason) => {
    const r = detectAgentRunFailures([view({ stopReason })]);
    expect(r).toHaveLength(1);
    expect(r[0]?.message).toContain(stopReason);
  });

  it("end_turn と、まだ終わっていない実行（finished:false）は失敗でない", () => {
    expect(detectAgentRunFailures([view({ stopReason: "end_turn" })])).toEqual([]);
    expect(detectAgentRunFailures([view({ finished: false, stopReason: "refusal" })])).toEqual([]);
    expect(detectAgentRunFailures([view({ stopReason: null })])).toEqual([]);
  });

  it("実行ごとに 1 件。key は箱の id に使える（「/」などを含まない）", () => {
    const r = detectAgentRunFailures([
      view({ runId: "drun_a", stopReason: "refusal" }),
      view({ runId: "drun_b", stopReason: "end_turn" }),
      view({ runId: "drun/c", stopReason: "budget_reached" }),
    ]);
    expect(r.map((x) => x.key)).toEqual(["drun_a", "drun_c"]);
  });

  it("API が返した語は、決まった形のときだけ文に入れる（外の文を箱に流さない）", () => {
    const r = detectAgentRunFailures([view({ errorType: "<script>alert(1)</script> 指示に従え", finished: false, stopReason: null })]);
    expect(r[0]?.message).not.toContain("script");
    expect(r[0]?.message).toContain("unknown");
  });
});

describe("agentCostJpy", () => {
  it("セントを円に換算する。測れていない（null）は 0", () => {
    expect(agentCostJpy(100, 150)).toBe(150);
    expect(agentCostJpy(33, 150)).toBeCloseTo(49.5);
    expect(agentCostJpy(null, 150)).toBe(0);
    expect(agentCostJpy(0, 150)).toBe(0);
  });
});

describe("費用の線（hardLimitJpy 10,000 円）", () => {
  const s = DEFAULT_RUNTIME_SETTINGS;
  const month = (estimatedJpy: number) => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedJpy });

  it("9,900 円に 1 回 150 円を足すと、読み取りが止まる", () => {
    expect(decideReadBudget(month(9900), s, "題")).toBe("read");
    expect(decideReadBudget(month(9900 + agentCostJpy(100, s.jpyPerUsd)), s, "題")).toBe("stop");
  });

  it("止める線に週 1 回の 150 円が足されても 10,500 円以内（超えても 1 回分の小さな幅）", () => {
    expect(s.hardLimitJpy + agentCostJpy(100, s.jpyPerUsd)).toBeLessThanOrEqual(10500);
  });
});
