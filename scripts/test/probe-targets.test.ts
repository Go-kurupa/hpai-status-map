import { describe, expect, it } from "vitest";
import { buildProbeTargets, NATIONAL_TARGETS, REFERENCE_TARGETS, targetsFromSources } from "../lib/probe-targets";

// 実物の TSV（private/）は読まない。形だけ同じ短い文書を作る。
const PERMANENT_HEAD = "pref\turl\tkind\tstatus\thas_hpai_word\tnote";
const ENTRANCE_HEAD = "pref\turl\tkind\tstatus\thow_to_detect\tcan_trace_last_season\tnote";
const perm = (...rows: string[]) => [PERMANENT_HEAD, ...rows].join("\n") + "\n";
const ent = (...rows: string[]) => [ENTRANCE_HEAD, ...rows].join("\n") + "\n";

describe("buildProbeTargets", () => {
  it("permanent の行を県コードつきで読み、dev に status と has_hpai_word を写す", () => {
    const targets = buildProbeTargets(
      perm(
        "北海道\thttps://www.pref.hokkaido.lg.jp/a.html\thpai_fixed\t200\tyes\tメモ1",
        "北海道\thttps://www.pref.hokkaido.lg.jp/rss.xml\trss_all\t200\tno\tメモ2",
        "青森県\thttps://www.pref.aomori.lg.jp/b.html\thpai_fixed\t404\tyes\t",
        "山形県\thttps://www.pref.yamagata.jp/c.html\thpai_fixed\t302(輪)\t未取得\t",
        "島根県\thttps://www.pref.shimane.lg.jp/d.html\thpai_dept\t-\t-\t",
      ),
      ent(),
    );
    const own = targets.filter((t) => t.prefCode !== null);
    expect(own.map((t) => [t.prefCode, t.url, t.kind, t.dev])).toEqual([
      ["01", "https://www.pref.hokkaido.lg.jp/a.html", "hpai_fixed", { ok: true, hasWord: true }],
      ["01", "https://www.pref.hokkaido.lg.jp/rss.xml", "rss_all", { ok: true, hasWord: false }],
      ["02", "https://www.pref.aomori.lg.jp/b.html", "hpai_fixed", { ok: false, hasWord: true }],
      ["06", "https://www.pref.yamagata.jp/c.html", "hpai_fixed", { ok: false, hasWord: null }],
      ["32", "https://www.pref.shimane.lg.jp/d.html", "hpai_dept", { ok: false, hasWord: null }],
    ]);
  });

  it("entrances の行は dev.hasWord が null。status が 200 で始まれば ok", () => {
    const targets = buildProbeTargets(
      perm(),
      ent(
        "愛知\thttps://www.pref.aichi.jp/a.html\thpai_fixed\t200(2026-11-03取得)\tPDF\t前季発生なし\tメモ",
        "愛知\thttps://www.pref.aichi.jp/rss.xml\trss_press\t200\tRDF\t未確認\tメモ",
        "長崎\thttps://www.pref.nagasaki.jp/p/\tpress_list\t接続リセット(curl 56)\t-\t-\tメモ",
      ),
    );
    const own = targets.filter((t) => t.prefCode !== null);
    expect(own.map((t) => [t.prefCode, t.kind, t.dev])).toEqual([
      ["23", "hpai_fixed", { ok: true, hasWord: null }],
      ["23", "rss_press", { ok: true, hasWord: null }],
      ["42", "press_list", { ok: false, hasWord: null }],
    ]);
  });

  it("URL のない行と blocked の行を飛ばす（www2.pref.fukui.lg.jp は許可の形に通るのでここで落とす）", () => {
    const targets = buildProbeTargets(
      perm("福井県\thttps://www.pref.fukui.lg.jp/doc/a.html\thpai_fixed\t200\tyes\t", "愛媛県\t-\trss_none\t-\t-\t", "高知県\t(見つからず)\trss_none\t-\t-\t"),
      ent(
        "福井\thttps://www2.pref.fukui.lg.jp/press/view.php\tblocked\t接続リセット\t使えない\t-\t",
        "福井\thttps://9a35b2b1.viewer.kintoneapp.com/public/xxx\tblocked\trobots全面禁止\t使えない\t-\t",
        "福井\thttps://www.pref.fukui.lg.jp/doc/kaho/\tdept_page\t200\tx\t-\t",
      ),
    );
    const urls = targets.map((t) => t.url);
    expect(urls).not.toContain("https://www2.pref.fukui.lg.jp/press/view.php");
    expect(urls.some((u) => u.includes("kintoneapp.com"))).toBe(false);
    expect(urls.some((u) => !/^https?:\/\//.test(u))).toBe(false);
    expect(targets.filter((t) => t.prefCode === "18").map((t) => t.url)).toEqual(["https://www.pref.fukui.lg.jp/doc/kaho/"]);
    // 福井は entrances にあるので、permanent の福井県の行は使わない
    expect(urls).not.toContain("https://www.pref.fukui.lg.jp/doc/a.html");
  });

  it("entrances にある県は permanent の行を使わない（「愛知」と「愛知県」を同じ県とみなす）", () => {
    const targets = buildProbeTargets(
      perm(
        "愛知県\thttps://www.pref.aichi.jp/old.html\thpai_fixed\t302(輪)\t未取得\t",
        "愛知県\thttps://www.pref.aichi.jp/old.rss\trss_all\t200\tno\t",
        "岡山県\thttps://www.pref.okayama.jp/a.html\thpai_fixed\t200\tyes\t",
      ),
      ent("愛知\thttps://www.pref.aichi.jp/new.html\thpai_fixed\t200\tPDF\t-\t"),
    );
    const aichi = targets.filter((t) => t.prefCode === "23").map((t) => t.url);
    expect(aichi).toEqual(["https://www.pref.aichi.jp/new.html"]);
    expect(targets.filter((t) => t.prefCode === "33")).toHaveLength(1);
  });

  it("URL の重複を除く（最初の行を残す）", () => {
    const targets = buildProbeTargets(
      perm("岡山県\thttps://www.pref.okayama.jp/a.html\thpai_fixed\t200\tyes\t", "岡山県\thttps://www.pref.okayama.jp/a.html\thpai_dept\t200\tyes\t"),
      ent(
        "愛知\thttps://www.pref.aichi.jp/x.html\thpai_fixed\t200\t-\t-\t",
        "愛知\thttps://www.pref.aichi.jp/x.html\tdept_page\t200\t-\t-\t",
        "愛知\thttps://www.maff.go.jp/j/press/index.html\tdept_page\t200\t-\t-\t", // 国の URL とも重ならない
      ),
    );
    const urls = targets.map((t) => t.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(targets.find((t) => t.url === "https://www.pref.okayama.jp/a.html")!.kind).toBe("hpai_fixed");
    expect(targets.find((t) => t.url === "https://www.maff.go.jp/j/press/index.html")!.prefCode).toBeNull(); // 国の行が正
  });

  it("国と環境省の 12 件を含む", () => {
    const targets = buildProbeTargets(perm(), ent());
    const national = targets.filter((t) => t.prefCode === null && t.kind !== "reference");
    const B = "https://www.maff.go.jp/j/";
    expect(national.map((t) => t.url).sort()).toEqual(
      [
        `${B}press/index.html`,
        ...["2510", "2511", "2512", "2601", "2602", "2603", "2604"].map((m) => `${B}press/arc/${m}.html`),
        `${B}press/syouan/douei/251220.html`,
        `${B}syouan/douei/tori/r8_hpai_kokunai.html`,
        `${B}syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf`,
        "https://www.env.go.jp/nature/dobutsu/bird_flu/",
      ].sort(),
    );
    expect(national).toHaveLength(12);
    expect(NATIONAL_TARGETS).toHaveLength(12);
    expect(targets.filter((t) => t.kind === "maff_arc")).toHaveLength(7);
    expect(national.every((t) => t.dev === null)).toBe(true);
  });

  it("地図の配布元 4 件を reference で別々に含む", () => {
    const targets = buildProbeTargets(perm(), ent());
    const refs = targets.filter((t) => t.kind === "reference");
    expect(refs.map((t) => t.url).sort()).toEqual(
      [
        "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html",
        "https://maps.gsi.go.jp/development/ichiran.html",
        "https://cyberjapandata.gsi.go.jp/xyz/pale/5/28/12.png",
        "https://www.gsi.go.jp/LAW/2930-index.html",
      ].sort(),
    );
    expect(REFERENCE_TARGETS).toHaveLength(4);
    expect(refs.every((t) => t.prefCode === null && t.dev === null)).toBe(true);
  });

  it("知らない県名の行は例外にせず飛ばす", () => {
    const targets = buildProbeTargets(perm("東北\thttps://www.pref.example.lg.jp/a.html\thpai_fixed\t200\tyes\t"), ent());
    expect(targets.some((t) => t.url.includes("example.lg.jp"))).toBe(false);
  });

  it("列の順が違っても見出しの名前で読む／CRLF でも読める", () => {
    const tsv = "kind\turl\tpref\tstatus\thas_hpai_word\r\nhpai_fixed\thttps://www.pref.okayama.jp/a.html\t岡山県\t200\tyes\r\n";
    const t = buildProbeTargets(tsv, ent()).find((x) => x.prefCode === "33");
    expect(t).toMatchObject({ url: "https://www.pref.okayama.jp/a.html", kind: "hpai_fixed", dev: { ok: true, hasWord: true } });
  });
});

describe("targetsFromSources（--from-sources）", () => {
  const seeds = [
    { prefCode: "33", url: "https://www.pref.okayama.jp/a.html", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null },
    { prefCode: "33", url: "https://www.pref.okayama.jp/rss.xml", kind: "pref_rss", confirmedOn: "2026-11-03", note: null },
    { prefCode: "23", url: "https://www.pref.aichi.jp/press/", kind: "pref_press_list", confirmedOn: "2026-11-03", note: null },
    { prefCode: null, url: "https://www.maff.go.jp/j/press/index.html", kind: "maff_press", confirmedOn: "2026-11-03", note: null },
    { prefCode: null, url: "https://www.env.go.jp/nature/dobutsu/bird_flu/", kind: "moe", confirmedOn: "2026-11-03", note: null },
  ] as const;

  it("既に試した URL を除き、種類を試験の種類へ写す", () => {
    const targets = targetsFromSources(seeds, new Set(["https://www.pref.okayama.jp/a.html"]));
    expect(targets.map((t) => [t.url, t.kind, t.prefCode, t.dev])).toEqual([
      ["https://www.pref.okayama.jp/rss.xml", "rss_all", "33", null],
      ["https://www.pref.aichi.jp/press/", "press_list", "23", null],
      ["https://www.maff.go.jp/j/press/index.html", "maff_press", null, null],
      ["https://www.env.go.jp/nature/dobutsu/bird_flu/", "moe", null, null],
    ]);
  });
});
