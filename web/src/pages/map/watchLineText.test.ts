import { PREFS } from "@hpai/shared/pref";
import type { WatchStatus } from "@hpai/shared/types";
import { describe, expect, it } from "vitest";
import { completeWatchStatus, watchLine } from "./watchLineText";

const NOW = new Date("2026-11-04T09:00:00+09:00");
const okRow = (prefCode: string, checkedAt = "2026-11-04T08:30:00+09:00"): WatchStatus => ({
  prefCode,
  checkedAt,
  ok: true,
  lastOkAt: checkedAt,
  failingSince: null,
});
const failRow = (prefCode: string, checkedAt: string | null = "2026-11-04T08:40:00+09:00"): WatchStatus => ({
  prefCode,
  checkedAt,
  ok: false,
  lastOkAt: null,
  failingSince: "2026-11-04T01:00:00+09:00",
});
const allOk = (): WatchStatus[] => PREFS.map((p) => okRow(p.code));

describe("completeWatchStatus", () => {
  it("空でも 47 行。足りない県は ok:false、checkedAt null", () => {
    const rows = completeWatchStatus([]);
    expect(rows).toHaveLength(47);
    expect(rows.map((r) => r.prefCode)).toEqual(PREFS.map((p) => p.code));
    expect(rows.every((r) => !r.ok && r.checkedAt === null)).toBe(true);
  });

  it("届いた行はそのまま。一覧にない県コードと 47 県の外の行は捨てる", () => {
    const rows = completeWatchStatus([okRow("33"), okRow("99")]);
    expect(rows).toHaveLength(47);
    expect(rows.find((r) => r.prefCode === "33")?.ok).toBe(true);
    expect(rows.find((r) => r.prefCode === "99")).toBeUndefined();
    expect(rows.filter((r) => r.ok)).toHaveLength(1);
  });

  it("同じ県が 2 行あるときは 1 行にまとめ、どちらかが失敗なら失敗", () => {
    const rows = completeWatchStatus([okRow("33"), failRow("33")]);
    expect(rows).toHaveLength(47);
    expect(rows.find((r) => r.prefCode === "33")?.ok).toBe(false);
  });
});

describe("watchLine（§9.7、§2）", () => {
  it("47 県のうち 45 件を確認、2 件は確認できていません（東京都、岡山県）", () => {
    const rows = allOk().map((r) => (r.prefCode === "13" || r.prefCode === "33" ? failRow(r.prefCode) : r));
    const w = watchLine(rows, NOW);
    expect(w.text).toBe("47 都道府県のうち 45 件を確認、2 件は確認できていません（東京都、岡山県）");
    expect(w.failedPrefCodes).toEqual(["13", "33"]);
  });

  it("結果が空でも 0 件を確認、47 件は確認できていません。asOf は null", () => {
    const w = watchLine([], NOW);
    expect(w.text).toMatch(/^47 都道府県のうち 0 件を確認、47 件は確認できていません/);
    expect(w.failedPrefCodes).toHaveLength(47);
    expect(w.text).not.toContain("（"); // 47 県の名前は並べない
    expect(w.asOf).toBeNull();
  });

  it("全県確認なら括弧がない", () => {
    const w = watchLine(allOk(), NOW);
    expect(w.text).toBe("47 都道府県のうち 47 件を確認、0 件は確認できていません");
    expect(w.text).not.toContain("（");
    expect(w.failedPrefCodes).toEqual([]);
  });

  it("33 を ok:false にすると failedPrefCodes に 33 が入り、文に岡山県", () => {
    const w = watchLine(allOk().map((r) => (r.prefCode === "33" ? failRow("33") : r)), NOW);
    expect(w.failedPrefCodes).toContain("33");
    expect(w.text).toContain("岡山県");
  });

  it("6 時間より古い確認は、ok:true でも確認できていない", () => {
    const w = watchLine(allOk().map((r) => (r.prefCode === "01" ? okRow("01", "2026-11-04T02:00:00+09:00") : r)), NOW);
    expect(w.failedPrefCodes).toEqual(["01"]);
    expect(w.text).toContain("北海道");
  });

  it("asOf は checkedAt の最大（失敗の行の最後の試行も含む）。now には動かされない", () => {
    const rows = allOk().map((r) => (r.prefCode === "33" ? failRow("33", "2026-11-04T08:45:00+09:00") : r));
    expect(watchLine(rows, NOW).asOf).toBe("2026-11-04T08:45:00+09:00");
    // now を進めても（6 時間を過ぎて全県が未確認になっても）asOf は checkedAt のまま
    const later = new Date("2026-11-04T20:00:00+09:00");
    const w = watchLine(rows, later);
    expect(w.asOf).toBe("2026-11-04T08:45:00+09:00");
    expect(w.failedPrefCodes).toHaveLength(47);
  });

  it("読めない checkedAt は asOf に使わない。すべて読めなければ null", () => {
    expect(watchLine([okRow("01", "not-a-date")], NOW).asOf).toBeNull();
    expect(watchLine([okRow("01", "not-a-date"), okRow("02", "2026-11-04T08:00:00+09:00")], NOW).asOf).toBe("2026-11-04T08:00:00+09:00");
  });

  it("未来の checkedAt（時計のずれ）は asOf に使わない。summarizeWatch が未確認にするのと同じ", () => {
    const rows = allOk().map((r) => (r.prefCode === "13" ? okRow("13", "2026-11-04T10:00:00+09:00") : r));
    const w = watchLine(rows, NOW);
    expect(w.asOf).toBe("2026-11-04T08:30:00+09:00");
    expect(w.failedPrefCodes).toEqual(["13"]);
    expect(watchLine([okRow("13", "2026-11-04T10:00:00+09:00")], NOW).asOf).toBeNull();
  });

  it("確認できた県の数 okCount を返す（全件失敗のとき、時刻を『時点』と読ませないために使う）", () => {
    expect(watchLine(allOk(), NOW).okCount).toBe(47);
    expect(watchLine([], NOW).okCount).toBe(0);
    expect(watchLine(PREFS.map((p) => failRow(p.code)), NOW).okCount).toBe(0);
  });
});
