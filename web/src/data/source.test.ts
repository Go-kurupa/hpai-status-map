import type { Case, WatchStatus } from "@hpai/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataSource } from "./source";

const FIXTURE_NOW = "2025-12-21T09:00:00+09:00";
const mkCase = (id: string, season: number): Case =>
  ({ id, season, prefCode: "33", muniCode: "33000", muniName: "x", confirmState: "replay" }) as Case;
const mkWatch = (): WatchStatus => ({ prefCode: "33", checkedAt: FIXTURE_NOW, ok: true, lastOkAt: FIXTURE_NOW, failingSince: null });

function setFixture(): void {
  (window as unknown as Record<string, unknown>).__HPAI_FIXTURE__ = {
    now: FIXTURE_NOW,
    cases: [mkCase("a", 2025), mkCase("b", 2024)],
    wildBirds: [],
    watch: [mkWatch()],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as Record<string, unknown>).__HPAI_FIXTURE__;
});

describe("createDataSource", () => {
  it("e2e でなければ __HPAI_FIXTURE__ があっても live", () => {
    setFixture();
    const ds = createDataSource();
    expect(ds.mode).toBe("live");
    expect(Math.abs(ds.now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("e2e でも __HPAI_FIXTURE__ がなければ live", () => {
    vi.stubEnv("MODE", "e2e");
    expect(Math.abs(createDataSource().now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("e2e かつ __HPAI_FIXTURE__ があれば fixture（時計と、シーズンで絞った事例）", async () => {
    vi.stubEnv("MODE", "e2e");
    setFixture();
    const ds = createDataSource();
    expect(ds.now().toISOString()).toBe(new Date(FIXTURE_NOW).toISOString());
    const cases = await new Promise<Case[]>((resolve) => ds.subscribeCases(2025, resolve));
    expect(cases.map((c) => c.id)).toEqual(["a"]);
    const watch = await new Promise<WatchStatus[]>((resolve) => ds.subscribeWatchStatus(resolve));
    expect(watch).toHaveLength(1);
  });

  it("fixture でも解除の後は cb を呼ばない", async () => {
    vi.stubEnv("MODE", "e2e");
    setFixture();
    const cb = vi.fn();
    createDataSource().subscribeCases(2025, cb)();
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).not.toHaveBeenCalled();
  });
});
