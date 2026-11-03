import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREFS } from "@hpai/shared/pref";
import type { SourceSeed } from "@hpai/shared/types";
import type { FetchOutcome } from "../../functions/src/watch/politeFetch";
import { runCheckEntrances } from "../check-entrances";
import {
  checkEntrances,
  countConfirmedPrefs,
  formatEntranceTable,
  type EntranceCheckRow,
} from "../lib/entrance-table";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NOW = new Date("2026-11-10T03:00:00Z"); // 日本時間 2026-11-10 12:00
const CHECKED_AT = "2026-11-10T12:00:00+09:00";

function row(over: Partial<EntranceCheckRow> & Pick<EntranceCheckRow, "prefCode" | "url">): EntranceCheckRow {
  return {
    prefName: PREFS.find((p) => p.code === over.prefCode)!.name,
    kind: "pref_fixed",
    outcome: "ok",
    errorCode: null,
    status: 200,
    title: "鳥インフルエンザに関する情報",
    hasHpaiWord: true,
    checkedAt: CHECKED_AT,
    ...over,
  };
}

/** 見出しの行、表の行（見出し行と区切り行を除く）を取り出す。 */
function parse(table: string) {
  const lines = table.split("\n");
  const head = lines.findIndex((l) => l.startsWith("| 県 |"));
  expect(head, "表の見出し行がありません").toBeGreaterThanOrEqual(0);
  const cells = (l: string) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());
  const body = lines.slice(head + 2).filter((l) => l.startsWith("|"));
  return { heading: lines.find((l) => l.startsWith("# ")) ?? "", header: cells(lines[head]!), rows: body.map(cells) };
}

describe("formatEntranceTable", () => {
  it("見出しに「確認できた県 N / 47」。列は 県、URL、種類、結果、題名、語の有無、時刻 だけ", () => {
    const table = formatEntranceTable([row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a.html" })]);
    const { heading, header } = parse(table);
    expect(heading).toMatch(/確認できた県 1 \/ 47/);
    expect(header).toEqual(["県", "URL", "種類", "結果", "題名", "語の有無", "時刻"]);
  });

  it("47 都道府県の行を出す。入口がない県は「入口なし」", () => {
    const { rows } = parse(formatEntranceTable([row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a.html" })]));
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(PREFS.map((p) => p.name)));
    const aomori = rows.filter((r) => r[0] === "青森県");
    expect(aomori).toHaveLength(1);
    expect(aomori[0]![3]).toBe("入口なし");
    expect(rows.filter((r) => r[3] === "入口なし")).toHaveLength(46);
    // 県の順（県コード順）
    expect([...new Set(rows.map((r) => r[0]))]).toEqual(PREFS.map((p) => p.name));
  });

  it("ok は「確認できました」。題名、語の有無（あり／なし）、時刻を出す", () => {
    const { rows } = parse(
      formatEntranceTable([
        row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a.html" }),
        row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/rss.xml", kind: "pref_rss", hasHpaiWord: false, title: null }),
      ]),
    );
    const hokkaido = rows.filter((r) => r[0] === "北海道");
    expect(hokkaido[0]).toEqual([
      "北海道",
      "https://www.pref.hokkaido.lg.jp/a.html",
      "pref_fixed",
      "確認できました",
      "鳥インフルエンザに関する情報",
      "あり",
      CHECKED_AT,
    ]);
    expect(hokkaido[1]![4]).toBe("-");
    expect(hokkaido[1]![5]).toBe("なし");
  });

  it("ok 以外は「確認できません」と理由。HTTP は status、TLS は code、方針は理由の言葉", () => {
    const { rows } = parse(
      formatEntranceTable([
        row({ prefCode: "02", url: "https://www.pref.aomori.lg.jp/a", outcome: "http_error", status: 404, title: null, hasHpaiWord: null }),
        row({ prefCode: "03", url: "https://www.pref.iwate.jp/a", outcome: "network_error", errorCode: "EPROTO", status: null, title: null, hasHpaiWord: null }),
        row({ prefCode: "04", url: "https://www.pref.miyagi.jp/a", outcome: "network_error", errorCode: "ECONNRESET", status: null, title: null, hasHpaiWord: null }),
        row({ prefCode: "05", url: "https://www.pref.akita.lg.jp/a", outcome: "network_error", errorCode: null, status: null, title: null, hasHpaiWord: null }),
        row({ prefCode: "06", url: "https://www.pref.yamagata.jp/a", outcome: "robots_denied", status: null, title: null, hasHpaiWord: null }),
        row({ prefCode: "07", url: "https://www.pref.fukushima.lg.jp/a", outcome: "not_allowed", status: null, title: null, hasHpaiWord: null }),
      ]),
    );
    const result = (name: string) => rows.find((r) => r[0] === name)![3]!;
    expect(result("青森県")).toBe("確認できません（HTTP 404）");
    expect(result("岩手県")).toBe("確認できません（古い TLS で握手に失敗: EPROTO）");
    expect(result("宮城県")).toBe("確認できません（接続できません: ECONNRESET）");
    expect(result("秋田県")).toBe("確認できません（接続できません）");
    expect(result("山形県")).toBe("確認できません（robots.txt が禁止）");
    expect(result("福島県")).toBe("確認できません（許可していないホスト）");
    // 確認できなかった入口の題名と語の有無は「-」
    for (const name of ["青森県", "岩手県", "宮城県"]) expect(rows.find((r) => r[0] === name)!.slice(4, 6)).toEqual(["-", "-"]);
  });

  it("確認できた県は、その県の入口がすべて ok の県（WatchStatus と同じ）。入口なしの県は数えない", () => {
    const rows = [
      row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a" }),
      row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/b", kind: "pref_rss" }),
      row({ prefCode: "02", url: "https://www.pref.aomori.lg.jp/a" }),
      row({ prefCode: "02", url: "https://www.pref.aomori.lg.jp/b", kind: "pref_rss", outcome: "http_error", status: 500 }),
    ];
    expect(countConfirmedPrefs(rows)).toBe(1);
    expect(parse(formatEntranceTable(rows)).heading).toMatch(/確認できた県 1 \/ 47/);
    expect(countConfirmedPrefs([])).toBe(0);
  });

  it("「取得できることと、県の発生を見分けられることは別」の注意を表の下に書く（索引 Q8 の既定 A）", () => {
    const table = formatEntranceTable([]);
    expect(table).toContain("取得できることと、県の発生を見分けられることは別");
    expect(parse(table).heading).toMatch(/確認できた県 0 \/ 47/);
  });

  it("題名の縦棒と改行で表が崩れず、長い題名は切る", () => {
    const { rows, header } = parse(
      formatEntranceTable([row({ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a", title: `題|名\n${"あ".repeat(80)}` })]),
    );
    const r = rows.find((x) => x[0] === "北海道")!;
    expect(r).toHaveLength(header.length);
    expect(r[4]!.length).toBeLessThanOrEqual(45);
    expect(r[4]).not.toContain("\n");
  });
});

describe("checkEntrances", () => {
  const seed = (prefCode: string | null, url: string, kind: SourceSeed["kind"] = "pref_fixed"): SourceSeed => ({
    prefCode,
    url,
    kind,
    confirmedOn: "2026-11-03",
    note: null,
  });

  const okHtml = (title: string, body: string): FetchOutcome => ({
    kind: "ok",
    status: 200,
    finalUrl: "https://www.pref.hokkaido.lg.jp/a.html",
    contentType: "text/html; charset=utf-8",
    body: Buffer.from(`<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`),
    etag: null,
    lastModified: null,
    fetchedAt: CHECKED_AT,
  });
  const okRss = (xml: string): FetchOutcome => ({
    kind: "ok",
    status: 200,
    finalUrl: "https://www.pref.hokkaido.lg.jp/rss.xml",
    contentType: "application/rss+xml",
    body: Buffer.from(xml),
    etag: null,
    lastModified: null,
    fetchedAt: CHECKED_AT,
  });

  function harness(outcomes: Record<string, FetchOutcome>, handshake = { code: null as string | null, tls: false }) {
    const calls: Array<{ url: string; allowed: (u: string) => boolean }> = [];
    const handshakes: string[] = [];
    return {
      calls,
      handshakes,
      deps: {
        fetcher: async (url: string, opts?: { allowUrl?: (u: URL) => boolean }) => {
          calls.push({ url, allowed: (u) => opts?.allowUrl?.(new URL(u)) ?? true });
          return outcomes[url] ?? ({ kind: "http_error", status: 404 } as FetchOutcome);
        },
        handshake: async (url: string) => {
          handshakes.push(url);
          return handshake;
        },
        now: () => NOW,
      },
    };
  }

  it("県の行だけを順に取り、国の行は取らない。時刻は日本時間", async () => {
    const h = harness({ "https://www.pref.hokkaido.lg.jp/a.html": okHtml("題", "<p>高病原性鳥インフルエンザ</p>") });
    const rows = await checkEntrances(
      [seed(null, "https://www.maff.go.jp/j/press/index.html", "maff_press"), seed("01", "https://www.pref.hokkaido.lg.jp/a.html")],
      h.deps,
    );
    expect(h.calls.map((c) => c.url)).toEqual(["https://www.pref.hokkaido.lg.jp/a.html"]);
    expect(rows).toEqual([
      {
        prefCode: "01",
        prefName: "北海道",
        url: "https://www.pref.hokkaido.lg.jp/a.html",
        kind: "pref_fixed",
        outcome: "ok",
        errorCode: null,
        status: 200,
        title: "題",
        hasHpaiWord: true,
        checkedAt: CHECKED_AT,
      },
    ]);
  });

  it("allowUrl は県のホスト（pref.<名>.jp、pref.<名>.lg.jp、metro.tokyo.lg.jp）だけを許す", async () => {
    const h = harness({});
    await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a.html")], h.deps);
    const allowed = h.calls[0]!.allowed;
    expect(allowed("https://www.pref.hokkaido.lg.jp/x")).toBe(true);
    expect(allowed("https://www.pref.aichi.jp/x")).toBe(true);
    expect(allowed("https://web.pref.hyogo.lg.jp/x")).toBe(true);
    expect(allowed("https://www.sangyo-rodo.metro.tokyo.lg.jp/x")).toBe(true);
    expect(allowed("https://9a35b2b1.viewer.kintoneapp.com/x")).toBe(false);
    expect(allowed("https://example.com/pref.aichi.jp")).toBe(false);
    expect(allowed("https://www.pref.aichi.jp.evil.example/x")).toBe(false);
    expect(allowed("ftp://www.pref.aichi.jp/x")).toBe(false);
  });

  it("語がなければ hasHpaiWord は false（学校の臨時休業だけの本文など）。RSS は題と項目から読む", async () => {
    const h = harness({
      "https://www.pref.hokkaido.lg.jp/a.html": okHtml("お知らせ", "<p>学校の臨時休業について</p>"),
      "https://www.pref.hokkaido.lg.jp/rss.xml": okRss(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>新着情報</title><item><title>高病原性鳥インフルエンザの発生について</title></item></channel></rss>`,
      ),
    });
    const rows = await checkEntrances(
      [seed("01", "https://www.pref.hokkaido.lg.jp/a.html"), seed("01", "https://www.pref.hokkaido.lg.jp/rss.xml", "pref_rss")],
      h.deps,
    );
    expect(rows.map((r) => [r.title, r.hasHpaiWord])).toEqual([
      ["お知らせ", false],
      ["新着情報", true],
    ]);
  });

  it("PDF などは題名も語も null", async () => {
    const h = harness({
      "https://www.pref.hokkaido.lg.jp/a.pdf": { ...okHtml("x", "y"), contentType: "application/pdf", body: Buffer.from("%PDF-1.7") } as FetchOutcome,
    });
    const rows = await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a.pdf")], h.deps);
    expect(rows[0]).toMatchObject({ outcome: "ok", title: null, hasHpaiWord: null });
  });

  it("HTTP の失敗は status を残す。握手は試さない", async () => {
    const h = harness({ "https://www.pref.hokkaido.lg.jp/a": { kind: "http_error", status: 403 } });
    const rows = await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a")], h.deps);
    expect(rows[0]).toMatchObject({ outcome: "http_error", status: 403, errorCode: null, title: null, hasHpaiWord: null });
    expect(h.handshakes).toEqual([]);
  });

  it("network_error（TLS と分からない）のときだけ、握手を 1 回試して code を残す（fetch は原因を隠す）", async () => {
    const h = harness(
      { "https://www.pref.hokkaido.lg.jp/a": { kind: "network_error", message: "fetch failed", code: "UND_ERR_CONNECT_TIMEOUT", tls: false } },
      { code: "EPROTO", tls: true },
    );
    const rows = await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a")], h.deps);
    expect(h.handshakes).toEqual(["https://www.pref.hokkaido.lg.jp/a"]);
    expect(rows[0]).toMatchObject({ outcome: "network_error", errorCode: "EPROTO" });
  });

  it("握手でも TLS と分からなければ、fetch の code を残す", async () => {
    const h = harness(
      { "https://www.pref.hokkaido.lg.jp/a": { kind: "network_error", message: "x", code: "ECONNRESET", tls: false } },
      { code: "ECONNRESET", tls: false },
    );
    const rows = await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a")], h.deps);
    expect(rows[0]).toMatchObject({ outcome: "network_error", errorCode: "ECONNRESET" });
    expect(h.handshakes).toHaveLength(1);
  });

  it("fetch の時点で TLS と分かっていれば、握手を試さない", async () => {
    const h = harness({ "https://www.pref.hokkaido.lg.jp/a": { kind: "network_error", message: "x", code: "EPROTO", tls: true } });
    const rows = await checkEntrances([seed("01", "https://www.pref.hokkaido.lg.jp/a")], h.deps);
    expect(h.handshakes).toEqual([]);
    expect(rows[0]).toMatchObject({ outcome: "network_error", errorCode: "EPROTO" });
  });

  it("robots_denied と not_allowed はそのまま残す。取得器が例外を投げても止まらず、次の行へ進む", async () => {
    const deps = {
      fetcher: async (url: string): Promise<FetchOutcome> => {
        if (url.endsWith("/boom")) throw new Error("想定外");
        if (url.endsWith("/robots")) return { kind: "robots_denied" };
        return { kind: "not_allowed", url };
      },
      handshake: async () => ({ code: null, tls: false }),
      now: () => NOW,
    };
    const rows = await checkEntrances(
      [seed("01", "https://www.pref.hokkaido.lg.jp/robots"), seed("01", "https://www.pref.hokkaido.lg.jp/boom"), seed("01", "https://www.pref.hokkaido.lg.jp/other")],
      deps,
    );
    expect(rows.map((r) => r.outcome)).toEqual(["robots_denied", "network_error", "not_allowed"]);
  });
});

describe("check-entrances（コマンド）", () => {
  it("fetch を直接呼ばない。取得は politeFetch を通し、TLS の設定を下げない（静的検査）", () => {
    for (const file of ["scripts/check-entrances.ts", "scripts/lib/entrance-table.ts"]) {
      const src = fs
        .readFileSync(path.join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/(?<![\w$.])fetch\s*\(/);
      expect(src, file).not.toMatch(/\b(globalThis|window|self)\s*\.\s*fetch\b/);
      expect(src, file).not.toMatch(/rejectUnauthorized|secureOptions|legacy|NODE_TLS_REJECT_UNAUTHORIZED|setGlobalDispatcher|undici/i);
    }
    const cli = fs.readFileSync(path.join(ROOT, "scripts/check-entrances.ts"), "utf8");
    expect(cli).toMatch(/politeFetch/);
  });

  function setup(seeds: SourceSeed[]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-entrances-"));
    const sources = path.join(dir, "sources.json");
    fs.writeFileSync(sources, JSON.stringify(seeds));
    const lines: string[] = [];
    return { dir, sources, docs: path.join(dir, "docs"), lines, write: (s: string) => lines.push(s) };
  }
  const deps = (outcome: FetchOutcome) => ({
    fetcher: async () => outcome,
    handshake: async () => ({ code: null, tls: false }),
    now: () => NOW,
  });

  it("表を標準出力に出し、docs/entrance-check-<日付>.md に書く（日付は日本時間）", async () => {
    const t = setup([{ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a.html", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null }]);
    try {
      const code = await runCheckEntrances(["--sources", t.sources, "--docs-dir", t.docs], {
        ...deps({ kind: "http_error", status: 404 }),
        write: t.write,
      });
      expect(code).toBe(0);
      const file = path.join(t.docs, "entrance-check-2026-11-10.md");
      const text = fs.readFileSync(file, "utf8");
      expect(text).toMatch(/確認できた県 0 \/ 47/);
      expect(text).toContain("確認できません（HTTP 404）");
      expect(t.lines.join("")).toContain(text.split("\n")[0]!);
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it("同じ日の 2 回目は上書きせず -2 を付ける", async () => {
    const t = setup([{ prefCode: "01", url: "https://www.pref.hokkaido.lg.jp/a.html", kind: "pref_fixed", confirmedOn: "2026-11-03", note: null }]);
    try {
      const args = ["--sources", t.sources, "--docs-dir", t.docs];
      await runCheckEntrances(args, { ...deps({ kind: "http_error", status: 404 }), write: t.write });
      await runCheckEntrances(args, { ...deps({ kind: "http_error", status: 500 }), write: t.write });
      expect(fs.readdirSync(t.docs).sort()).toEqual(["entrance-check-2026-11-10-2.md", "entrance-check-2026-11-10.md"]);
      expect(fs.readFileSync(path.join(t.docs, "entrance-check-2026-11-10.md"), "utf8")).toContain("HTTP 404");
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });

  it("sources.json が読めなければ 2 で終わり、何も書かない", async () => {
    const t = setup([]);
    try {
      const code = await runCheckEntrances(["--sources", path.join(t.dir, "none.json"), "--docs-dir", t.docs], {
        ...deps({ kind: "robots_denied" }),
        write: t.write,
      });
      expect(code).toBe(2);
      expect(fs.existsSync(t.docs)).toBe(false);
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  });
});

describe(".claude/skills/entrance-check/SKILL.md", () => {
  const file = path.join(ROOT, ".claude", "skills", "entrance-check", "SKILL.md");
  const text = fs.readFileSync(file, "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

  it("name: entrance-check と description がある", () => {
    expect(front).toMatch(/^name: entrance-check$/m);
    expect(front).toMatch(/^description: \S.{20,}$/m);
  });

  it("書いたコマンドのファイルが在る", () => {
    expect(text).toContain("npx tsx scripts/check-entrances.ts");
    const scripts = [...text.matchAll(/scripts\/[\w./-]+\.ts/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(fs.existsSync(path.join(ROOT, s)), `${s} がありません`).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "data", "sources.json"))).toBe(true);
  });

  it("作法（名乗り、robots.txt、1.2 秒、再試行しない、TLS を緩めない）と、見回り先を勝手に変えないことを書く", () => {
    for (const s of ["名乗", "robots.txt", "1.2 秒", "再試行", "TLS", "運営者の承認"]) expect(text).toContain(s);
    expect(text).toMatch(/見回り先を勝手に変えない/);
    expect(text).toContain("取得できることと、県の発生を見分けられることは別");
  });
});
