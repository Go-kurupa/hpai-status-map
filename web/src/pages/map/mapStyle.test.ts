import fs from "node:fs";
import path from "node:path";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { baseStyle, codeFilter, GSI_TILE_URL, LAYER_IDS, overlayLayers, OVERLAY_SOURCE_IDS, PAINT } from "./mapStyle";
import { MUNI_ZOOM } from "./seasonView";

const layers = overlayLayers();

describe("地図の層", () => {
  it("下から gsi-pale、muni-fill、pref-unwatched、case-suspected、case-confirmed、muni-line、near-line、pref-line、my-town、距離の輪、野鳥 2 層", () => {
    const base = baseStyle().layers.map((l) => l.id);
    expect([...base, ...layers.map((l) => l.id)]).toEqual([
      "gsi-pale",
      "muni-fill",
      "pref-unwatched",
      "case-suspected",
      "case-confirmed",
      "pref-unwatched-flat",
      "cmp-one",
      "cmp-two",
      "cmp-both",
      "cmp-latest",
      "muni-line",
      "cmp-one-line",
      "cmp-two-line",
      "cmp-both-line",
      "cmp-latest-line",
      "near-line",
      "pref-line",
      "my-town",
      "picked-line",
      "distance-rings",
      "wild-bird-screening",
      "wild-bird-confirmed",
    ]);
    expect([...base, ...layers.map((l) => l.id)]).toEqual([...LAYER_IDS]);
  });

  it("case-* は MUNI_ZOOM から、muni-line は 5.5 から。pref-unwatched に minzoom はない", () => {
    const by = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect(by["case-suspected"]!.minzoom).toBe(MUNI_ZOOM);
    expect(by["case-confirmed"]!.minzoom).toBe(MUNI_ZOOM);
    expect(by["muni-line"]!.minzoom).toBe(5.5);
    expect(by["pref-unwatched"]!.minzoom).toBeUndefined();
  });

  it("重ね合わせの 3 層は全国の広さから塗る（minzoom なし。設計書 2026-11-06-data-explore E13）。模様は 3 つの画像", () => {
    const by = Object.fromEntries(layers.map((l) => [l.id, l]));
    for (const id of ["cmp-one", "cmp-two", "cmp-both", "pref-unwatched-flat"]) expect(by[id]!.minzoom, id).toBeUndefined();
    expect((by["cmp-one"]!.paint as Record<string, unknown>)["fill-pattern"]).toBe(PAINT.hatchCmpOne);
    expect((by["cmp-two"]!.paint as Record<string, unknown>)["fill-pattern"]).toBe(PAINT.hatchCmpTwo);
    expect((by["cmp-both"]!.paint as Record<string, unknown>)["fill-pattern"]).toBe(PAINT.hatchCmpBoth);
    expect((by["pref-unwatched-flat"]!.paint as Record<string, unknown>)["fill-color"]).toBe(PAINT.muted);
  });

  it("重ね合わせの色は橙と青緑（設計書 E9）", () => {
    expect([PAINT.cmpOne, PAINT.cmpTwo, PAINT.cmpBoth]).toEqual(["#d97a00", "#00857a", "#3b3b8f"]);
  });

  it("比べの画面で押した町を赤い線で囲む層（作者 11/7）", () => {
    const by = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect((by["picked-line"]!.paint as Record<string, unknown>)["line-color"]).toBe(PAINT.current);
    expect(by["picked-line"]!.minzoom).toBeUndefined();
  });

  it("circle の層がない（農場を点で示さない）", () => {
    expect([...baseStyle().layers, ...layers].some((l) => l.type === "circle")).toBe(false);
  });

  it("疑いは fill-pattern、確定は単色。野鳥は symbol", () => {
    const by = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect((by["case-suspected"]!.paint as Record<string, unknown>)["fill-pattern"]).toBe(PAINT.hatchCurrent);
    expect((by["case-confirmed"]!.paint as Record<string, unknown>)["fill-color"]).toBe(PAINT.current);
    expect(by["wild-bird-screening"]!.type).toBe("symbol");
    expect(by["wild-bird-confirmed"]!.type).toBe("symbol");
  });

  it("距離の輪は点線の line の層で、面を塗らない（発表の区域の円に見せない）", () => {
    const ring = layers.find((l) => l.id === "distance-rings")!;
    expect(ring.type).toBe("line");
    expect("source" in ring && ring.source).toBe("distance-rings");
    expect(((ring.paint as Record<string, unknown>)["line-dasharray"] as number[]).length).toBeGreaterThanOrEqual(2);
    expect(ring.minzoom).toBeUndefined();
  });

  it("text-field を使わない（glyphs の外部 URL が要る）", () => {
    expect(JSON.stringify(layers)).not.toContain("text-field");
    expect((baseStyle() as { glyphs?: string }).glyphs).toBeUndefined();
  });

  it("muni の source は tolerance 0.3 の geojson。source の名前が層と一致する", () => {
    const style = baseStyle();
    expect(style.sources["gsi"]).toMatchObject({ type: "raster", tileSize: 256, minzoom: 2, maxzoom: 18 });
    expect(OVERLAY_SOURCE_IDS).toEqual(["muni", "pref", "wild-birds", "distance-rings"]);
    for (const l of layers) {
      if ("source" in l) expect(OVERLAY_SOURCE_IDS).toContain(l.source);
    }
  });

  it("外部の URL は地理院タイルだけ", () => {
    expect(GSI_TILE_URL).toBe("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png");
    const all = JSON.stringify([baseStyle(), layers]);
    const urls = all.match(/https?:\/\/[^"]+/g) ?? [];
    expect(urls).toEqual([GSI_TILE_URL]);
  });

  it("色は theme.css の --lv1 / --lv2 / --lv4 / --muted / --fg / --accent と同じ値", () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../ui/theme.css"), "utf8");
    const v = (n: string) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!.toLowerCase();
    expect(PAINT.current.toLowerCase()).toBe(v("lv1"));
    expect(PAINT.past.toLowerCase()).toBe(v("lv4"));
    expect(PAINT.muted.toLowerCase()).toBe(v("muted"));
    expect(PAINT.ink.toLowerCase()).toBe(v("fg"));
    expect(PAINT.near.toLowerCase()).toBe(v("lv2"));
    expect(PAINT.mine.toLowerCase()).toBe(v("accent"));
    expect(PAINT.cmpOne.toLowerCase()).toBe(v("cmp-one"));
    expect(PAINT.cmpTwo.toLowerCase()).toBe(v("cmp-two"));
    expect(PAINT.cmpBoth.toLowerCase()).toBe(v("cmp-both"));
  });
});

describe("maplibre の style の検査（本物の検証器）", () => {
  it("下地と重ねる層を合わせた style に、検証器の誤りがない（空の filter も）", () => {
    const empty = { type: "FeatureCollection" as const, features: [] };
    const base = baseStyle();
    const style = {
      ...base,
      sources: {
        ...base.sources,
        muni: { type: "geojson" as const, data: empty, tolerance: 0.3 },
        pref: { type: "geojson" as const, data: empty },
        "wild-birds": { type: "geojson" as const, data: empty },
        "distance-rings": { type: "geojson" as const, data: empty },
      },
      layers: [...base.layers, ...overlayLayers()],
    };
    expect(validateStyleMin(style as never).map((e) => e.message)).toEqual([]);
  });

  it("codeFilter は指定のコードだけを通し、空なら何も通さない", () => {
    const run = (f: unknown, props: Record<string, string>) =>
      featureFilter(f as never, "layers[0].filter").filter({ zoom: 8 } as never, { properties: props } as never);
    expect(run(codeFilter("c", ["33203", "33204"]), { c: "33203" })).toBe(true);
    expect(run(codeFilter("c", ["33203"]), { c: "33999" })).toBe(false);
    expect(run(codeFilter("p", ["33"]), { p: "33" })).toBe(true);
    expect(run(codeFilter("p", []), { p: "33" })).toBe(false);
  });
});

describe("重ね合わせの町の縁（作者 11/6 夜の決定「C」）", () => {
  it("3 つの縁の線は町の境の線の上にあり、色は塗りと同じ、太さ 2、minzoom なし", () => {
    const by = Object.fromEntries(overlayLayers().map((l) => [l.id, l]));
    for (const [id, color] of [["cmp-one-line", PAINT.cmpOne], ["cmp-two-line", PAINT.cmpTwo], ["cmp-both-line", PAINT.cmpBoth]] as const) {
      const l = by[id]!;
      expect(l.type, id).toBe("line");
      expect(l.minzoom, id).toBeUndefined();
      expect((l.paint as Record<string, unknown>)["line-color"], id).toBe(color);
      expect((l.paint as Record<string, unknown>)["line-width"], id).toBe(2);
    }
  });
});
