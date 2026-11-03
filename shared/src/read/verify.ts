// 照合（I-04、設計書 §9.5）。Claude が読み取った各項目の引用が原文にあるか、値がその引用から取り出せるかを
// プログラムで確かめる。必須（都道府県、市町村、種類、段階、日付。野鳥は各行の日付と都道府県）が通れば pass。
// 任意の項目は不合格なら空欄にして pass のまま（droppedOptional）。迷うものは落とす側に倒す。
// issues の detail は決まった語だけで、引用や値の文を入れない。
import { findMuniByName, type GeoStore } from "../geo";
import { addDays } from "../dates";
import { prefCodeOfName } from "../pref";
import { normalizeForMatch } from "../text";
import type { Case, CaseStage, IsoDate, PrefCode, StageStamp, WildBirdTest } from "../types";
import { muniCoreName } from "./names";
import {
  dateInQuote,
  headCountInQuote,
  nationalNoInQuote,
  prefNoInQuote,
  quoteInNormalized,
  radiusInQuote,
  relativeDateInQuote,
  valueInQuote,
} from "./quote";
import type { DocumentKind, NormalizedRead, Quoted, ReadDate, ReadResult, VerifyCheck, VerifyIssue, VerifyReport } from "./types";

const CASE_KINDS: ReadonlySet<DocumentKind> = new Set(["suspected", "confirmed", "progress", "control_done", "zone_lifted", "negated"]);

// 段階の語（設計書 §9.5）。kindQuote の中で見る。progress と control_done は見ない。
// 確定は「疑似患畜」、疑いは「簡易検査」「疑い」、解除は「解除」、否定は「陰性」「否定」「高病原性ではない」など。
const NEGATION_PHRASE = "高病原性[^。]{0,12}(?:では|で)ない|疑似患畜(?:では|で)ない";
// 語を探す前に取り除く句。語の否定形や見込みの形（疑いが否定できない、疑似患畜ではない、解除の見込み、解除予定）は、
// その段階を知らせる語ではない。誤って通すと警告が実際より弱く出るので、除いてから見る。
const UNSURE_NEGATION = /否定(?:でき|出来)(?:ない|ず)|否定(?:は|も)?(?:しきれ|でき)ない/gu;
const NOT_CONFIRMED = /疑似患畜(?:では|で)ない|疑似患畜に(?:は)?該当しない|疑似患畜(?:と|を)(?:は)?(?:確認|確定)(?:でき|され)(?:ない|ず|ていない)/gu;
const NOT_LIFTED = /解除[^。]{0,6}?(?:見込|予定)|解除(?:でき|され)(?:ない|ず|ていない)/gu;
const STRIP: Partial<Record<DocumentKind, RegExp>> = { negated: UNSURE_NEGATION, confirmed: NOT_CONFIRMED, zone_lifted: NOT_LIFTED };
const KIND_WORD: Partial<Record<DocumentKind, RegExp>> = {
  suspected: /簡易検査|疑い|疑われ|疑う/u,
  confirmed: /疑似患畜/u,
  zone_lifted: /解除/u,
  negated: new RegExp(`陰性|否定|${NEGATION_PHRASE}`, "u"),
};

// 種類と primaryStage の組み合わせ（null は段階なし）。
const ALLOWED_STAGES: Partial<Record<DocumentKind, ReadonlyArray<CaseStage | null>>> = {
  suspected: ["suspected"],
  confirmed: ["confirmed"],
  control_done: ["control_done"],
  zone_lifted: ["shipment_lifted", "movement_lifted", "surveillance_lifted"],
  negated: [null],
  progress: ["culling_done", null],
};

// 段階の前後（§10.2）。搬出の解除と移動の解除は比べない。
const AFTER: Readonly<Record<CaseStage, readonly CaseStage[]>> = {
  suspected: ["confirmed", "culling_done", "control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"],
  confirmed: ["culling_done", "control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"],
  culling_done: ["control_done", "shipment_lifted", "movement_lifted", "surveillance_lifted"],
  control_done: ["shipment_lifted", "movement_lifted", "surveillance_lifted"],
  shipment_lifted: [],
  movement_lifted: ["surveillance_lifted"],
  surveillance_lifted: [],
};

/** 同じ段階なら同じ日、前の段階は後の段階より遅くない。 */
function stagesConflict(a: { stage: CaseStage; date: IsoDate }, b: { stage: CaseStage; date: IsoDate }): boolean {
  if (a.stage === b.stage) return a.date !== b.date;
  if (AFTER[a.stage].includes(b.stage)) return a.date > b.date;
  if (AFTER[b.stage].includes(a.stage)) return b.date > a.date;
  return false;
}

/** 年のない日付をシーズンから補い、実在とシーズンの範囲（6/1〜翌 5/31）を確かめる。範囲外と実在しない日は null。 */
export function resolveReadDate(d: ReadDate, season: number): { date: IsoDate; completed: boolean } | null {
  const year = d.year ?? (d.month >= 6 ? season : season + 1);
  const date = `${String(year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  try {
    addDays(date, 0);
  } catch {
    return null;
  }
  if (date < `${season}-06-01` || date > `${season + 1}-05-31`) return null;
  return { date, completed: d.year === null };
}

// 野鳥の test の語（引用に test を支える語があるか）。「H5/H7以外」「高病原性ではない」は確定にしない。
function wildTestWordOk(test: WildBirdTest, quote: string): boolean {
  const nq = normalizeForMatch(quote).replace(UNSURE_NEGATION, "");
  const negated = new RegExp(`陰性|否定|${NEGATION_PHRASE}|H5/H7以外`, "u");
  if (test === "negative") return negated.test(nq);
  if (test === "screening_positive") return /簡易|陽性/u.test(nq);
  const stripped = nq.replace(new RegExp(`${NEGATION_PHRASE}|H5/H7以外`, "gu"), "");
  return /高病原性|H5|HPAI|確定/u.test(stripped) && !nq.includes("陰性");
}

const emptyNormalized = (kind: DocumentKind): NormalizedRead => ({
  kind,
  prefCode: null,
  muniCode: null,
  muniName: null,
  nationalNo: null,
  prefNo: null,
  birdUse: null,
  housing: null,
  headCount: null,
  primaryStage: null,
  primaryStamp: null,
  stages: {},
  radiiKm: [],
  estimates: { shipment: null, movement: null, surveillance: null },
  negationBasis: null,
  yearCompleted: false,
  wildBirds: [],
});

export function verifyRead(
  read: ReadResult,
  doc: { text: string; hasTextLayer: boolean; season: number },
  geo: GeoStore,
  previous: Case | null,
  /**
   * 呼び出し側が渡す、プログラムが取り出した情報（どちらも省略可）。
   * sourcePrefCode: 取得元の県（sources.json の prefCode。国の発表のように複数県なら渡さない）。引用に県名がなくても、読みの県と一致すれば都道府県は合格。
   * announcedOn: 文書の発表日。引用が「本日」「同日」だけで年月日がないとき、日付の値がこの日と同じなら合格（時刻は引用で照合する）。
   */
  opts: { sourcePrefCode?: PrefCode | null; announcedOn?: IsoDate | null } = {},
): VerifyReport {
  if (!doc.hasTextLayer) {
    return {
      pass: false,
      issues: [{ field: "document", check: "quote_exists", mandatory: true, detail: "no_text_layer" }],
      droppedOptional: [],
      normalized: null,
    };
  }

  const ndoc = normalizeForMatch(doc.text);
  const issues: VerifyIssue[] = [];
  const dropped = new Set<string>();
  const out = emptyNormalized(read.kind);

  const mandatoryFail = (field: string, check: VerifyCheck, detail: string): false => {
    issues.push({ field, check, mandatory: true, detail });
    return false;
  };
  const optionalFail = (field: string, check: VerifyCheck, detail: string): void => {
    issues.push({ field, check, mandatory: false, detail });
    dropped.add(field);
  };
  const inDoc = (quote: string | null): quote is string => quote !== null && quoteInNormalized(quote, ndoc);
  const finish = (): VerifyReport => ({
    pass: !issues.some((i) => i.mandatory),
    issues,
    droppedOptional: [...dropped],
    normalized: out,
  });

  // 野鳥と家きんの事例以外（他県の対策、訓練、周知、無関係）は、値を取らない。
  if (read.kind !== "wild_bird" && !CASE_KINDS.has(read.kind)) return finish();

  // ── 種類 ──
  checkKind(read, inDoc, mandatoryFail);

  if (read.kind === "wild_bird") {
    verifyWildBirds(read, doc.season, geo, ndoc, out, issues, dropped);
    return finish();
  }

  // ── 都道府県、市町村（必須） ──
  const prefCode = checkPrefecture(read.prefecture, inDoc, mandatoryFail, opts.sourcePrefCode ?? null, issues);
  const muni = checkMunicipality(read.municipality, prefCode, geo, inDoc, mandatoryFail);
  out.prefCode = prefCode;
  out.muniCode = muni?.code ?? null;
  out.muniName = muni?.name ?? null;

  // ── 段階と日付（必須） ──
  let completed = false;
  const stageOk = (ALLOWED_STAGES[read.kind] ?? []).includes(read.primaryStage);
  if (!stageOk) mandatoryFail("primaryStage", "stage_word", "kind_stage_mismatch");
  let stamp: StageStamp | null = null;
  const d = read.primaryDate;
  if (d === null) {
    if (read.primaryStage !== null) mandatoryFail("primaryDate", "value_in_quote", "missing_value");
  } else if (read.primaryDateQuote === null) {
    mandatoryFail("primaryDate", "quote_exists", "missing_quote");
  } else if (!inDoc(read.primaryDateQuote)) {
    mandatoryFail("primaryDate", "quote_exists", "quote_not_in_document");
  } else if (!dateInQuote(d, read.primaryDateQuote) && !(opts.announcedOn && relativeDateInQuote(d, read.primaryDateQuote, opts.announcedOn))) {
    mandatoryFail("primaryDate", "value_in_quote", "date_not_in_quote");
  } else {
    const r = resolveReadDate(d, doc.season);
    if (!r) mandatoryFail("primaryDate", "year_completion", "out_of_season_or_invalid");
    else {
      stamp = { date: r.date, time: d.time };
      if (read.primaryStage !== null && previous) {
        const clash = (Object.entries(previous.stages) as Array<[CaseStage, StageStamp]>).some(([stage, s]) =>
          stagesConflict({ stage: read.primaryStage!, date: r.date }, { stage, date: s.date }),
        );
        if (clash) {
          mandatoryFail("primaryDate", "chronology", "before_previous_stage");
          stamp = null;
        }
      }
      if (stamp) completed ||= r.completed;
    }
  }
  if (stageOk && stamp) {
    out.primaryStage = read.primaryStage;
    out.primaryStamp = stamp;
    if (read.primaryStage) out.stages[read.primaryStage] = stamp;
  }

  // ── 任意の項目 ──
  out.nationalNo = checkCount("nationalNo", read.nationalNo, nationalNoInQuote, inDoc, optionalFail);
  out.prefNo = checkCount("prefNo", read.prefNo, prefNoInQuote, inDoc, optionalFail);
  out.headCount = checkCount("headCount", read.headCount, headCountInQuote, inDoc, optionalFail);
  out.birdUse = checkText("birdUse", read.birdUse, inDoc, optionalFail);
  out.housing = checkText("housing", read.housing, inDoc, optionalFail);
  out.negationBasis = checkText("negationBasis", read.negationBasis, inDoc, optionalFail);

  const radii = new Set<number>();
  read.radiiKm.forEach((row, i) => {
    if (!inDoc(row.quote)) return optionalFail("radiiKm", "quote_exists", `row${i}:quote_not_in_document`);
    if (!radiusInQuote(row.km, row.quote)) return optionalFail("radiiKm", "radius_sentence", `row${i}:radius_not_in_sentence`);
    radii.add(row.km);
  });
  out.radiiKm = [...radii].sort((a, b) => a - b);

  // 見込み日: 引用に日付があり、シーズンの範囲内。同じ対象で日付が割れたら両方落とす。
  const est = new Map<"shipment" | "movement" | "surveillance", IsoDate[]>();
  read.estimates.forEach((row, i) => {
    const field = "estimates";
    if (!inDoc(row.quote)) return optionalFail(field, "quote_exists", `row${i}:quote_not_in_document`);
    if (!dateInQuote(row.date, row.quote)) return optionalFail(field, "value_in_quote", `row${i}:date_not_in_quote`);
    const r = resolveReadDate(row.date, doc.season);
    if (!r) return optionalFail(field, "year_completion", `row${i}:out_of_season_or_invalid`);
    completed ||= r.completed;
    est.set(row.target, [...(est.get(row.target) ?? []), r.date]);
  });
  for (const [target, dates] of est) {
    if (new Set(dates).size === 1) out.estimates[target] = dates[0]!;
    else optionalFail("estimates", "chronology", `${target}:estimates_disagree`);
  }

  // 段階の出来事: 主の段階と前の事例とは矛盾せず、行の間でも矛盾しない（矛盾する行は両方落とす）。
  const reference: Array<{ stage: CaseStage; date: IsoDate }> = [];
  for (const [stage, s] of Object.entries(previous?.stages ?? {}) as Array<[CaseStage, StageStamp]>) reference.push({ stage, date: s.date });
  if (out.primaryStage && out.primaryStamp) reference.push({ stage: out.primaryStage, date: out.primaryStamp.date });
  const events: Array<{ i: number; stage: CaseStage; stamp: StageStamp; completed: boolean }> = [];
  read.stageEvents.forEach((row, i) => {
    const field = "stageEvents";
    if (!inDoc(row.quote)) return optionalFail(field, "quote_exists", `row${i}:quote_not_in_document`);
    if (!dateInQuote(row.date, row.quote)) return optionalFail(field, "value_in_quote", `row${i}:date_not_in_quote`);
    const r = resolveReadDate(row.date, doc.season);
    if (!r) return optionalFail(field, "year_completion", `row${i}:out_of_season_or_invalid`);
    if (reference.some((ref) => stagesConflict({ stage: row.stage, date: r.date }, ref))) {
      return optionalFail(field, "chronology", `row${i}:conflicts_with_known_stage`);
    }
    events.push({ i, stage: row.stage, stamp: { date: r.date, time: row.date.time }, completed: r.completed });
  });
  const clashing = new Set<number>();
  for (let a = 0; a < events.length; a++) {
    for (let b = a + 1; b < events.length; b++) {
      const ea = events[a]!;
      const eb = events[b]!;
      if (stagesConflict({ stage: ea.stage, date: ea.stamp.date }, { stage: eb.stage, date: eb.stamp.date })) {
        clashing.add(ea.i);
        clashing.add(eb.i);
      }
    }
  }
  for (const e of events) {
    if (clashing.has(e.i)) {
      optionalFail("stageEvents", "chronology", `row${e.i}:conflicts_between_events`);
      continue;
    }
    completed ||= e.completed;
    if (!out.stages[e.stage]) out.stages[e.stage] = e.stamp;
  }

  out.yearCompleted = completed;
  return finish();
}

type Fail = (field: string, check: VerifyCheck, detail: string) => false;
type OptFail = (field: string, check: VerifyCheck, detail: string) => void;
/** 必須の不合格を記録して null を返す。 */
function failNull(fail: Fail, field: string, check: VerifyCheck, detail: string): null {
  fail(field, check, detail);
  return null;
}

type InDoc = (quote: string | null) => quote is string;

/** 種類の根拠（kindQuote）。語を見る種類は、引用が本文にあり、その種類の語を含むこと。 */
function checkKind(read: ReadResult, inDoc: InDoc, fail: Fail): boolean {
  const word = KIND_WORD[read.kind];
  if (read.kindQuote !== null && !inDoc(read.kindQuote)) return fail("kind", "quote_exists", "quote_not_in_document");
  if (!word) return true; // progress、control_done、wild_bird は語を見ない
  if (read.kindQuote === null) return fail("kind", "stage_word", "missing_quote");
  const strip = STRIP[read.kind];
  const nq = normalizeForMatch(read.kindQuote);
  if (!word.test(strip ? nq.replace(strip, "") : nq)) return fail("kind", "stage_word", "stage_word_not_in_quote");
  return true;
}

/** 都道府県。引用が本文にあり、値が引用にあり、都道府県の名前であること。 */
function checkPrefecture(q: Quoted<string>, inDoc: InDoc, fail: Fail, sourcePrefCode: PrefCode | null, issues: VerifyIssue[]): PrefCode | null {
  if (q.value === null) return failNull(fail, "prefecture", "value_in_quote", "missing_value");
  if (q.quote !== null && !inDoc(q.quote)) return failNull(fail, "prefecture", "quote_exists", "quote_not_in_document");
  const code = prefCodeOfName(q.value);
  const inQuote = q.quote !== null && valueInQuote(q.value, q.quote);
  if (!inQuote) {
    // 引用に県名がない: 取得元の県（プログラムの情報）と読みの県が一致するときだけ合格。国の発表（取得元の県なし）では引用に県名が要る
    if (code === null || sourcePrefCode === null || code !== sourcePrefCode) {
      return failNull(fail, "prefecture", "value_in_quote", q.quote === null ? "missing_quote" : "value_not_in_quote");
    }
    issues.push({ field: "prefecture", check: "value_in_quote", mandatory: false, detail: "prefecture_from_source" });
    return code;
  }
  if (code === null) return failNull(fail, "prefecture", "muni_exists", "unknown_prefecture");
  return code;
}

/** 市町村。引用が本文にあり、値が引用にあり、その都道府県に存在すること。 */
function checkMunicipality(
  q: Quoted<string>,
  prefCode: PrefCode | null,
  geo: GeoStore,
  inDoc: InDoc,
  fail: Fail,
): { code: string; name: string } | null {
  if (q.value === null) return failNull(fail, "municipality", "value_in_quote", "missing_value");
  if (q.quote === null) return failNull(fail, "municipality", "quote_exists", "missing_quote");
  if (!inDoc(q.quote)) return failNull(fail, "municipality", "quote_exists", "quote_not_in_document");
  if (!valueInQuote(q.value, q.quote)) return failNull(fail, "municipality", "value_in_quote", "value_not_in_quote");
  const core = muniCoreName(q.value);
  if (prefCodeOfName(core) !== null) return failNull(fail, "municipality", "muni_exists", "prefecture_name_in_municipality");
  if (prefCode === null) return null; // 都道府県の不合格が既に出ている
  const code = findMuniByName(prefCode, core, geo);
  if (code === null) return failNull(fail, "municipality", "muni_exists", "not_in_prefecture");
  return { code, name: geo.index[code]?.name ?? core };
}

/** 任意の項目の不合格の理由。引用がない、本文にない、値が引用から取り出せない。通れば null。 */
function optionalReason(quote: string | null, inDoc: InDoc, supports: () => boolean): { check: VerifyCheck; detail: string } | null {
  if (quote === null) return { check: "quote_exists", detail: "missing_quote" };
  if (!inDoc(quote)) return { check: "quote_exists", detail: "quote_not_in_document" };
  if (!supports()) return { check: "value_in_quote", detail: "value_not_in_quote" };
  return null;
}

/** 任意の数の項目。引用が本文にあり、値がその引用から取り出せること。 */
function checkCount(
  field: string,
  q: Quoted<number>,
  matcher: (value: number, quote: string) => boolean,
  inDoc: InDoc,
  optionalFail: OptFail,
): number | null {
  if (q.value === null) return null;
  const reason = optionalReason(q.quote, inDoc, () => matcher(q.value!, q.quote!));
  if (reason) {
    optionalFail(field, reason.check, reason.detail);
    return null;
  }
  return q.value;
}

/** 任意の文字列の項目。 */
function checkText(field: string, q: Quoted<string>, inDoc: InDoc, optionalFail: OptFail): string | null {
  if (q.value === null) return null;
  const reason = optionalReason(q.quote, inDoc, () => valueInQuote(q.value!, q.quote!));
  if (reason) {
    optionalFail(field, reason.check, reason.detail);
    return null;
  }
  return q.value;
}

/** 野鳥は行ごとに検査する。1 行でも必須（日付、都道府県、引用、test の語）が通らなければ不合格。0 行も不合格。 */
function verifyWildBirds(
  read: ReadResult,
  season: number,
  geo: GeoStore,
  ndoc: string,
  out: NormalizedRead,
  issues: VerifyIssue[],
  dropped: Set<string>,
): void {
  if (read.wildBirds.length === 0) {
    issues.push({ field: "wildBirds", check: "quote_exists", mandatory: true, detail: "no_rows" });
    return;
  }
  read.wildBirds.forEach((row, i) => {
    const must = (check: VerifyCheck, detail: string): false => {
      issues.push({ field: "wildBirds", check, mandatory: true, detail: `row${i}:${detail}` });
      return false;
    };
    const optional = (check: VerifyCheck, detail: string): void => {
      issues.push({ field: "wildBirds", check, mandatory: false, detail: `row${i}:${detail}` });
      dropped.add("wildBirds");
    };
    if (!quoteInNormalized(row.quote, ndoc)) return must("quote_exists", "quote_not_in_document");
    let ok = true;
    if (!dateInQuote(row.date, row.quote)) ok = must("value_in_quote", "date_not_in_quote");
    const resolved = resolveReadDate(row.date, season);
    if (ok && !resolved) ok = must("year_completion", "out_of_season_or_invalid");
    const prefCode = prefCodeOfName(row.prefecture);
    if (!valueInQuote(row.prefecture, row.quote)) ok = must("value_in_quote", "value_not_in_quote");
    else if (prefCode === null) ok = must("muni_exists", "unknown_prefecture");
    if (!wildTestWordOk(row.test, row.quote)) ok = must("stage_word", "test_word_not_in_quote");
    if (!ok || !resolved || prefCode === null) return;

    let muniCode: string | null = null;
    let muniName: string | null = null;
    if (row.municipality !== null) {
      const core = muniCoreName(row.municipality);
      muniName = core;
      if (!valueInQuote(core, row.quote)) optional("value_in_quote", "muni_value_not_in_quote");
      else {
        muniCode = findMuniByName(prefCode, core, geo);
        if (muniCode === null) optional("muni_exists", "muni_not_in_prefecture");
        else muniName = geo.index[muniCode]?.name ?? core;
      }
    }
    let species = row.species;
    if (species !== null && !valueInQuote(species, row.quote)) {
      optional("value_in_quote", "species_not_in_quote");
      species = null;
    }
    out.wildBirds.push({ date: resolved.date, prefCode, muniCode, muniName, species, test: row.test });
    out.yearCompleted ||= resolved.completed;
  });
}
