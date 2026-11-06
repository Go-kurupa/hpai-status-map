// WebGL がない端末の代わりの地図（境の線だけの SVG）。色分けは MapLibre の層と同じ決まり（applyView）で決まることを確かめる。
import type { Case, HistoryCase, WildBird } from "@hpai/shared/types";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeoStore } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { findWordingViolations } from "@hpai/shared/wording";
import adjacencyJson from "../../../../data/geo/adjacency.json";
import indexJson from "../../../../data/geo/muni-index.json";
import anchorsJson from "../../../../data/geo/pref-anchors.json";
import historyJson from "../../../../data/history/cases.json";
import { applyView, type ViewTarget } from "./applyView";
import { PAINT } from "./mapStyle";
import { buildSeasonView } from "./seasonView";
import { TEXT } from "./texts";

vi.mock("../../geo/loadGeo", () => {
  const geoDir = path.resolve(import.meta.dirname, "../../../../data/geo");
  const store = createGeoStore({
    index: indexJson as unknown as Parameters<typeof createGeoStore>[0]["index"],
    adjacency: adjacencyJson as Parameters<typeof createGeoStore>[0]["adjacency"],
    loadPrefTopo: async (p) => JSON.parse(readFileSync(path.join(geoDir, "pref", `${p}.topo.json`), "utf8")) as unknown,
  });
  const japan = JSON.parse(readFileSync(path.join(geoDir, "japan.topo.json"), "utf8")) as unknown;
  return {
    loadWebGeoStore: () => Promise.resolve(store),
    loadJapanTopo: () => Promise.resolve(japan),
    loadPrefAnchors: () => Promise.resolve(anchorsJson),
  };
});
// 代わりの地図は maplibre を読まない（読めば、WebGL のない端末でも重い chunk を取りに行く）
vi.mock("../../geo/maplibre", () => {
  throw new Error("SvgMap は maplibre を読まない");
});

import SvgMap, { type SvgMapProps } from "./SvgMap";

const history = historyJson as HistoryCase[];

function mkCase(o: Partial<Case>): Case {
  return {
    id: "c1",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date: "2026-11-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: "2026-11-20T12:00:00+09:00",
    ...o,
  };
}

// 岡山県: 津山市は確定、岡山市は疑いだけ。自分の町は西粟倉村、隣の町は美作市。北海道は見回りで確認できていない
const cases = [
  mkCase({ id: "a", muniCode: "33203", muniName: "津山市" }),
  mkCase({ id: "b", muniCode: "33100", muniName: "岡山市", stages: { suspected: { date: "2026-11-21", time: null } } }),
];
const view = buildSeasonView({ season: 2026, current: 2026, currentCases: cases, history });

function props(o: Partial<SvgMapProps> = {}): SvgMapProps {
  return {
    view,
    wildBirds: [],
    failedPrefCodes: ["01"],
    myMuniCode: "33643",
    nearMuniCodes: ["33215"],
    focus: null,
    ...o,
  };
}

/** applyView が MapLibre に渡す filter を、偽の map で控える（既存の決まりの答え） */
function layerFilters(p: SvgMapProps) {
  const filters = new Map<string, unknown>();
  const paints = new Map<string, unknown>();
  const map: ViewTarget = {
    setFilter: (id, f) => void filters.set(id, f),
    setPaintProperty: (id, prop, v) => void paints.set(`${id}/${prop}`, v),
    getSource: () => undefined,
  };
  applyView(map, { view: p.view, failedPrefCodes: p.failedPrefCodes, myMuniCode: p.myMuniCode, nearMuniCodes: p.nearMuniCodes });
  const codes = (id: string) => ((filters.get(id) as unknown[])[2] as unknown[])[1] as string[];
  return { codes, paints };
}

afterEach(cleanup);

async function openPref(name: RegExp) {
  const japan = await screen.findByRole("group", { name: TEXT.svgMapAria });
  fireEvent.click(within(japan).getByRole("button", { name }));
}

describe("代わりの地図（SVG）", () => {
  it("全国の図は 47 都道府県を押せる形で出し、確認できていない県だけに斜線を引く。県の件数は名前に入る", async () => {
    render(<SvgMap {...props()} />);
    const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
    const prefs = within(map).getAllByRole("button");
    expect(prefs).toHaveLength(47);
    const hokkaido = within(map).getByRole("button", { name: /^北海道/ });
    expect(hokkaido.getAttribute("aria-label")).toContain(TEXT.svgUnwatched);
    expect(hokkaido.getAttribute("data-unwatched")).toBe("true");
    const okayama = within(map).getByRole("button", { name: /^岡山県/ });
    expect(okayama.getAttribute("aria-label")).toContain("2 件");
    expect(okayama.getAttribute("data-unwatched")).toBe("false");
    // 全国の倍率では町を塗らない（MapLibre の case-* の層は MUNI_ZOOM から）
    expect(map.querySelectorAll("[data-fill='confirmed'],[data-fill='suspected']")).toHaveLength(0);
    // 出典（N03）と、代わりの地図であることの注記
    expect(screen.getByText(TEXT.svgMapNote, { exact: false })).toBeTruthy();
    expect(document.body.textContent).toContain("国土数値情報「行政区域データ N03 2026 年版」");
    expect(document.body.textContent).not.toContain("地理院タイル");
  });

  it("県を押すとその県の市町村の図になり、塗り分けは MapLibre の層の filter と同じ。戻るで全国へ", async () => {
    const p = props();
    render(<SvgMap {...p} />);
    await openPref(/^岡山県/);
    const map = await screen.findByRole("group", { name: /岡山県の市町村/ });
    await waitFor(() => expect(within(map).getAllByLabelText(/./).length).toBeGreaterThan(20));

    const { codes, paints } = layerFilters(p);
    const shapes = [...map.querySelectorAll<SVGElement>("[data-code]")];
    const pick = (attr: string) =>
      shapes
        .filter((s) => s.getAttribute(attr) === "true" || s.getAttribute("data-fill") === attr)
        .map((s) => s.getAttribute("data-code"))
        .sort();
    expect(pick("confirmed")).toEqual(codes("case-confirmed").filter((c) => c.startsWith("33")).sort());
    expect(pick("suspected")).toEqual(codes("case-suspected").filter((c) => c.startsWith("33")).sort());
    expect(pick("data-mine")).toEqual(codes("my-town"));
    expect(pick("data-near")).toEqual(codes("near-line"));

    // 色そのもの: 確定は今季の段階の色、疑いは同じ色の斜線
    const tsuyama = map.querySelector<SVGElement>("[data-code='33203'][data-fill]")!;
    expect(tsuyama.getAttribute("fill")).toBe(paints.get("case-confirmed/fill-color"));
    expect(tsuyama.getAttribute("fill")).toBe(PAINT.current);
    const okayamaCity = map.querySelector<SVGElement>("[data-code='33100'][data-fill]")!;
    const hatchId = /^url\(#(.+)\)$/.exec(okayamaCity.getAttribute("fill") ?? "")?.[1];
    expect(hatchId).toBeTruthy();
    expect(document.getElementById(hatchId!)?.getAttribute("data-color")).toBe(PAINT.current);

    // 名前に状態が入る
    expect(within(map).getByLabelText(/^津山市/).getAttribute("aria-label")).toContain("確定");
    expect(within(map).getByLabelText(/^岡山市/).getAttribute("aria-label")).toContain("疑い");
    expect(within(map).getByLabelText(/^西粟倉村/).getAttribute("aria-label")).toContain(TEXT.myTown);

    fireEvent.click(screen.getByRole("button", { name: TEXT.svgBack }));
    expect(await screen.findByRole("group", { name: TEXT.svgMapAria })).toBeTruthy();
  });

  it("過去のシーズンは段階の色を使わず、見回りの斜線も重ねない（applyView と同じ）", async () => {
    const past = buildSeasonView({ season: 2022, current: 2026, currentCases: [], history });
    const muni = past.confirmedMuniCodes[0]!;
    const prefCode = muni.slice(0, 2);
    const p = props({ view: past, failedPrefCodes: [prefCode], myMuniCode: null, nearMuniCodes: [] });
    render(<SvgMap {...p} />);
    const all = await screen.findByRole("group", { name: TEXT.svgMapAria });
    expect(all.querySelectorAll("[data-unwatched='true']")).toHaveLength(0);
    fireEvent.click(all.querySelector<SVGElement>(`[data-pref='${prefCode}']`)!);
    await waitFor(() => expect(document.querySelector(`[data-code='${muni}'][data-fill]`)).toBeTruthy());
    const { paints } = layerFilters(p);
    expect(document.querySelector(`[data-code='${muni}'][data-fill]`)!.getAttribute("fill")).toBe(paints.get("case-confirmed/fill-color"));
    expect(paints.get("case-confirmed/fill-color")).toBe(PAINT.past);
  });

  it("町を選べるとき（onSelectMuni がある）だけ、市町村を押すと町が選ばれる", async () => {
    const onSelectMuni = vi.fn();
    const { rerender } = render(<SvgMap {...props()} />);
    await openPref(/^岡山県/);
    const target = await screen.findByLabelText(/^津山市/);
    fireEvent.click(target);
    expect(onSelectMuni).not.toHaveBeenCalled();
    rerender(<SvgMap {...props({ onSelectMuni })} />);
    const map = screen.getByRole("group", { name: /岡山県の市町村/ });
    // 読み上げは「自分の町にします」（設計書 2026-11-06-town-picker 3 章）
    expect(within(map).getByRole("button", { name: /^津山市/ }).getAttribute("aria-label")).toMatch(/。押すとこの町を選択地域にします$/);
    fireEvent.click(within(map).getByRole("button", { name: /^津山市/ }));
    expect(onSelectMuni).toHaveBeenCalledWith("33203");
    // 一覧のボタンからも選べる（小さな町も指で押せる）
    const list = screen.getByRole("group", { name: TEXT.svgMuniList });
    fireEvent.click(within(list).getByRole("button", { name: "新庄村" }));
    expect(onSelectMuni).toHaveBeenLastCalledWith("33586");
  });

  // 設計書 2026-11-06-ui-frame 決定 4: 場所を選んでいないときは、町を押すとその町の発生を見る。読み上げも「選ぶ」と言わない
  it("町を見るだけのとき（onInspectMuni だけ）は、押すとその町の発生を見る。読み上げと一覧の題は『選ぶ』と言わず、選ぶ案内も出さない", async () => {
    const onInspectMuni = vi.fn();
    render(<SvgMap {...props({ onInspectMuni })} />);
    await openPref(/^岡山県/);
    const map = await screen.findByRole("group", { name: /岡山県の市町村/ });
    const tsuyama = within(map).getByRole("button", { name: /^津山市/ });
    expect(tsuyama.getAttribute("aria-label")).toMatch(/押すとこの町の発生を見ます$/);
    expect(tsuyama.getAttribute("aria-label")).not.toContain("選びます");
    fireEvent.click(tsuyama);
    expect(onInspectMuni).toHaveBeenCalledWith("33203");
    const list = screen.getByRole("group", { name: TEXT.svgMuniListInspect });
    fireEvent.click(within(list).getByRole("button", { name: "新庄村" }));
    expect(onInspectMuni).toHaveBeenLastCalledWith("33586");
    expect(screen.queryByText(TEXT.mapTapHint)).toBeNull();
  });

  it("町だけ選んだ人の輪は、町の中心（ringCenter）から描く。地点があればそちらが先", async () => {
    const { rerender } = render(<SvgMap {...props({ ringCenter: [134.0, 35.07] })} />);
    const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
    expect(map.querySelectorAll(".svg-ring")).toHaveLength(3);
    rerender(<SvgMap {...props({ ringCenter: null })} />);
    expect((await screen.findByRole("group", { name: TEXT.svgMapAria })).querySelectorAll(".svg-ring")).toHaveLength(0);
  });

  it("見る場所の指定（focus）で、町の県の図や全国の図に移る", async () => {
    const { rerender } = render(<SvgMap {...props()} />);
    await screen.findByRole("group", { name: TEXT.svgMapAria });
    rerender(<SvgMap {...props({ focus: { kind: "muni", codes: ["33643"], nonce: 1 } })} />);
    expect(await screen.findByRole("group", { name: /岡山県の市町村/ })).toBeTruthy();
    rerender(<SvgMap {...props({ focus: { kind: "japan", codes: [], nonce: 2 } })} />);
    expect(await screen.findByRole("group", { name: TEXT.svgMapAria })).toBeTruthy();
  });

  it("野鳥は今季だけ印を出し、置けない記録の数を知らせる", async () => {
    const birds: WildBird[] = [
      { id: "w1", season: 2026, prefCode: "33", muniCode: "33203", test: "hpai_confirmed" } as WildBird,
      { id: "w2", season: 2026, prefCode: "99", muniCode: null, test: "screening_positive" } as WildBird,
    ];
    const onUnplaced = vi.fn();
    render(<SvgMap {...props({ wildBirds: birds, onUnplaced })} />);
    const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
    await waitFor(() => expect(map.querySelectorAll("[data-bird='hpai_confirmed']")).toHaveLength(1));
    expect(onUnplaced).toHaveBeenLastCalledWith(1);
  });

  describe("距離の輪", () => {
    const FARM_MESH = latLngToMesh3(35.07, 134.0); // 津山市のあたり（試験の地点）

    it("地点がなければ輪を描かない", async () => {
      render(<SvgMap {...props({ myMuniCode: "33203" })} />);
      const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
      expect(map.querySelectorAll(".svg-ring")).toHaveLength(0);
      expect(map.querySelectorAll(".svg-ring-label")).toHaveLength(0);
    });

    it("全国の図は輪を 3 本描く。輪が小さいのでラベルは出さない。点線で、面を塗らない", async () => {
      render(<SvgMap {...props({ farmMeshCode: FARM_MESH, myMuniCode: "33203" })} />);
      const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
      const rings = [...map.querySelectorAll(".svg-ring")];
      expect(rings.map((r) => r.getAttribute("data-km"))).toEqual(["10", "30", "60"]);
      for (const r of rings) {
        expect(r.getAttribute("fill")).toBe("none");
        expect(r.getAttribute("stroke-dasharray")).toBeTruthy();
        expect(r.getAttribute("d")).toMatch(/^M.*Z$/);
      }
      expect(map.querySelectorAll(".svg-ring-label")).toHaveLength(0);
    });

    it("県の図は輪と km のラベルを出す。距離に「約」が付き、文字は画面で 14px 以上", async () => {
      render(<SvgMap {...props({ farmMeshCode: FARM_MESH, myMuniCode: "33203" })} />);
      await openPref(/^岡山県/);
      const map = await screen.findByRole("group", { name: /岡山県の市町村/ });
      expect(map.querySelectorAll(".svg-ring")).toHaveLength(3);
      const labels = [...map.querySelectorAll(".svg-ring-label")];
      expect(labels.map((l) => l.textContent)).toEqual(["約 10 km", "約 30 km", "約 60 km"]);
      // 実測できない jsdom では幅 480px の目安で計算する
      for (const l of labels) expect(Number(l.getAttribute("font-size")) * (480 / 1000)).toBeGreaterThanOrEqual(14);
    });

    it("不正なマス目でも落ちず、輪を描かない", async () => {
      render(<SvgMap {...props({ farmMeshCode: "abc", myMuniCode: "33203" })} />);
      const map = await screen.findByRole("group", { name: TEXT.svgMapAria });
      expect(map.querySelectorAll(".svg-ring")).toHaveLength(0);
    });
  });

  it("文言は禁句の検査を通る", () => {
    const words = [TEXT.svgMapNote, TEXT.svgMapAria, TEXT.svgBack, TEXT.svgUnwatched, TEXT.svgPrefList, TEXT.svgMuniList, TEXT.svgPrefHint];
    expect(findWordingViolations(words.join(""))).toEqual([]);
  });

  // 過去シーズンとの重ね合わせ（設計書 2026-11-06-data-explore E8、E11、E13、E14）
  it("重ね合わせを渡すと、市町村の図で 1 だけ・2 だけ・両方を 3 つの模様で塗る。確認できていない県は斜線でなく灰色", async () => {
    const overlay = { first: ["33203", "33214"], second: ["33214", "33202"], show: "both" as const, unwatchedPrefCodes: ["33"] };
    render(<SvgMap {...props({ overlay, failedPrefCodes: [] })} />);
    await openPref(/^岡山県/);
    await screen.findByRole("group", { name: /岡山県の市町村/ });
    const fill = (c: string) => document.querySelector(`[data-code='${c}'][data-fill]`)?.getAttribute("data-fill");
    expect(fill("33203")).toBe("cmp-one");
    expect(fill("33202")).toBe("cmp-two");
    expect(fill("33214")).toBe("cmp-both");
    // 模様は色で塗りつぶし、斜線を白く抜く。町の縁は塗りと同じ色（作者 11/6 夜の決定「C」）
    const stroke = (c: string) => document.querySelector(`[data-code='${c}'][data-fill]`)?.getAttribute("stroke");
    expect(stroke("33203")).toBe(PAINT.cmpOne);
    expect(stroke("33202")).toBe(PAINT.cmpTwo);
    expect(stroke("33214")).toBe(PAINT.cmpBoth);
    const pattern = document.querySelector(`pattern[data-color='${PAINT.cmpOne}'][data-filled='true']`)!;
    expect(pattern.querySelector("rect")!.getAttribute("fill")).toBe(PAINT.cmpOne);
    expect([...pattern.querySelectorAll("polygon")].every((p) => p.getAttribute("fill") === "#ffffff")).toBe(true);
    expect(document.querySelector("[data-unwatched-flat='true']")).toBeTruthy();
    expect(document.querySelector("[data-fill='suspected'], [data-fill='confirmed']")).toBeNull();
  });

  it("重ね合わせの間は、全国の図に県の件数の札を出さない", async () => {
    const overlay = { first: ["33203"], second: [], show: "both" as const, unwatchedPrefCodes: [] };
    render(<SvgMap {...props({ overlay })} />);
    await screen.findByRole("group", { name: TEXT.svgMapAria });
    expect(document.querySelector(".svg-badge")).toBeNull();
  });
});
