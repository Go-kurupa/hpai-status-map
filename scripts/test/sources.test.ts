import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProbeRow, ProbeVerdict } from "../../functions/src/probe/run";
import { runBuildSources } from "../build-sources";
import {
  buildSources,
  kindOf,
  NATIONAL_SEEDS,
  RESEARCH_DATE,
  TWELVE_PREFS,
  TWELVE_SEEDS,
  UNREACHED_NOTE_RE,
} from "../lib/sources";

// 実物の TSV（private/）は読まない。形だけ同じ短い文書を作る。
const HEAD = "pref\turl\tkind\tstatus\thas_hpai_word\tnote";
const tsv = (...rows: string[]) => [HEAD, ...rows].join("\n") + "\n";

const SAMPLE = tsv(
  "北海道\thttps://www.pref.hokkaido.lg.jp/a.html\thpai_fixed\t200\tyes\tメモ1",
  "北海道\thttps://www.pref.hokkaido.lg.jp/rss.xml\trss_all\t200\tno\tメモ2",
  "京都府\thttps://www.pref.kyoto.jp/birdflu/\thpai_fixed\t200\tyes\t",
  "京都府\t-\trss_none\t-\t-\t",
  "長野県\thttps://www.pref.nagano.lg.jp/press.xml\trss_press\t200\tno\t",
  // 12 県の行。種類が 12 県の独自のもの（hpai_season など）でも、使わずに飛ばす
  "新潟県\thttps://www.pref.niigata.lg.jp/sec/0/2025toriinflu.html\thpai_season\t200\tyes\t",
  "福岡県\thttps://www.pref.fukuoka.lg.jp/rss/10/list1.xml\trss_all\tROBOTS_DISALLOW\t-\t",
  "福岡県\thttps://www.pref.fukuoka.lg.jp/contents/shizentorifuru.html\thpai_wildbird\t200\tyes\t",
  "長崎県\thttps://www.pref.nagasaki.jp/bunrui/shigoto-sangyo/nogyo/boueki/infuruenza/\thpai_unknown\t404\t-\t",
);

function row(url: string, verdict: ProbeVerdict, errorCode: string | null = null): ProbeRow {
  return {
    target: { prefCode: "01", url, kind: "hpai_fixed", dev: null },
    verdict,
    status: verdict === "ok" ? 200 : null,
    finalUrl: null,
    errorCode,
    bytes: 0,
    ms: 1,
    hasWord: true,
    itemCount: 0,
    outbreakTitleCount: 0,
  };
}

describe("kindOf", () => {
  it("hpai_fixed は pref_fixed、rss_all と rss_press は pref_rss", () => {
    expect(kindOf("hpai_fixed")).toBe("pref_fixed");
    expect(kindOf("rss_all")).toBe("pref_rss");
    expect(kindOf("rss_press")).toBe("pref_rss");
  });

  it("rss_none は null（入口がない）", () => {
    expect(kindOf("rss_none")).toBeNull();
  });

  it("知らない種類は throw する（12 県の種類が混ざれば気づく）", () => {
    for (const k of ["hpai_season", "hpai_dept", "hpai_stale", "hpai_unknown", "hpai_wildbird", "", "RSS_ALL"]) {
      expect(() => kindOf(k)).toThrow(/知らない種類/);
    }
  });
});

describe("12 県の表", () => {
  it("12 県で、判定は 確定 10、条件付き 1（福岡）、確定できず 1（福井）", () => {
    expect(TWELVE_PREFS).toHaveLength(12);
    const count = (v: string) => TWELVE_PREFS.filter((p) => p.verdict === v).length;
    expect([count("confirmed"), count("conditional"), count("undetermined")]).toEqual([10, 1, 1]);
    expect(TWELVE_PREFS.find((p) => p.verdict === "conditional")?.name).toBe("福岡県");
    expect(TWELVE_PREFS.find((p) => p.verdict === "undetermined")?.name).toBe("福井県");
  });

  it("県の行は 36 件で、12 県の県コードだけを持つ", () => {
    expect(TWELVE_SEEDS).toHaveLength(36);
    const codes = new Set(TWELVE_PREFS.map((p) => p.code));
    expect(TWELVE_SEEDS.every((s) => s.prefCode !== null && codes.has(s.prefCode))).toBe(true);
  });
});

describe("buildSources", () => {
  it("permanent の 12 県の行を使わない（種類が知らないものでも throw せず、12 県の手書きの表だけを使う）", () => {
    const { seeds } = buildSources(SAMPLE);
    const urls = seeds.map((s) => s.url);
    expect(urls).not.toContain("https://www.pref.niigata.lg.jp/sec/0/2025toriinflu.html");
    expect(urls).not.toContain("https://www.pref.fukuoka.lg.jp/rss/10/list1.xml");
    expect(urls).not.toContain("https://www.pref.nagasaki.jp/bunrui/shigoto-sangyo/nogyo/boueki/infuruenza/");
    // 12 県は手書きの表の 36 件がそのまま入る
    expect(seeds.filter((s) => TWELVE_PREFS.some((p) => p.code === s.prefCode))).toEqual(TWELVE_SEEDS);
  });

  it("35 県の行は kindOf で読み、rss_none は入口にしない。国の 3 行が先頭に入る", () => {
    const { seeds } = buildSources(SAMPLE);
    expect(seeds.slice(0, 3)).toEqual(NATIONAL_SEEDS);
    const own = seeds.filter((s) => ["01", "26", "20"].includes(s.prefCode ?? ""));
    expect(own.map((s) => [s.prefCode, s.url, s.kind])).toEqual([
      ["01", "https://www.pref.hokkaido.lg.jp/a.html", "pref_fixed"],
      ["01", "https://www.pref.hokkaido.lg.jp/rss.xml", "pref_rss"],
      ["20", "https://www.pref.nagano.lg.jp/press.xml", "pref_rss"],
      ["26", "https://www.pref.kyoto.jp/birdflu/", "pref_fixed"],
    ]);
  });

  it("--reach なしで作れる。confirmedOn は調査の日で、今日の日付に動かない。35 県の note は資料の文を写さず null", () => {
    const { seeds, report } = buildSources(SAMPLE, { today: "2026-11-10" });
    expect(RESEARCH_DATE).toBe("2026-11-03");
    expect(seeds.every((s) => s.confirmedOn === "2026-11-03")).toBe(true);
    expect(seeds.filter((s) => s.prefCode === "01").every((s) => s.note === null)).toBe(true);
    expect(report).toEqual({ reached: 0, cloudUnreached: 0, tlsUnreached: 0, noContent: [], policyDenied: [] });
  });

  it("URL が重複したら throw する（どの行かを示す）", () => {
    const dup = tsv(
      "北海道\thttps://www.pref.hokkaido.lg.jp/a.html\thpai_fixed\t200\tyes\t",
      "青森県\thttps://www.pref.hokkaido.lg.jp/a.html\thpai_fixed\t200\tyes\t",
    );
    expect(() => buildSources(dup)).toThrow(/重複/);
  });

  it("35 県の行の URL が 12 県の手書きの表と重なっても throw する", () => {
    const dup = tsv("北海道\thttps://www.pref.kumamoto.jp/soshiki/77/\thpai_fixed\t200\tyes\t");
    expect(() => buildSources(dup)).toThrow(/重複/);
  });

  it("使う行の URL が http(s) でなければ throw する", () => {
    expect(() => buildSources(tsv("北海道\t(見つからず)\thpai_fixed\t200\tyes\t"))).toThrow(/URL/);
  });

  it("県名が読めない行は throw する", () => {
    expect(() => buildSources(tsv("東北\thttps://www.pref.aomori.lg.jp/a\thpai_fixed\t200\tyes\t"))).toThrow(/県/);
  });

  it("見出しに url / kind / pref の列がなければ throw する", () => {
    expect(() => buildSources("a\tb\n1\t2\n")).toThrow(/列/);
  });
});

describe("buildSources --reach", () => {
  const HOKKAIDO_A = "https://www.pref.hokkaido.lg.jp/a.html";
  const HOKKAIDO_RSS = "https://www.pref.hokkaido.lg.jp/rss.xml";
  const KYOTO = "https://www.pref.kyoto.jp/birdflu/";
  const FUKUI = "https://www.pref.fukui.lg.jp/doc/kaho/toriinfluenza.html";
  const FUKUI_NEWS = "https://www.pref.fukui.lg.jp/news.xml";
  const TODAY = "2026-11-10";

  it("届いた行（ok）の confirmedOn を実行日にし、note は変えない", () => {
    const { seeds, report } = buildSources(SAMPLE, { reach: [row(HOKKAIDO_A, "ok")], today: TODAY });
    const a = seeds.find((s) => s.url === HOKKAIDO_A)!;
    expect(a.confirmedOn).toBe(TODAY);
    expect(a.note).toBeNull();
    expect(seeds.find((s) => s.url === HOKKAIDO_RSS)!.confirmedOn).toBe(RESEARCH_DATE); // 測っていない行は動かない
    expect(report.reached).toBe(1);
  });

  it("未到達の行は残し、note に「クラウドから未到達（日付）」を書く。confirmedOn は動かさない", () => {
    const { seeds, report } = buildSources(SAMPLE, {
      reach: [row(HOKKAIDO_A, "http_error"), row(HOKKAIDO_RSS, "network_error", "ECONNRESET")],
      today: TODAY,
    });
    for (const url of [HOKKAIDO_A, HOKKAIDO_RSS]) {
      const s = seeds.find((x) => x.url === url)!;
      expect(s.note).toBe(`クラウドから未到達（${TODAY}）`);
      expect(s.confirmedOn).toBe(RESEARCH_DATE);
    }
    expect(report.cloudUnreached).toBe(2);
    expect(seeds.some((s) => s.url === HOKKAIDO_A)).toBe(true);
  });

  it("古い TLS（tls_error）は「古い TLS で未到達（日付）」", () => {
    const { seeds, report } = buildSources(SAMPLE, { reach: [row(KYOTO, "tls_error", "EPROTO")], today: TODAY });
    expect(seeds.find((s) => s.url === KYOTO)!.note).toBe(`古い TLS で未到達（${TODAY}）`);
    expect(report.tlsUnreached).toBe(1);
  });

  it("もとの note があれば未到達の文を先に置いて続ける。60 字を超えるなら未到達の文だけ", () => {
    const { seeds } = buildSources(SAMPLE, {
      reach: [row(FUKUI, "network_error", "ECONNRESET"), row(FUKUI_NEWS, "tls_error", "EPROTO")],
      today: TODAY,
    });
    const fixed = seeds.find((s) => s.url === FUKUI)!;
    expect(fixed.note).toBe(`クラウドから未到達（${TODAY}）。確定できず。国の発表で補う`);
    expect(fixed.note!.length).toBeLessThanOrEqual(60);
    expect(seeds.find((s) => s.url === FUKUI_NEWS)!.note).toBe(`古い TLS で未到達（${TODAY}）。発生時に流れるか未確認`);
  });

  it("未到達の note を I-02 が見分けられる（UNREACHED_NOTE_RE）", () => {
    expect(UNREACHED_NOTE_RE.test(`クラウドから未到達（${TODAY}）`)).toBe(true);
    expect(UNREACHED_NOTE_RE.test(`古い TLS で未到達（${TODAY}）。野鳥のみ`)).toBe(true);
    expect(UNREACHED_NOTE_RE.test("次季も使うか未確認")).toBe(false);
    expect(UNREACHED_NOTE_RE.test(null as unknown as string)).toBe(false);
  });

  it("届いたが内容が違う（reached_no_content）は、届いたとも未到達とも数えず、行を動かさない。一覧には出す", () => {
    const { seeds, report } = buildSources(SAMPLE, { reach: [row(KYOTO, "reached_no_content")], today: TODAY });
    const s = seeds.find((x) => x.url === KYOTO)!;
    expect(s.confirmedOn).toBe(RESEARCH_DATE);
    expect(s.note).toBeNull();
    expect(report.noContent).toEqual([KYOTO]);
    expect(report.reached + report.cloudUnreached + report.tlsUnreached).toBe(0);
  });

  it("方針で取れない（robots_denied、not_allowed）行は直さず、report に出す", () => {
    const { report } = buildSources(SAMPLE, {
      reach: [row(HOKKAIDO_A, "robots_denied"), row(HOKKAIDO_RSS, "not_allowed")],
      today: TODAY,
    });
    expect(report.policyDenied).toEqual([HOKKAIDO_A, HOKKAIDO_RSS]);
  });

  it("同じ URL が複数あれば、後の行を採る。sources にない URL の行は無視する", () => {
    const { seeds, report } = buildSources(SAMPLE, {
      reach: [row(HOKKAIDO_A, "http_error"), row(HOKKAIDO_A, "ok"), row("https://www.pref.example.jp/zzz", "http_error")],
      today: TODAY,
    });
    expect(seeds.find((s) => s.url === HOKKAIDO_A)!.confirmedOn).toBe(TODAY);
    expect(seeds.find((s) => s.url === HOKKAIDO_A)!.note).toBeNull();
    expect(report.reached).toBe(1);
    expect(report.cloudUnreached).toBe(0);
  });

  it("12 県と国の行にも同じ規則を当てる（毎回、表から作り直すので note が重ならない）", () => {
    const url = "https://www.pref.fukuoka.lg.jp/press/";
    const first = buildSources(SAMPLE, { reach: [row(url, "http_error")], today: "2026-11-04" });
    const second = buildSources(SAMPLE, { reach: [row(url, "http_error")], today: TODAY });
    expect(first.seeds.find((s) => s.url === url)!.note).toBe("クラウドから未到達（2026-11-04）");
    expect(second.seeds.find((s) => s.url === url)!.note).toBe(`クラウドから未到達（${TODAY}）`);
  });
});

describe("runBuildSources（コマンド）", () => {
  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-sources-"));
    const permanent = path.join(dir, "permanent.tsv");
    fs.writeFileSync(permanent, SAMPLE);
    const out = path.join(dir, "out", "sources.json");
    const lines: string[] = [];
    return { dir, permanent, out, lines, write: (s: string) => lines.push(s) };
  }

  it("--permanent だけで data/sources.json の形（SourceSeed[]、2 字下げ、末尾の改行）を書く", () => {
    const t = setup();
    try {
      const code = runBuildSources(["--permanent", t.permanent, "--out", t.out], { write: t.write, now: () => new Date("2026-11-10T03:00:00Z") });
      expect(code).toBe(0);
      const text = fs.readFileSync(t.out, "utf8");
      expect(text.endsWith("]\n")).toBe(true);
      const seeds = JSON.parse(text);
      expect(Object.keys(seeds[0]).sort()).toEqual(["confirmedOn", "kind", "note", "prefCode", "url"]);
      expect(seeds.every((s: { confirmedOn: string }) => s.confirmedOn === "2026-11-03")).toBe(true);
      expect(text).toBe(`${JSON.stringify(seeds, null, 2)}\n`);
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it("--reach の NDJSON を読み、実行日（日本時間）で作り直す。壊れた行は飛ばす", () => {
    const t = setup();
    try {
      const reach = path.join(t.dir, "probe.ndjson");
      fs.writeFileSync(
        reach,
        [
          JSON.stringify(row("https://www.pref.hokkaido.lg.jp/a.html", "ok")),
          "{壊れた行",
          JSON.stringify(row("https://www.pref.kyoto.jp/birdflu/", "tls_error", "EPROTO")),
        ].join("\n") + "\n",
      );
      // 2026-11-09 15:30 UTC は日本時間の 2026-11-10
      const code = runBuildSources(["--permanent", t.permanent, "--reach", reach, "--out", t.out], {
        write: t.write,
        now: () => new Date("2026-11-09T15:30:00Z"),
      });
      expect(code).toBe(0);
      const seeds = JSON.parse(fs.readFileSync(t.out, "utf8")) as Array<{ url: string; confirmedOn: string; note: string | null }>;
      expect(seeds.find((s) => s.url === "https://www.pref.hokkaido.lg.jp/a.html")!.confirmedOn).toBe("2026-11-10");
      expect(seeds.find((s) => s.url === "https://www.pref.kyoto.jp/birdflu/")!.note).toBe("古い TLS で未到達（2026-11-10）");
      expect(t.lines.join("")).toMatch(/届いた 1/);
      // reached_no_content が無いので 0。文言は「失敗」とは読めない
      expect(t.lines.join("")).toContain("届いた（語なし。平時は正常な入口もある） 0");
      expect(t.lines.join("")).not.toContain("内容が違う");
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it("方針で取れない行があれば 1 で終わり、何も書かない", () => {
    const t = setup();
    try {
      const reach = path.join(t.dir, "probe.ndjson");
      fs.writeFileSync(reach, `${JSON.stringify(row("https://www.pref.hokkaido.lg.jp/a.html", "robots_denied"))}\n`);
      const code = runBuildSources(["--permanent", t.permanent, "--reach", reach, "--out", t.out], { write: t.write, now: () => new Date() });
      expect(code).toBe(1);
      expect(fs.existsSync(t.out)).toBe(false);
      expect(t.lines.join("")).toContain("https://www.pref.hokkaido.lg.jp/a.html");
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it("引数が足りなければ 2 で終わる／読めない TSV の行は throw でなく 2 で知らせる", () => {
    const t = setup();
    try {
      expect(runBuildSources([], { write: t.write, now: () => new Date() })).toBe(2);
      const bad = path.join(t.dir, "bad.tsv");
      fs.writeFileSync(bad, tsv("北海道\thttps://www.pref.hokkaido.lg.jp/a\thpai_season\t200\tyes\t"));
      expect(runBuildSources(["--permanent", bad, "--out", t.out], { write: t.write, now: () => new Date() })).toBe(2);
      expect(fs.existsSync(t.out)).toBe(false);
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });
});
