// 再現モード（設計書 §17、X-02）。2025 年 12 月の中国・近畿の 4 事例を、時刻どおりに流すための型と純粋な関数。
// データは data/replay/scenario.json の事実（日時、県、市町村、段階、羽数、半径、出典の URL）だけで、県や国の文章を写さない。
// 時計は引数で受ける。ここでは今の時刻を読まない。
import { addDays, toJstIso } from "./dates";
import { muniCoreName } from "./read/names";
import { PREF_FILLED_FROM_SOURCE, PREF_FROM_SOURCE } from "./read/notes";
import { radiusInQuote } from "./read/quote";
import type { CompareReport, DocumentKind, ReadDate, ReadResult, SecondReadResult, VerifyCheck, VerifyReport } from "./read/types";
import { normalizeForMatch } from "./text";
import { FIXED_TEXT } from "./wording";
import type { Case, CaseStage, CheckRecord, DeathRecord, Farm, FarmPoint, House, IsoDate, IsoDateTime, Level, WatchStatus, WildBird } from "./types";

export interface ReplayEvent {
  /** 1 からの連番。日付の昇順（同じ日は時刻の順） */
  order: number;
  date: IsoDate;
  /** "HH:MM"。出典がその段階の時刻を書いているときだけ。null は「時刻の記載なし」 */
  time: string | null;
  /** この出来事の後の事例。前の出来事の段階を引き継ぐ。confirmState は "replay" */
  caseAfter: Case;
  /** 仮の地点にメールが届くときの下書き。段階 ④ の事例、またはメールに語のない出来事（防疫措置の完了）は null */
  noticePreview: { level: Level; text: string } | null;
  sourceUrl: string;
  /** 舞台裏の画面（X-07）の項目。まだなければ null */
  backstageId: string | null;
}

export interface ReplayScenario {
  id: "2025-12";
  title: string;
  /** 津山市の範囲から 5km 以内の仮の地点。説明のために置いた地点で、特定の農場を指すものではない */
  defaultSpot: FarmPoint;
  events: ReplayEvent[];
  wildBirds: WildBird[];
  /** 説明のための例。実際の見回りの結果ではない */
  watchStatus: WatchStatus[];
}

/** 再現の舞台のシーズン（2025 = 2025-06-01〜2026-05-31） */
export const REPLAY_SEASON = 2025;
export const NO_TIME_LABEL = "時刻の記載なし";

/** 出典が時刻を書いていない出来事は、その日の終わりに置く（時刻を作らない） */
const END_OF_DAY = "23:59:59";

const STAGE_PRIORITY: readonly CaseStage[] = [
  "movement_lifted",
  "shipment_lifted",
  "surveillance_lifted",
  "control_done",
  "culling_done",
  "confirmed",
  "suspected",
];

/** メールの文に使う語。語のない段階（防疫措置の完了など）はメールを送らない（M-02 の diffCaseEvents と同じ） */
const NOTICE_WORD: Partial<Record<CaseStage, string>> = {
  suspected: "疑い",
  confirmed: "確定",
  shipment_lifted: "搬出制限の解除",
  movement_lifted: "移動制限の解除",
};

/** 一覧に出す語（メールの語に、防疫措置の完了を足したもの） */
export const STAGE_LABEL: Readonly<Record<string, string>> = {
  ...NOTICE_WORD,
  control_done: "防疫措置の完了",
};

/** 出来事の時計。時刻があればその時刻（JST）、なければその日の 23:59:59（JST） */
export function virtualNow(e: Pick<ReplayEvent, "date" | "time">): Date {
  const t = e.time === null ? END_OF_DAY : `${e.time}:00`;
  const d = new Date(`${e.date}T${t}+09:00`);
  if (Number.isNaN(d.getTime())) throw new RangeError(`再現の日時が不正です: ${e.date} ${e.time}`);
  return d;
}

export function timeLabel(e: Pick<ReplayEvent, "time">): string {
  return e.time ?? NO_TIME_LABEL;
}

function assertOrder(s: ReplayScenario, order: number): void {
  if (!Number.isInteger(order) || order < 0 || order > s.events.length) {
    throw new RangeError(`order は 0〜${s.events.length} の整数にしてください: ${order}`);
  }
}

/** order までの事例（事例ごとの最新の caseAfter）。order 0 は 0 件 */
export function casesAt(s: ReplayScenario, order: number): Case[] {
  assertOrder(s, order);
  const latest = new Map<string, Case>();
  for (const e of s.events) {
    if (e.order > order) break;
    latest.set(e.caseAfter.id, e.caseAfter);
  }
  return [...latest.values()];
}

/** order までに出来事がある最後の order（出来事の日付が date 以前のもの）。なければ 0 */
export function lastOrderOn(s: ReplayScenario, date: IsoDate): number {
  let last = 0;
  for (const e of s.events) {
    if (e.date > date) break;
    last = e.order;
  }
  return last;
}

/** order の時計。order 0 は最初の出来事の前の日の終わり（2025 シーズンの中） */
export function replayNowAt(s: ReplayScenario, order: number): Date {
  assertOrder(s, order);
  if (order > 0) return virtualNow(s.events[order - 1]!);
  const first = s.events[0];
  if (!first) throw new RangeError("再現の出来事がありません");
  return virtualNow({ date: addDays(first.date, -1), time: null });
}

/** この出来事で加わった段階（caseAfter の段階のうち、日付と時刻が出来事と同じ最も後のもの） */
export function eventStage(e: Pick<ReplayEvent, "date" | "time" | "caseAfter">): CaseStage | null {
  for (const k of STAGE_PRIORITY) {
    const st = e.caseAfter.stages[k];
    if (st && st.date === e.date && st.time === e.time) return k;
  }
  return null;
}

/** メールの下書きの文。語のない段階は null（メールを送らない） */
export function noticeTextFor(muniName: string, stage: CaseStage, authority: string = FIXED_TEXT.prefContactIsAuthority): string | null {
  const word = NOTICE_WORD[stage];
  return word ? `${muniName}で${word}の発表がありました。${authority}` : null;
}

/**
 * order の時点の見回りの状況（説明のための例）。どの県も、再生の時刻に確認したことにする（ok かどうかは変えない）。
 * 固定の時刻のままだと、時計が進んで「6 時間以内」を外れ、全県が確認できていない扱いになり、
 * 画面の『時点』も再生の時刻と食い違う。
 */
export function watchAt(s: ReplayScenario, order: number): WatchStatus[] {
  const at = toJstIso(replayNowAt(s, order));
  return s.watchStatus.map((w) => ({ ...w, checkedAt: at, lastOkAt: w.ok ? at : w.lastOkAt }));
}

// ── 見本の農場（X-08）──
// 会員でなくても「会員だったらこう見える」を試せる、作り物の農場（data/replay/sample-farm.json）。
// 実在の農場名、人名、住所、電話番号を持たない。再現の筋（津山市の約 1km のマス目）に合わせた架空の数字だけ。

export interface SampleFarmData {
  /** 見本の「今日」。再現の時計をこの日の最後の出来事に合わせる（lastOrderOn） */
  today: IsoDate;
  farm: Farm & { id: string };
  houses: Array<House & { id: string }>;
  deaths: DeathRecord[];
  checks: Array<CheckRecord & { id: string }>;
}

// ── 舞台裏（X-07）──
// 事前に Claude で文書を読み、照合と二重読みの結果を見せるための型と純粋な関数。
// 原文と引用を持たない: 載せるのは、照合に使った短い語と、読み取った短い値だけ（本文の連続 20 字以上は載せない）。

/** 一つの文書の読み取りの記録。引用のキーは持たない */
export interface BackstageEntry {
  id: string;
  documentUrl: string;
  kind: DocumentKind;
  /** 主の読み手の値。matchedWord は、その値を支える語として文書にあったもの（20 字以内）。見つからなければ null */
  primary: Array<{ field: string; value: string; matchedWord: string | null }>;
  second: Array<{ field: string; value: string }>;
  /** 照合の行。走らなかった照合は行にしない。任意の項目が落ちたものも pass: false */
  checks: Array<{ check: VerifyCheck; pass: boolean; detail: string }>;
  /** 照合が必須の項目で通ったか（任意の項目が落ちても true のまま。設計書 §9.5） */
  verifyPass: boolean;
  /** 照合で落として空にした任意の項目 */
  droppedOptional: string[];
  /** 二重読みの一致。別の読み手が失敗したときは null */
  compare: CompareReport | null;
  /** 値をわざと入れ替えて、本当に落ちた結果だけ。入れ替えなかった、または落ちなかったときは null */
  tamperedDemo: { field: string; before: string; after: string; rejectedBy: VerifyCheck | "compare" } | null;
}

/** data/replay/backstage.json。測っていない間は status "unmeasured"、entries は空 */
export interface BackstageFile {
  status: "unmeasured" | "measured";
  /** 測った時刻（JST）。測っていなければ null */
  measuredAt: IsoDateTime | null;
  note?: string;
  entries: BackstageEntry[];
}

export interface ModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** data/replay/measured-usage.json。API の応答の使用量の合計だけ（見積もりは入れない） */
export interface MeasuredUsage {
  status: "unmeasured" | "measured";
  documents: number;
  byModel: Record<string, ModelTokens>;
  measuredAt: IsoDateTime | null;
}

export const UNMEASURED_NOTE = "まだ実物の文書を読んでいません。有料の Claude API の呼び出しは、支払いの上限を置いてから行います。";
export const UNMEASURED_BACKSTAGE: Readonly<BackstageFile> = Object.freeze({ status: "unmeasured", measuredAt: null, note: UNMEASURED_NOTE, entries: [] });
export const UNMEASURED_USAGE: Readonly<MeasuredUsage> = Object.freeze({ status: "unmeasured", documents: 0, byModel: {}, measuredAt: null });

const CASE_KINDS: ReadonlySet<DocumentKind> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);
const WORD_KINDS: ReadonlySet<DocumentKind> = new Set(["suspected", "confirmed", "zone_lifted", "negated"]);
const CHECK_ORDER: readonly VerifyCheck[] = ["quote_exists", "value_in_quote", "muni_exists", "stage_word", "radius_sentence", "chronology", "year_completion"];
export const BACKSTAGE_WORD_MAX = 20;
const OMITTED = "（長い文なので載せません）";
const GUARD = 20;
const FROM_SOURCE = PREF_FROM_SOURCE;
const FILLED_FROM_SOURCE = PREF_FILLED_FROM_SOURCE;

/** 本文（正規化後）の連続 20 字の集合。値や詳細がこれを含めば、本文の写しになる */
function runSet(docText: string): Set<string> {
  const n = normalizeForMatch(docText);
  const out = new Set<string>();
  for (let i = 0; i + GUARD <= n.length; i++) out.add(n.slice(i, i + GUARD));
  return out;
}
function copiesBody(s: string, runs: Set<string>): boolean {
  const n = normalizeForMatch(s);
  for (let i = 0; i + GUARD <= n.length; i++) if (runs.has(n.slice(i, i + GUARD))) return true;
  return false;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
function dateText(d: ReadDate, resolved: IsoDate | null, time: string | null): string {
  const day = resolved ?? `${d.year === null ? "----" : String(d.year).padStart(4, "0")}-${pad2(d.month)}-${pad2(d.day)}`;
  return time === null ? day : `${day} ${time}`;
}

interface RowSpec {
  field: string;
  value: string;
  candidates: string[];
}

function primarySpecs(read: ReadResult, verify: VerifyReport): RowSpec[] {
  const specs: RowSpec[] = [{ field: "kind", value: read.kind, candidates: [] }];
  const text = (field: string, v: string | null, extra: string[] = []) => {
    if (v !== null && v !== "") specs.push({ field, value: v, candidates: [v, ...extra] });
  };
  text("prefecture", read.prefecture.value);
  text("municipality", read.municipality.value, read.municipality.value === null ? [] : [muniCoreName(read.municipality.value)]);
  if (read.nationalNo.value !== null) specs.push({ field: "nationalNo", value: `${read.nationalNo.value}`, candidates: [`国内${read.nationalNo.value}例目`, `${read.nationalNo.value}例目`] });
  if (read.prefNo.value !== null) specs.push({ field: "prefNo", value: `${read.prefNo.value}`, candidates: [`${read.prefNo.value}例目`] });
  text("birdUse", read.birdUse.value);
  text("housing", read.housing.value);
  if (read.headCount.value !== null) {
    const n = read.headCount.value;
    specs.push({ field: "headCount", value: `${n}`, candidates: [`${n}羽`, ...(n % 10000 === 0 ? [`${n / 10000}万羽`] : [])] });
  }
  text("negationBasis", read.negationBasis.value);
  if (read.primaryStage !== null) specs.push({ field: "primaryStage", value: read.primaryStage, candidates: [] });
  if (read.primaryDate !== null) {
    const stamp = verify.normalized?.primaryStamp ?? null;
    const d = read.primaryDate;
    specs.push({ field: "primaryDate", value: dateText(d, stamp?.date ?? null, d.time), candidates: [`${d.month}月${d.day}日`] });
  }
  if (read.radiiKm.length > 0) specs.push({ field: "radiiKm", value: read.radiiKm.map((r) => `${r.km}km`).join("、"), candidates: [`${read.radiiKm[0]!.km}km`] });
  if (read.kind === "wild_bird") specs.push({ field: "wildBirds", value: `${read.wildBirds.length} 行`, candidates: [] });
  return specs;
}

function secondSpecs(s: SecondReadResult): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [{ field: "kind", value: s.kind }];
  if (s.prefecture !== null && s.prefecture !== "") out.push({ field: "prefecture", value: s.prefecture });
  if (s.municipality !== null && s.municipality !== "") out.push({ field: "municipality", value: s.municipality });
  if (s.primaryStage !== null) out.push({ field: "primaryStage", value: s.primaryStage });
  if (s.primaryDate !== null) out.push({ field: "primaryDate", value: dateText(s.primaryDate, null, s.primaryDate.time) });
  if (s.kind === "wild_bird") out.push({ field: "wildBirds", value: `${s.wildBirds.length} 行` });
  return out;
}

/** 実行された照合（走らなかったものは行にしない。verifyRead は失敗だけを返すので、読みの中身から走った照合を決める） */
function appliedChecks(read: ReadResult, verify: VerifyReport, hadPrevious: boolean): Set<VerifyCheck> {
  const applied = new Set<VerifyCheck>(verify.issues.map((i) => i.check));
  const wild = read.kind === "wild_bird";
  if (!wild && !CASE_KINDS.has(read.kind)) return applied; // 他県の対策、訓練などは値を取らない
  const anyQuote = [read.prefecture, read.municipality, read.nationalNo, read.prefNo, read.birdUse, read.housing, read.headCount, read.negationBasis].some((q) => q.value !== null) || read.kindQuote !== null || read.primaryDateQuote !== null;
  if (anyQuote || (wild && read.wildBirds.length > 0)) {
    applied.add("quote_exists");
    applied.add("value_in_quote");
  }
  if (read.municipality.value !== null || (wild && read.wildBirds.length > 0)) applied.add("muni_exists");
  if ((read.kindQuote !== null && WORD_KINDS.has(read.kind)) || (wild && read.wildBirds.length > 0)) applied.add("stage_word");
  if (read.radiiKm.length > 0) applied.add("radius_sentence");
  if (read.primaryDate !== null || (wild && read.wildBirds.length > 0)) applied.add("year_completion");
  if (hadPrevious && (read.primaryDate !== null || read.stageEvents.length > 0)) applied.add("chronology");
  return applied;
}

export function toBackstageEntry(i: {
  id: string;
  url: string;
  read: ReadResult;
  second: SecondReadResult | null;
  verify: VerifyReport;
  compare: CompareReport | null;
  docText: string;
  /** 前の事例を渡して照合したか（渡したときだけ chronology が走る） */
  hadPrevious?: boolean;
}): BackstageEntry {
  const runs = runSet(i.docText);
  const ndoc = normalizeForMatch(i.docText);
  const safe = (s: string): boolean => !copiesBody(s, runs);

  const primary: BackstageEntry["primary"] = [];
  for (const spec of primarySpecs(i.read, i.verify)) {
    if (!safe(spec.value)) continue; // 長い自由記述は載せない
    const hit = spec.candidates.find((c) => c.length <= BACKSTAGE_WORD_MAX && c !== "" && ndoc.includes(normalizeForMatch(c)));
    primary.push({ field: spec.field, value: spec.value, matchedWord: hit ?? null });
  }
  const second = (i.second === null ? [] : secondSpecs(i.second)).filter((r) => safe(r.value));

  const applied = appliedChecks(i.read, i.verify, i.hadPrevious ?? false);
  const checks: BackstageEntry["checks"] = [];
  for (const check of CHECK_ORDER) {
    if (!applied.has(check)) continue;
    const all = i.verify.issues.filter((x) => x.check === check);
    // 引用に県名がなく、取得元の県（プログラムの情報）と一致して通した注記、本文に県名がなく取得元の県で補った注記は、落ちたのではない
    const issues = all.filter((x) => x.detail !== FROM_SOURCE && x.detail !== FILLED_FROM_SOURCE);
    const note = all.some((x) => x.detail === FILLED_FROM_SOURCE)
      ? "都道府県は、読み取りが空で、本文に別の県名もなかったので、取得元の県（プログラムの情報）で補いました"
      : all.some((x) => x.detail === FROM_SOURCE)
        ? "都道府県は、引用に県名がなかったので、取得元の県（プログラムの情報）と一致したことで通しました"
        : null;
    const detail =
      issues.length === 0
        ? (note ?? "問題なし")
        : issues.map((x) => `${x.field}: ${x.detail}${x.mandatory ? "（必須の項目）" : "（任意の項目。落として続行）"}`).join(" / ");
    checks.push({ check, pass: issues.length === 0, detail: safe(detail) ? detail : OMITTED });
  }

  return {
    id: i.id,
    documentUrl: i.url,
    kind: i.read.kind,
    primary,
    second,
    checks,
    verifyPass: i.verify.pass,
    droppedOptional: [...i.verify.droppedOptional],
    compare: i.compare === null ? null : { match: i.compare.match, mismatches: [...i.compare.mismatches] },
    tamperedDemo: null,
  };
}

/** 農場数に見える数（発生は 1 農場）。半径の文にならない数を選ぶ */
const SWAP_NUMBERS: readonly number[] = [1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 15, 20, 30, 50, 100];

/**
 * 半径の最初の行の km を、農場数のような数にすり替える（引用はそのまま）。元を書き換えない。
 * 半径の行がない、または半径の文にならない数が見つからないときは null。
 */
export function tamperRadius(read: ReadResult): ReadResult | null {
  const row = read.radiiKm[0];
  if (!row) return null;
  const km = SWAP_NUMBERS.find((n) => n !== row.km && !radiusInQuote(n, row.quote));
  if (km === undefined) return null;
  return { ...read, radiiKm: read.radiiKm.map((r, idx) => (idx === 0 ? { ...r, km } : { ...r })) };
}

/** 別の読み手の市町村を、別の町の名前に入れ替える。元を書き換えない */
export function tamperSecondMuni(second: SecondReadResult, otherMuni: string): SecondReadResult {
  return { ...second, municipality: otherMuni };
}
