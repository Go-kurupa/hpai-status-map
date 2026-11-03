// 到達試験の対象を作る（F-03）。県の入口は private/ の調査表（TSV）から、国と地図の配布元はここに持つ。
import { prefCodeOfName } from "@hpai/shared/pref";
import type { SourceSeed } from "@hpai/shared/types";
import type { ProbeTarget } from "../../functions/src/probe/run";

const MAFF = "https://www.maff.go.jp/j/";
const national = (url: string, kind: string): ProbeTarget => ({ prefCode: null, url, kind, dev: null });

/** 国（農林水産省）と環境省の 12 件。 */
export const NATIONAL_TARGETS: readonly ProbeTarget[] = [
  national(`${MAFF}press/index.html`, "maff_press"),
  ...["2510", "2511", "2512", "2601", "2602", "2603", "2604"].map((m) => national(`${MAFF}press/arc/${m}.html`, "maff_arc")),
  national(`${MAFF}press/syouan/douei/251220.html`, "maff_season"),
  national(`${MAFF}syouan/douei/tori/r8_hpai_kokunai.html`, "maff_season"),
  national(`${MAFF}syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf`, "maff_season"),
  national("https://www.env.go.jp/nature/dobutsu/bird_flu/", "moe"),
];

/** 地図の配布元 4 件。ホストごとに届き方が違う（古い TLS のホストがある）ので別々に試す。 */
export const REFERENCE_TARGETS: readonly ProbeTarget[] = [
  "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html",
  "https://maps.gsi.go.jp/development/ichiran.html",
  "https://cyberjapandata.gsi.go.jp/xyz/pale/5/28/12.png",
  "https://www.gsi.go.jp/LAW/2930-index.html",
].map((url) => national(url, "reference"));

interface TsvRow {
  [column: string]: string;
}

/** 1 行目の見出しの名前で列を読む。空行は飛ばす。 */
function parseTsv(tsv: string): TsvRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines[0]?.split("\t").map((h) => h.trim()) ?? [];
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

const isUrl = (s: string | undefined): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
const ok200 = (status: string | undefined) => (status ?? "").startsWith("200");

/**
 * permanent（常設ページと RSS の調査表）と entrances（12 県の入口の調査表）から対象を作る。
 * URL のない行と blocked の行は飛ばす。entrances にある県は permanent の行を使わない。URL の重複は最初の行を残す。
 * 国と環境省の 12 件、地図の配布元 4 件を先に入れる。
 */
export function buildProbeTargets(permanentTsv: string, entrancesTsv: string): ProbeTarget[] {
  const entranceRows = parseTsv(entrancesTsv);
  const entrancePrefs = new Set(entranceRows.map((r) => prefCodeOfName(r.pref ?? "")).filter((c): c is string => c !== null));

  const targets: ProbeTarget[] = [...NATIONAL_TARGETS, ...REFERENCE_TARGETS];
  const seen = new Set(targets.map((t) => t.url));
  const add = (t: ProbeTarget) => {
    if (seen.has(t.url)) return;
    seen.add(t.url);
    targets.push(t);
  };

  for (const r of parseTsv(permanentTsv)) {
    const prefCode = prefCodeOfName(r.pref ?? "");
    if (prefCode === null || entrancePrefs.has(prefCode) || !isUrl(r.url) || r.kind === "blocked") continue;
    const word = r.has_hpai_word === "yes" ? true : r.has_hpai_word === "no" ? false : null;
    add({ prefCode, url: r.url, kind: r.kind ?? "", dev: { ok: ok200(r.status), hasWord: word } });
  }
  for (const r of entranceRows) {
    const prefCode = prefCodeOfName(r.pref ?? "");
    if (prefCode === null || !isUrl(r.url) || r.kind === "blocked") continue;
    add({ prefCode, url: r.url, kind: r.kind ?? "", dev: { ok: ok200(r.status), hasWord: null } });
  }
  return targets;
}

const SOURCE_KIND_TO_PROBE_KIND: Record<SourceSeed["kind"], string> = {
  maff_press: "maff_press",
  maff_season: "maff_season",
  moe: "moe",
  pref_fixed: "hpai_fixed",
  pref_rss: "rss_all",
  pref_press_list: "press_list",
};

/** data/sources.json の入口のうち、まだ試していない URL だけを対象にする（--from-sources）。 */
export function targetsFromSources(seeds: readonly SourceSeed[], alreadyProbed: ReadonlySet<string>): ProbeTarget[] {
  const seen = new Set(alreadyProbed);
  const out: ProbeTarget[] = [];
  for (const s of seeds) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ prefCode: s.prefCode, url: s.url, kind: SOURCE_KIND_TO_PROBE_KIND[s.kind], dev: null });
  }
  return out;
}
