// WebGL2 が使えない端末の、農場の地点の選び方。地図を押す代わりに、町の中心あたりのマス目を使うボタンを出す。
import type { MuniEntry } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { findWordingViolations } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import indexJson from "../../../../data/geo/muni-index.json";
import { TEXT } from "../map/texts";

vi.mock("../../geo/maplibre", () => {
  class MlMap {
    constructor() {
      throw new Error("GPUInitializationError: WebGL2 is required to display this map");
    }
  }
  return { MlMap };
});
vi.mock("../../geo/loadGeo", () => ({ loadWebGeoStore: () => Promise.reject(new Error("unused")) }));

import { MeshPicker } from "./MeshPicker";

const nishiawakura = (indexJson as unknown as Record<string, MuniEntry>)["33643"]!;

afterEach(cleanup);

describe("MeshPicker（WebGL2 が使えない端末）", () => {
  it("町を選ぶ前はボタンを押せず、選ぶと町の中心あたりのマス目と町のコードだけを渡す", () => {
    const onPick = vi.fn();
    const { rerender } = render(<MeshPicker muni={null} onPick={onPick} />);
    const button = screen.getByRole("button", { name: TEXT.meshUseCenter }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    rerender(<MeshPicker muni={nishiawakura} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.meshUseCenter }));
    expect(onPick).toHaveBeenCalledTimes(1);
    // 緯度経度は渡さない（toEqual で余計なキーがないことも見る）
    expect(onPick.mock.calls[0]![0]).toEqual({
      meshCode: latLngToMesh3(nishiawakura.center[1], nishiawakura.center[0]),
      muniCode: "33643",
      prefCode: "33",
    });
  });

  it("地図の代わりの文は短く、ブラウザの設定を変える案内や英語のエラー名を出さない", () => {
    render(<MeshPicker muni={nishiawakura} onPick={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(TEXT.meshNoMap);
    expect(text).not.toMatch(/WebGL|GPUInitializationError|ハードウェアアクセラレーション/);
    expect(screen.queryByRole("region", { name: "農場の地点を選ぶ地図" })).toBeNull();
    expect(findWordingViolations(TEXT.meshNoMap + TEXT.meshUseCenter + TEXT.meshCenterPicked)).toEqual([]);
  });

  it("押した後は、選んだことを知らせる", () => {
    render(<MeshPicker muni={nishiawakura} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: TEXT.meshUseCenter }));
    expect(screen.getByText(TEXT.meshCenterPicked)).toBeTruthy();
  });
});
