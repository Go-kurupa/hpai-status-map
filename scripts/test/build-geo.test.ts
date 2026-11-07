// data/geo/（commit する生成物）だけを読む。元データ（data/private）は読まない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { distanceToMuniKm, isAdjacent } from "../../shared/src/geo";
import { MESH_MARGIN_KM } from "../../shared/src/level";
import { latLngToMesh3, mesh3Center } from "../../shared/src/mesh";
import { PREFS } from "../../shared/src/pref";
import { countFeatures } from "../build-geo";
import { DESIGNATED_CITIES } from "../lib/designated-cities";
import { loadScriptGeoStore } from "../lib/geoStore";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const GEO = path.join(ROOT, "data", "geo");
const readJson = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(GEO, rel), "utf8")) as T;

type Index = Record<string, { code: string; name: string; prefCode: string; center: [number, number]; bbox: number[] }>;
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}
const index = readJson<Index>("muni-index.json");
const adjacency = readJson<Record<string, string[]>>("adjacency.json");

describe("data/geo の市町村", () => {
  it("市町村 1747、県 47", () => {
    expect(Object.keys(index)).toHaveLength(1747);
    expect(Object.keys(adjacency)).toHaveLength(1747);
    expect(new Set(Object.values(index).map((e) => e.prefCode))).toEqual(new Set(PREFS.map((p) => p.code)));
  });

  it("政令市の区のコードと所属未定地がない", () => {
    for (const c of ["33101", "01101", "14101", "13000", "46000", "23000", "12000", "30000", "40000", "47000"]) {
      expect(index[c], c).toBeUndefined();
    }
  });

  it("政令市は市のコードで 20 市、東京の特別区はそのまま", () => {
    for (const [key, code] of Object.entries(DESIGNATED_CITIES)) expect(index[code]?.name, key).toBeDefined();
    expect(index["33100"]).toMatchObject({ name: "岡山市", prefCode: "33" });
    expect(index["13101"]).toMatchObject({ name: "千代田区", prefCode: "13" });
    expect(index["03381"]!.name).toBe("金ケ崎町");
  });

  it("すべての市町村に名前、県（コードの先頭 2 桁）、bbox の中の中心がある", () => {
    for (const e of Object.values(index)) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.prefCode).toBe(e.code.slice(0, 2));
      const [w, s, ea, n] = e.bbox as [number, number, number, number];
      expect(e.center[0]).toBeGreaterThanOrEqual(w);
      expect(e.center[0]).toBeLessThanOrEqual(ea);
      expect(e.center[1]).toBeGreaterThanOrEqual(s);
      expect(e.center[1]).toBeLessThanOrEqual(n);
    }
  });

  it("県の代表点が 47 県ぶんある", () => {
    const anchors = readJson<Record<string, [number, number]>>("pref-anchors.json");
    expect(Object.keys(anchors).sort()).toEqual(PREFS.map((p) => p.code));
  });
});

describe("data/geo の隣り合い", () => {
  it("津山市 33203 の隣", () => {
    for (const c of ["33214", "33606", "33622", "33623", "33666", "31201", "31328"]) {
      expect(adjacency["33203"], c).toContain(c);
    }
  });

  it("対称で、自分自身を含まない", () => {
    for (const [a, list] of Object.entries(adjacency)) {
      expect(list).not.toContain(a);
      for (const b of list) expect(adjacency[b], `${a}-${b}`).toContain(a);
    }
  });

  it("小笠原村 13421 と 47207 は隣なし。孤立は 49", () => {
    expect(adjacency["13421"]).toEqual([]);
    expect(adjacency["47207"]).toEqual([]);
    const isolated = Object.entries(adjacency).filter(([, l]) => l.length === 0);
    expect(isolated).toHaveLength(49);
    const info = readJson<{ isolated: Array<{ code: string }> }>("build-info.json");
    expect(info.isolated.map((i) => i.code).sort()).toEqual(isolated.map(([c]) => c).sort());
  });
});

describe("data/geo の形のファイル", () => {
  it("japan.topo.json は 2MB 以下。object は muni、properties は {c,n,p}", () => {
    const file = path.join(GEO, "japan.topo.json");
    expect(fs.statSync(file).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    const topo = readJson<any>("japan.topo.json");
    expect(Object.keys(topo.objects)).toEqual(["muni"]);
    const geoms = topo.objects.muni.geometries as Array<{ properties: Record<string, string> }>;
    expect(geoms).toHaveLength(1747);
    for (const g of geoms) expect(Object.keys(g.properties).sort()).toEqual(["c", "n", "p"]);
  });

  it("pref は 47 ファイルで、各県の市町村だけが入る", () => {
    const files = fs.readdirSync(path.join(GEO, "pref")).sort();
    expect(files).toEqual(PREFS.map((p) => `${p.code}.topo.json`));
    let total = 0;
    for (const p of PREFS) {
      const topo = readJson<any>(`pref/${p.code}.topo.json`);
      expect(Object.keys(topo.objects)).toEqual(["muni"]);
      const geoms = topo.objects.muni.geometries as Array<{ properties: Record<string, string> }>;
      for (const g of geoms) {
        expect(Object.keys(g.properties).sort()).toEqual(["c", "n", "p"]);
        expect(g.properties.p).toBe(p.code);
      }
      total += geoms.length;
    }
    expect(total).toBe(1747);
  });

  it("build-info に版、出典 URL、簡略化の値、大きさ、除いた地物がある", () => {
    const info = readJson<any>("build-info.json");
    expect(info.dataset).toBe("N03-20260101");
    expect(info.license).toBe("CC BY 4.0");
    expect(info.sourceUrl).toContain("nlftp.mlit.go.jp");
    expect(info.simplify.japan).toContain("1.5%");
    expect(info.simplify.pref).toContain("dp interval=30");
    expect(info.counts.droppedFeatures).toBe(141);
    expect(info.sizesBytes["japan.topo.json"]).toBe(fs.statSync(path.join(GEO, "japan.topo.json")).size);
  });

  it("簡略化のずれ: MESH_MARGIN_KM が、メッシュの半対角＋簡略化の最大のずれ＋元の形の量子化の誤差を覆う（§19）", () => {
    const e = readJson<any>("build-info.json").simplifyError;
    expect(e.munisLost).toBe(0);
    // 実測で、大きな面（幅 100m 以上）の境界は 30m（interval）に再量子化の誤差が乗った値までしかずれない。
    // 100m 以上ずれるなら、大きな面が丸ごと消えている（1km 超えが出た mapshaper の既定の重み付き Visvalingam のとき）
    expect(e.maxForwardM).toBeGreaterThan(0);
    expect(e.maxForwardM).toBeLessThan(60);
    expect(e.maxBackwardM).toBeLessThan(60);
    // 半対角は南ほど長い（経度の幅が緯度で縮む比が小さくなる）。農場がある最南端（波照間島 24.05°N）より南の北緯 24.0 度で測る
    const southMesh = latLngToMesh3(24.0, 123.8);
    const c = mesh3Center(southMesh);
    const halfDiagM = haversineKm(c.lat, c.lng, c.lat + 1 / 240, c.lng + 1 / 160) * 1000;
    expect(halfDiagM).toBeGreaterThan(780);
    expect(halfDiagM).toBeLessThan(790);
    const needM = halfDiagM + e.maxForwardM + e.referenceQuantizationErrorM;
    expect(needM).toBeLessThanOrEqual(MESH_MARGIN_KM * 1000);
  });

  it("消えた面の記録: 市町村の残りから 1km 以上離れて消えた小さな面の数が build-info にある（距離が大きく出る市町村がある）", () => {
    const e = readJson<any>("build-info.json").simplifyError;
    expect(e.parts.before).toBe(e.parts.after + e.parts.vanished);
    expect(e.small.count).toBeGreaterThan(0);
    expect(e.small.farFrom1km).toBeGreaterThanOrEqual(e.small.farFrom10km);
    expect(e.small.farFrom100m).toBeGreaterThanOrEqual(e.small.farFrom1km);
  });

  it("2021 年版の形（N03-21_210101）が data/ と web/public/ にない", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (p === path.join(ROOT, "data", "private")) continue; // 公開しない作業場
        if (ent.name.includes("N03-21_210101")) bad.push(p);
        else if (ent.isDirectory()) walk(p);
        else if (fs.readFileSync(p, "utf8").includes("N03-21_210101")) bad.push(p);
      }
    };
    for (const d of [path.join(ROOT, "data"), path.join(ROOT, "web", "public")]) if (fs.existsSync(d)) walk(d);
    expect(bad).toEqual([]);
  });
});

describe("loadScriptGeoStore", () => {
  it("津山市の形を読み込め、隣り合いと距離が引ける", async () => {
    const geo = await loadScriptGeoStore();
    await geo.ensurePrefs(["33", "31"]);
    expect(geo.geometry("33203").properties.c).toBe("33203");
    expect(isAdjacent("33203", "31201", geo)).toBe(true);
    // 津山市の center のメッシュから、県をまたぐ鳥取市への距離が測れる
    const [lng, lat] = geo.index["33203"]!.center;
    const d = distanceToMuniKm(latLngToMesh3(lat, lng), "31201", geo);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(40);
  });
});

describe("countFeatures", () => {
  it("地物の数と所属未定地の数を数える（1 行に複数あっても）", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hpai-count-")), "x.geojson");
    const feat = (n: string) => `{ "type": "Feature", "properties": { "N03_001": "東京都", "N03_004": "${n}", "N03_005": null, "N03_007": "13000" }, "geometry": null }`;
    fs.writeFileSync(
      f,
      `{\n"type": "FeatureCollection",\n"crs": { "type": "name", "properties": { "name": "x" } },\n"features": [\n${feat("所属未定地")},\n${feat("千代田区")}, ${feat("所属未定地")}\n]}\n`,
    );
    expect(await countFeatures(f)).toEqual({ total: 3, dropped: 2 });
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  });
});
