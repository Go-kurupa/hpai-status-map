import fs from "node:fs";
import path from "node:path";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { baseStyle, codeFilter, GSI_TILE_URL, LAYER_IDS, overlayLayers, OVERLAY_SOURCE_IDS, PAINT } from "./mapStyle";
import { MUNI_ZOOM } from "./seasonView";

const layers = overlayLayers();

describe("地図の層", () => {
  it("下から gsi-pale、muni-fill、pref-unwatched、case-suspected、case-confirmed、muni-line、near-line、pref-line、my-town、野鳥 2 層", () => {
    const base = baseStyle().layers.map((l) => l.id);
    expect([...base, ...layers.map((l) => l.id)]).toEqual([
      "gsi-pale",
      "muni-fill",
      "pref-unwatched",
      "case-suspected",
      "case-confirmed",
      "muni-line",
      "near-line",
      "pref-line",
      "my-town",
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

  it("text-field を使わない（glyphs の外部 URL が要る）", () => {
    expect(JSON.stringify(layers)).not.toContain("text-field");
    expect((baseStyle() as { glyphs?: string }).glyphs).toBeUndefined();
  });

  it("muni の source は tolerance 0.3 の geojson。source の名前が層と一致する", () => {
    const style = baseStyle();
    expect(style.sources["gsi"]).toMatchObject({ type: "raster", tileSize: 256, minzoom: 2, maxzoom: 18 });
    expect(OVERLAY_SOURCE_IDS).toEqual(["muni", "pref", "wild-birds"]);
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

  it("色は theme.css の --lv1 / --lv4 / --muted と同じ値", () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../../ui/theme.css"), "utf8");
    const v = (n: string) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!.toLowerCase();
    expect(PAINT.current.toLowerCase()).toBe(v("lv1"));
    expect(PAINT.past.toLowerCase()).toBe(v("lv4"));
    expect(PAINT.muted.toLowerCase()).toBe(v("muted"));
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
