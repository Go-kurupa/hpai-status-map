// 自分の町の 1 文（設計書 §5、§15）。色（tone）は今季の段階だけを表す。過去の発生は別の行で、色を使わない。
// 距離を使う計算の前に必ず ensurePrefs を待つ（契約 3.2）。読めなかったときは④にせず投げる（「何もない」に見せない）。
import type { GeoStore } from "@hpai/shared/geo";
import { computeAreaStatus, computeLevel, isZoneActive, prefsToLoad, wildBirdsNotifiable } from "@hpai/shared/level";
import type {
  AreaStatus,
  Case,
  FarmPoint,
  IsoDate,
  IsoDateTime,
  LevelResult,
  MuniCode,
  PrefCode,
  Season,
  WildBird,
} from "@hpai/shared/types";
import { FIXED_TEXT } from "@hpai/shared/wording";
import { SURVEILLANCE_NOTE, TEXT } from "./texts";

export interface TownLine {
  /** 今季の段階の色。lv3 は「登録した町」、none は町が未選択か読めなかったとき、または町の県が見回りで確認できていない④（withWatchState） */
  tone: "lv1" | "lv2" | "lv3" | "lv4" | "none";
  main: string;
  details: string[];
}

const MAX_CASE_LINES = 5;

/** "2026-12-20" → "12 月 20 日"（formatAsOf と同じ書き方） */
export function monthDay(date: IsoDate): string {
  const [, m, d] = date.split("-");
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 事例 1 件の行。確定があれば確定の日、なければ疑いの日 */
function caseLine(c: Case): string | null {
  const s = c.stages;
  const name = c.muniName ?? "";
  if (s.confirmed) return `${name}で確定（${monthDay(s.confirmed.date)}）`;
  if (s.suspected) return `${name}で疑い（${monthDay(s.suspected.date)}）`;
  const first = Object.values(s)
    .map((st) => st?.date)
    .filter((d): d is IsoDate => typeof d === "string")
    .sort()[0];
  return first ? `${name}で発生（${monthDay(first)}）` : null;
}

function caseLines(cases: readonly Case[]): string[] {
  const lines: string[] = [];
  for (const c of cases) {
    const l = caseLine(c);
    if (l !== null) lines.push(l);
  }
  if (lines.length <= MAX_CASE_LINES) return lines;
  return [...lines.slice(0, MAX_CASE_LINES), `ほか ${lines.length - MAX_CASE_LINES} 件`];
}

function birdLine(b: WildBird): string {
  const where = b.muniName ?? "";
  const what = b.test === "hpai_confirmed" ? "野鳥の高病原性の確定" : "野鳥の検査中";
  return `${where}で${what}（${monthDay(b.date)}）`;
}

function birdLines(birds: readonly WildBird[]): string[] {
  return birds.filter((b) => b.test !== "negative").map(birdLine);
}

/** 地点を決めた人の 1 文。reasons のうち、文の元になった段階の事例を行にする */
export function levelLine(result: LevelResult, cases: readonly Case[]): TownLine {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const reasons = result.reasons.filter((r) => r.level === result.level);
  const hit = reasons.map((r) => byId.get(r.caseId)).filter((c): c is Case => c !== undefined);

  switch (result.level) {
    case 1: {
      const details = caseLines(hit);
      if (result.shipmentLifted) details.push(TEXT.shipmentLifted); // 色は変えない（§5）
      if (result.inSurveillanceNote) details.push(SURVEILLANCE_NOTE);
      return { tone: "lv1", main: TEXT.zone, details };
    }
    case 2: {
      // 移動制限の解除の後の同じ市町村に「隣町」と書かない（契約 2.4）
      const sameTown = reasons.some((r) => r.kind === "same_muni");
      return { tone: "lv2", main: sameTown ? FIXED_TEXT.sameMuniLifted : TEXT.adjacent, details: caseLines(hit) };
    }
    case 3:
      return { tone: "lv3", main: TEXT.frequent, details: caseLines(hit) };
    case 4:
      return { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.riskAnywhere] };
  }
}

/** 町だけを選んだ人の 1 文（/area と同じ計算）。距離を見ないので、全段階で areaNoDistance と riskAnywhere を添える */
export function areaLine(status: AreaStatus): TownLine {
  const birds = birdLines(status.wildBirds);
  const tail = [FIXED_TEXT.areaNoDistance, FIXED_TEXT.riskAnywhere];

  if (status.level === 1) {
    const active = status.sameMuniCases.filter(isZoneActive);
    const details = caseLines(active);
    if (active.length > 0 && active.every((c) => c.stages.shipment_lifted !== undefined)) details.push(TEXT.shipmentLifted);
    if (active.some((c) => c.stages.surveillance_lifted === undefined)) details.push(SURVEILLANCE_NOTE);
    return { tone: "lv1", main: TEXT.areaSame, details: [...details, ...birds, ...tail] };
  }
  if (status.level === 2) {
    const sameTown = status.sameMuniCases.length > 0;
    return {
      tone: "lv2",
      main: sameTown ? FIXED_TEXT.sameMuniLifted : TEXT.adjacent,
      details: [...caseLines([...status.sameMuniCases, ...status.adjacentCases]), ...birds, ...tail],
    };
  }
  return { tone: "lv4", main: TEXT.national, details: [...birds, ...tail] };
}

/**
 * 自分の町の県が見回りで確認できていないとき、1 文にそれを加える（同期。見回りの結果が変わるたびに計算し直さない）。
 * ④は「全国の動き」だけにせず、県が確認できていないことを主文にして色も段階の色にしない。
 * ①②③は段階の文と色を保ち、先頭の詳細に足す。町が未選択か読めなかったとき（色なし）は足さない。
 */
export function withWatchState(line: TownLine, townPref: PrefCode | null, failedPrefCodes: readonly PrefCode[]): TownLine {
  if (townPref === null || line.tone === "none" || !failedPrefCodes.includes(townPref)) return line;
  if (line.tone === "lv4") return { tone: "none", main: TEXT.prefUnwatched, details: [...line.details] };
  return { ...line, details: [TEXT.prefUnwatched, ...line.details] };
}

export interface ResolveInput {
  spot: FarmPoint | null;
  town: MuniCode | null;
  /** 今季の事例（読み込めた一覧）。今季でないものは計算に入れない */
  cases: readonly Case[];
  birds: readonly WildBird[];
  season: Season;
  geo: GeoStore;
  asOf: IsoDateTime;
}

export interface ResolvedTown {
  line: TownLine;
  /** 地図で縁を描く、1 文の元になった事例のある町（自分の町は my-town で描くので除く） */
  nearMuniCodes: MuniCode[];
}

const unique = (codes: Iterable<MuniCode>): MuniCode[] => [...new Set(codes)];

/**
 * 1 文と、地図の縁にする町を決める。spot があれば computeLevel、なければ town で computeAreaStatus。
 * 県の形の読み込みに失敗したときは投げる（呼び出し側が「読めませんでした」を出す）。
 */
export async function resolveTown(i: ResolveInput): Promise<ResolvedTown> {
  const cases = i.cases.filter((c) => c.season === i.season);
  const birds = i.birds.filter((b) => b.season === i.season);

  if (i.spot) {
    const { spot } = i;
    // 知らない市町村コードの地点は、隣がなく②が出ないまま④に倒れる。町だけの場合と同じく先に断る
    if (!i.geo.index[spot.muniCode]) return { line: { tone: "none", main: TEXT.unknownTown, details: [] }, nearMuniCodes: [] };
    await i.geo.ensurePrefs(prefsToLoad(cases, birds)); // 距離の前に必ず（契約 3.2）
    const result = computeLevel(spot, cases, i.season, i.geo);
    const line = levelLine(result, cases);
    const notifiable = wildBirdsNotifiable(spot, birds, i.geo);
    line.details.push(...birdLines(notifiable));
    const byId = new Map(cases.map((c) => [c.id, c]));
    const near = result.reasons
      .map((r) => byId.get(r.caseId)?.muniCode)
      .filter((m): m is MuniCode => typeof m === "string" && m !== spot.muniCode);
    return { line, nearMuniCodes: unique(near) };
  }

  if (i.town) {
    // 知らない市町村コード（古い保存や、区のコード）は computeAreaStatus が RangeError にするので、先に断る
    if (!i.geo.index[i.town]) return { line: { tone: "none", main: TEXT.unknownTown, details: [] }, nearMuniCodes: [] };
    const status = computeAreaStatus({ muniCode: i.town, cases, wildBirds: birds, geo: i.geo, asOf: i.asOf, season: i.season });
    const near = status.adjacentCases.map((c) => c.muniCode).filter((m): m is MuniCode => m !== null);
    return { line: areaLine(status), nearMuniCodes: unique(near) };
  }

  return { line: { tone: "none", main: TEXT.noTown, details: [] }, nearMuniCodes: [] };
}

export async function resolveTownLine(i: ResolveInput): Promise<TownLine> {
  return (await resolveTown(i)).line;
}

