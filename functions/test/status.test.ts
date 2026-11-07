import { describe, expect, it } from "vitest";
import { summarizeWatch } from "@hpai/shared/level";
import { PREFS } from "@hpai/shared/pref";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { computeWatchStatuses, isRecovered, shouldAlertFailing, watchFailingItem } from "../src/watch/status";

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
  it("1 つでも 2 回続けて失敗した入口があれば ok:false。failingSince は、前の状態も入口の時刻もなければ今になる", () => {
    const s = one([src("a", "33"), src("b", "33", { failureCount: 2 })], "33");
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
    it("1 組が 2 回続けて失敗なら ok:false で failingSince がある（回っていない入口があっても）", () => {
      const s = one([src("a", "33", { group: 0, failureCount: 2 }), unchecked("b"), unchecked("c")], "33");
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
  it("未来の時刻や読み込めない時刻は書かない（その入口は未確認として ok にしない）", () => {
    const future = one([src("a", "33", { lastCheckedAt: new Date(NOW.getTime() + 3_600_000).toISOString() })], "33");
    expect(future.ok).toBe(false);
    expect(future.checkedAt === null || Date.parse(future.checkedAt) <= NOW.getTime()).toBe(true);
    expect(one([src("a", "33", { lastCheckedAt: "壊れた時刻" })], "33").ok).toBe(false);
    const prevFuture: WatchStatus = { prefCode: "33", ok: false, checkedAt: null, lastOkAt: null, failingSince: new Date(NOW.getTime() + 3_600_000).toISOString() };
    expect(Date.parse(one([src("a", "33", { failureCount: 2 })], "33", [prevFuture]).failingSince!)).toBeLessThanOrEqual(NOW.getTime());
    const futureSince = one([src("a", "33", { failureCount: 2, failingSince: new Date(NOW.getTime() + 3_600_000).toISOString() })], "33");
    expect(futureSince.failingSince).toBe("2026-11-05T12:00:00+09:00"); // 入口の未来の時刻も使わない
  });
  it("summarizeWatch に通すと、失敗した県が failedPrefCodes に入る（TLS の失敗も回避しない）", () => {
    const all = computeWatchStatuses([src("a", "33"), src("b", "34", { failureCount: 2 })], [], NOW);
    const sum = summarizeWatch(all, NOW);
    expect(sum.failedPrefCodes).toContain("34");
    expect(sum.failedPrefCodes).not.toContain("33");
    expect(sum.okCount).toBe(1);
  });
});

describe("2 回続けて失敗したら確認できていない（1 回だけの失敗では公開の表示を変えない）", () => {
  const J = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  const jst = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000 + 9 * 3_600_000).toISOString().slice(0, 19) + "+09:00";
  // 3 時間ごとの見回り: 3 時間 30 分前に読み込めて、30 分前に 1 回目の失敗
  const firstFail = (id: string, o: Partial<Source> = {}) => src(id, "33", { failureCount: 1, lastOkAt: J(210), lastCheckedAt: J(30), failingSince: J(30), ...o });

  it("1 回目の失敗は ok のまま、failingSince は null。checkedAt は前に読み込めた時刻。summarizeWatch でも失敗に数えない", () => {
    const s = one([firstFail("a")], "33");
    expect(s).toEqual({ prefCode: "33", ok: true, checkedAt: jst(210), lastOkAt: jst(210), failingSince: null });
    expect(shouldAlertFailing(s, NOW)).toBe(false);
    expect(summarizeWatch(computeWatchStatuses([firstFail("a")], [], NOW), NOW).failedPrefCodes).not.toContain("33");
  });
  it("2 回目の失敗で ok:false、failingSince は 1 回目の失敗の時刻（入口の failingSince）", () => {
    const s = one([src("a", "33", { failureCount: 2, lastOkAt: J(390), lastCheckedAt: J(30), failingSince: J(210) })], "33");
    expect(s).toMatchObject({ ok: false, checkedAt: jst(30), failingSince: jst(210) });
  });
  it("成功すれば数え直し（ok、failingSince は null）。前の状態の failingSince も引き継がない", () => {
    const prev: WatchStatus = { prefCode: "33", ok: false, checkedAt: J(200), lastOkAt: J(600), failingSince: J(400) };
    expect(one([src("a", "33", { lastCheckedAt: J(10), lastOkAt: J(10) })], "33", [prev])).toMatchObject({ ok: true, failingSince: null });
  });
  it("24 時間の知らせは 1 回目の失敗から数える（決まりは変えない）", () => {
    const s = one([src("a", "33", { failureCount: 9, lastOkAt: J(25 * 60), lastCheckedAt: J(10), failingSince: J(24 * 60) })], "33");
    expect(s.failingSince).toBe(jst(24 * 60));
    expect(shouldAlertFailing(s, NOW)).toBe(true);
    expect(shouldAlertFailing(s, new Date(NOW.getTime() - 60_000))).toBe(false);
  });
  it("前の状態の failingSince があれば、入口の時刻より前の状態を保つ（同じ失敗の期間）", () => {
    const prev: WatchStatus = { prefCode: "33", ok: false, checkedAt: J(200), lastOkAt: J(600), failingSince: J(400) };
    expect(one([src("a", "33", { failureCount: 3, failingSince: J(300) })], "33", [prev]).failingSince).toBe(prev.failingSince);
  });
  it("一度も読み込めていない入口は、1 回目の失敗で ok:false（慎重な側）。failingSince はその失敗の時刻", () => {
    const s = one([firstFail("a", { lastOkAt: null })], "33");
    expect(s).toMatchObject({ ok: false, failingSince: jst(30) });
  });
  it("前に読み込めたのが 24 時間より前なら、1 回目の失敗でも ok:false（見回りが長く止まった後の失敗）", () => {
    expect(one([firstFail("a", { lastOkAt: J(24 * 60 + 1) })], "33").ok).toBe(false);
    expect(one([firstFail("a", { lastOkAt: J(24 * 60) })], "33").ok).toBe(true);
  });
  it("前に読み込めた時刻が壊れている・未来なら、1 回目の失敗でも ok:false", () => {
    expect(one([firstFail("a", { lastOkAt: "壊れた時刻" })], "33").ok).toBe(false);
    expect(one([firstFail("a", { lastOkAt: new Date(NOW.getTime() + 60_000).toISOString() })], "33").ok).toBe(false);
  });
  it("入口が複数: 1 つが 1 回目の失敗で、ほかが成功なら ok のまま", () => {
    expect(one([firstFail("a"), src("b", "33", { lastCheckedAt: J(90), lastOkAt: J(90) })], "33")).toMatchObject({ ok: true, checkedAt: jst(210), failingSince: null });
  });
  it("入口が複数: 2 つの入口がそれぞれ 1 回目の失敗なら、県として 2 回続けて読み込めていないので ok:false。failingSince は早い方", () => {
    const s = one([firstFail("a", { failingSince: J(30) }), firstFail("b", { lastCheckedAt: J(90), failingSince: J(90) })], "33");
    expect(s).toMatchObject({ ok: false, failingSince: jst(90) });
  });
  it("入口が複数: 同じ回（1 回目の失敗の時刻が 30 分の幅）に 2 つとも 1 回目の失敗なら、県として 1 回なので ok のまま", () => {
    const pair = (bAgo: number) => [firstFail("a", { lastCheckedAt: J(30), failingSince: J(30) }), firstFail("b", { lastCheckedAt: J(bAgo), failingSince: J(bAgo) })];
    expect(one(pair(31), "33")).toMatchObject({ ok: true, checkedAt: jst(210), failingSince: null });
    expect(one(pair(60), "33").ok).toBe(true); // ちょうど 30 分は同じ回
    expect(one(pair(61), "33")).toMatchObject({ ok: false, failingSince: jst(61) }); // 30 分 1 秒以上離れたら別の回
  });
  it("1 回目の失敗の後、次の同じ組の見回り（読み込めてから 6 時間 30 分）まで、summarizeWatch でも確認できたに数える", () => {
    // 6 時間 30 分前に読み込めて、3 時間 30 分前に 1 回目の失敗。次の見回りの記録はまだ
    const s = computeWatchStatuses([firstFail("a", { lastOkAt: J(390), lastCheckedAt: J(210), failingSince: J(210) })], [], NOW);
    expect(summarizeWatch(s, NOW).failedPrefCodes).not.toContain("33");
  });
  it("入口が複数: 1 つが 2 回続けて失敗なら、ほかが成功でも ok:false", () => {
    expect(one([src("a", "33", { failureCount: 2, failingSince: J(200) }), src("b", "33")], "33")).toMatchObject({ ok: false, failingSince: jst(200) });
  });
  it("欄が無い古い入口: 1 回目の失敗は ok のまま。2 回目以降は前の状態か今を failingSince にする", () => {
    const legacy = (o: Partial<Source>) => {
      const x = firstFail("a", o);
      delete x.failingSince;
      return x;
    };
    expect(one([legacy({})], "33").ok).toBe(true);
    expect(one([legacy({ lastOkAt: null })], "33").failingSince).toBe(jst(30)); // 1 回目の失敗は最後の確認の時刻
    expect(one([legacy({ failureCount: 2 })], "33").failingSince).toBe("2026-11-05T12:00:00+09:00");
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

describe("isRecovered: 見回りの失敗の知らせを自動で閉じてよいか", () => {
  const st = (o: Partial<WatchStatus>): WatchStatus => ({ prefCode: "34", ok: true, checkedAt: iso(30), lastOkAt: iso(30), failingSince: null, ...o });
  it("ok で、確認が 24 時間以内（ちょうど 24 時間も含む）なら閉じてよい", () => {
    expect(isRecovered(st({}), NOW)).toBe(true);
    expect(isRecovered(st({ checkedAt: iso(24 * 60) }), NOW)).toBe(true);
  });
  it("失敗中（ok:false）は閉じない", () => {
    expect(isRecovered(st({ ok: false, failingSince: iso(60 * 30) }), NOW)).toBe(false);
  });
  it("ok でも、確認が 24 時間より古い・読み込めない・未来・無いなら閉じない（見回り全体が止まっている）", () => {
    expect(isRecovered(st({ checkedAt: iso(24 * 60 + 1) }), NOW)).toBe(false);
    expect(isRecovered(st({ checkedAt: "壊れた時刻" }), NOW)).toBe(false);
    expect(isRecovered(st({ checkedAt: iso(-60) }), NOW)).toBe(false);
    expect(isRecovered(st({ checkedAt: null }), NOW)).toBe(false);
  });
});
