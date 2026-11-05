// 毎朝の全国まとめ（設計書 2 章の 5）と、毎朝の札の数え方。純粋な計算と、県の形を待つ計算だけ（読み書きと送信は functions/src/notify/）。
// 多い少ないを判断しない。件数、町、距離はプログラムが入れ、Claude の総括 1 文は checkOverviewSentence（許した語だけでできているか）に通ったものだけを載せる。
// 農場の位置（マス目）は本文に書かず、距離と町名までにする。全国の文書（OverviewDay）には農場の情報を入れない。
import { addDays, jstDateOf, toJstIso } from "./dates";
import type { CheckResult } from "./drafts";
import { distanceToMuniKm, type GeoStore } from "./geo";
import { formatJaDate } from "./jaDate";
import { isCountable, isWithinDistanceBand, summarizeWatch } from "./level";
import { PREFS } from "./pref";
import { compareSeasons } from "./seasonCompare";
import { seasonOf } from "./season";
import { normalizeForMatch } from "./text";
import type { Case, FarmPoint, HistoryCase, IsoDate, IsoDateTime, MuniCode, PrefCode, Season, WatchStatus, WildBird } from "./types";
import { FIXED_TEXT } from "./wording";

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
  /** 野鳥の検査中。農場の事例には付けない。 */
  screening?: boolean;
  sourceUrl: string | null;
}

/** 印に残す、前回載せた事例か発表の段階と場所。次の朝に比べて訂正の行を作る。 */
export interface OverviewMark {
  stage: "suspected" | "confirmed" | "screening";
  prefName: string;
  muniName: string | null;
}

/** 前回載せたものの訂正。人が確かめて否定にしたもの（negated）と、段階が変わったもの、件数から外れたもの。 */
export interface OverviewCorrection {
  target: "case" | "bird";
  change: "negated" | "to_confirmed" | "to_suspected" | "to_screening" | "withdrawn";
  /** 県と町（確認中に戻ったものは県だけ）。古い印で分からなければ null。 */
  place: string | null;
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
  /** null は比べる印がない最初の朝。新規の節を出さない（0 件とも書かない）。 */
  newCaseCount: number | null;
  newCases: OverviewPlace[];
  newBirdCount: number | null;
  newBirds: OverviewPlace[];
  corrections: OverviewCorrection[];
  /** 確認中の事例がある県。件数には入れない。 */
  reviewingPrefCodes: PrefCode[];
  /** 町ごとの今季の件数。会員ごとの距離を、この朝の事例で計算するために持つ。 */
  muniCounts: Record<MuniCode, number>;
  /** 町が分からず、距離を測れない件数。 */
  unknownMuniCount: number;
  /** null は確認の状況を読めなかった。 */
  watch: { okCount: number; failedPrefCodes: PrefCode[] } | null;
  caseIds: string[];
  birdIds: string[];
  caseMarks: Record<string, OverviewMark>;
  birdMarks: Record<string, OverviewMark>;
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
  /** 古い印にはない（そのときは ID だけで比べる）。 */
  caseMarks?: Record<string, OverviewMark>;
  birdMarks?: Record<string, OverviewMark>;
}

/** まとめと比べる印の形。date があればシーズンの変わり目を見分ける。 */
export type OverviewPrior = Pick<OverviewMarker, "caseIds" | "birdIds" | "caseMarks" | "birdMarks"> & { date?: IsoDate };

/** まとめに数える事例。今季、isCountable（否定と確認中を除く）で、再現を除く（isCountable は再現を除かない）。 */
export function overviewCases(cases: readonly Case[], season: Season): Case[] {
  return cases.filter((c) => c.season === season && isCountable(c) && c.confirmState !== "replay");
}

/** まとめに数える野鳥の発表。今季で、否定を除く。 */
export function overviewBirds(birds: readonly WildBird[], season: Season): WildBird[] {
  return birds.filter((b) => b.season === season && b.test !== "negative");
}

const caseStage = (c: Case): OverviewMark["stage"] => (isSuspectedOnly(c) ? "suspected" : "confirmed");
const birdStage = (b: WildBird): OverviewMark["stage"] => (b.test === "hpai_confirmed" ? "confirmed" : "screening");

const STAGE_CHANGE: Record<OverviewMark["stage"], OverviewCorrection["change"]> = { suspected: "to_suspected", confirmed: "to_confirmed", screening: "to_screening" };

const markPlace = (m: OverviewMark | undefined): string | null => (m === undefined ? null : `${m.prefName}${m.muniName ?? ""}`);

/** 前のシーズンの印の中身は、今季の問い合わせには出てこないので、消えたと数えない。印があること自体は残す（新規の節は出す）。 */
function priorInSeason(marker: OverviewPrior, season: Season): OverviewPrior {
  return marker.date !== undefined && seasonOf(marker.date) !== season ? { caseIds: [], birdIds: [] } : marker;
}

/**
 * 前回載せたものと今の差から作る訂正の行。否定は negated だけ（否定の候補は数えたまま。人が確かめて消す決まり）。
 * 段階は、印に段階があるものだけ比べる（古い印で、配備の朝に全件を訂正にしない）。確認中に戻ったものは町を書かない。
 */
function correctionsOf(marker: OverviewPrior | null, cases: readonly Case[], birds: readonly WildBird[], season: Season): OverviewCorrection[] {
  if (marker === null) return [];
  const prior = priorInSeason(marker, season);
  const out: OverviewCorrection[] = [];
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const counted = new Set(overviewCases(cases, season).map((c) => c.id));
  for (const id of [...prior.caseIds].sort()) {
    const c = caseById.get(id);
    const mark = prior.caseMarks?.[id];
    if (counted.has(id)) {
      const stage = caseStage(c!);
      if (mark !== undefined && mark.stage !== stage) out.push({ target: "case", change: STAGE_CHANGE[stage], place: markPlace(mark) });
    } else if (c?.negation === "negated") {
      out.push({ target: "case", change: "negated", place: markPlace(mark) ?? prefNameOf(c.prefCode) });
    } else if (c !== undefined) {
      out.push({ target: "case", change: "withdrawn", place: prefNameOf(c.prefCode) }); // 確認中に戻ったものは、町を書かない
    } else {
      out.push({ target: "case", change: "withdrawn", place: markPlace(mark) });
    }
  }
  const birdById = new Map(birds.map((b) => [b.id, b]));
  const countedBirds = new Set(overviewBirds(birds, season).map((b) => b.id));
  for (const id of [...prior.birdIds].sort()) {
    const b = birdById.get(id);
    const mark = prior.birdMarks?.[id];
    if (countedBirds.has(id)) {
      const stage = birdStage(b!);
      if (mark !== undefined && mark.stage !== stage) out.push({ target: "bird", change: STAGE_CHANGE[stage], place: markPlace(mark) });
    } else if (b?.test === "negative") {
      out.push({ target: "bird", change: "negated", place: markPlace(mark) ?? prefNameOf(b.prefCode) });
    } else {
      out.push({ target: "bird", change: "withdrawn", place: markPlace(mark) });
    }
  }
  return out;
}

/** 前回のまとめの後に、変化があったか。増えた事例と発表のほか、消えたもの（否定を含む）、段階が変わったものも数える。数でなく事例で比べる。 */
export function hasOverviewChange(marker: OverviewPrior | null, cases: readonly Case[], birds: readonly WildBird[], season: Season): boolean {
  const prior = marker === null ? null : priorInSeason(marker, season);
  const seenCases = new Set(prior?.caseIds ?? []);
  const seenBirds = new Set(prior?.birdIds ?? []);
  return overviewCases(cases, season).some((c) => !seenCases.has(c.id)) || overviewBirds(birds, season).some((b) => !seenBirds.has(b.id)) || correctionsOf(marker, cases, birds, season).length > 0;
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
  marker: OverviewPrior | null;
  geo: Pick<GeoStore, "index">;
}): OverviewDay {
  const date = jstDateOf(i.now);
  const season = seasonOf(date);
  const cases = overviewCases(i.cases, season);
  const birds = overviewBirds(i.birds, season);
  // 印がない朝は、今季の全件を「新しい」と言わない
  const prior = i.marker === null ? null : priorInSeason(i.marker, season);
  const seenCases = new Set(prior?.caseIds ?? []);
  const seenBirds = new Set(prior?.birdIds ?? []);
  const newCases = (prior === null ? [] : cases)
    .filter((c) => !seenCases.has(c.id))
    .map((c): OverviewPlace => ({ prefName: prefNameOf(c.prefCode), muniName: muniNameFrom(i.geo, c.muniCode), date: caseDate(c), suspected: isSuspectedOnly(c), sourceUrl: httpUrl(c.sourceUrls?.at(-1)) }))
    .sort(newestFirst);
  const newBirds = (prior === null ? [] : birds)
    .filter((b) => !seenBirds.has(b.id))
    .map((b): OverviewPlace => ({ prefName: prefNameOf(b.prefCode), muniName: muniNameFrom(i.geo, b.muniCode), date: b.date, suspected: false, screening: b.test !== "hpai_confirmed", sourceUrl: httpUrl(b.sourceUrl) }))
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
    newCaseCount: prior === null ? null : newCases.length,
    newCases: newCases.slice(0, OVERVIEW_MAX_PLACES),
    newBirdCount: prior === null ? null : newBirds.length,
    newBirds: newBirds.slice(0, OVERVIEW_MAX_PLACES),
    corrections: correctionsOf(i.marker, i.cases, i.birds, season),
    reviewingPrefCodes: [...new Set(i.cases.filter((c) => c.season === season && c.confirmState === "reviewing" && c.negation !== "negated").map((c) => c.prefCode))].sort(),
    muniCounts,
    unknownMuniCount: cases.filter((c) => c.muniCode === null).length,
    watch: watch === null ? null : { okCount: watch.okCount, failedPrefCodes: watch.failedPrefCodes },
    caseIds: cases.map((c) => c.id).sort(),
    birdIds: birds.map((b) => b.id).sort(),
    caseMarks: Object.fromEntries(cases.map((c) => [c.id, { stage: caseStage(c), prefName: prefNameOf(c.prefCode), muniName: muniNameFrom(i.geo, c.muniCode) }])),
    birdMarks: Object.fromEntries(birds.map((b) => [b.id, { stage: birdStage(b), prefName: prefNameOf(b.prefCode), muniName: muniNameFrom(i.geo, b.muniCode) }])),
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

// 検査が見るのは文の形と、件数と町が下の値と組で合うことだけ。文の意味や、元の発表が正しいかは確かめていない
const AI_LABEL = "AI の要約（決まった形の文で、件数と町名が下の値と合うものだけを載せています）";

function placeLine(p: OverviewPlace): string {
  const notes = [p.date === null ? null : formatJaDate(p.date), p.suspected ? "疑い" : null].filter((x): x is string => x !== null);
  const tail = notes.length > 0 ? `（${notes.join("、")}）` : "";
  const src = p.sourceUrl === null ? "" : ` ${p.sourceUrl}`;
  return `・${p.prefName}${p.muniName ?? "（町は確認中）"}${tail}${src}`;
}

/** 県の発表から数えた件数の書き方。画面の countText と同じ形。確認の状況を読めない朝は、全県が未確認と同じに扱う。 */
function countedText(n: number, watch: OverviewDay["watch"]): string {
  const unchecked = watch === null ? PREFS.length : watch.failedPrefCodes.length;
  if (unchecked >= PREFS.length) return "まだ確認できていません";
  return unchecked > 0 ? `確認できた範囲では ${n} 件（${unchecked} 県は確認できていません）` : `${n} 件`;
}

function correctionLine(c: OverviewCorrection): string {
  const place = c.place ?? "";
  if (c.target === "case") {
    switch (c.change) {
      case "negated":
        return `訂正: ${place}の疑いは否定されました`;
      case "to_confirmed":
        return `訂正: ${place}は疑いから確定に変わりました`;
      case "to_suspected":
        return `訂正: ${place}は確定から疑いに変わりました`;
      default:
        return c.place === null ? "訂正: 前回載せた発生 1 件は、今回の件数に入れていません" : `訂正: 前回載せた${place}の発生は、今回の件数に入れていません`;
    }
  }
  switch (c.change) {
    case "negated":
      return `訂正: ${place}の野鳥の陽性は否定されました`;
    case "to_confirmed":
      return `訂正: ${place}の野鳥は検査中から高病原性の確定に変わりました`;
    case "to_screening":
      return `訂正: ${place}の野鳥は高病原性の確定から検査中に変わりました`;
    default:
      return c.place === null ? "訂正: 前回載せた野鳥の発表 1 件は、今回の件数に入れていません" : `訂正: 前回載せた${place}の野鳥の発表は、今回の件数に入れていません`;
  }
}

const asOfText = (d: Pick<OverviewDay, "date" | "asOf">): string => `${formatJaDate(d.date)} ${d.asOf.slice(11, 16)}`;

/** 全国まとめの節。先頭に riskAnywhere（件数の札の前に置く決まり）。near が null は近くの件数を計算できなかった（0 と書かない）。 */
export function overviewLines(d: OverviewDay, near: NearFacts | null, appUrl: string): string[] {
  const lines = [`■ 全国の状況（${asOfText(d)} 時点）`, FIXED_TEXT.riskAnywhere];
  if (d.sentence !== null) lines.push(`${AI_LABEL}: ${d.sentence}`);
  lines.push(`今季の全国の発生: ${countedText(d.seasonCount, d.watch)}`, `直近 ${RECENT_DAYS} 日の全国の発生: ${countedText(d.recentCount, d.watch)}`);
  if (d.past === null) lines.push("過去のシーズンの同じ日までの件数は、今朝は出せませんでした。");
  else lines.push(`過去 ${d.past.seasons} シーズンの同じ日までの件数: ${rangeText(d.past)}`, `${FIXED_TEXT.pastDisclaimer}。`);
  lines.push(`野鳥の陽性: ${d.birds.total} 件（高病原性の確定 ${d.birds.confirmed} 件、検査中 ${d.birds.screening} 件）`);

  // 送り直しで、この形より前に作った日付の文書を読むことがあるので ?? [] で受ける
  const reviewing = d.reviewingPrefCodes ?? [];
  if (reviewing.length > 0) lines.push(`確認中の発表がある県: ${reviewing.map(prefNameOf).join("、")}。件数にはまだ入れていません。`);

  const changes: string[] = [];
  if (d.newCaseCount !== null) {
    changes.push(`今回新しく載せた発生: ${d.newCaseCount} 件`, ...d.newCases.map(placeLine));
    if (d.newCaseCount > d.newCases.length) changes.push(`ほか ${d.newCaseCount - d.newCases.length} 件`);
  }
  if (d.newBirdCount !== null && d.newBirdCount > 0) {
    changes.push(`今回新しく載せた野鳥の発表: ${d.newBirdCount} 件`, ...d.newBirds.map(placeLine));
    if (d.newBirdCount > d.newBirds.length) changes.push(`ほか ${d.newBirdCount - d.newBirds.length} 件`);
  }
  const corrections = d.corrections ?? [];
  changes.push(...corrections.slice(0, OVERVIEW_MAX_PLACES).map(correctionLine));
  if (corrections.length > OVERVIEW_MAX_PLACES) changes.push(`ほか ${corrections.length - OVERVIEW_MAX_PLACES} 件の訂正があります`);
  if (changes.length > 0) lines.push("", ...changes);

  lines.push("");
  if (near === null) {
    lines.push("約 60km 以内の今季の発生は、今朝は出せませんでした。画面で確かめてください。");
  } else {
    lines.push(`約 60km 以内の今季の発生: ${countedText(near.withinCount, d.watch)}`);
    for (const r of near.within) {
      lines.push(`・${r.prefName}${r.muniName} ${r.sameTown ? "同じ町" : `約 ${r.distanceKm} km`} ${r.count} 件${r.registered ? "（登録した町）" : ""}`);
    }
    if (near.registeredCount !== null) {
      lines.push(`登録した町の今季の発生: ${countedText(near.registeredCount, d.watch)}`);
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

/** 全県を確認できた朝か。そうでない朝は、県の発表から数えた全国の件数を総括に書かせない（本文が素の件数として出さない数なので）。 */
const allPrefsChecked = (d: Pick<OverviewDay, "watch">): boolean => d.watch !== null && d.watch.failedPrefCodes.length === 0;

/**
 * Claude に渡す公開の事実。件数と、新しく載せた町だけ。農場、会員、URL、文書の原文を入れない。
 * 比べる印がない朝は、新規の件数と町を渡さない。未確認の県がある朝は、今季と直近の件数を渡さない。
 */
export function overviewClaudeInput(d: OverviewDay): string {
  const places = [...d.newCases.map((p) => ({ p, kind: "農場" as const })), ...d.newBirds.map((p) => ({ p, kind: "野鳥" as const }))]
    .filter(({ p }) => p.muniName !== null)
    .map(({ p, kind }) => (kind === "農場" ? { prefecture: p.prefName, town: p.muniName, kind, suspected: p.suspected } : { prefecture: p.prefName, town: p.muniName, kind, screening: p.screening === true }));
  return JSON.stringify({
    ...(allPrefsChecked(d) ? { seasonCount: d.seasonCount, recent14DaysCount: d.recentCount } : {}),
    pastSameDate: d.past,
    wildBirdCount: d.birds.total,
    wildBirdConfirmedCount: d.birds.confirmed,
    wildBirdScreeningCount: d.birds.screening,
    ...(d.newCaseCount === null ? {} : { newCaseCount: d.newCaseCount, places }),
  });
}

type CountItem = "season" | "recent" | "past" | "bird" | "bird_confirmed" | "bird_screening" | "new";

/** 件数の項目の語。項目ごとに、その値の「N 件」しか続けられない。 */
const COUNT_ITEMS: ReadonlyArray<readonly [RegExp, CountItem]> = [
  [/^直近14日(?:の全国の発生|の発生)?(?:は全国で|は|全国で)?/u, "recent"],
  [/^(?:例年の同じ日まで|過去(\d+)シーズンの同じ日まで)(?:の件数)?は?/u, "past"],
  [/^(?:今季|今シーズン)(?:の全国の発生|の発生)?(?:は全国で|は|全国で)?/u, "season"],
  [/^野鳥の高病原性の確定(?:の件数)?は?/u, "bird_confirmed"],
  [/^野鳥の検査中(?:の件数)?は?/u, "bird_screening"],
  [/^野鳥の陽性(?:の件数)?は?/u, "bird"],
];
const COUNT_VALUE = /^(?:(\d+)[~〜](\d+)|(\d+))件/u;

type PlaceKind = "case" | "bird";
type PlaceStage = "confirmed" | "suspected" | "screening";

/** 町の後に続けてよい述語。種別と段階が述語で決まる。文の終わり（。）か、次の節へのつなぎ（、）で閉じる。 */
const PLACE_PREDICATES: ReadonlyArray<readonly [RegExp, PlaceKind, PlaceStage]> = [
  [/^で発生(?:しました。|し、)/u, "case", "confirmed"],
  [/^で疑いの発表が(?:ありました。|あり、)/u, "case", "suspected"],
  [/^の野鳥で高病原性の確定の発表が(?:ありました。|あり、)/u, "bird", "confirmed"],
  [/^の野鳥で検査中の発表が(?:ありました。|あり、)/u, "bird", "screening"],
];

/** 件数が項目の値と組で合うか。 */
function countFailure(item: CountItem, value: RegExpExecArray, d: OverviewDay, seasons: string | undefined): string | null {
  const single = value[3] === undefined ? null : Number(value[3]);
  const expected: Partial<Record<CountItem, number | null>> = {
    season: d.seasonCount,
    recent: d.recentCount,
    bird: d.birds.total,
    bird_confirmed: d.birds.confirmed,
    bird_screening: d.birds.screening,
    new: d.newCaseCount,
  };
  if (item === "past") {
    if (d.past === null || (seasons !== undefined && Number(seasons) !== d.past.seasons)) return "number_mismatch:past";
    const ok = single === null ? d.past.min < d.past.max && Number(value[1]) === d.past.min && Number(value[2]) === d.past.max : d.past.min === d.past.max && single === d.past.min;
    return ok ? null : "number_mismatch:past";
  }
  if ((item === "season" || item === "recent") && !allPrefsChecked(d)) return "number_unchecked";
  return single !== null && single === expected[item] ? null : `number_mismatch:${item}`;
}

/** 許した町の索引。名前は「県＋町」の形だけ（「倉敷」や県だけでは組を確かめられない）。 */
function allowedPlaces(d: OverviewDay): Array<{ name: string; kind: PlaceKind; stage: PlaceStage }> {
  const named = (p: OverviewPlace) => (p.muniName === null ? [] : [normalizeForMatch(`${p.prefName}${p.muniName}`)]);
  return [
    ...d.newCases.flatMap((p) => named(p).map((name) => ({ name, kind: "case" as const, stage: (p.suspected ? "suspected" : "confirmed") as PlaceStage }))),
    ...d.newBirds.flatMap((p) => named(p).map((name) => ({ name, kind: "bird" as const, stage: (p.screening === true ? "screening" : "confirmed") as PlaceStage }))),
  ].sort((a, b) => b.name.length - a.name.length);
}

/** 町の述語（種別と段階）が、その朝の事実と組で合うか。 */
function placeFailure(name: string, kind: PlaceKind, stage: PlaceStage, places: ReadonlyArray<{ name: string; kind: PlaceKind; stage: PlaceStage }>): string | null {
  const same = places.filter((p) => p.name === name);
  if (same.some((p) => p.kind === kind && p.stage === stage)) return null;
  if (kind === "case" && stage === "confirmed" && same.some((p) => p.kind === "case" && p.stage === "suspected")) return "missing_suspected_word";
  return "place_mismatch";
}

/**
 * 許した語だけを先頭から順に取り除く。1 文字でも読めずに残れば residual で落とす（禁止の語の一覧は持たない。言い換えで抜けるので）。
 * 項目の語は直後の「N 件」とだけ組になり、町は「県＋町」と直後の述語とだけ組になる。別の節の項目や値を引きずらない。
 */
function residueFailures(t: string, d: OverviewDay): string[] {
  const out = new Set<string>();
  const places = allowedPlaces(d);
  let rest = t;
  const stop = (): string[] => {
    out.add("residual");
    if (/\d/u.test(rest)) out.add("number_without_item");
    return [...out];
  };
  for (;;) {
    let matchedItem: CountItem | null = null;
    let seasons: string | undefined;
    const fresh = /^新たに/u.exec(rest);
    if (fresh !== null) rest = rest.slice(fresh[0].length);
    if (fresh !== null && COUNT_VALUE.test(rest)) {
      matchedItem = "new";
    } else if (fresh === null) {
      for (const [re, item] of COUNT_ITEMS) {
        const m = re.exec(rest);
        if (m === null) continue;
        matchedItem = item;
        seasons = m[1];
        rest = rest.slice(m[0].length);
        break;
      }
    }

    if (matchedItem !== null) {
      const value = COUNT_VALUE.exec(rest);
      if (value === null) return stop();
      const failure = countFailure(matchedItem, value, d, seasons);
      if (failure !== null) out.add(failure);
      rest = rest.slice(value[0].length);
      if (rest === "です。") return [...out];
      const sep = /^(?:で、?|、)/u.exec(rest);
      if (sep === null) return stop();
      rest = rest.slice(sep[0].length);
      continue;
    }

    const place = places.find((p) => rest.startsWith(p.name));
    if (place === undefined) return stop();
    const afterName = rest.slice(place.name.length);
    const predicate = PLACE_PREDICATES.flatMap(([re, kind, stage]) => {
      const m = re.exec(afterName);
      return m === null ? [] : [{ text: m[0], kind, stage }];
    })[0];
    if (predicate === undefined) return stop();
    const failure = placeFailure(place.name, predicate.kind, predicate.stage, places);
    if (failure !== null) out.add(failure);
    rest = afterName.slice(predicate.text.length);
    if (predicate.text.endsWith("。")) {
      if (rest !== "") return stop();
      return [...out];
    }
  }
}

/**
 * 総括の検査。落ちたら総括を外し、定型だけを送る。理由の符号に文の断片を入れない（出力は外部の文字として扱う）。
 * 1 文かと、残余（許した語だけでできているか）を見る。意味の判断はしないので、形から外れる言い回しはすべて落とす。
 * 長さと URL は functions の lengthAndUrlFailures が見る。
 */
export function checkOverviewSentence(text: string, d: OverviewDay): CheckResult {
  const raw = text.trim();
  const failures: string[] = [];
  const stops = raw.match(/[。．.！!？?]/gu) ?? [];
  if (/[\r\n]/u.test(raw) || stops.length !== 1 || !raw.endsWith("。")) failures.push("not_one_sentence");
  failures.push(...residueFailures(normalizeForMatch(raw), d));
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
