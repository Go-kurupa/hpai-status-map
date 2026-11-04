// 読み取りの採点と summary（I-06、設計書 §16 読み取り）。正解（evals/answers）と、読み取りの結果、照合、二重読みの一致、載せるかの判断を突き合わせる。
// 純粋な関数と、作った文書を使う入れ替えの試験だけ。API は呼ばない。
//
// 採点の決まり:
// - 主の誤り（市町村、段階、日付、羽数）は、主の読み手の結果（read）と正解を比べる。読めなかった文書（read が null）は誤りに数えない。
// - 市町村は表記の違い（ヶ/ケ、郡、区）を誤りにしない。日付は年が空なら月日で比べる。正解の段階が null なら日付は比べない。
// - 公開の誤りは、自動で載せる設定を入にして（autoPublishEnabled: true）測る。既定の false だと全件が確認中になり、誤りが 0 に見える。
//   公開の誤りは、公開と決めた文書だけを、照合の後の値（NormalizedRead）と正解で比べる。確認中に回った文書は入らない。
//   羽数の誤りが照合で空欄になれば、公開の羽数の誤りに入らない。
import { compareReads } from "@hpai/shared/read/compare";
import { muniCoreName } from "@hpai/shared/read/names";
import { decidePublication } from "@hpai/shared/read/publish";
import type { CompareReport, DocumentKind, NormalizedRead, PublishDecision, ReadDate, ReadResult, SecondReadResult, VerifyReport } from "@hpai/shared/read/types";
import { verifyRead } from "@hpai/shared/read/verify";
import { prefCodeOfName } from "@hpai/shared/pref";
import type { GeoStore } from "@hpai/shared/geo";
import type { EvalMetricName, EvalSummary, IsoDateTime, PrefCode } from "@hpai/shared/types";
import type { ReadAttempt } from "../functions/src/read/claude";
import fs from "node:fs";
import path from "node:path";
import { ANSWERS_DIR, FABRICATED_DIR, type EvalAnswer } from "./types";
import { TITLE_SPLIT } from "./detection";

type Failure = "refusal" | "format_error" | "max_tokens" | "api_error";
export interface DocErrors {
  muni: boolean;
  stage: boolean;
  date: boolean;
  headCount: boolean;
  /** 家きんの事例、野鳥、対象外のどれかの区別を取り違えた。または否定かどうかを取り違えた。 */
  kindClass: boolean;
}

/** 1 文書の採点。本文と引用は持たない（read は run の内部で使うだけで、toRunRecord が事実だけにする）。 */
export interface DocScore {
  id: string;
  answerKind: DocumentKind;
  read: ReadResult | null;
  second: SecondReadResult | null;
  primaryFailure: Failure | null;
  secondFailure: Failure | null;
  /** 失敗の detail（`status=429` など。本文は含まない）。読みの失敗と API の失敗を見分けるため。 */
  primaryDetail: string | null;
  secondDetail: string | null;
  verify: VerifyReport | null;
  compare: CompareReport | null;
  decision: PublishDecision;
  errors: DocErrors;
  /** 照合の後の半径に、区域でない値（区域の外への自粛の距離など）が入った。合否には入れない。 */
  radiusWrong: boolean;
  published: boolean;
  publishedMandatoryError: boolean;
  publishedHeadcountError: boolean;
}

export interface ScoreInput {
  answer: EvalAnswer;
  /** 文字層、または HTML の本文（題を含まない）。 */
  text: string;
  hasTextLayer: boolean;
  primary: ReadAttempt<ReadResult>;
  second: ReadAttempt<SecondReadResult>;
  geo: GeoStore;
  /** 取得元の県（sources.json から。正解の県は渡さない）。 */
  sourcePrefCode?: PrefCode | null;
}

const CASE_KINDS: ReadonlySet<DocumentKind> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);
type KindClass = "case" | "wild" | "none";
const kindClass = (k: DocumentKind): KindClass => (CASE_KINDS.has(k) ? "case" : k === "wild_bird" ? "wild" : "none");

const NO_ERRORS: DocErrors = { muni: false, stage: false, date: false, headCount: false, kindClass: false };

const sameMuni = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : muniCoreName(a) === muniCoreName(b));

function sameDate(read: ReadDate | null, iso: string | null): boolean {
  if (read === null || iso === null) return read === null && iso === null;
  const [y, m, d] = iso.split("-").map(Number);
  return read.month === m && read.day === d && (read.year === null || read.year === y);
}

/** 行の組を 1 対 1 で当てる。当たらない行があれば false。 */
function matchRows<A, B>(as: readonly A[], bs: readonly B[], eq: (a: A, b: B) => boolean): boolean {
  if (as.length !== bs.length) return false;
  const used = new Set<number>();
  for (const a of as) {
    const j = bs.findIndex((b, i) => !used.has(i) && eq(a, b));
    if (j < 0) return false;
    used.add(j);
  }
  return true;
}

const prefOfRead = (name: string): string => prefCodeOfName(name) ?? name;

function primaryErrors(a: EvalAnswer, read: ReadResult | null): DocErrors {
  if (read === null) return NO_ERRORS;
  const cls = kindClass(a.kind);
  const kindClassErr = cls !== kindClass(read.kind) || (a.kind === "negated") !== (read.kind === "negated");
  if (cls === "case") {
    return {
      muni: !sameMuni(read.municipality.value, a.muniName),
      stage: read.primaryStage !== a.primaryStage,
      date: a.primaryStage === null ? false : !sameDate(read.primaryDate, a.primaryDate),
      headCount: (read.headCount.value ?? null) !== a.headCount,
      kindClass: kindClassErr,
    };
  }
  if (cls === "wild") {
    const rows = read.wildBirds;
    const want = a.wildBirds ?? [];
    return {
      muni: !matchRows(rows, want, (r, w) => sameMuni(r.municipality, w.muniName)),
      stage: !matchRows(rows, want, (r, w) => r.test === w.test),
      date: !matchRows(rows, want, (r, w) => sameDate(r.date, w.date)),
      headCount: false,
      kindClass: kindClassErr,
    };
  }
  return { ...NO_ERRORS, kindClass: kindClassErr };
}

/** 公開と決めた文書の、照合の後の値と正解の比べ。必須の誤り、羽数の誤り。 */
function publishedErrors(a: EvalAnswer, read: ReadResult, n: NormalizedRead | null): { mandatory: boolean; headCount: boolean } {
  const cls = kindClass(a.kind);
  const kindClassErr = cls !== kindClass(read.kind) || (a.kind === "negated") !== (read.kind === "negated");
  if (n === null) return { mandatory: true, headCount: false };
  if (cls === "case") {
    const mandatory =
      kindClassErr ||
      !sameMuni(n.muniName, a.muniName) ||
      n.prefCode !== a.prefCode ||
      n.primaryStage !== a.primaryStage ||
      (a.primaryStage !== null && n.primaryStamp?.date !== a.primaryDate);
    return { mandatory, headCount: n.headCount !== null && n.headCount !== a.headCount };
  }
  if (cls === "wild") {
    const want = a.wildBirds ?? [];
    const mandatory = kindClassErr || !matchRows(n.wildBirds, want, (r, w) => r.date === w.date && r.prefCode === w.prefCode && sameMuni(r.muniName, w.muniName) && r.test === w.test);
    return { mandatory, headCount: false };
  }
  return { mandatory: kindClassErr, headCount: false };
}

export function scoreDocument(i: ScoreInput): DocScore {
  const read = i.primary.ok ? i.primary.value : null;
  const second = i.second.ok ? i.second.value : null;
  const verify = read ? verifyRead(read, { text: i.text, hasTextLayer: i.hasTextLayer, season: i.answer.season }, i.geo, null, { sourcePrefCode: i.sourcePrefCode ?? null, title: i.answer.title }) : null;
  const compare = read && second ? compareReads(read, second, verify) : null;
  const decision = decidePublication({
    read,
    verify,
    compare,
    hasTextLayer: i.hasTextLayer,
    docText: `${i.answer.title}\n${i.text}`,
    autoPublishEnabled: true, // 自動で載せる設定を入にして測る（false だと公開の誤りが 0 に見える）
  });
  const published = decision.action === "publish";
  const pub = published && read ? publishedErrors(i.answer, read, verify?.normalized ?? null) : { mandatory: false, headCount: false };
  const n = verify?.normalized ?? null;
  return {
    id: i.answer.id,
    answerKind: i.answer.kind,
    read,
    second,
    primaryFailure: i.primary.ok ? null : i.primary.reason,
    secondFailure: i.second.ok ? null : i.second.reason,
    primaryDetail: i.primary.ok ? null : i.primary.detail,
    secondDetail: i.second.ok ? null : i.second.detail,
    verify,
    compare,
    decision,
    errors: primaryErrors(i.answer, read),
    radiusWrong: n !== null && n.radiiKm.some((km) => !i.answer.radiiKm.includes(km)),
    published,
    publishedMandatoryError: pub.mandatory,
    publishedHeadcountError: pub.headCount,
  };
}

// ── summary ──

export interface Tamper {
  total: number;
  rejected: number;
}
export type Detection = { prevSeason: number; titles: number } | null;

const count = (scores: readonly DocScore[], f: (s: DocScore) => boolean): number => scores.filter(f).length;

export function summarize(scores: readonly DocScore[], tamper: Tamper, detection: Detection, costUsd: number, measuredAt: IsoDateTime): EvalSummary {
  const documents = scores.length;
  const readCount = count(scores, (s) => s.read !== null);
  const both = count(scores, (s) => s.compare !== null);
  const published = count(scores, (s) => s.published);
  const m = (name: EvalMetricName, value: number, denominator: number | null, unit: string, note: string | null = null) => ({ name, value, denominator, unit, note });
  const metrics: EvalSummary["metrics"] = [
    m("documents", documents, null, "文書", "試みた全文書"),
    m("read_refusals", count(scores, (s) => s.primaryFailure === "refusal") + count(scores, (s) => s.secondFailure === "refusal"), documents * 2, "件", "主と別の読み手の呼び出しの合計"),
    m("format_errors", count(scores, (s) => s.primaryFailure === "format_error") + count(scores, (s) => s.secondFailure === "format_error"), documents * 2, "件", "主と別の読み手の呼び出しの合計"),
    m("primary_muni_errors", count(scores, (s) => s.errors.muni), readCount, "文書", "読めた文書のうち、市町村の読み違い"),
    m("primary_stage_errors", count(scores, (s) => s.errors.stage), readCount, "文書", `読めた文書のうち、段階の読み違い。種類の取り違え ${count(scores, (s) => s.errors.kindClass)} 件（家きんの事例、野鳥、対象外の区別、否定かどうか）は合否に入れない`),
    m("primary_date_errors", count(scores, (s) => s.errors.date), readCount, "文書", "読めた文書のうち、日付の読み違い"),
    m("primary_headcount_errors", count(scores, (s) => s.errors.headCount), readCount, "文書", "羽数の読み違い。合否には入れない（照合で空欄になる）"),
    m("published_mandatory_errors", count(scores, (s) => s.publishedMandatoryError), published, "文書", "自動で載せると決めた文書の、必須の項目の誤り"),
    m("published_headcount_errors", count(scores, (s) => s.publishedHeadcountError), published, "文書", "自動で載せると決めた文書の、羽数の誤り"),
    m("auto_published_documents", published, documents, "文書", "自動で載せる設定を入にして測った"),
    m("review_documents", count(scores, (s) => s.decision.action === "review_public" || s.decision.action === "review_private"), documents, "文書", "人の確認に回った"),
    m("second_reader_mismatches", count(scores, (s) => s.compare !== null && !s.compare.match), both, "文書", "主と別の読み手の食い違い"),
    m("tamper_rejected", tamper.rejected, tamper.total, "件", "わざと入れ替えた結果と誤った読み手のうち、載らずに落ちた数"),
  ];
  const unmeasured: string[] = [];
  if (detection) {
    metrics.push(m("detection_prev_season", detection.prevSeason, 24, "件", "前季の確認の発表が国の事例の一覧と一致"));
    metrics.push(m("detection_title_classification", detection.titles, TITLE_SPLIT.confirmed + TITLE_SPLIT.movement_lifted + TITLE_SPLIT.other, "題", `確認/解除/それ以外 = ${TITLE_SPLIT.confirmed}/${TITLE_SPLIT.movement_lifted}/${TITLE_SPLIT.other}`));
  } else {
    unmeasured.push("detection_prev_season", "detection_title_classification");
  }
  return { measuredAt, metrics, unmeasured, costPerDocumentUsd: documents > 0 ? costUsd / documents : null };
}

export const MIN_READ_DOCUMENTS = 30;

// 設計書 §16「読み取り」: 正解つきの発表（疑い、確定、進捗、完了、解除、野鳥の否定を含む 30 文書以上）で、市町村、段階、日付の誤りが 0。
// 羽数の誤りは照合か二重読みで落ちる。読めなかった文書の許容は書かれていないので、形式エラーと打ち切りは 0 件を合格の条件にする。
// API の失敗は再実行で解消しうるので合否には入れず、rerunNeeded でやり直しが要る件数を別に出す。
const failedWith = (s: DocScore, reason: Failure): boolean => s.primaryFailure === reason || s.secondFailure === reason;

/**
 * 合格: 読めた文書が 30 以上、市町村、段階、日付の誤りが 0、公開の誤りが 0、形式エラーと打ち切りが 0 件、入れ替えがすべて落ちる。
 * 主の羽数の誤りは合否に入れない。拒否は終了コード（run.ts）で止める。
 */
export function evalPasses(s: EvalSummary, scores: readonly DocScore[]): boolean {
  const v = (n: EvalMetricName): number => s.metrics.find((x) => x.name === n)?.value ?? Number.POSITIVE_INFINITY;
  const tamper = s.metrics.find((x) => x.name === "tamper_rejected");
  return (
    count(scores, (x) => x.read !== null) >= MIN_READ_DOCUMENTS &&
    v("primary_muni_errors") === 0 &&
    v("primary_stage_errors") === 0 &&
    v("primary_date_errors") === 0 &&
    v("published_mandatory_errors") === 0 &&
    v("published_headcount_errors") === 0 &&
    count(scores, (x) => failedWith(x, "format_error") || failedWith(x, "max_tokens")) === 0 &&
    tamper !== undefined &&
    tamper.denominator !== null &&
    tamper.value === tamper.denominator
  );
}

/** API の失敗（api_error）があった文書の数。合否とは別に「やり直しが要る」と出す。 */
export function rerunNeeded(scores: readonly DocScore[]): number {
  return count(scores, (x) => failedWith(x, "api_error"));
}

/** 合否に入れない件数。種類の取り違え、区域でない半径、API の失敗。 */
export function runCounts(scores: readonly DocScore[]) {
  return {
    kindClassErrors: count(scores, (x) => x.errors.kindClass),
    radiusWrong: count(scores, (x) => x.radiusWrong),
    rerunNeeded: rerunNeeded(scores),
  };
}

/** 公開してよい run の記録（事実のみ）。引用、本文、題は入れない。 */
export function toRunRecord(scores: readonly DocScore[]) {
  return {
    counts: runCounts(scores),
    documents: scores.map((s) => ({
      id: s.id,
      answerKind: s.answerKind,
      readKind: s.read?.kind ?? null,
      muniRead: s.read?.municipality.value ?? null,
      stageRead: s.read?.primaryStage ?? null,
      headCountRead: s.read?.headCount.value ?? null,
      primaryFailure: s.primaryFailure,
      secondFailure: s.secondFailure,
      primaryDetail: s.primaryDetail,
      secondDetail: s.secondDetail,
      compareMismatches: s.compare?.mismatches ?? null,
      decision: s.decision.action,
      reasons: "reasons" in s.decision && s.decision.reasons ? s.decision.reasons : [],
      errors: s.errors,
      radiusWrong: s.radiusWrong,
      published: s.published,
      publishedMandatoryError: s.publishedMandatoryError,
      publishedHeadcountError: s.publishedHeadcountError,
    })),
  };
}

// ── わざと入れ替えた結果と誤った読み手（作った文書。控えがなくても走る） ──

export interface TamperBase {
  answer: EvalAnswer;
  text: string;
  goodRead: ReadResult;
  goodSecond: SecondReadResult;
}

const BASE_ID = "f-confirmed-base";
const EMPTY_Q = { value: null, quote: null } as const;

/** 作った文書 f-confirmed-base から、正しい読みと正しい別の読み手を作る。引用は文書の行そのまま。 */
export async function loadTamperBase(_geo?: GeoStore): Promise<TamperBase> {
  const answer = JSON.parse(fs.readFileSync(path.join(ANSWERS_DIR, `${BASE_ID}.json`), "utf8")) as EvalAnswer;
  const text = fs.readFileSync(path.join(FABRICATED_DIR, answer.file!), "utf8");
  const lineWith = (needle: string): string => {
    const line = text.split("\n").find((l) => l.includes(needle));
    if (!line) throw new Error(`作った文書に「${needle}」の行がない`);
    return line.trim();
  };
  const found = lineWith("疑似患畜が確認されました");
  const head = lineWith("飼養状況");
  const date = lineWith("遺伝子検査を実施した結果");
  const susp = lineWith("簡易検査で陽性");
  const rad = lineWith("移動制限区域の設定");
  const d = (day: number) => ({ year: 2025, month: 11, day, time: null });
  const goodRead: ReadResult = {
    kind: "confirmed",
    kindQuote: date,
    multipleCases: false,
    prefecture: { value: "福岡県", quote: found },
    municipality: { value: "朝倉市", quote: found },
    nationalNo: EMPTY_Q,
    prefNo: EMPTY_Q,
    birdUse: { value: "採卵鶏", quote: head },
    housing: EMPTY_Q,
    headCount: { value: 50000, quote: head },
    negationBasis: EMPTY_Q,
    primaryStage: "confirmed",
    primaryDate: d(8),
    primaryDateQuote: date,
    stageEvents: [{ stage: "suspected", date: d(7), quote: susp }],
    radiiKm: [
      { km: 3, quote: rad },
      { km: 10, quote: rad },
    ],
    estimates: [],
    wildBirds: [],
  };
  const goodSecond: SecondReadResult = { kind: "confirmed", multipleCases: false, prefecture: "福岡県", municipality: "朝倉市", primaryStage: "confirmed", primaryDate: d(8), wildBirds: [] };
  return { answer, text, goodRead, goodSecond };
}

export interface TamperResult {
  /** 正しい読みと正しい別の読み手の判断。publish でなければ、落ちた数は意味がない。 */
  control: PublishDecision["action"];
  total: number;
  rejected: number;
  /** 落ちずに載ってしまった入れ替えの名前。 */
  failures: string[];
}

/** summary に渡す入れ替えの数。対照が載らないとき（環境や規則が変わった）は、全部が「確認中に回って落ちた」だけなので、落ちた数を 0 にする。 */
export function tamperForSummary(r: TamperResult): Tamper {
  return { total: r.total, rejected: r.control === "publish" ? r.rejected : 0 };
}

/** 入れ替えた結果と誤った読み手が、すべて載らずに落ちるか。 */
export function runTamper(base: TamperBase, geo: GeoStore): TamperResult {
  const { goodRead: g, goodSecond: s0 } = base;
  const decide = (read: ReadResult, second: SecondReadResult): PublishDecision["action"] =>
    scoreDocument({
      answer: base.answer,
      text: base.text,
      hasTextLayer: true,
      primary: { ok: true, value: read, usage: { input_tokens: 0, output_tokens: 0 } as never },
      second: { ok: true, value: second, usage: { input_tokens: 0, output_tokens: 0 } as never },
      geo,
    }).decision.action;
  const q = (field: "prefecture" | "municipality") => g[field].quote;
  const date = g.primaryDateQuote!;
  const susp = g.stageEvents[0]!.quote;
  const swapped: Array<[string, ReadResult]> = [
    ["市町村を同じ県の別の市に入れ替え", { ...g, municipality: { value: "久留米市", quote: q("municipality") } }],
    ["都道府県と市町村の入れ替え", { ...g, prefecture: { value: "朝倉市", quote: q("prefecture") }, municipality: { value: "福岡県", quote: q("municipality") } }],
    ["市町村の値が引用にない", { ...g, municipality: { value: "久留米市", quote: date } }],
    ["別の県の市町村", { ...g, municipality: { value: "札幌市", quote: q("municipality") } }],
    ["日付の日を 1 日ずらす", { ...g, primaryDate: { ...g.primaryDate!, day: 9 } }],
    ["日付の年を前の年にする", { ...g, primaryDate: { ...g.primaryDate!, year: 2024 } }],
    ["日付が引用にない別の日", { ...g, primaryDate: { ...g.primaryDate!, day: 7 } }],
    ["引用が原文にない", { ...g, kindQuote: "この文は原文にありません。", primaryDateQuote: "この文も原文にありません。" }],
    ["確定の日付に疑いの日付を入れる（引用は実在）", { ...g, primaryDate: { ...g.primaryDate!, day: 7 }, primaryDateQuote: susp }],
    ["確定の文書を疑いと読む", { ...g, kind: "suspected", primaryStage: "suspected" }],
    ["種類を解除と読む", { ...g, kind: "zone_lifted", primaryStage: "movement_lifted" }],
  ];
  const wrongSecond: Array<[string, SecondReadResult]> = [
    ["誤った読み手: 種類", { ...s0, kind: "suspected" }],
    ["誤った読み手: 都道府県", { ...s0, prefecture: "佐賀県" }],
    ["誤った読み手: 市町村", { ...s0, municipality: "唐津市" }],
    ["誤った読み手: 段階", { ...s0, primaryStage: "suspected" }],
    ["誤った読み手: 日付", { ...s0, primaryDate: { ...s0.primaryDate!, day: 9 } }],
    ["誤った読み手: 複数の事例", { ...s0, multipleCases: true }],
  ];
  const control = decide(g, s0);
  const failures: string[] = [];
  for (const [name, read] of swapped) if (decide(read, s0) === "publish") failures.push(name);
  for (const [name, second] of wrongSecond) if (decide(g, second) === "publish") failures.push(name);
  const total = swapped.length + wrongSecond.length;
  return { control, total, rejected: total - failures.length, failures };
}
