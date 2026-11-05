import { findForbiddenPhrases, findWordingViolations } from "@hpai/shared/wording";
import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { createGeoStore } from "@hpai/shared/geo";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSourceProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource } from "../../data/types";
import { SPOT_KEY } from "../../data/spot";
import { TEXT } from "./texts";

// WebGL2 が使えない端末では、MapLibre の初期化が投げる。それを再現する
vi.mock("../../geo/maplibre", () => {
  class MlMap {
    constructor() {
      throw new Error("GPUInitializationError: WebGL2 is required to display this map");
    }
  }
  return { MlMap, AttributionControl: class {}, Marker: class {} };
});
// 代わりの地図が読む形は、実データを fs から読む偽に替える
vi.mock("../../geo/loadGeo", () => {
  const dir = path.resolve(import.meta.dirname, "../../../../data/geo");
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown;
  const store = createGeoStore({
    index: read("muni-index.json") as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: read("adjacency.json") as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => read(`pref/${p}.topo.json`),
  });
  return {
    loadWebGeoStore: () => Promise.resolve(store),
    loadJapanTopo: () => Promise.resolve(read("japan.topo.json")),
    loadPrefAnchors: () => Promise.resolve(read("pref-anchors.json")),
  };
});

import MapPage from "./MapPage";

const NOW = new Date("2026-11-04T09:00:00+09:00");
const ds: DataSource = {
  mode: "live",
  now: () => NOW,
  subscribeCases: (_s: Season, cb: (c: Case[]) => void) => {
    cb([]);
    return () => {};
  },
  subscribeWildBirds: (_s: Season, cb) => {
    cb([]);
    return () => {};
  },
  subscribeWatchStatus: (cb: (w: WatchStatus[]) => void) => {
    cb([]);
    return () => {};
  },
  loadHistory: () => Promise.resolve([] as HistoryCase[]),
};

// 地図と代わりの地図は別の chunk（lazy）。読み込みの速さではなく描画の結果を確かめるので、先に読んでおく。
// 読まずに始めると、負荷の高いときに最初の試験だけ、読み込みの間に findBy の待ちが切れる
beforeAll(async () => {
  await Promise.all([import("./MapView"), import("./SvgMap")]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount() {
  return render(
    <MemoryRouter>
      <DataSourceProvider value={ds}>
        <SpotProvider>
          <MapPage />
        </SpotProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

describe("WebGL2 が使えない端末", () => {
  it("画面が落ちず、境の線だけの代わりの地図と 1 行の注記が出て、地図以外の内容も見える", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
    expect(within(map).getAllByRole("button")).toHaveLength(47);
    expect(screen.getByText(TEXT.svgMapNote, { exact: false })).toBeTruthy();
    // 地図以外（シーズンの棒、見回りの確認、固定のリンク）が残っている
    expect(screen.getByRole("button", { name: /今季/ })).toBeTruthy();
    expect(screen.getByTestId("watch-line")).toBeTruthy();
    // 禁句と英語のエラー名は出さない。ブラウザの設定を変えてもらう案内も出さない
    const text = document.body.textContent ?? "";
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(findWordingViolations(TEXT.svgMapNote)).toEqual([]);
    expect(text).not.toMatch(/WebGL|GPUInitializationError|ハードウェアアクセラレーション/);
  });

  it("地点があれば、代わりの地図にも距離の輪を描き、輪の断りを出す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(SPOT_KEY, JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] }));
    mount();
    const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
    expect(map.querySelectorAll(".svg-ring")).toHaveLength(3);
    expect(screen.getByText(TEXT.ringNote)).toBeTruthy();
  });

  it("「町を選ぶ」の後、県を押して市町村を押すと、その町が自分の町になる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    const japan = await screen.findByRole("group", { name: TEXT.svgMapAria });
    fireEvent.click(screen.getByRole("button", { name: TEXT.pickTown }));
    fireEvent.click(within(japan).getByRole("button", { name: /^岡山県/ }));
    const muni = await screen.findByRole("group", { name: /岡山県の市町村/ });
    fireEvent.click(await within(muni).findByRole("button", { name: /^西粟倉村/ }));
    expect((await screen.findByText("西粟倉村", { selector: "strong" })).textContent).toBe("西粟倉村");
  });

  it("「くわしい場所を決める」は、十字ではなく町の中心あたりのマス目を使うボタンになり、この端末に保存する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mount();
    const japan = await screen.findByRole("group", { name: TEXT.svgMapAria });
    const spot = screen.getByRole("region", { name: TEXT.spotTitle });
    expect(within(spot).queryByRole("button", { name: TEXT.spotStart })).toBeNull();
    expect(within(spot).getByText(TEXT.spotNoMap)).toBeTruthy();
    // 町を選ぶ（代わりの地図から）
    fireEvent.click(screen.getByRole("button", { name: TEXT.pickTown }));
    fireEvent.click(within(japan).getByRole("button", { name: /^岡山県/ }));
    const muni = await screen.findByRole("group", { name: /岡山県の市町村/ });
    fireEvent.click(await within(muni).findByRole("button", { name: /^西粟倉村/ }));
    fireEvent.click(within(spot).getByRole("button", { name: TEXT.meshUseCenter }));
    fireEvent.click(within(spot).getByRole("button", { name: TEXT.spotDecide }));
    const saved = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "null") as { meshCode: string; muniCode: string } | null;
    expect(saved?.muniCode).toBe("33643");
    expect(saved?.meshCode).toMatch(/^\d{8}$/);
    expect(container.querySelector(".crosshair")).toBeNull();
  });
});
