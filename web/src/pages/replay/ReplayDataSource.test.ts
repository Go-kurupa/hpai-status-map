import { toJstIso } from "@hpai/shared/dates";
import { summarizeWatch } from "@hpai/shared/level";
import { casesAt, eventStage, REPLAY_SEASON, replayNowAt, timeLabel, virtualNow, type ReplayScenario } from "@hpai/shared/replay";
import { currentSeason } from "@hpai/shared/season";
import type { Case, HistoryCase, WatchStatus, WildBird } from "@hpai/shared/types";
import { describe, expect, it, vi } from "vitest";
import scenarioJson from "../../../../data/replay/scenario.json";
import { ReplayDataSource } from "./ReplayDataSource";

const scenario = scenarioJson as unknown as ReplayScenario;
const flush = () => new Promise<void>((r) => queueMicrotask(r));
const make = () => new ReplayDataSource(scenario, () => Promise.resolve([] as HistoryCase[]));

describe("ReplayDataSource", () => {
  it("mode は replay。起動時は order 0 で、事例は 0 件、時計は 2025 シーズンの中", async () => {
    const ds = make();
    expect(ds.mode).toBe("replay");
    expect(ds.currentOrder()).toBe(0);
    let got: Case[] | null = null;
    ds.subscribeCases(REPLAY_SEASON, (c) => (got = c));
    await flush();
    expect(got).toEqual([]);
    expect(currentSeason(ds.now())).toBe(2025);
    expect(ds.now().getTime()).toBe(replayNowAt(scenario, 0).getTime());
  });

  it("seek すると、購読している画面に order までの事例を渡し、now が出来事の時刻に進む", async () => {
    const ds = make();
    const seen: Case[][] = [];
    ds.subscribeCases(REPLAY_SEASON, (c) => seen.push(c));
    await flush();
    ds.seek(3);
    expect(ds.currentOrder()).toBe(3);
    expect(seen[seen.length - 1]).toEqual(casesAt(scenario, 3));
    expect(ds.now().getTime()).toBe(virtualNow(scenario.events[2]!).getTime());
    ds.seek(scenario.events.length);
    expect(seen[seen.length - 1]).toHaveLength(4);
    ds.seek(0);
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it("season が 2025 以外は、いつでも空", async () => {
    const ds = make();
    const cases: Case[][] = [];
    const birds: WildBird[][] = [];
    ds.subscribeCases(2024, (c) => cases.push(c));
    ds.subscribeWildBirds(2024, (b) => birds.push(b));
    await flush();
    ds.seek(scenario.events.length);
    expect(cases.every((c) => c.length === 0)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    expect(birds.every((b) => b.length === 0)).toBe(true);
    const own: WildBird[][] = [];
    ds.subscribeWildBirds(2025, (b) => own.push(b));
    await flush();
    expect(own[0]).toEqual([]);
  });

  it("time が null の出来事の now は、その日の 23:59:59 JST。timeLabel は『時刻の記載なし』", () => {
    const ds = make();
    const e = scenario.events.find((x) => x.time === null)!;
    ds.seek(e.order);
    expect(toJstIso(ds.now())).toBe(`${e.date}T23:59:59+09:00`);
    expect(timeLabel(e)).toBe("時刻の記載なし");
  });

  it("time がある出来事の now は、その時刻（津山の確定は 09:00）", () => {
    const ds = make();
    const e = scenario.events.find((x) => eventStage(x) === "confirmed" && x.caseAfter.muniCode === "33203")!;
    ds.seek(e.order);
    expect(toJstIso(ds.now())).toBe("2025-12-20T09:00:00+09:00");
  });

  it("範囲の外の seek は RangeError。currentOrder は変わらない", () => {
    const ds = make();
    ds.seek(2);
    expect(() => ds.seek(-1)).toThrow(RangeError);
    expect(() => ds.seek(scenario.events.length + 1)).toThrow(RangeError);
    expect(() => ds.seek(1.2)).toThrow(RangeError);
    expect(ds.currentOrder()).toBe(2);
  });

  it("見回りの状況は seek のたびに届き、どの時点でも 47 県のうち 23 だけが確認できていない（時刻は再生の時刻に合わせる）", async () => {
    const ds = make();
    const seen: WatchStatus[][] = [];
    ds.subscribeWatchStatus((w) => seen.push(w));
    await flush();
    for (let o = 0; o <= scenario.events.length; o++) {
      ds.seek(o);
      const w = seen[seen.length - 1]!;
      expect(w).toHaveLength(47);
      expect(summarizeWatch(w, ds.now()).failedPrefCodes, `order ${o}`).toEqual(["23"]);
    }
  });

  it("購読を解除すると、それ以後は届かない。順序の購読（画面の帯用）もできる", async () => {
    const ds = make();
    const cb = vi.fn();
    const off = ds.subscribeCases(REPLAY_SEASON, cb);
    await flush();
    cb.mockClear();
    off();
    ds.seek(1);
    expect(cb).not.toHaveBeenCalled();

    const orders = vi.fn();
    const offOrder = ds.subscribeOrder(orders);
    ds.seek(2);
    expect(orders).toHaveBeenCalledTimes(1);
    offOrder();
    ds.seek(3);
    expect(orders).toHaveBeenCalledTimes(1);
  });

  it("購読をすぐ解除すると、最初の配信も届かない", async () => {
    const ds = make();
    const cb = vi.fn();
    ds.subscribeCases(REPLAY_SEASON, cb)();
    await flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it("loadHistory は渡された関数をそのまま呼ぶ（過去 6 シーズンは本物の記録）", async () => {
    const rows = [{ season: 2024, no: 1 }] as unknown as HistoryCase[];
    const load = vi.fn(() => Promise.resolve(rows));
    const ds = new ReplayDataSource(scenario, load);
    expect(load).not.toHaveBeenCalled();
    await expect(ds.loadHistory()).resolves.toBe(rows);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
