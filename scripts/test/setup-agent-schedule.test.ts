// setup-agent の定期実行の操作（X-14）。--schedule、--restore-schedule、--unpause。API は偽物。有料の呼び出しはしない。
import { describe, expect, it, vi } from "vitest";
import { isFiveFieldCron, parseScheduleArgs, runScheduleCommand, type ScheduleClient } from "../setup-agent";

describe("isFiveFieldCron", () => {
  it.each(["30 15 4 11 *", "0 7 * * 1", "*/15 * * * *", "0 7 1,15 * 1-5"])("通す: %s", (c) => expect(isFiveFieldCron(c)).toBe(true));
  it.each(["@daily", "0 7 * *", "0 0 7 * * 1", "0 7 * * ? ", "a b c d e", "", "0 7 * * 1; rm"])("拒む: %j", (c) => expect(isFiveFieldCron(c)).toBe(false));
});

describe("parseScheduleArgs", () => {
  it("操作の指定がなければ null（通常の setup）", () => expect(parseScheduleArgs([])).toBeNull());
  it("--schedule は 5 項目の cron を取る", () => expect(parseScheduleArgs(["--schedule", "30  15 4 11 *"])).toEqual({ kind: "schedule", cron: "30 15 4 11 *" }));
  it("--restore-schedule、--unpause", () => {
    expect(parseScheduleArgs(["--restore-schedule"])).toEqual({ kind: "restore" });
    expect(parseScheduleArgs(["--unpause"])).toEqual({ kind: "unpause" });
  });
  it("cron がない、形が違う、操作が重なるのは error", () => {
    for (const argv of [["--schedule"], ["--schedule", "--unpause"], ["--schedule", "@daily"], ["--unpause", "--restore-schedule"]]) {
      expect(parseScheduleArgs(argv), argv.join(" ")).toHaveProperty("error");
    }
  });
});

function harness(ids: { deploymentId?: string } | null = { deploymentId: "depl_x" }) {
  const update = vi.fn(async () => ({ status: "active", schedule: { upcoming_runs_at: ["2026-11-09T07:00:00+09:00"] } }));
  const unpause = vi.fn(async () => ({ status: "active", schedule: { upcoming_runs_at: ["2026-11-09T07:00:00+09:00"] } }));
  const client = { beta: { deployments: { update, unpause } } } as unknown as ScheduleClient;
  let out = "";
  return { update, unpause, deps: { client, readIds: () => ids, write: (s: string) => (out += s) }, out: () => out };
}

describe("runScheduleCommand", () => {
  it("--schedule は cron と Asia/Tokyo で schedule だけを替える（環境や agent、予算は触らない）", async () => {
    const h = harness();
    expect(await runScheduleCommand(h.deps, { kind: "schedule", cron: "30 15 4 11 *" })).toBe(0);
    expect(h.update).toHaveBeenCalledWith("depl_x", { schedule: { type: "cron", expression: "30 15 4 11 *", timezone: "Asia/Tokyo" } });
    expect(h.out()).toContain("--restore-schedule");
    expect(h.out()).toContain("upcoming_runs_at");
  });

  it("--restore-schedule は月曜 07:00 JST（0 7 * * 1）に戻す", async () => {
    const h = harness();
    expect(await runScheduleCommand(h.deps, { kind: "restore" })).toBe(0);
    expect(h.update).toHaveBeenCalledWith("depl_x", { schedule: { type: "cron", expression: "0 7 * * 1", timezone: "Asia/Tokyo" } });
  });

  it("--unpause は unpause を 1 回呼ぶ", async () => {
    const h = harness();
    expect(await runScheduleCommand(h.deps, { kind: "unpause" })).toBe(0);
    expect(h.unpause).toHaveBeenCalledWith("depl_x");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("控えに deploymentId がなければ何も呼ばず 2", async () => {
    for (const ids of [null, {}]) {
      const h = harness(ids);
      expect(await runScheduleCommand(h.deps, { kind: "unpause" })).toBe(2);
      expect(h.unpause).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
    }
  });

  it("API の失敗は例外のまま（呼び出し側が種類だけを表示する）", async () => {
    const h = harness();
    h.update.mockRejectedValueOnce(new Error("boom"));
    await expect(runScheduleCommand(h.deps, { kind: "restore" })).rejects.toThrow("boom");
  });
});
