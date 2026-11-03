// data/sources.json（見回り先）を作る（F-09）。
// 35 県は調査表（permanent の TSV。private/ にあり、公開しない）を kindOf で読む。
// 12 県は TSV を使わず、下の手書きの表だけを使う。note は自前の短い文で、資料の文を写さない。
import { prefCodeOfName, PREFS } from "@hpai/shared/pref";
import type { IsoDate, PrefCode, SourceKind, SourceSeed } from "@hpai/shared/types";
import type { ProbeRow } from "../../functions/src/probe/run";

/** 調査の日。--reach なしで作ったときの confirmedOn。 */
export const RESEARCH_DATE: IsoDate = "2026-11-03";

// ── 種類 ──

const TSV_KINDS: Readonly<Record<string, SourceKind | null>> = {
  hpai_fixed: "pref_fixed",
  rss_all: "pref_rss",
  rss_press: "pref_rss",
  rss_none: null, // 入口がない（行を作らない）
};

/** 調査表の種類を SourceKind にする。入口がない種類は null。35 県に出ない種類（12 県の独自の種類など）は throw。 */
export function kindOf(tsvKind: string): SourceKind | null {
  if (!Object.hasOwn(TSV_KINDS, tsvKind)) throw new Error(`知らない種類です: ${JSON.stringify(tsvKind)}`);
  return TSV_KINDS[tsvKind]!;
}

// ── 12 県の手書きの表 ──

export type TwelveVerdict = "confirmed" | "conditional" | "undetermined";

interface TwelveEntry {
  /** 県のホスト（https://www. の後ろ）。 */
  host: string;
  verdict: TwelveVerdict;
  fixed: Array<string | [path: string, note: string]>;
  rss: Array<string | [path: string, note: string]>;
  press: Array<string | [path: string, note: string]>;
}

const TWELVE: Readonly<Record<PrefCode, TwelveEntry>> = {
  "15": {
    host: "pref.niigata.lg.jp",
    verdict: "confirmed",
    fixed: ["site/chikusan/1196180201100.html"],
    rss: ["rss/10/site-163.xml", "rss/10/list2.xml"],
    press: [],
  },
  "39": {
    host: "pref.kochi.lg.jp",
    verdict: "confirmed",
    fixed: ["soshiki/160000/160901/", "doc/2022041100295/"],
    rss: ["category/bunya/shigoto_sangyo/chikusangyo/index.rss", "category/kubun/news/index.rss"],
    press: [],
  },
  "25": {
    host: "pref.shiga.lg.jp",
    verdict: "confirmed",
    fixed: ["ge00/7137.html"],
    rss: [],
    press: ["cgi-bin/press/index.php"],
  },
  "21": {
    host: "pref.gifu.lg.jp",
    verdict: "confirmed",
    fixed: ["page/120868.html", ["page/338648.html", "次季も使うか未確認"]],
    rss: [],
    press: ["site/pressrelease/"],
  },
  "16": {
    host: "pref.toyama.jp",
    verdict: "confirmed",
    fixed: [
      ["1612/kurashi/seikatsu/shokuseikatsu/20260309.html", "URL に日付。次季も使うか未確認"],
      "1612/kensei/kenseiunei/kensei/soshiki/16/1612.html",
    ],
    rss: ["shinchaku/shinchaku.xml", "kensei/kouhou/houdou/press.xml"],
    press: [],
  },
  "43": {
    host: "pref.kumamoto.jp",
    verdict: "confirmed",
    fixed: ["soshiki/77/"],
    rss: ["rss/10/soshiki-7-77.xml", "rss/10/list1.xml"],
    press: [],
  },
  "44": {
    host: "pref.oita.jp",
    verdict: "confirmed",
    fixed: ["soshiki/15450/"],
    rss: ["rss/10/soshiki-15-15450.xml", "rss/10/list6.xml"],
    press: [],
  },
  "38": {
    host: "pref.ehime.jp",
    verdict: "confirmed",
    fixed: ["soshiki/85/", ["page/95900.html", "次季も使うか未確認"]],
    rss: ["rss/20/soshiki-19-85.xml", "rss/20/list5.xml"],
    press: [],
  },
  "23": {
    host: "pref.aichi.jp",
    verdict: "confirmed",
    fixed: ["soshiki/chikusan/chikusan-hpai.html"],
    rss: ["rss/10/list7.xml", "rss/10/list1.xml"],
    press: [],
  },
  "42": {
    host: "pref.nagasaki.jp",
    verdict: "confirmed",
    fixed: ["bunrui/shigoto-sangyo/nogyo/chikusan/boueki/infuruenza/"],
    rss: [],
    press: ["press-contents/index.html"],
  },
  // 福岡: robots.txt が /rss/ を禁止しているので pref_rss はない
  "40": {
    host: "pref.fukuoka.lg.jp",
    verdict: "conditional",
    fixed: [
      ["contents/kachikueisei-osirase.html", "条件付き。家きんの節は外部リンクのみ"],
      ["contents/shizentorifuru.html", "野鳥のみ"],
    ],
    rss: [],
    press: ["press/"],
  },
  "18": {
    host: "pref.fukui.lg.jp",
    verdict: "undetermined",
    fixed: [["doc/kaho/toriinfluenza.html", "確定できず。国の発表で補う"]],
    rss: [["news.xml", "発生時に流れるか未確認"]],
    press: [],
  },
};

export const TWELVE_PREFS: ReadonlyArray<{ code: PrefCode; name: string; verdict: TwelveVerdict }> = Object.entries(TWELVE).map(
  ([code, e]) => ({ code, name: PREFS.find((p) => p.code === code)!.name, verdict: e.verdict }),
);

const TWELVE_CODES: ReadonlySet<PrefCode> = new Set(Object.keys(TWELVE));

export const TWELVE_SEEDS: readonly SourceSeed[] = Object.entries(TWELVE).flatMap(([prefCode, e]) =>
  (
    [
      ["pref_fixed", e.fixed],
      ["pref_rss", e.rss],
      ["pref_press_list", e.press],
    ] as const
  ).flatMap(([kind, list]) =>
    list.map((item): SourceSeed => {
      const [path, note] = typeof item === "string" ? [item, null] : item;
      return { prefCode, url: `https://www.${e.host}/${path}`, kind, confirmedOn: RESEARCH_DATE, note };
    }),
  ),
);

// ── 国と環境省の 3 行（設計書 §9.2。F-03 の到達試験の対象と同じ URL） ──

export const NATIONAL_SEEDS: readonly SourceSeed[] = [
  { prefCode: null, url: "https://www.maff.go.jp/j/press/index.html", kind: "maff_press", confirmedOn: RESEARCH_DATE, note: null },
  { prefCode: null, url: "https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html", kind: "maff_season", confirmedOn: RESEARCH_DATE, note: null },
  { prefCode: null, url: "https://www.env.go.jp/nature/dobutsu/bird_flu/", kind: "moe", confirmedOn: RESEARCH_DATE, note: null },
];

// ── 調査表（TSV）の読み取り ──

/** 1 行目の見出しの名前で列を読む。空行は飛ばす。 */
function parseTsv(tsv: string): Array<Record<string, string>> {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines[0]?.split("\t").map((h) => h.trim()) ?? [];
  for (const need of ["pref", "url", "kind"]) {
    if (!head.includes(need)) throw new Error(`調査表に列「${need}」がありません（必要な列: pref、url、kind）`);
  }
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

/** 35 県の行。12 県の行は kindOf を通す前に飛ばす（12 県の種類は kindOf が throw する）。note は資料の文を写さず null。 */
function seedsFromPermanent(tsv: string): SourceSeed[] {
  const out: SourceSeed[] = [];
  parseTsv(tsv).forEach((r, i) => {
    const where = `${i + 2} 行目（${r.pref}）`;
    const prefCode = prefCodeOfName(r.pref ?? "");
    if (prefCode === null) throw new Error(`${where}: 県名を読めません`);
    if (TWELVE_CODES.has(prefCode)) return;
    const kind = kindOf(r.kind ?? "");
    if (kind === null) return;
    if (!/^https?:\/\/\S+$/.test(r.url ?? "")) throw new Error(`${where}: URL が正しくありません`);
    out.push({ prefCode, url: r.url!, kind, confirmedOn: RESEARCH_DATE, note: null });
  });
  return out;
}

// ── 到達の結果の反映 ──

/** 未到達の note。I-02 が失敗に数えるときの目印。 */
export const UNREACHED_NOTE_RE = /(クラウドから|古い TLS で)未到達（\d{4}-\d{2}-\d{2}）/;

const NOTE_MAX = 60;

export interface BuildReport {
  /** 届いた（ok）行。confirmedOn を実行日にした。 */
  reached: number;
  cloudUnreached: number;
  tlsUnreached: number;
  /** 届いたが語がなかった行（reached_no_content）。課のトップなど、平時は正常な入口もある。行は動かさない。 */
  noContent: string[];
  /** 方針で取れない行（robots_denied、not_allowed）。表の間違いなので、直してから作り直す。 */
  policyDenied: string[];
}

export interface BuildOptions {
  /** F-03 の到達試験の行（data/private/reach/*.ndjson）。同じ URL が複数あれば後の行を採る。 */
  reach?: readonly ProbeRow[];
  /** 実行日。--reach のときの confirmedOn と未到達の note の日付。 */
  today?: IsoDate;
}

function withUnreached(seed: SourceSeed, text: string): SourceSeed {
  const joined = seed.note === null ? text : `${text}。${seed.note}`;
  return { ...seed, note: joined.length <= NOTE_MAX ? joined : text };
}

/** 国 3 行の次に県コード順。同じ県の中は 35 県の行、12 県の表の順に並べた見回り先を作る。 */
export function buildSources(permanentTsv: string, opts: BuildOptions = {}): { seeds: SourceSeed[]; report: BuildReport } {
  const all: SourceSeed[] = [...NATIONAL_SEEDS, ...seedsFromPermanent(permanentTsv), ...TWELVE_SEEDS];

  const seen = new Set<string>();
  for (const s of all) {
    if (seen.has(s.url)) throw new Error(`URL が重複しています: ${s.url}`);
    seen.add(s.url);
  }
  // 県コード順（国は先頭）。同じ県の中は国 → 35 県 → 12 県の並びを保つ
  const byPref = new Map<string, SourceSeed[]>();
  for (const s of all) byPref.set(s.prefCode ?? "", [...(byPref.get(s.prefCode ?? "") ?? []), s]);
  const sorted = [...byPref.keys()].sort().flatMap((k) => byPref.get(k)!);

  const report: BuildReport = { reached: 0, cloudUnreached: 0, tlsUnreached: 0, noContent: [], policyDenied: [] };
  const latest = new Map<string, ProbeRow>();
  for (const r of opts.reach ?? []) latest.set(r.target.url, r);
  const today = opts.today ?? RESEARCH_DATE;

  const seeds = sorted.map((seed): SourceSeed => {
    const r = latest.get(seed.url);
    if (!r) return seed;
    switch (r.verdict) {
      case "ok":
        report.reached++;
        return { ...seed, confirmedOn: today };
      case "http_error":
      case "network_error":
        report.cloudUnreached++;
        return withUnreached(seed, `クラウドから未到達（${today}）`);
      case "tls_error":
        report.tlsUnreached++;
        return withUnreached(seed, `古い TLS で未到達（${today}）`);
      case "reached_no_content":
        report.noContent.push(seed.url);
        return seed;
      case "robots_denied":
      case "not_allowed":
        report.policyDenied.push(seed.url);
        return seed;
    }
  });
  return { seeds, report };
}
