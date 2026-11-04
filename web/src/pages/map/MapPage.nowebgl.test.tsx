import { findForbiddenPhrases, findWordingViolations } from "@hpai/shared/wording";
import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider } from "../../data/context";
import { SpotProvider } from "../../data/spotContext";
import type { DataSource } from "../../data/types";
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
vi.mock("../../geo/loadGeo", () => ({
  loadWebGeoStore: () => Promise.reject(new Error("unused")),
  loadJapanTopo: () => Promise.reject(new Error("unused")),
  loadPrefAnchors: () => Promise.reject(new Error("unused")),
}));

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

afterEach(cleanup);

describe("WebGL2 が使えない端末", () => {
  it("画面が落ちず、地図の枠に代わりの文と案内が出て、地図以外の内容が見える", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <DataSourceProvider value={ds}>
          <SpotProvider>
            <MapPage />
          </SpotProvider>
        </DataSourceProvider>
      </MemoryRouter>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(TEXT.mapUnsupported);
    expect(alert.textContent).toContain(TEXT.mapUnsupportedHint);
    // 地図以外（シーズンの棒、見回りの確認、固定のリンク）が残っている
    expect(screen.getByRole("button", { name: /今季/ })).toBeTruthy();
    expect(screen.getByTestId("watch-line")).toBeTruthy();
    // 禁句と英語のエラー名は出さない
    const text = document.body.textContent ?? "";
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(findWordingViolations(TEXT.mapUnsupported + TEXT.mapUnsupportedHint)).toEqual([]);
    expect(text).not.toMatch(/WebGL|GPUInitializationError/);
  });
});
