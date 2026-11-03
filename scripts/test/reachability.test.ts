import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { PREFS } from "@hpai/shared/pref";
import type { ProbeRow, ProbeTarget, ProbeVerdict } from "../../functions/src/probe/run";
import { parseNdjson, renderReachability, runProbe, type ProbeIo } from "../lib/reachability";

const MEASURED_AT = "2026-11-04T12:00:00+09:00";

function row(partial: Partial<Omit<ProbeRow, "target">> & { target: Partial<ProbeTarget> & { url: string } }): ProbeRow {
  const { target, ...rest } = partial;
  const verdict: ProbeVerdict = rest.verdict ?? "ok";
  return {
    target: { prefCode: target.prefCode ?? null, url: target.url, kind: target.kind ?? "hpai_fixed", dev: target.dev ?? null },
    verdict,
    status: verdict === "ok" ? 200 : null,
    finalUrl: null,
    errorCode: null,
    bytes: 0,
    ms: 5,
    hasWord: false,
    itemCount: 0,
    outbreakTitleCount: 0,
    ...rest,
  };
}

const ARC = (n: number, titles: number, verdict: ProbeVerdict = "ok") =>
  row({ target: { url: `https://www.maff.go.jp/j/press/arc/${n}.html`, kind: "maff_arc" }, verdict, outbreakTitleCount: titles });

describe("renderReachability", () => {
  const rows: ProbeRow[] = [
    ...[3, 4, 5, 2, 6, 3, 1].map((t, i) => ARC(2510 + i, t)),
    row({ target: { prefCode: "33", url: "https://www.pref.okayama.jp/a.html", kind: "hpai_fixed", dev: { ok: true, hasWord: true } }, verdict: "ok" }),
    row({ target: { prefCode: "33", url: "https://www.pref.okayama.jp/rss.xml", kind: "rss_all", dev: { ok: true, hasWord: false } }, verdict: "ok" }),
    row({ target: { prefCode: "18", url: "https://www.pref.fukui.lg.jp/doc/a.html", kind: "dept_page", dev: { ok: true, hasWord: null } }, verdict: "ok" }),
    row({ target: { prefCode: "18", url: "https://www.pref.fukui.lg.jp/news.xml", kind: "rss_all", dev: { ok: true, hasWord: false } }, verdict: "network_error", errorCode: "ECONNRESET" }),
    row({ target: { prefCode: "23", url: "https://www.pref.aichi.jp/x.html", kind: "hpai_fixed", dev: { ok: true, hasWord: true } }, verdict: "http_error", status: 403 }),
    row({ target: { prefCode: "42", url: "https://www.pref.nagasaki.jp/p/", kind: "press_list", dev: null }, verdict: "network_error", errorCode: "ETIMEDOUT" }),
    row({ target: { prefCode: "42", url: "https://www.pref.nagasaki.jp/q/", kind: "hpai_fixed", dev: { ok: true, hasWord: true } }, verdict: "reached_no_content", status: 200 }),
    row({ target: { prefCode: "10", url: "https://www.pref.gunma.jp/r.html", kind: "hpai_fixed", dev: { ok: true, hasWord: true } }, verdict: "robots_denied" }),
    row({ target: { url: "https://www.gsi.go.jp/LAW/2930-index.html", kind: "reference" }, verdict: "tls_error", errorCode: "EPROTO" }),
    row({ target: { prefCode: "05", url: "https://www.pref.akita.lg.jp/old.html", kind: "hpai_fixed", dev: { ok: false, hasWord: null } }, verdict: "tls_error", errorCode: "CERT_HAS_EXPIRED" }),
    row({ target: { url: "https://www.env.go.jp/nature/dobutsu/bird_flu/", kind: "moe" }, verdict: "ok" }),
  ];
  const md = renderReachability(rows, MEASURED_AT);

  it("測った日時と、国の月別一覧の題の合計（期待 24 との照合）を出す", () => {
    expect(md).toContain(MEASURED_AT);
    expect(md).toMatch(/国の月別一覧[^\n]*題の合計[^\n]*\*\*24\*\*[^\n]*期待値 24 と一致/);
    const off = renderReachability([ARC(2510, 20)], MEASURED_AT);
    expect(off).toMatch(/題の合計[^\n]*\*\*20\*\*[^\n]*期待値 24 と一致しません/);
    const none = renderReachability([ARC(2510, 0, "network_error")], MEASURED_AT);
    expect(none).toMatch(/題の合計[^\n]*\*\*0\*\*/);
    expect(none).toMatch(/届いていません/);
  });

  it("届いた入口の数と、届かなかった県名を出す", () => {
    expect(md).toMatch(/届いた入口: 11 \/ 18/);
    // 愛知（http_error のみ）、群馬（robots_denied のみ）、秋田（tls_error のみ）は 1 件も届かない。長崎は reached_no_content だけなので ok はない
    const never = md.split("\n").find((l) => l.includes("1 件も届かなかった県"))!;
    for (const name of ["愛知県", "群馬県", "秋田県", "長崎県"]) expect(never).toContain(name);
    expect(never).not.toContain("岡山県");
    expect(never).not.toContain("福井県");
    const partial = md.split("\n").find((l) => l.includes("一部の入口が届かなかった県"))!;
    expect(partial).toContain("福井県");
    expect(partial).not.toContain("岡山県");
  });

  it("tls_error は別の欄に errorCode つきで出す", () => {
    const section = md.slice(md.indexOf("## 古い TLS"), md.indexOf("\n## ", md.indexOf("## 古い TLS") + 5));
    expect(section).toContain("https://www.gsi.go.jp/LAW/2930-index.html");
    expect(section).toContain("EPROTO");
    expect(section).toContain("https://www.pref.akita.lg.jp/old.html");
    expect(section).toContain("CERT_HAS_EXPIRED");
    expect(section).not.toContain("https://www.pref.fukui.lg.jp/news.xml");
  });

  it("開発機で届きクラウドで届かない入口を、届かなかったものと内容・方針の違いに分ける", () => {
    const start = md.indexOf("## 開発機で届き");
    const section = md.slice(start, md.indexOf("\n## ", start + 5));
    const unreachable = section.slice(section.indexOf("### クラウドで届かなかった"), section.indexOf("### 届いたが"));
    expect(unreachable).toContain("https://www.pref.fukui.lg.jp/news.xml");
    expect(unreachable).toContain("https://www.pref.aichi.jp/x.html");
    expect(unreachable).not.toContain("https://www.pref.nagasaki.jp/q/");
    expect(unreachable).not.toContain("https://www.pref.nagasaki.jp/p/"); // dev が null の行は比べられない
    expect(unreachable).not.toContain("https://www.pref.akita.lg.jp/old.html"); // dev でも届いていない
    const other = section.slice(section.indexOf("### 届いたが"));
    expect(other).toContain("https://www.pref.nagasaki.jp/q/");
    expect(other).toContain("https://www.pref.gunma.jp/r.html");
    expect(other).not.toContain("https://www.pref.fukui.lg.jp/news.xml");
  });

  it("47 都道府県がすべて出る（入口のない県も）", () => {
    for (const { name } of PREFS) expect(md, name).toContain(name);
    expect(md).toMatch(/入口なし/);
  });

  it("全入口の表に errorCode と status を出す", () => {
    expect(md).toContain("ECONNRESET");
    expect(md).toContain("ETIMEDOUT");
    expect(md).toMatch(/\| 403 \|/);
  });

  it("TSV の note を含まず、禁止の語がない", () => {
    expect(findForbiddenPhrases(md)).toEqual([]);
    expect(findForbiddenPhrases(renderReachability([], MEASURED_AT))).toEqual([]);
  });

  it("行が 0 件でも全 47 県が出て、例外にならない", () => {
    const empty = renderReachability([], MEASURED_AT);
    for (const { name } of PREFS) expect(empty).toContain(name);
    expect(empty).toMatch(/届いた入口: 0 \/ 0/);
  });
});

describe("parseNdjson", () => {
  it("1 行 1 件を読み、空行と壊れた行は飛ばす", () => {
    const a = row({ target: { url: "https://www.maff.go.jp/a" } });
    const text = `${JSON.stringify(a)}\n\nnot json\n{"verdict":"ok"}\n${JSON.stringify(a)}`;
    expect(parseNdjson(text)).toEqual([a, a]);
  });
});

describe("runProbe（ops.ts probe の中身）", () => {
  let root: string;
  let out: string;
  const TOKEN = "tok-FAKE-for-test";
  const written: string[] = [];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hpai-probe-"));
    out = "";
    written.length = 0;
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const PERM = "pref\turl\tkind\tstatus\thas_hpai_word\tnote\n岡山県\thttps://www.pref.okayama.jp/a.html\thpai_fixed\t200\tyes\t内部メモ-秘\n";
  const ENT = "pref\turl\tkind\tstatus\thow_to_detect\tcan_trace_last_season\tnote\n愛知\thttps://www.pref.aichi.jp/b.html\tdept_page\t200\tx\t-\t内部メモ-秘2\n";

  function streamOf(lines: string[], splitAt: number): Response {
    const text = lines.join("");
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // 行の途中で切って送る
        controller.enqueue(enc.encode(text.slice(0, splitAt)));
        controller.enqueue(enc.encode(text.slice(splitAt)));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }

  function makeIo(fetchImpl: typeof fetch, extra: Partial<ProbeIo> = {}): ProbeIo {
    return {
      env: { FIREBASE_PROJECT: "demo-proj" },
      readToken: () => TOKEN,
      fetch: fetchImpl,
      write: (s) => {
        out += s;
        written.push(s);
      },
      repoRoot: root,
      now: () => new Date("2026-11-04T03:00:00Z"),
      ...extra,
    };
  }

  const fakeServer = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { targets } = JSON.parse(String(init!.body)) as { targets: ProbeTarget[] };
    const lines = targets.map((t) => `${JSON.stringify(row({ target: t, verdict: "ok", status: 200 }))}\n`);
    return streamOf(lines, 37);
  });

  it("targets を組み、関数へ POST し、NDJSON と docs/reachability.md を書く", async () => {
    fakeServer.mockClear();
    fs.writeFileSync(path.join(root, "perm.tsv"), PERM);
    fs.writeFileSync(path.join(root, "ent.tsv"), ENT);
    const code = await runProbe(["--permanent", path.join(root, "perm.tsv"), "--entrances", path.join(root, "ent.tsv")], makeIo(fakeServer as never));
    expect(code).toBe(0);

    expect(fakeServer).toHaveBeenCalledTimes(1);
    const [url, init] = fakeServer.mock.calls[0]!;
    expect(String(url)).toBe("https://asia-northeast1-demo-proj.cloudfunctions.net/probeEntrances");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    const sent = JSON.parse(String(init!.body)) as { targets: ProbeTarget[] };
    expect(sent.targets.some((t) => t.url === "https://www.pref.okayama.jp/a.html" && t.dev?.hasWord === true)).toBe(true);
    expect(sent.targets.filter((t) => t.kind === "maff_arc")).toHaveLength(7);

    const ndjson = fs.readFileSync(path.join(root, "data", "private", "reach", "probe-20261104.ndjson"), "utf8");
    const saved = parseNdjson(ndjson);
    expect(saved).toHaveLength(sent.targets.length);
    expect(ndjson.trim().split("\n")).toHaveLength(sent.targets.length);

    const md = fs.readFileSync(path.join(root, "docs", "reachability.md"), "utf8");
    expect(md).toContain("2026-11-04T12:00:00+09:00");
    expect(md).toContain("岡山県");
    expect(md).not.toContain("内部メモ");
    expect(out + md).not.toContain(TOKEN);
  });

  it("同じ日にもう一度走らせても前の NDJSON を上書きしない", async () => {
    fs.writeFileSync(path.join(root, "perm.tsv"), PERM);
    fs.writeFileSync(path.join(root, "ent.tsv"), ENT);
    const argv = ["--permanent", path.join(root, "perm.tsv"), "--entrances", path.join(root, "ent.tsv")];
    await runProbe(argv, makeIo(fakeServer as never));
    await runProbe(argv, makeIo(fakeServer as never));
    const files = fs.readdirSync(path.join(root, "data", "private", "reach")).sort();
    expect(files).toEqual(["probe-20261104-2.ndjson", "probe-20261104.ndjson"]);
  });

  it("--from-sources は data/sources.json のうち reach/ にない URL だけを試し、docs は全部の結果から作る", async () => {
    fs.mkdirSync(path.join(root, "data", "private", "reach"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "data", "private", "reach", "probe-20261103.ndjson"),
      `${JSON.stringify(row({ target: { prefCode: "33", url: "https://www.pref.okayama.jp/a.html", kind: "hpai_fixed" } }))}\n`,
    );
    fs.writeFileSync(
      path.join(root, "data", "sources.json"),
      JSON.stringify([
        { prefCode: "33", url: "https://www.pref.okayama.jp/a.html", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null },
        { prefCode: "23", url: "https://www.pref.aichi.jp/new.html", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null },
      ]),
    );
    fakeServer.mockClear();
    const code = await runProbe(["--from-sources"], makeIo(fakeServer as never));
    expect(code).toBe(0);
    const sent = JSON.parse(String(fakeServer.mock.calls[0]![1]!.body)) as { targets: ProbeTarget[] };
    expect(sent.targets.map((t) => t.url)).toEqual(["https://www.pref.aichi.jp/new.html"]);
    const md = fs.readFileSync(path.join(root, "docs", "reachability.md"), "utf8");
    expect(md).toContain("https://www.pref.okayama.jp/a.html"); // 前の日の結果も残る
    expect(md).toContain("https://www.pref.aichi.jp/new.html");
  });

  it("認証の失敗や、使い方の誤りでは何も書かない", async () => {
    fs.writeFileSync(path.join(root, "perm.tsv"), PERM);
    fs.writeFileSync(path.join(root, "ent.tsv"), ENT);
    const argv = ["--permanent", path.join(root, "perm.tsv"), "--entrances", path.join(root, "ent.tsv")];
    const denied = vi.fn(async () => new Response('{"ok":false,"error":"認証できません"}', { status: 401 }));
    expect(await runProbe(argv, makeIo(denied as never))).toBe(1);
    expect(out).toContain("401");
    expect(fs.existsSync(path.join(root, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(root, "data", "private", "reach"))).toBe(false);

    expect(await runProbe([], makeIo(denied as never))).toBe(2);
    expect(await runProbe(["--permanent", "x.tsv"], makeIo(denied as never))).toBe(2);
    expect(await runProbe(argv, makeIo(denied as never, { readToken: () => null }))).toBe(2);
    expect(await runProbe(argv, makeIo(denied as never, { env: {} }))).toBe(2);
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it("応答が途中で切れたら、届いた行までを NDJSON に残し、docs は書き換えない", async () => {
    fs.writeFileSync(path.join(root, "perm.tsv"), PERM);
    fs.writeFileSync(path.join(root, "ent.tsv"), ENT);
    const broken = vi.fn(async () => {
      const enc = new TextEncoder();
      const first = `${JSON.stringify(row({ target: { url: "https://www.maff.go.jp/a", kind: "maff_press" } }))}\n`;
      let sent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            // 1 回目の読み取りで 1 行を返し、2 回目で切れる
            if (!sent) {
              sent = true;
              c.enqueue(enc.encode(first));
              return;
            }
            c.error(new Error("cut"));
          },
        }),
        { status: 200 },
      );
    });
    const code = await runProbe(["--permanent", path.join(root, "perm.tsv"), "--entrances", path.join(root, "ent.tsv")], makeIo(broken as never));
    expect(code).toBe(1);
    expect(parseNdjson(fs.readFileSync(path.join(root, "data", "private", "reach", "probe-20261104.ndjson"), "utf8"))).toHaveLength(1);
    expect(fs.existsSync(path.join(root, "docs", "reachability.md"))).toBe(false);
  });
});
