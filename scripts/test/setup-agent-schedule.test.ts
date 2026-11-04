// setup-agent の定期実行の操作（X-14）。--schedule、--restore-schedule、--unpause。API は偽物。有料の呼び出しはしない。
import { describe, expect, it, vi } from "vitest";
import type { UsageStatus } from "../ops";
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
    expect(parseScheduleArgs(["--unpause", "--force"])).toEqual({ kind: "unpause", force: true });
  });
  it("--force は --unpause と一緒のときだけ（単独、ほかの操作との組は error）", () => {
    for (const argv of [["--force"], ["--restore-schedule", "--force"], ["--schedule", "30 15 4 11 *", "--force"]]) {
      expect(parseScheduleArgs(argv), argv.join(" ")).toHaveProperty("error");
    }
  });
  it.each(["* * * * *", "*/5 * * * *", "0 * * * *", "0 7,19 * * *", "0,30 7 * * *", "0 */6 * * *", "0 7-9 * * *", "60 7 * * *", "0 24 * * *"])(
    "1 日に 1 回より多く動く（または範囲外の）cron は error: %s",
    (cron) => {
      expect(parseScheduleArgs(["--schedule", cron]), cron).toHaveProperty("error");
    },
  );
  it.each(["30 15 4 11 *", "0 7 * * 1", "0 7 * * *", "5 0 1 1 *", "59 23 31 12 *"])("1 日に 1 回以下の cron は通る: %s", (cron) => {
    expect(parseScheduleArgs(["--schedule", cron])).toEqual({ kind: "schedule", cron });
  });
  it("cron がない、形が違う、操作が重なるのは error", () => {
    for (const argv of [["--schedule"], ["--schedule", "--unpause"], ["--schedule", "@daily"], ["--unpause", "--restore-schedule"]]) {
      expect(parseScheduleArgs(argv), argv.join(" ")).toHaveProperty("error");
    }
  });
});

const BELOW: UsageStatus = { month: "2026-11", estimatedJpy: 9000, hardLimitJpy: 10000 };

function harness(ids: { deploymentId?: string } | null = { deploymentId: "depl_x" }, usage: UsageStatus | null = BELOW) {
  const update = vi.fn(async () => ({ status: "active", schedule: { upcoming_runs_at: ["2026-11-09T07:00:00+09:00"] } }));
  const unpause = vi.fn(async () => ({ status: "active", schedule: { upcoming_runs_at: ["2026-11-09T07:00:00+09:00"] } }));
  const client = { beta: { deployments: { update, unpause } } } as unknown as ScheduleClient;
  let out = "";
  const readUsage = vi.fn(async () => usage);
  return { update, unpause, readUsage, deps: { client, readIds: () => ids, readUsage, write: (s: string) => (out += s) }, out: () => out };
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

  describe("--unpause は、今月の費用が上限を越えている間は断る（S-13）", () => {
    it("上限を越えていれば（以上、ちょうども）戻さず 2。月と金額を出し、--force を案内する", async () => {
      for (const estimatedJpy of [10000, 10600]) {
        const h = harness(undefined, { month: "2026-11", estimatedJpy, hardLimitJpy: 10000 });
        expect(await runScheduleCommand(h.deps, { kind: "unpause" }), String(estimatedJpy)).toBe(2);
        expect(h.unpause).not.toHaveBeenCalled();
        expect(h.out()).toContain("2026-11");
        expect(h.out()).toContain("--force");
      }
    });

    it("今月の費用を確かめられない（null）ときも戻さず 2（確かめられないなら費用を守る側に倒す）", async () => {
      const h = harness(undefined, null);
      expect(await runScheduleCommand(h.deps, { kind: "unpause" })).toBe(2);
      expect(h.unpause).not.toHaveBeenCalled();
      expect(h.out()).toContain("--force");
    });

    it("上限の手前なら戻す", async () => {
      const h = harness(undefined, { month: "2026-12", estimatedJpy: 0, hardLimitJpy: 10000 });
      expect(await runScheduleCommand(h.deps, { kind: "unpause" })).toBe(0);
      expect(h.unpause).toHaveBeenCalledTimes(1);
    });

    it("--force は確かめずに戻す（越えていても、確かめられなくても）。費用を読みにいかない", async () => {
      for (const usage of [{ month: "2026-11", estimatedJpy: 12000, hardLimitJpy: 10000 }, null]) {
        const h = harness(undefined, usage);
        expect(await runScheduleCommand(h.deps, { kind: "unpause", force: true })).toBe(0);
        expect(h.unpause).toHaveBeenCalledWith("depl_x");
        expect(h.readUsage).not.toHaveBeenCalled();
      }
    });

    it("--schedule と --restore-schedule は費用を確かめない", async () => {
      const h = harness(undefined, null);
      expect(await runScheduleCommand(h.deps, { kind: "restore" })).toBe(0);
      expect(h.readUsage).not.toHaveBeenCalled();
    });
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
