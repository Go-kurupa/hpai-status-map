// 毎朝の全国まとめ（設計書 2 章の 5）と、毎朝の札の数え方。純粋な計算と、県の形を待つ計算だけ（読み書きと送信は functions/src/notify/）。
// 多い少ないを判断しない。件数、町、距離はプログラムが入れ、Claude の総括 1 文は checkOverviewSentence に通ったものだけを載せる。
// 農場の位置（マス目）は本文に書かず、距離と町名までにする。全国の文書（OverviewDay）には農場の情報を入れない。
import { addDays, jstDateOf, toJstIso } from "./dates";
import { checkNeighborText, type CheckResult } from "./drafts";
import { distanceToMuniKm, type GeoStore } from "./geo";
import { formatJaDate } from "./jaDate";
import { isCountable, isWithinDistanceBand, summarizeWatch } from "./level";
import { PREFS } from "./pref";
import { compareSeasons } from "./seasonCompare";
import { seasonOf } from "./season";
import { normalizeForMatch } from "./text";
import type { Case, FarmPoint, HistoryCase, IsoDate, IsoDateTime, MuniCode, PrefCode, Season, WatchStatus, WildBird } from "./types";
import { CALMING_WORDS, findWordingViolations, FIXED_TEXT, INTERPRETATION_WORDS, UNVERIFIABLE_REGIONS } from "./wording";

export const RECENT_DAYS = 14;
/** 今季と比べる過去のシーズンの数（シーズンの棒と同じ） */
export const PAST_SEASONS = 6;

/** 日付の文書の置き場。農場の情報を入れない。規則は全拒否に落ちる（サーバーだけが読み書きする）。 */
export const OVERVIEW_COLLECTION = "dailyOverviews";
/** 前回のまとめの印（usage/settings と同じ置き場）。 */
export const OVERVIEW_MARKER_PATH = "usage/overviewMarker";
/** 本文と Claude の入力に並べる町の数の上限。 */
export const OVERVIEW_MAX_PLACES = 10;
/** 送り直しで送ってよい日数。これより古い分は送らない（次に変化があった朝の数字に任せる）。 */
export const OVERVIEW_MAX_RETRY_DAYS = 1;
/** 総括の文字の数の上限。 */
export const OVERVIEW_SENTENCE_MAX_CHARS = 160;

/** data/sources.json の国と環境省の入口と同じ。 */
const MAFF_SEASON_URL = "https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html";
const MOE_BIRD_URL = "https://www.env.go.jp/nature/dobutsu/bird_flu/";

const PREF_NAME = new Map(PREFS.map((p) => [p.code, p.name]));
const prefNameOf = (code: PrefCode): string => PREF_NAME.get(code) ?? code;

/** 疑いの段階しかない事例だけが疑い。確定より後の段階（殺処分など）が記録されていれば確定。 */
export function isSuspectedOnly(c: Case): boolean {
  return !Object.keys(c.stages).some((k) => k !== "suspected");
}

/** 月の棒に入れる日。確定の日、なければ疑いの日、なければ最初の段階の日 */
export function caseDate(c: Case): IsoDate | null {
  const s = c.stages;
  if (s.confirmed) return s.confirmed.date;
  if (s.suspected) return s.suspected.date;
  const dates = Object.values(s)
    .map((st) => st?.date)
    .filter((d): d is IsoDate => typeof d === "string")
    .sort();
  return dates[0] ?? null;
}

/** 今日を含む直近 14 日の今季の件数。日付のない事例は数える（少ない側に倒さない。countThisSeasonToDate と同じ）。未来の日付は入れない */
export function countRecentDays(cases: readonly Case[], current: Season, today: IsoDate): number {
  const from = addDays(today, -(RECENT_DAYS - 1));
  return cases.filter((c) => {
    if (c.season !== current || !isCountable(c)) return false;
    const d = caseDate(c) ?? today;
    return d >= from && d <= today;
  }).length;
}

/** 比べる過去のシーズン（新しい順）。最大 6 つで、記録の最も古いシーズンより前は入れない */
export function pastSeasonsOf(history: readonly HistoryCase[], current: Season): Season[] {
  if (history.length === 0) return [];
  const first = Math.min(...history.map((h) => h.season));
  const oldest = Math.max(current - PAST_SEASONS, first);
  const out: Season[] = [];
  for (let s = current - 1; s >= oldest; s--) out.push(s);
  return out;
}

export interface PastRange {
  seasons: number;
  min: number;
  max: number;
}

/** 過去のシーズンの、今日と同じ日までの件数の幅。比べるシーズンがなければ null。件数のないシーズンは 0 件として入れる */
export function pastRangeToDate(history: readonly HistoryCase[], today: IsoDate): PastRange | null {
  const seasons = pastSeasonsOf(history, seasonOf(today));
  if (seasons.length === 0) return null;
  const toDate = new Map(compareSeasons(history, today).map((r) => [r.season, r.countToDate]));
  const counts = seasons.map((s) => toDate.get(s) ?? 0);
  return { seasons: seasons.length, min: Math.min(...counts), max: Math.max(...counts) };
}

export function rangeText(r: PastRange): string {
  return r.min === r.max ? `${r.min} 件` : `${r.min}〜${r.max} 件`;
}

export interface WildBirdCount {
  total: number;
  confirmed: number;
  screening: number;
}

/** 野鳥の陽性の件数。否定を除き、検査中と確定を分ける（一覧の wildBirdRows と同じ扱い） */
export function wildBirdCounts(birds: readonly WildBird[]): WildBirdCount {
  const rows = birds.filter((b) => b.test !== "negative");
  const confirmed = rows.filter((b) => b.test === "hpai_confirmed").length;
  return { total: rows.length, confirmed, screening: rows.length - confirmed };
}

/** 確認状況の文。47 県すべてのときは県名を並べない（どの県も確認できていない、と読める）。 */
export function watchCoverageText(okCount: number, failedPrefCodes: readonly PrefCode[]): string {
  const names = failedPrefCodes.map(prefNameOf);
  const tail = names.length > 0 && names.length < PREFS.length ? `（${names.join("、")}）` : "";
  return `${PREFS.length} 都道府県のうち ${okCount} 件を確認、${failedPrefCodes.length} 件は確認できていません${tail}`;
}

// ── まとめの事実 ──

/** 本文に並べる新しい発生の 1 行。町は索引の名前だけ（文書の文字をそのまま使わない）。 */
export interface OverviewPlace {
  prefName: string;
  /** 町が分からない、または索引にない。 */
  muniName: string | null;
  date: IsoDate | null;
  suspected: boolean;
  sourceUrl: string | null;
}

/** dailyOverviews/{YYYY-MM-DD}。その朝の全国の事実で固定する（送り直しでも同じ数字を出す）。農場の情報を入れない。 */
export interface OverviewDay {
  date: IsoDate;
  asOf: IsoDateTime;
  season: Season;
  seasonCount: number;
  recentCount: number;
  past: PastRange | null;
  birds: WildBirdCount;
  newCaseCount: number;
  newCases: OverviewPlace[];
  newBirdCount: number;
  newBirds: OverviewPlace[];
  /** 町ごとの今季の件数。会員ごとの距離を、この朝の事例で計算するために持つ。 */
  muniCounts: Record<MuniCode, number>;
  /** 町が分からず、距離を測れない件数。 */
  unknownMuniCount: number;
  /** null は確認の状況を読めなかった。 */
  watch: { okCount: number; failedPrefCodes: PrefCode[] } | null;
  caseIds: string[];
  birdIds: string[];
  /** 検査に通った総括。なければ null（定型だけ）。 */
  sentence: string | null;
  /** 総括を外した理由の符号。文の断片は入れない。 */
  sentenceFailures: string[];
}

/** usage/overviewMarker。 */
export interface OverviewMarker {
  date: IsoDate;
  caseIds: string[];
  birdIds: string[];
}

/** まとめに数える事例。今季、isCountable（否定と確認中を除く）で、再現を除く（isCountable は再現を除かない）。 */
export function overviewCases(cases: readonly Case[], season: Season): Case[] {
  return cases.filter((c) => c.season === season && isCountable(c) && c.confirmState !== "replay");
}

/** まとめに数える野鳥の発表。今季で、否定を除く。 */
export function overviewBirds(birds: readonly WildBird[], season: Season): WildBird[] {
  return birds.filter((b) => b.season === season && b.test !== "negative");
}

/** 前回のまとめの後に、数える事例か野鳥の発表が増えたか。数でなく事例で比べる（1 件の否定と 1 件の追加を見逃さない）。 */
export function hasOverviewChange(marker: Pick<OverviewMarker, "caseIds" | "birdIds"> | null, cases: readonly Case[], birds: readonly WildBird[], season: Season): boolean {
  const seenCases = new Set(marker?.caseIds ?? []);
  const seenBirds = new Set(marker?.birdIds ?? []);
  return overviewCases(cases, season).some((c) => !seenCases.has(c.id)) || overviewBirds(birds, season).some((b) => !seenBirds.has(b.id));
}

const httpUrl = (u: string | null | undefined): string | null => (typeof u === "string" && /^https?:\/\/\S+$/u.test(u) ? u : null);

const muniNameFrom = (geo: Pick<GeoStore, "index">, muni: MuniCode | null): string | null => (muni !== null && Object.hasOwn(geo.index, muni) ? geo.index[muni]!.name : null);

const newestFirst = (a: OverviewPlace, b: OverviewPlace): number => ((a.date ?? "") < (b.date ?? "") ? 1 : (a.date ?? "") > (b.date ?? "") ? -1 : 0);

/** その朝の全国の事実。総括は別に入れる。 */
export function buildOverviewDay(i: {
  now: Date;
  cases: readonly Case[];
  birds: readonly WildBird[];
  /** null は過去の記録を読めなかった。 */
  history: readonly HistoryCase[] | null;
  /** null は確認の状況を読めなかった。 */
  watch: readonly WatchStatus[] | null;
  marker: Pick<OverviewMarker, "caseIds" | "birdIds"> | null;
  geo: Pick<GeoStore, "index">;
}): OverviewDay {
  const date = jstDateOf(i.now);
  const season = seasonOf(date);
  const cases = overviewCases(i.cases, season);
  const birds = overviewBirds(i.birds, season);
  const seenCases = new Set(i.marker?.caseIds ?? []);
  const seenBirds = new Set(i.marker?.birdIds ?? []);
  const newCases = cases
    .filter((c) => !seenCases.has(c.id))
    .map((c): OverviewPlace => ({ prefName: prefNameOf(c.prefCode), muniName: muniNameFrom(i.geo, c.muniCode), date: caseDate(c), suspected: isSuspectedOnly(c), sourceUrl: httpUrl(c.sourceUrls?.at(-1)) }))
    .sort(newestFirst);
  const newBirds = birds
    .filter((b) => !seenBirds.has(b.id))
    .map((b): OverviewPlace => ({ prefName: prefNameOf(b.prefCode), muniName: muniNameFrom(i.geo, b.muniCode), date: b.date, suspected: false, sourceUrl: httpUrl(b.sourceUrl) }))
    .sort(newestFirst);
  const muniCounts: Record<MuniCode, number> = {};
  for (const c of cases) if (c.muniCode !== null) muniCounts[c.muniCode] = (muniCounts[c.muniCode] ?? 0) + 1;
  const watch = i.watch === null ? null : summarizeWatch(i.watch, i.now);
  return {
    date,
    asOf: toJstIso(i.now),
    season,
    seasonCount: cases.length,
    recentCount: countRecentDays(cases, season, date),
    past: i.history === null ? null : pastRangeToDate(i.history, date),
    birds: wildBirdCounts(birds),
    newCaseCount: newCases.length,
    newCases: newCases.slice(0, OVERVIEW_MAX_PLACES),
    newBirdCount: newBirds.length,
    newBirds: newBirds.slice(0, OVERVIEW_MAX_PLACES),
    muniCounts,
    unknownMuniCount: cases.filter((c) => c.muniCode === null).length,
    watch: watch === null ? null : { okCount: watch.okCount, failedPrefCodes: watch.failedPrefCodes },
    caseIds: cases.map((c) => c.id).sort(),
    birdIds: birds.map((b) => b.id).sort(),
    sentence: null,
    sentenceFailures: [],
  };
}

// ── 会員ごとの近くの発生 ──

export interface NearRow {
  prefName: string;
  muniName: string;
  count: number;
  /** 農場のマス目から町の面までの距離（1 以上の整数）。同じ町は 0。 */
  distanceKm: number;
  sameTown: boolean;
  registered: boolean;
}

export interface NearFacts {
  withinCount: number;
  within: NearRow[];
  /** 登録した町がなければ null。 */
  registeredCount: number | null;
  registered: Array<{ prefName: string; muniName: string; count: number }>;
}

/**
 * その朝の事例の、農場から約 60km 以内の町と登録した町。距離の測り方と帯は relationToCase と同じ（distanceToMuniKm、isWithinDistanceBand）。
 * 段階の種類で絞らない（①②の近い発生も帯の中に数える）。形を読めないとき、索引にない町があるときは投げる（0 件にしない）。
 */
export async function nearFactsOf(p: FarmPoint, day: Pick<OverviewDay, "muniCounts">, geo: GeoStore): Promise<NearFacts> {
  const entries = Object.entries(day.muniCounts);
  const entryOf = (muni: MuniCode) => {
    if (!Object.hasOwn(geo.index, muni)) throw new Error("市町村の索引にありません");
    return geo.index[muni]!;
  };
  await geo.ensurePrefs([...new Set(entries.map(([muni]) => entryOf(muni).prefCode))].sort());
  const frequent = Array.isArray(p.frequentMuniCodes) ? p.frequentMuniCodes : [];
  const within: NearRow[] = [];
  for (const [muni, count] of entries) {
    const sameTown = muni === p.muniCode;
    const km = sameTown ? 0 : distanceToMuniKm(p.meshCode, muni, geo);
    if (!isWithinDistanceBand(km)) continue;
    const e = entryOf(muni);
    within.push({ prefName: prefNameOf(e.prefCode), muniName: e.name, count, distanceKm: sameTown ? 0 : Math.max(1, Math.round(km)), sameTown, registered: frequent.includes(muni) });
  }
  within.sort((a, b) => a.distanceKm - b.distanceKm || (a.muniName < b.muniName ? -1 : 1));
  const registered = frequent.flatMap((muni) => {
    const count = day.muniCounts[muni] ?? 0;
    if (count === 0) return [];
    const e = entryOf(muni);
    return [{ prefName: prefNameOf(e.prefCode), muniName: e.name, count }];
  });
  return {
    withinCount: within.reduce((n, r) => n + r.count, 0),
    within,
    registeredCount: frequent.length === 0 ? null : registered.reduce((n, r) => n + r.count, 0),
    registered,
  };
}

// ── 本文 ──

const AI_LABEL = "AI の要約（数字と町名はプログラムが確かめています）";

function placeLine(p: OverviewPlace): string {
  const notes = [p.date === null ? null : formatJaDate(p.date), p.suspected ? "疑い" : null].filter((x): x is string => x !== null);
  const tail = notes.length > 0 ? `（${notes.join("、")}）` : "";
  const src = p.sourceUrl === null ? "" : ` ${p.sourceUrl}`;
  return `・${p.prefName}${p.muniName ?? "（町は確認中）"}${tail}${src}`;
}

const asOfText = (d: Pick<OverviewDay, "date" | "asOf">): string => `${formatJaDate(d.date)} ${d.asOf.slice(11, 16)}`;

/** 全国まとめの節。先頭に riskAnywhere（件数の札の前に置く決まり）。near が null は近くの件数を計算できなかった（0 と書かない）。 */
export function overviewLines(d: OverviewDay, near: NearFacts | null, appUrl: string): string[] {
  const lines = [`■ 全国の状況（${asOfText(d)} 時点）`, FIXED_TEXT.riskAnywhere];
  if (d.sentence !== null) lines.push(`${AI_LABEL}: ${d.sentence}`);
  lines.push(`今季の全国の発生: ${d.seasonCount} 件`, `直近 ${RECENT_DAYS} 日の全国の発生: ${d.recentCount} 件`);
  if (d.past === null) lines.push("過去のシーズンの同じ日までの件数は、今朝は出せませんでした。");
  else lines.push(`過去 ${d.past.seasons} シーズンの同じ日までの件数: ${rangeText(d.past)}`, `${FIXED_TEXT.pastDisclaimer}。`);
  lines.push(`野鳥の陽性: ${d.birds.total} 件（高病原性の確定 ${d.birds.confirmed} 件、検査中 ${d.birds.screening} 件）`);

  lines.push("", `今回新しく載せた発生: ${d.newCaseCount} 件`, ...d.newCases.map(placeLine));
  if (d.newCaseCount > d.newCases.length) lines.push(`ほか ${d.newCaseCount - d.newCases.length} 件`);
  if (d.newBirdCount > 0) {
    lines.push(`今回新しく載せた野鳥の発表: ${d.newBirdCount} 件`, ...d.newBirds.map(placeLine));
    if (d.newBirdCount > d.newBirds.length) lines.push(`ほか ${d.newBirdCount - d.newBirds.length} 件`);
  }

  lines.push("");
  if (near === null) {
    lines.push("約 60km 以内の今季の発生は、今朝は出せませんでした。画面で確かめてください。");
  } else {
    lines.push(`約 60km 以内の今季の発生: ${near.withinCount} 件`);
    for (const r of near.within) {
      lines.push(`・${r.prefName}${r.muniName} ${r.sameTown ? "同じ町" : `約 ${r.distanceKm} km`} ${r.count} 件${r.registered ? "（登録した町）" : ""}`);
    }
    if (near.registeredCount !== null) {
      lines.push(`登録した町の今季の発生: ${near.registeredCount} 件`);
      for (const r of near.registered) lines.push(`・${r.prefName}${r.muniName} ${r.count} 件`);
    }
  }
  if (d.unknownMuniCount > 0) lines.push(`町が分からない発表 ${d.unknownMuniCount} 件は、距離に入れていません。`);
  lines.push("距離は目安で、発表の区域ではありません。");

  lines.push(d.watch === null ? "県の発表の確認の状況を読めませんでした。" : watchCoverageText(d.watch.okCount, d.watch.failedPrefCodes));
  lines.push(`農林水産省の発表: ${MAFF_SEASON_URL}`, `環境省の発表: ${MOE_BIRD_URL}`);
  lines.push(`地図で見る: ${appUrl.replace(/\/+$/, "")}/`);
  return lines;
}

// ── Claude の総括 ──

/** Claude に渡す公開の事実。件数と、新しく載せた町だけ。農場、会員、URL、文書の原文を入れない。 */
export function overviewClaudeInput(d: OverviewDay): string {
  const places = [...d.newCases.map((p) => ({ p, kind: "農場" })), ...d.newBirds.map((p) => ({ p, kind: "野鳥" }))]
    .filter(({ p }) => p.muniName !== null)
    .map(({ p, kind }) => ({ prefecture: p.prefName, town: p.muniName, kind, suspected: p.suspected }));
  return JSON.stringify({
    seasonCount: d.seasonCount,
    recent14DaysCount: d.recentCount,
    pastSameDate: d.past,
    wildBirdCount: d.birds.total,
    newCaseCount: d.newCaseCount,
    places,
  });
}

type ItemLabel = "season" | "recent" | "past" | "bird" | "new";

const ITEM_OF: ReadonlyArray<[RegExp, ItemLabel | null]> = [
  [/^直近14日$/u, "recent"],
  [/^(?:過去\d+シーズン|例年|過去|同じ日)$/u, "past"],
  [/^約?60km$/u, null], // 距離の目安の語。後ろの件数は項目に結び付かない
  [/^(?:今季|今シーズン)$/u, "season"],
  [/^野鳥$/u, "bird"],
  [/^(?:前回|新た|新しく)$/u, "new"],
];

/** 数字は、固定の語（直近 14 日、過去 N シーズン、約 60km）か、直前の項目の値と一致する「N 件」だけ。N シーズンは実際に比べた数。項目のない数字は落とす。 */
function numberFailures(t: string, d: OverviewDay): string[] {
  const out = new Set<string>();
  const expected: Record<ItemLabel, readonly number[]> = {
    season: [d.seasonCount],
    recent: [d.recentCount],
    past: d.past === null ? [] : [d.past.min, d.past.max],
    bird: [d.birds.total],
    new: [d.newCaseCount],
  };
  let item: ItemLabel | null = null;
  const re = /直近14日|過去(\d+)シーズン|約?60km|今季|今シーズン|例年|過去|同じ日|野鳥|前回|新た|新しく|(\d+)[~〜](\d+)件|(\d+)件|\d+/gu;
  for (const m of t.matchAll(re)) {
    if (m[1] !== undefined && Number(m[1]) !== d.past?.seasons) out.add("number_mismatch:past");
    if (m[2] !== undefined) {
      if (item === null) out.add("number_without_item");
      else if (item !== "past" || d.past === null || Number(m[2]) !== d.past.min || Number(m[3]) !== d.past.max) out.add(`number_mismatch:${item}`);
    } else if (m[4] !== undefined) {
      if (item === null) out.add("number_without_item");
      else if (!expected[item].includes(Number(m[4]))) out.add(`number_mismatch:${item}`);
    } else if (/^\d/u.test(m[0]) && !/^60km$/u.test(m[0])) {
      out.add("number_without_item");
    } else {
      const hit = ITEM_OF.find(([word]) => word.test(m[0]));
      if (hit) item = hit[1];
    }
  }
  return [...out];
}

/** 定型に含まれない町、県、地方。許す名前を先に取り除き、残りに索引の名前、県名、「〜市」の形があれば落とす。 */
function placeFailures(t: string, d: OverviewDay, knownMuniNames: readonly string[]): string[] {
  const allowed = [...d.newCases, ...d.newBirds].flatMap((p) => (p.muniName === null ? [p.prefName] : [p.prefName, p.muniName]));
  let rest = t;
  for (const name of [...new Set(allowed.map(normalizeForMatch))].sort((a, b) => b.length - a.length)) rest = rest.replaceAll(name, "");
  const known = [...knownMuniNames, ...PREFS.map((p) => p.name), ...UNVERIFIABLE_REGIONS];
  if (known.some((name) => rest.includes(normalizeForMatch(name)))) return ["unknown_place"];
  if (/[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]+[市町村郡区]/u.test(rest) || /\p{Script=Han}+県/u.test(rest)) return ["unknown_place"];
  return [];
}

/**
 * 総括の検査。落ちたら総括を外し、定型だけを送る。理由の符号に文の断片を入れない（出力は外部の文字として扱う）。
 * 1 文、数字と項目の対応、町名、禁句、少なさや今後を言い切る語を見る。意味の判断はしないので、迷う言い回しは落とす側に倒す。
 * 長さと URL は functions の lengthAndUrlFailures が見る。
 */
export function checkOverviewSentence(text: string, d: OverviewDay, knownMuniNames: readonly string[]): CheckResult {
  const raw = text.trim();
  const failures: string[] = [];
  const stops = raw.match(/[。．.！!？?]/gu) ?? [];
  if (/[\r\n]/u.test(raw) || stops.length !== 1 || !raw.endsWith("。")) failures.push("not_one_sentence");

  const t = normalizeForMatch(raw);
  failures.push(...numberFailures(t, d), ...placeFailures(t, d, knownMuniNames));
  for (const w of findWordingViolations(t)) failures.push(`wording:${w}`);
  // 漢数字、煽る語、禁句、健康の語、言い切りの形は、説明文の検査と同じ部品。数字はここで見終わっているので素通しする
  failures.push(...checkNeighborText(t, t.match(/\d+/gu) ?? [], { input: "" }).failures);
  for (const w of CALMING_WORDS) if (t.includes(normalizeForMatch(w))) failures.push(`calming:${w}`);
  for (const w of INTERPRETATION_WORDS) if (t.includes(normalizeForMatch(w))) failures.push(`interpretation:${w}`);
  if (/ありません|ない|無い|なし|ゼロ/u.test(t)) failures.push("negation");
  if (t.includes("区域")) failures.push("zone");
  // 全員に同じ文を送るので、農場ごとに違う距離の帯の中の発生を言い切らない
  if (/60km.{0,12}(?:発生|確認|出て|広が|近づ|迫)/u.test(t)) failures.push("band_claim");
  const suspectedNamed = [...d.newCases].some((p) => p.suspected && p.muniName !== null && t.includes(normalizeForMatch(p.muniName)));
  if (suspectedNamed && !t.includes("疑い")) failures.push("missing_suspected_word");
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
