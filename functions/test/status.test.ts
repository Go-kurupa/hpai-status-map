import { describe, expect, it } from "vitest";
import { summarizeWatch } from "@hpai/shared/level";
import { PREFS } from "@hpai/shared/pref";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { computeWatchStatuses, shouldAlertFailing, watchFailingItem } from "../src/watch/status";

const NOW = new Date("2026-11-05T03:00:00Z"); // JST 12:00
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function src(id: string, prefCode: string | null, o: Partial<Source> = {}): Source {
  return {
    id,
    prefCode,
    url: `https://www.pref.example.jp/${id}`,
    kind: "pref_fixed",
    confirmedOn: "2026-11-03",
    note: null,
    group: 0,
    enabled: true,
    lastCheckedAt: iso(30),
    lastOkAt: iso(30),
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 0,
    ...o,
  };
}
const one = (list: Source[], code: string, prev: WatchStatus[] = []) => computeWatchStatuses(list, prev, NOW).find((s) => s.prefCode === code)!;

describe("computeWatchStatuses", () => {
  it("47 件を返し、入口のない県も含む", () => {
    const all = computeWatchStatuses([], [], NOW);
    expect(all.map((s) => s.prefCode)).toEqual(PREFS.map((p) => p.code));
  });
  it("入口がすべて成功なら ok、checkedAt は入口の中でいちばん古い確認の時刻、failingSince は null", () => {
    const s = one([src("a", "33", { lastCheckedAt: iso(10) }), src("b", "33", { lastCheckedAt: iso(120) })], "33");
    expect(s).toEqual({ prefCode: "33", ok: true, checkedAt: "2026-11-05T10:00:00+09:00", lastOkAt: "2026-11-05T10:00:00+09:00", failingSince: null });
  });
  it("1 つでも失敗なら ok:false。failingSince は今になる", () => {
    const s = one([src("a", "33"), src("b", "33", { failureCount: 1 })], "33");
    expect(s.ok).toBe(false);
    expect(s.failingSince).toBe("2026-11-05T12:00:00+09:00");
  });
  it("有効な入口がない県は ok:false で checkedAt は null（無効の入口は数えない）", () => {
    const s = one([src("a", "33", { enabled: false })], "33");
    expect(s).toMatchObject({ ok: false, checkedAt: null });
    expect(one([], "34")).toMatchObject({ ok: false, checkedAt: null });
  });
  describe("まだ回っていない入口（lastCheckedAt:null かつ failureCount:0）は判定から外す", () => {
    const unchecked = (id: string) => src(id, "33", { lastCheckedAt: null, lastOkAt: null });
    it("3 組にまたがる県で、1 組だけ回って成功なら ok:true（回っていない入口は数えない）", () => {
      const s = one([src("a", "33", { group: 0, lastCheckedAt: iso(10) }), unchecked("b"), unchecked("c")], "33");
      expect(s).toEqual({ prefCode: "33", ok: true, checkedAt: "2026-11-05T11:50:00+09:00", lastOkAt: "2026-11-05T11:50:00+09:00", failingSince: null });
    });
    it("1 組が失敗なら ok:false で failingSince がある（回っていない入口があっても）", () => {
      const s = one([src("a", "33", { group: 0, failureCount: 1 }), unchecked("b"), unchecked("c")], "33");
      expect(s.ok).toBe(false);
      expect(s.failingSince).toBe("2026-11-05T12:00:00+09:00");
    });
    it("成功した入口と失敗した入口が混ざれば ok:false", () => {
      expect(one([src("a", "33"), src("b", "33", { failureCount: 2 }), unchecked("c")], "33").ok).toBe(false);
    });
    it("全部未確認なら ok:false、checkedAt:null、failingSince:null（前の failingSince も引き継がない）", () => {
      const prev: WatchStatus = { prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: iso(600) };
      expect(one([unchecked("a"), unchecked("b"), unchecked("c")], "33")).toEqual({ prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: null });
      expect(one([unchecked("a")], "33", [prev]).failingSince).toBeNull();
    });
    it("未確認だけの県は 24 時間たっても警告しない", () => {
      const s = one([unchecked("a")], "33");
      expect(shouldAlertFailing(s, new Date(NOW.getTime() + 48 * 3_600_000))).toBe(false);
    });
  });
  it("国の入口（prefCode null）は県に数えない", () => {
    const list = [src("m", null, { failureCount: 5 }), src("a", "33")];
    expect(one(list, "33").ok).toBe(true);
  });
  it("failingSince は最初の時刻を保ち、成功で null に戻る", () => {
    const prev: WatchStatus = { prefCode: "33", ok: false, checkedAt: iso(500), lastOkAt: iso(900), failingSince: iso(600) };
    const still = one([src("a", "33", { failureCount: 3 })], "33", [prev]);
    expect(still.failingSince).toBe(prev.failingSince);
    expect(still.lastOkAt).toBe(prev.lastOkAt);
    const recovered = one([src("a", "33")], "33", [prev]);
    expect(recovered).toMatchObject({ ok: true, failingSince: null });
  });
  it("未来の時刻や読めない時刻は書かない（その入口は未確認として ok にしない）", () => {
    const future = one([src("a", "33", { lastCheckedAt: new Date(NOW.getTime() + 3_600_000).toISOString() })], "33");
    expect(future.ok).toBe(false);
    expect(future.checkedAt === null || Date.parse(future.checkedAt) <= NOW.getTime()).toBe(true);
    expect(one([src("a", "33", { lastCheckedAt: "壊れた時刻" })], "33").ok).toBe(false);
    const prevFuture: WatchStatus = { prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: new Date(NOW.getTime() + 3_600_000).toISOString() };
    expect(Date.parse(one([src("a", "33", { failureCount: 1 })], "33", [prevFuture]).failingSince!)).toBeLessThanOrEqual(NOW.getTime());
  });
  it("summarizeWatch に通すと、失敗した県が failedPrefCodes に入る（TLS の失敗も回避しない）", () => {
    const all = computeWatchStatuses([src("a", "33"), src("b", "34", { failureCount: 2 })], [], NOW);
    const sum = summarizeWatch(all, NOW);
    expect(sum.failedPrefCodes).toContain("34");
    expect(sum.failedPrefCodes).not.toContain("33");
    expect(sum.okCount).toBe(1);
  });
});

describe("shouldAlertFailing: 24 時間", () => {
  const st = (ago: number | null): WatchStatus => ({ prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: ago === null ? null : iso(ago) });
  it("23 時間 59 分では知らせず、24 時間で知らせる", () => {
    expect(shouldAlertFailing(st(24 * 60 - 1), NOW)).toBe(false);
    expect(shouldAlertFailing(st(24 * 60), NOW)).toBe(true);
    expect(shouldAlertFailing(st(48 * 60), NOW)).toBe(true);
  });
  it("失敗していなければ知らせない", () => {
    expect(shouldAlertFailing(st(null), NOW)).toBe(false);
    expect(shouldAlertFailing({ ...st(30 * 60), ok: true }, NOW)).toBe(false);
  });
});

describe("watchFailingItem", () => {
  it("失敗の期間ごとに別の id（/ を含まない）。同じ期間は同じ id", () => {
    const a: WatchStatus = { prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: "2026-11-04T09:00:00+09:00" };
    const b = { ...a, failingSince: "2026-11-10T09:00:00+09:00" };
    const ia = watchFailingItem(a, NOW)!;
    expect(ia).toMatchObject({ kind: "alert", alert: "watch_failing", prefCode: "33", caseId: null });
    expect(ia.id).not.toContain("/");
    expect(watchFailingItem(a, NOW)!.id).toBe(ia.id);
    expect(watchFailingItem(b, NOW)!.id).not.toBe(ia.id);
    expect(ia.kind === "alert" && ia.message).toContain("岡山");
  });
});
