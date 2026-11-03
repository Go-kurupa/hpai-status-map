// N03（行政区域データ）から data/geo/ を作る。  tsx scripts/build-geo.ts
//
//   入力  data/private/n03/N03-20260101.geojson   国土数値情報からの取得は 1 回だけ（docs/data-sources.md）
//   作業  data/private/geo-work/{full,mid}.topo.json
//   出力  data/geo/{japan.topo.json, pref/NN.topo.json, adjacency.json, muni-index.json, pref-anchors.json, build-info.json}
//
// 全国の形が大きいので NODE_OPTIONS=--max-old-space-size=16000 を付けて実行する。
// 引数: --input <geojson> --work <dir> --out <dir>（試験と下見用。既定は上のとおり）
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Topology } from "topojson-specification";
import { buildAdjacency, buildMuniIndex, buildPrefAnchors, eachExpression } from "./lib/geo-build";
import { measureSimplifyError } from "./lib/simplify-error";

const require = createRequire(import.meta.url);
const mapshaper = require("mapshaper") as { runCommands(argv: string[]): Promise<void> };

const ROOT = path.resolve(import.meta.dirname, "..");

/** 簡略化の値（利用者の点検と W-02 の受け入れで直す。直したら docs/data-sources.md の値も合わせる）。 */
export const SIMPLIFY = {
  japan: { percentage: "1.5%", options: "keep-shapes", quantization: 10_000 },
  // dp（Douglas-Peucker）は、元の点から簡略化した線までの距離が interval を超えない。mapshaper の既定の重み付き Visvalingam は
  // 面積で点を消すので、細長い入り江や小さな島で数 km ずれた（F-06 のレビュー）。
  pref: { method: "dp", interval: 30, options: "keep-shapes", quantization: 100_000 },
  work: { quantization: 1_000_000 },
} as const;

export const N03_RELEASE = {
  version: "N03-20260101",
  edition: "2026年版（2026-01-01 時点）",
  pageUrl: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html",
  zipUrl: "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip",
  license: "CC BY 4.0",
} as const;

const KM_PER_DEG = (6371.0088 * Math.PI) / 180;
const DROPPED_NAME = "所属未定地";

/** 入力の地物の数と、除く地物（所属未定地）の数。1 行 1 地物の GeoJSON を流し読みする。 */
export async function countFeatures(geojson: string): Promise<{ total: number; dropped: number }> {
  let total = 0;
  let dropped = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(geojson, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    for (const m of line.matchAll(/"properties": (\{[^}]*\})/g)) {
      const p = JSON.parse(m[1]!) as { N03_001?: string; N03_004?: string };
      if (p.N03_001 === undefined) continue; // crs の行
      total += 1;
      if (p.N03_004 === DROPPED_NAME) dropped += 1;
    }
  }
  return { total, dropped };
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const sizeOf = (file: string): number => fs.statSync(file).size;

async function ms(label: string, argv: string[], log: (s: string) => void): Promise<void> {
  const t0 = Date.now();
  await mapshaper.runCommands(argv);
  log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
}

export interface BuildOptions {
  input: string;
  workDir: string;
  outDir: string;
  log?: (s: string) => void;
}

export async function buildGeo(opts: BuildOptions): Promise<Record<string, unknown>> {
  const log = opts.log ?? ((s) => console.log(s));
  const { input, workDir, outDir } = opts;
  if (!fs.existsSync(input)) throw new Error(`入力がありません: ${input}（docs/data-sources.md の取得手順）`);
  const heapGb = v8.getHeapStatistics().heap_size_limit / 1024 ** 3;
  if (heapGb < 12) {
    throw new Error(`ヒープが足りません（${heapGb.toFixed(1)}GB）。NODE_OPTIONS=--max-old-space-size=16000 を付けてください`);
  }
  fs.mkdirSync(workDir, { recursive: true });
  fs.rmSync(path.join(outDir, "pref"), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "pref"), { recursive: true });

  const counts = await countFeatures(input);
  log(`入力の地物 ${counts.total}、除く地物（${DROPPED_NAME}）${counts.dropped}`);

  const full = path.join(workDir, "full.topo.json");
  const mid = path.join(workDir, "mid.topo.json");
  const japan = path.join(outDir, "japan.topo.json");

  // A: 所属未定地を除き、市町村（政令市は市）で束ねる。この形から隣り合いを作る。
  await ms(
    "A 束ねる",
    [
      "-i", input,
      "-filter", `N03_004 !== '${DROPPED_NAME}'`,
      "-each", eachExpression(),
      "-dissolve", "c", "copy-fields=n,p",
      "-rename-layers", "muni",
      "-o", full, "format=topojson", `quantization=${SIMPLIFY.work.quantization}`,
    ],
    log,
  );
  // B: 全国の表示用
  await ms(
    "B 全国",
    [
      "-i", full,
      "-simplify", SIMPLIFY.japan.percentage, SIMPLIFY.japan.options,
      "-clean",
      "-o", japan, "format=topojson", `quantization=${SIMPLIFY.japan.quantization}`,
    ],
    log,
  );
  // C: 県ごとのファイルの元（距離の計算に使う）
  await ms(
    "C 中間",
    [
      "-i", full,
      "-simplify", SIMPLIFY.pref.method, `interval=${SIMPLIFY.pref.interval}`, SIMPLIFY.pref.options,
      "-o", mid, "format=topojson", `quantization=${SIMPLIFY.work.quantization}`,
    ],
    log,
  );

  const topo = readJson<Topology>(full);
  const adjacency = buildAdjacency(topo);
  const index = buildMuniIndex(topo);
  const anchors = buildPrefAnchors(topo);
  const prefCodes = [...new Set(Object.values(index).map((e) => e.prefCode))].sort();
  log(`市町村 ${Object.keys(index).length}、県 ${prefCodes.length}`);

  // D: 県ごと
  for (const p of prefCodes) {
    await ms(
      `D 県 ${p}`,
      [
        "-i", mid,
        "-filter", `p==='${p}'`,
        "-rename-layers", "muni",
        "-o", path.join(outDir, "pref", `${p}.topo.json`), "format=topojson", `quantization=${SIMPLIFY.pref.quantization}`,
      ],
      log,
    );
  }

  // 簡略化の前（束ねた直後の形）と後（県ごとの形。距離の計算に使うもの）の食い違いを測る
  const prefTopos = prefCodes.map((p) => readJson<Topology>(path.join(outDir, "pref", `${p}.topo.json`)));
  const simplifyError = measureSimplifyError(topo, prefTopos);
  log(
    `簡略化のずれ（大きな面の前→後の最大）${simplifyError.maxForwardM.toFixed(1)}m（${simplifyError.maxForwardAt.name}）、後→前 ${simplifyError.maxBackwardM.toFixed(1)}m、` +
      `消えた面 ${simplifyError.parts.vanished}/${simplifyError.parts.before}（うち 1km 以上離れた小さな面 ${simplifyError.small.farFrom1km}）`,
  );
  // 比べる元（束ねた直後の形）自体が量子化されている。半歩ぶんの誤差（m）。緯度 24 度の経度の縮みで小さめに取らない（大きく見積もる側で、cos を 1 とする）
  const sc = topo.transform?.scale ?? [0, 0];
  const referenceQuantizationErrorM = Math.hypot(((sc[0] ?? 0) / 2) * KM_PER_DEG * 1000, ((sc[1] ?? 0) / 2) * KM_PER_DEG * 1000);

  writeJson(path.join(outDir, "adjacency.json"), adjacency);
  writeJson(path.join(outDir, "muni-index.json"), index);
  writeJson(path.join(outDir, "pref-anchors.json"), anchors);

  const isolated = Object.entries(adjacency)
    .filter(([, list]) => list.length === 0)
    .map(([code]) => ({ code, name: index[code]!.name, prefCode: index[code]!.prefCode }));
  const prefSizes = Object.fromEntries(prefCodes.map((p) => [p, sizeOf(path.join(outDir, "pref", `${p}.topo.json`))]));
  const info = {
    dataset: N03_RELEASE.version,
    edition: N03_RELEASE.edition,
    license: N03_RELEASE.license,
    pageUrl: N03_RELEASE.pageUrl,
    sourceUrl: N03_RELEASE.zipUrl,
    attribution:
      "国土交通省 国土数値情報「行政区域データ N03 2026 年版」をもとに、形の簡略化、政令市の区の統合、隣り合いの計算を行って作成",
    simplify: {
      work: `-dissolve c（quantization=${SIMPLIFY.work.quantization}）。隣り合いはこの形から`,
      japan: `-simplify ${SIMPLIFY.japan.percentage} ${SIMPLIFY.japan.options} -clean（quantization=${SIMPLIFY.japan.quantization}）`,
      pref: `-simplify ${SIMPLIFY.pref.method} interval=${SIMPLIFY.pref.interval} ${SIMPLIFY.pref.options}（quantization=${SIMPLIFY.pref.quantization}）`,
    },
    counts: {
      inputFeatures: counts.total,
      droppedFeatures: counts.dropped,
      droppedReason: `${DROPPED_NAME}（市町村に属さない地物）`,
      munis: Object.keys(index).length,
      prefs: prefCodes.length,
    },
    sizesBytes: {
      "japan.topo.json": sizeOf(japan),
      "adjacency.json": sizeOf(path.join(outDir, "adjacency.json")),
      "muni-index.json": sizeOf(path.join(outDir, "muni-index.json")),
      "pref-anchors.json": sizeOf(path.join(outDir, "pref-anchors.json")),
      prefTotal: Object.values(prefSizes).reduce((a, b) => a + b, 0),
      prefLargest: Math.max(...Object.values(prefSizes)),
      pref: prefSizes,
    },
    simplifyError: {
      method:
        "市町村ごとに、簡略化の前（束ねた直後の形）の大きな面（幅 100m 以上。幅 = 2 * 面積 / 外周）の外側の輪の頂点から、県ごとの形の同じ市町村の輪郭までの最短距離（前→後）の最大。幅 100m 未満の小さな面は small に分ける（簡略化で消えるため）。scripts/lib/simplify-error.ts",
      referenceQuantizationErrorM,
      ...simplifyError,
    },
    isolated,
  };
  fs.writeFileSync(path.join(outDir, "build-info.json"), `${JSON.stringify(info, null, 1)}\n`);
  log(`孤立 ${isolated.length}、japan.topo.json ${sizeOf(japan)} バイト`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      input: { type: "string", default: path.join(ROOT, "data/private/n03/N03-20260101.geojson") },
      work: { type: "string", default: path.join(ROOT, "data/private/geo-work") },
      out: { type: "string", default: path.join(ROOT, "data/geo") },
    },
  });
  buildGeo({ input: path.resolve(values.input), workDir: path.resolve(values.work), outDir: path.resolve(values.out) }).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
