// 全国の傾向の深掘りの集計（設計書 2026-11-06-trends-redesign §2.1、§3、§5）。手元の抽出の結果（公開しない）と国の事例一覧から、
// data/trends/insights.json を作る。Claude は呼ばない。
//
// - 今の data/trends/summary.json は変えない（今の画面は知らないキーを拒むので、別のファイルにする）。
// - 根拠の文、例目、市町村は出さない。語の数と、群ごとの件数だけ。
// - 用途・飼い方で分けた数は 6 シーズン合計だけ。4 件以下は伏せ、列の合計からの引き算で戻せないよう 2 つ目も伏せる。
import { toJstIso } from "@hpai/shared/dates";
import { findWordingViolations } from "@hpai/shared/wording";
import { TREND_KEYS, type TrendKey } from "../../web/src/pages/trends/types";
import type { GroupCount, InsightCounts, InsightGroupRow, InsightGroups, InsightNoticing, InsightPhrases, InsightSeason, ReportQuote, TrendInsights } from "../../web/src/pages/trends/insightsTypes";
import type { SurveyExtract, SurveyExtractRow } from "./trends";
import { NOTICING_FIELDS, NOTICING_KEYS, NOTICING_LABELS, NOTICING_VALUE_LABELS, type NoticingSummary } from "./trends-noticing";

/** 国の事例一覧の 1 行（data/history/cases.json）のうち、使う欄だけ */
export interface CaseRow {
  season: number;
  no: number;
  birdUse: string | null;
  housing: string | null;
  related: boolean;
}

/** これより小さい数は伏せる */
export const SUPPRESS_BELOW = 5;

/**
 * 根拠の 1 文に当てる語の表（2026-11-06 に 20 件を目で確かめて直した）。1 文が複数の語に入る。
 * 「見かける」（農場の人の話）と「囓」の字を拾う。
 */
export const PHRASES: Readonly<Partial<Record<TrendKey, ReadonlyArray<readonly [string, RegExp]>>>> = {
  rodent_signs: [
    ["ふん", /糞|ふん|フン/u],
    ["姿・捕獲", /見かけ|見る|姿|生体|捕獲|目撃|ネズミ(?:を|が)確認/u],
    ["かじり跡", /かじ|齧|囓/u],
    ["死骸", /死骸|死体|死がい/u],
    ["通り道・巣", /通り道|ラットサイン|巣/u],
    ["足跡", /足跡/u],
  ],
  wall_net_damage: [
    ["金網・ネット", /金網|ネット|網/u],
    ["壁", /壁/u],
    ["カーテン", /カーテン/u],
    ["天井・屋根", /天井|屋根|軒/u],
    ["換気口", /換気|入気|吸気|ファン|排気/u],
    ["扉の隙間", /扉|戸|ドア|シャッター/u],
  ],
};

/** ねずみの根拠の文の出どころ。調査のときに見つかった / 農場の人の話 / どちらとも読めない */
export function rodentSourceOf(quote: string): "survey" | "interview" | "unclear" {
  if (/調査時|調査の際|現地調査|確認され|認められ|確認した|見られ/u.test(quote)) return "survey";
  if (/とのこと/u.test(quote)) return "interview";
  return "unclear";
}

export const useGroupOf = (u: string | null): string => (u?.startsWith("採卵鶏") ? "採卵鶏" : u === "肉用鶏" ? "肉用鶏" : "その他");
export const housingGroupOf = (h: string | null): string => (h === null ? "記載なし" : h.includes("平飼") ? "平飼い（併用を含む）" : h === "ケージ飼い" ? "ケージ" : "記載なし");
const USE_ORDER = ["採卵鶏", "肉用鶏", "その他"];
const HOUSING_ORDER = ["ケージ", "平飼い（併用を含む）", "記載なし"];

/**
 * 国の疫学調査報告書の結論の文（2026-11-07 に農林水産省の原本の PDF で一字一句を確かめた。脚注の番号だけ除いた）。
 * 県、市町村、例目を含む文は使わない。
 */
const R2526 = { reportTitle: "2025年～2026年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書", reportUrl: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf" };
const R2425 = { reportTitle: "2024年～2025年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書", reportUrl: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_94/attach/pdf/kakin_94-10.pdf" };
const R2324 = { reportTitle: "2023年～2024年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書", reportUrl: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r5_hpai_kokunai-157.pdf" };
export const REPORT_QUOTES: readonly ReportQuote[] = [
  { season: 2025, about: "general", text: "国内では近隣での感染確認の有無によらず、初発事例後は全国どこでも感染リスクがあるものと考えられた。", ...R2526 },
  { season: 2025, about: "rodent_signs", text: "ネズミについても、半数以上の農場で死体や痕跡が確認されている。", ...R2526 },
  {
    season: 2025,
    about: "wall_net_damage",
    text: "家きん舎へのウイルスの侵入要因については、多くの農場で、裏口を含めた家きん舎立入り時の手指の洗浄・消毒等の人の衛生管理や、家きん舎の壁面破損の修繕等の野生動物侵入防止対策に不備等があったことから、これらがウイルスの侵入経路となった可能性が考えられた。",
    ...R2526,
  },
  {
    season: 2025,
    about: "external_clothing",
    text: "飼養衛生管理の実施状況については、飼養衛生管理基準の遵守に努めている農場においても発生が確認された一方で、半数以上の農場で、外部事業者における衛生管理区域立入り時の専用衣服又は靴の使用について不備が確認された。",
    ...R2526,
  },
  {
    season: 2024,
    about: "wall_net_damage",
    text: "家きん舎への侵入経路については、作業着・長靴の交換、手指消毒の不徹底等や、家きん舎の壁面破損の修繕、家きん舎及び関連施設における防鳥ネットの設置等の不備があり、これらが感染リスクとなった可能性が考えられた。",
    ...R2425,
  },
  {
    season: 2023,
    about: "wall_net_damage",
    text: "家きん舎へのウイルスの侵入経路については、ほとんどの発生農家で壁や防鳥ネットの破損部からのカラス等の野鳥や小動物の侵入、手指消毒等の不徹底がみられたことから、これらが要因となった可能性が考えられた。",
    ...R2324,
  },
];

function counts(xs: readonly SurveyExtract[]): InsightCounts[] {
  return TREND_KEYS.map((key) => ({
    key,
    issue: xs.filter((x) => x[key].status === "issue").length,
    noIssue: xs.filter((x) => x[key].status === "no_issue").length,
    notMentioned: xs.filter((x) => x[key].status === "not_mentioned").length,
  }));
}

/** 列（項目）ごとに、5 件未満を伏せ、伏せたのが 1 つだけなら残りのうち最も小さいものも伏せる */
export function suppressColumn(values: readonly number[]): GroupCount[] {
  const hide = values.map((v) => v < SUPPRESS_BELOW);
  if (hide.filter(Boolean).length === 1) {
    let j = -1;
    values.forEach((v, i) => {
      if (!hide[i] && (j < 0 || v < values[j]!)) j = i;
    });
    if (j >= 0) hide[j] = true;
  }
  return values.map((v, i) => (hide[i] ? { suppressed: true } : v));
}

function groups(dimension: InsightGroups["dimension"], rows: ReadonlyArray<{ group: string; x: SurveyExtract }>): InsightGroups {
  const order = dimension === "use" ? USE_ORDER : HOUSING_ORDER;
  const totals = order.map((g) => rows.filter((r) => r.group === g).length);
  const issues = Object.fromEntries(TREND_KEYS.map((k) => [k, suppressColumn(order.map((g) => rows.filter((r) => r.group === g && r.x[k].status === "issue").length))])) as Record<TrendKey, GroupCount[]>;
  const out: InsightGroupRow[] = order.map((label, i) => ({
    label,
    total: totals[i]!,
    issue: Object.fromEntries(TREND_KEYS.map((k) => [k, issues[k][i]!])) as Record<TrendKey, GroupCount>,
  }));
  return { dimension, rows: out };
}

export function aggregateInsights(rows: readonly SurveyExtractRow[], cases: readonly CaseRow[], generatedAt: string = toJstIso(new Date())): TrendInsights {
  const caseOf = new Map(cases.filter((c) => !c.related).map((c) => [`${c.season}-${c.no}`, c]));
  const read = rows.filter((r): r is SurveyExtractRow & { extract: SurveyExtract } => r.extract !== null);
  const joined = read.map((r) => {
    const c = caseOf.get(`${r.season}-${r.no}`);
    if (!c) throw new Error(`事例一覧につながりません: ${r.season}-${r.no}`);
    return { r, c };
  });
  const xs = read.map((r) => r.extract);
  const seasonNos = [...new Set(read.map((r) => r.season))].sort((a, b) => b - a);
  const seasons: InsightSeason[] = seasonNos.map((season) => {
    const ys = read.filter((r) => r.season === season).map((r) => r.extract);
    return { season, surveyed: ys.length, items: counts(ys) };
  });

  const phrases: InsightPhrases[] = [];
  for (const key of TREND_KEYS) {
    const table = PHRASES[key];
    if (!table) continue;
    const quotes = xs.filter((x) => x[key].status === "issue").map((x) => x[key].quote ?? "");
    phrases.push({
      key,
      base: quotes.length,
      words: table.map(([label, re]) => ({ label, count: quotes.filter((q) => re.test(q)).length })),
      unmatched: quotes.filter((q) => !table.some(([, re]) => re.test(q))).length,
    });
  }

  const rodentSource = { survey: 0, interview: 0, unclear: 0 };
  for (const x of xs) if (x.rodent_signs.status === "issue") rodentSource[rodentSourceOf(x.rodent_signs.quote ?? "")]++;

  return {
    generatedAt,
    total: { season: 0, surveyed: xs.length, items: counts(xs) },
    seasons,
    phrases,
    rodentSource,
    groups: [
      groups("housing", joined.map(({ r, c }) => ({ group: housingGroupOf(c.housing), x: r.extract }))),
      groups("use", joined.map(({ r, c }) => ({ group: useGroupOf(c.birdUse), x: r.extract }))),
    ],
    reportQuotes: [...REPORT_QUOTES],
  };
}

/**
 * 段階 2 の集計（data/private/noticing-summary.json、scripts/lib/trends-noticing.ts）から、画面に出す 6 シーズン合計だけを取り出す。
 * シーズンごとには割らない。値の並びは抽出の決まりの順（記載なしは最後）。
 */
export function noticingFromSummary(s: NoticingSummary): InsightNoticing {
  return {
    read: s.total.read,
    fields: NOTICING_KEYS.map((key) => ({
      key,
      label: NOTICING_LABELS[key],
      values: NOTICING_FIELDS[key].map((v) => ({ key: v, label: NOTICING_VALUE_LABELS[v]!, count: s.total.fields[key].counts[v] ?? 0 })),
      unverified: s.total.fields[key].unverified,
    })),
  };
}

const FORBIDDEN_KEYS =["muniCode", "muniName", "prefCode", "prefName", "caseId", "no", "sourceUrl", "url", "title", "quote", "customId", "custom_id"];
function* keysOf(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keysOf(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keysOf(x);
    }
}

/** 公開する前の検査。違反の一覧（なければ空） */
export function checkInsights(s: TrendInsights, muniNames: readonly string[] = []): string[] {
  const errors: string[] = [];
  for (const k of new Set(keysOf(s))) if (FORBIDDEN_KEYS.includes(k)) errors.push(`持たないキー: ${k}`);
  for (const g of s.groups)
    for (const k of TREND_KEYS) {
      const col = g.rows.map((r) => r.issue[k]);
      const shown = col.filter((v): v is number => typeof v === "number");
      if (shown.some((v) => v < SUPPRESS_BELOW)) errors.push(`${g.dimension} ${k}: 伏せていない小さな数`);
      if (col.length - shown.length === 1) errors.push(`${g.dimension} ${k}: 伏せたのが 1 つだけ（引き算で戻せる）`);
    }
  for (const q of s.reportQuotes) if (/例目|[都道府県]\S{0,6}[市町村]/u.test(q.text)) errors.push(`報告書の文に事例の手がかり: ${q.text.slice(0, 20)}`);
  const text = JSON.stringify(s);
  for (const n of muniNames) if (n.length >= 2 && text.includes(n)) errors.push(`市町村名: ${n}`);
  for (const w of findWordingViolations(text)) errors.push(`禁句: ${w}`);
  return errors;
}
