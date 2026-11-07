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
import { PREFS } from "@hpai/shared/pref";
import { SURVEILLANCE_NOTE, TEXT } from "./texts";

export interface TownLine {
  /** 今季の段階の色。lv3 は「距離の帯」と「登録した町」、none は町が未選択か読めなかったとき、または町の県のホームページを読み込めていない④（withWatchState） */
  tone: "lv1" | "lv2" | "lv3" | "lv4" | "none";
  main: string;
  details: string[];
  /**
   * スマホで地図の前に出す短い文と、地図の下の行の先頭に添える行（2026-11-07 作者の決定）。
   * 時刻つきの文は地図の前で 3 行になり、地図が最初の画面からはみ出すので、地図の前は時刻なし、時刻は地図の下に出す。PC は main のまま
   */
  lead?: { main: string; note: string };
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
export function levelLine(result: LevelResult, cases: readonly Case[], frequentMuniCodes: readonly MuniCode[] = []): TownLine {
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
    case 3: {
      const distances = reasons.flatMap((r) => (r.kind === "distance_band" && r.distanceKm !== null ? [r.distanceKm] : []));
      if (distances.length === 0) return { tone: "lv3", main: TEXT.frequent, details: caseLines(hit) };
      // 最も近い発生の距離。主文を帯にしても、登録した町で発生したことは消さない
      const registered =
        reasons.some((r) => r.kind === "frequent") || hit.some((c) => c.muniCode !== null && frequentMuniCodes.includes(c.muniCode));
      return {
        tone: "lv3",
        main: TEXT.distanceBand(Math.max(1, Math.round(Math.min(...distances)))),
        details: [...(registered ? [TEXT.frequent] : []), ...caseLines(hit)],
      };
    }
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

/** 町の隣の市町村が属する県（自分の県を除く）。区域は県をまたぐので、これらの県の確認の結果も町の 1 文に関わる */
export function neighborPrefsOf(townCode: MuniCode, geo: Pick<GeoStore, "index" | "adjacency">): PrefCode[] {
  const own = geo.index[townCode]?.prefCode;
  const prefs = new Set<PrefCode>();
  for (const n of geo.adjacency[townCode] ?? []) {
    const p = geo.index[n]?.prefCode;
    if (p !== undefined && p !== own) prefs.add(p);
  }
  return [...prefs].sort();
}

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));

/** "2026-11-07T09:29:19+09:00" → "11 月 7 日 9:29"（日本時間）。読めなければ null */
export function sinceLabel(iso: IsoDateTime | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const j = new Date(t + 9 * 3_600_000);
  return `${j.getUTCMonth() + 1} 月 ${j.getUTCDate()} 日 ${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 自分の町の県、または隣の県のホームページを読み込めていないとき、1 文にそれを加える（同期。確認の結果が変わるたびに計算し直さない）。
 * failingSince は県ごとの 1 回目に読めなかった時刻。あれば「〇月〇日 〇:〇〇 から」を添え、なければ時刻を付けない（推測で書かない）。
 * ④は「全国の動き」だけにせず、確認できていないことを主文にして色も段階の色にしない。
 * ①②③は段階の文と色を保ち、先頭の詳細に足す。町が未選択か読めなかったとき（色なし）は足さない。
 * 隣の県の文は、隣の市町村より先に届く区域（地点は 10.85km）までは見ていない最低線。
 */
export function withWatchState(
  line: TownLine,
  townPref: PrefCode | null,
  failedPrefCodes: readonly PrefCode[],
  neighborPrefs: readonly PrefCode[] = [],
  failingSince: Readonly<Partial<Record<PrefCode, IsoDateTime>>> = {},
): TownLine {
  if (townPref === null || line.tone === "none") return line;
  const since = (p: PrefCode): string | null => sinceLabel(failingSince[p] ?? null);
  // 文ごとに、時刻のない短い文と、地図の下に添える時刻の行（時刻がなければ null）を持つ
  const notes: Array<{ text: string; short: string; note: string | null }> = [];
  if (failedPrefCodes.includes(townPref)) {
    const own = since(townPref);
    notes.push(
      own === null
        ? { text: TEXT.prefUnwatched, short: TEXT.prefUnwatched, note: null }
        : { text: TEXT.prefUnwatchedSince(own), short: TEXT.prefUnwatched, note: TEXT.unwatchedSinceNote([{ name: null, since: own }]) },
    );
  }
  const failedNeighbors = neighborPrefs.filter((p) => p !== townPref && failedPrefCodes.includes(p));
  if (failedNeighbors.length > 0) {
    const prefs = failedNeighbors.map((p) => ({ name: PREF_NAME.get(p) ?? p, since: since(p) }));
    const undated = prefs.map((p) => ({ ...p, since: null }));
    const dated = prefs.filter((p) => p.since !== null);
    notes.push({ text: TEXT.neighborUnwatched(prefs), short: TEXT.neighborUnwatched(undated), note: dated.length === 0 ? null : TEXT.unwatchedSinceNote(prefs.length === 1 ? [{ name: null, since: dated[0]!.since }] : dated) });
  }
  if (notes.length === 0) return line;
  if (line.tone === "lv4") {
    const [head, ...rest] = notes;
    const out: TownLine = { tone: "none", main: head!.text, details: [...rest.map((n) => n.text), ...line.details] };
    return head!.note === null ? out : { ...out, lead: { main: head!.short, note: head!.note } };
  }
  return { ...line, details: [...notes.map((n) => n.text), ...line.details] };
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
    const line = levelLine(result, cases, spot.frequentMuniCodes);
    const notifiable = wildBirdsNotifiable(spot, birds, i.geo);
    line.details.push(...birdLines(notifiable));
    const byId = new Map(cases.map((c) => [c.id, c]));
    // 距離の帯の町には縁を付けない（町の輪郭の縁は隣と登録の印）。帯の中でも登録した町には付ける
    const near = result.reasons
      .map((r) => ({ kind: r.kind, muni: byId.get(r.caseId)?.muniCode }))
      .filter((h) => h.kind !== "distance_band" || (typeof h.muni === "string" && spot.frequentMuniCodes.includes(h.muni)))
      .map((h) => h.muni)
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

