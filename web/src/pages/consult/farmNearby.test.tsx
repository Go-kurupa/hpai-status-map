// 相談の条件の「近くの発生の状況」。対策項目（resolveTodo の段階 ①）と地図（casesWithinBand の約 60 km）と同じ部品で作り、読めないときは送らない。
import { createGeoStore, type GeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import type { Case, FarmPoint, WatchStatus } from "@hpai/shared/types";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { DataSourceProvider } from "../../data/context";
import type { DataSource } from "../../data/types";
import { casesWithinBand } from "../map/overviewCounts";
import { resolveTodo } from "../todo/todoModel";

const geoBox = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../geo/loadGeo", () => ({ loadWebGeoStore: () => geoBox.load() }));

import { nearbyOfFarm, useFarmPlace } from "./farmNearby";

const NOW = new Date("2026-11-08T03:00:00Z");
const SEASON = 2026;
// 津山市のあたり（試験の地点）
const POINT: FarmPoint = { meshCode: latLngToMesh3(35.07, 134.0), muniCode: "33203", frequentMuniCodes: [] };

function geoStore(failPrefs = false): GeoStore {
  return createGeoStore({
    index: indexJson as unknown as GeoStore["index"],
    adjacency: adjacencyJson as GeoStore["adjacency"],
    loadPrefTopo: async (p) => {
      if (failPrefs) throw new Error("読み込めない");
      return JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../data/geo/pref", `${p}.topo.json`), "utf8")) as unknown;
    },
  });
}

function mkCase(o: Partial<Case> = {}): Case {
  return {
    id: "c1",
    season: SEASON,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-02", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-02T12:00:00+09:00",
    ...o,
  };
}

const okWatch = (prefCode: string): WatchStatus => ({ prefCode, checkedAt: "2026-11-08T11:00:00+09:00", ok: true, lastOkAt: "2026-11-08T11:00:00+09:00", failingSince: null });

afterEach(cleanup);

describe("nearbyOfFarm（対策項目と地図と同じ部品）", () => {
  it("同じ町の発生は区域に入っている可能性あり（段階 ①）。件数は今季の数える事例のうち約 60 km 以内だけ（遠い町・確認中・前のシーズンは数えない）", async () => {
    const cases = [
      mkCase({ id: "same" }),
      mkCase({ id: "far", prefCode: "01", muniCode: "01100", muniName: "札幌市" }),
      mkCase({ id: "reviewing", confirmState: "reviewing" }),
      mkCase({ id: "last", season: SEASON - 1 }),
    ];
    const geo = geoStore();
    const got = await nearbyOfFarm({ point: POINT, cases, season: SEASON, geo });
    expect(got).toEqual({ casesWithin60km: 1, zone: "possible" });
    // 地図の件数と対策項目の段階と、同じ値になる
    const now = cases.filter((c) => c.season === SEASON && c.confirmState !== "reviewing");
    expect(got.casesWithin60km).toBe(await casesWithinBand(POINT.meshCode, now, geo));
    expect((await resolveTodo({ spot: POINT, cases, season: SEASON, geo })).level.level).toBe(1);
  });

  it("発生がなければ 0 件・可能性は見つかっていない（読めているときの 0 件）", async () => {
    expect(await nearbyOfFarm({ point: POINT, cases: [], season: SEASON, geo: geoStore() })).toEqual({ casesWithin60km: 0, zone: "none" });
  });

  it("県の形を読めないときは投げる（0 件にしない）", async () => {
    await expect(nearbyOfFarm({ point: POINT, cases: [mkCase()], season: SEASON, geo: geoStore(true) })).rejects.toThrow();
  });
});

describe("useFarmPlace（登録した農場の地点から作る。読めないときは送らない）", () => {
  const sub: { cases: Case[] | null; watch: WatchStatus[] | null; casesCalls: number } = { cases: null, watch: null, casesCalls: 0 };
  const ds: DataSource = {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s, cb) => {
      sub.casesCalls += 1;
      if (sub.cases) cb(sub.cases);
      return () => {};
    },
    subscribeWildBirds: () => () => {},
    subscribeWatchStatus: (cb) => {
      if (sub.watch) cb(sub.watch);
      return () => {};
    },
    loadHistory: async () => [],
  };
  const wrapper = ({ children }: { children: ReactNode }) => <DataSourceProvider value={ds}>{children}</DataSourceProvider>;

  beforeEach(() => {
    sub.cases = [mkCase()];
    sub.watch = [okWatch("33")];
    sub.casesCalls = 0;
    geoBox.load.mockReset().mockResolvedValue(geoStore());
  });

  it("読めれば ready（件数と区域の可能性）と町の名前", async () => {
    const { result } = renderHook(() => useFarmPlace(POINT), { wrapper });
    await waitFor(() => expect(result.current.nearby.status).toBe("ready"));
    expect(result.current).toEqual({ nearby: { status: "ready", nearby: { casesWithin60km: 1, zone: "possible" } }, townName: "岡山県津山市" });
  });

  it("農場の県の発表を確認できていない（見回りの結果がない・古い・失敗）ときは送らない（unavailable）", async () => {
    for (const watch of [[], [okWatch("13")], [{ ...okWatch("33"), checkedAt: "2026-11-07T00:00:00+09:00" }], [{ ...okWatch("33"), ok: false }]]) {
      sub.watch = watch;
      const { result, unmount } = renderHook(() => useFarmPlace(POINT), { wrapper });
      await waitFor(() => expect(result.current.nearby.status).toBe("unavailable"));
      unmount();
    }
  });

  it("事例・見回りがまだ届かない間は loading（0 件と言わない）", async () => {
    sub.cases = null;
    const { result } = renderHook(() => useFarmPlace(POINT), { wrapper });
    await waitFor(() => expect(result.current.townName).toBe("岡山県津山市"));
    expect(result.current.nearby).toEqual({ status: "loading" });
  });

  it("地理を読めないときは unavailable で、町の名前は null", async () => {
    geoBox.load.mockReset().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useFarmPlace(POINT), { wrapper });
    await waitFor(() => expect(result.current.nearby.status).toBe("unavailable"));
    expect(result.current.townName).toBeNull();
  });

  it("地点がない（農場なし）ときは何も読まない", async () => {
    const { result } = renderHook(() => useFarmPlace(null), { wrapper });
    expect(result.current).toEqual({ nearby: { status: "unavailable" }, townName: null });
    expect(geoBox.load).not.toHaveBeenCalled();
    expect(sub.casesCalls).toBe(0);
  });
});
