import { createGeoStore, type GeoStore } from "@hpai/shared/geo";
import type { HistoryCase } from "@hpai/shared/types";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import { usePast } from "./useTownView";

const geo: GeoStore = createGeoStore({
  index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
  adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
  loadPrefTopo: () => Promise.reject(new Error("unused")),
});

const row = (o: Partial<HistoryCase> = {}): HistoryCase => ({
  season: 2025,
  no: 8,
  prefCode: "33",
  muniCode: "33203",
  muniNameThen: "津山市",
  date: "2025-12-20",
  birdUse: null,
  housing: null,
  headCount: 1000,
  sourceUrl: "https://example.invalid/a",
  related: false,
  ...o,
});

const base = { town: "33214", history: [row()], historyFailed: false, geo, geoFailed: false, current: 2026 };

describe("usePast（過去の 1 文。失敗を『発生なし』に見せない）", () => {
  it("読めているときは ready（真庭市の隣の津山市の発生）", () => {
    const { result } = renderHook(() => usePast(base));
    expect(result.current.status).toBe("ready");
  });

  it("索引にない市町村の町は、『発生なし』ではなく failed", () => {
    const { result } = renderHook(() => usePast({ ...base, town: "99999" }));
    expect(result.current.status).toBe("failed");
  });

  it("describePast が投げても、ページを落とさず failed（町か隣町に、壊れたシーズンの行がある）", () => {
    // 2024.5 は整数でなく、今季より前なので describePast が seasonAgoLabel まで進んで RangeError になる
    const { result } = renderHook(() => usePast({ ...base, history: [row({ season: 2024.5 })] }));
    expect(result.current.status).toBe("failed");
  });

  it("町と関係のない壊れた行では投げない（上の試験が空振りでないことの対）", () => {
    const { result } = renderHook(() => usePast({ ...base, history: [row({ season: 2024.5, muniCode: "01100" })] }));
    expect(result.current.status).toBe("ready");
  });

  it("町が未選択なら idle、読み込み前は loading、失敗は failed", () => {
    expect(renderHook(() => usePast({ ...base, town: null })).result.current.status).toBe("idle");
    expect(renderHook(() => usePast({ ...base, history: null })).result.current.status).toBe("loading");
    expect(renderHook(() => usePast({ ...base, historyFailed: true })).result.current.status).toBe("failed");
  });
});
