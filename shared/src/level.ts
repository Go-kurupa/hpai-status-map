// 警告の段階（契約 3.2、設計書 §5）。純粋な計算だけ。文は持たない（文は W、宛先は M が使う）。
// 農場の警告の段階を決める。①を見逃す方向の誤りが最も重いので、迷う入力は数える側（①に近い側）に倒す。
//
// 距離を使う関数（computeLevel、relationToCase、wildBirdsNotifiable）を呼ぶ前に、
// 呼び出し側が await geo.ensurePrefs(prefsToLoad(cases, birds)) を済ませること。
// 未読み込みの県は GeoNotLoadedError になる（黙って④にしない）。
import { distanceToMuniKm, isAdjacent, type GeoStore } from "./geo";
import { toJstIso } from "./dates";
import { PREFS } from "./pref";
import type {
  AreaStatus,
  Case,
  FarmPoint,
  IsoDateTime,
  Level,
  LevelReason,
  LevelResult,
  MuniCode,
  PrefCode,
  Season,
  WatchStatus,
  WatchSummary,
  WildBird,
} from "./types";

/** 区域の基準の半径（km）。県の発表がこれより狭くても狭くしない。 */
export const ZONE_BASE_KM = 10;
/** メッシュの中心から角まで最大約 0.78km と、形の簡略化の約 30m を覆う誤差（km）。 */
export const MESH_MARGIN_KM = 0.85;
/** 確認済みと数える、直近の確認（ok かつ checkedAt）からの時間（§9.7）。未来の時刻は数えない。 */
const WATCH_FRESH_MS = 6 * 60 * 60 * 1000;

/** 県の発表の半径のうち最も外側。10km より狭くしない。数でない値は無視する（NaN で①を見逃さない）。 */
export function zoneRadiusKm(c: Case): number {
  return Math.max(ZONE_BASE_KM, ...c.radiiKm.filter((r) => Number.isFinite(r)));
}

/** 確認中（reviewing）と否定が確定したものを除く。否定の候補は数える。 */
export function isCountable(c: Case): boolean {
  return c.confirmState !== "reviewing" && c.negation !== "negated";
}

/** 数える事例で、移動制限の解除がまだ。完了からの日数は見ない（解除の記録だけで決める）。 */
export function isZoneActive(c: Case): boolean {
  return isCountable(c) && c.stages.movement_lifted === undefined;
}

/** 距離を計算するために読む県。数える事例と、検査の結果が否定でない野鳥の県を重複なく（昇順）。 */
export function prefsToLoad(cases: readonly Case[], birds: readonly WildBird[] = []): PrefCode[] {
  const out = new Set<PrefCode>();
  const add = (prefCode: PrefCode, muniCode: MuniCode | null): void => {
    out.add(prefCode);
    if (muniCode) out.add(muniCode.slice(0, 2)); // 県の欄とコードがずれていても、形が見つかる県を読む
  };
  for (const c of cases) if (isCountable(c)) add(c.prefCode, c.muniCode);
  for (const b of birds) if (b.test !== "negative") add(b.prefCode, b.muniCode);
  return [...out].sort();
}

/**
 * 農場と 1 つの事例の関係。時期（シーズン）も否定も見ない（呼び出し側が選ぶ）。
 * 同じ市町村では距離を計算しない。移動制限の解除の後は距離を見ない（同じ町は②、隣は②、登録は③、他は④）。
 */
export function relationToCase(p: FarmPoint, c: Case, geo: GeoStore): { level: Level; reason: LevelReason | null } {
  const muni = c.muniCode;
  if (muni === null) return { level: 4, reason: null };

  const reasonOf = (level: Level, kind: LevelReason["kind"], distanceKm: number | null, radiusKm: number | null) => ({
    level,
    reason: { caseId: c.id, level, kind, distanceKm, radiusKm } satisfies LevelReason,
  });

  const zoneActive = c.stages.movement_lifted === undefined;

  if (muni === p.muniCode) {
    return zoneActive ? reasonOf(1, "same_muni", null, null) : reasonOf(2, "same_muni", null, null);
  }

  if (zoneActive) {
    const radiusKm = zoneRadiusKm(c);
    const distanceKm = distanceToMuniKm(p.meshCode, muni, geo);
    if (distanceKm <= radiusKm + MESH_MARGIN_KM) return reasonOf(1, "within_radius", distanceKm, radiusKm);
  }
  if (isAdjacent(p.muniCode, muni, geo)) return reasonOf(2, "adjacent", null, null);
  if (p.frequentMuniCodes.includes(muni)) return reasonOf(3, "frequent", null, null);
  return { level: 4, reason: null };
}

/** 農場の段階。今季の数える事例だけを見て、最も高い段階を返す。reasons は当たった事例すべて（高い順）。 */
export function computeLevel(p: FarmPoint, cases: readonly Case[], season: Season, geo: GeoStore): LevelResult {
  const hits: Array<{ reason: LevelReason; c: Case }> = [];
  for (const c of cases) {
    if (c.season !== season || !isCountable(c)) continue;
    const { reason } = relationToCase(p, c, geo);
    if (reason) hits.push({ reason, c });
  }
  hits.sort((a, b) => a.reason.level - b.reason.level); // 安定ソート: 同じ段階は入力の順

  const level: Level = hits.length > 0 ? hits[0]!.reason.level : 4;
  const first = hits.filter((h) => h.reason.level === 1);
  return {
    level,
    reasons: hits.map((h) => h.reason),
    // ①の事例がすべて搬出制限の解除済みのときだけ。一部でも未解除なら「解除」と言わない。
    shipmentLifted: first.length > 0 && first.every((h) => h.c.stages.shipment_lifted !== undefined),
    // 監視強化の説明は①のときだけ。
    inSurveillanceNote: first.some((h) => h.c.stages.surveillance_lifted === undefined),
  };
}

/** /area/{code} と API の状態。地点がないので距離を見ない（同じ町、隣の町、他）。 */
export function computeAreaStatus(i: {
  muniCode: MuniCode;
  cases: readonly Case[];
  wildBirds: readonly WildBird[];
  geo: GeoStore;
  asOf: IsoDateTime;
  season: Season;
}): AreaStatus {
  const entry = i.geo.index[i.muniCode];
  if (!entry) throw new RangeError(`知らない市町村コードです: ${i.muniCode}`);

  const counted = i.cases.filter((c) => c.season === i.season && isCountable(c) && c.muniCode !== null);
  const sameMuniCases = counted.filter((c) => c.muniCode === i.muniCode);
  const adjacentCases = counted.filter((c) => c.muniCode !== null && isAdjacent(i.muniCode, c.muniCode, i.geo));

  const wildBirds = i.wildBirds.filter(
    (b) =>
      b.season === i.season &&
      b.test !== "negative" &&
      b.muniCode !== null &&
      (b.muniCode === i.muniCode || isAdjacent(i.muniCode, b.muniCode, i.geo)),
  );

  let level: AreaStatus["level"] = 4;
  if (sameMuniCases.some(isZoneActive)) level = 1;
  else if (sameMuniCases.length > 0 || adjacentCases.length > 0) level = 2;

  const sourceUrls = [...new Set([...sameMuniCases, ...adjacentCases].flatMap((c) => c.sourceUrls).concat(wildBirds.map((b) => b.sourceUrl)))];

  return {
    muniCode: i.muniCode,
    muniName: entry.name,
    prefCode: entry.prefCode,
    asOf: i.asOf,
    level,
    sameMuniCases,
    adjacentCases,
    wildBirds,
    sourceUrls,
  };
}

/** 朝のメールで知らせる野鳥: 高病原性が確定し、メッシュの中心から市町村の面まで 10km＋誤差以内。段階は上げない。 */
export function wildBirdsNotifiable(p: FarmPoint, birds: readonly WildBird[], geo: GeoStore): WildBird[] {
  return birds.filter(
    (b) =>
      b.test === "hpai_confirmed" &&
      b.muniCode !== null &&
      distanceToMuniKm(p.meshCode, b.muniCode, geo) <= ZONE_BASE_KM + MESH_MARGIN_KM,
  );
}

/** 47 都道府県のうち、ok で checkedAt が 6 時間以内（未来は除く）のものを確認済みと数える。一覧にない県は未確認。 */
export function summarizeWatch(all: readonly WatchStatus[], now: Date): WatchSummary {
  const failedPrefCodes: PrefCode[] = [];
  let okCount = 0;
  for (const pref of PREFS) {
    const records = all.filter((w) => w.prefCode === pref.code);
    const fresh =
      records.length > 0 &&
      records.every((w) => {
        if (!w.ok || w.checkedAt === null) return false;
        const age = now.getTime() - Date.parse(w.checkedAt);
        return Number.isFinite(age) && age >= 0 && age <= WATCH_FRESH_MS; // 読めない時刻は NaN、未来の時刻は負で、どちらも未確認になる
      });
    if (fresh) okCount++;
    else failedPrefCodes.push(pref.code);
  }
  return { asOf: toJstIso(now), okCount, failedCount: failedPrefCodes.length, failedPrefCodes };
}
