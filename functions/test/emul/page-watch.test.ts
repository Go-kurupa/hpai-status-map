// 県のページの見回り（checkPrefPage）を、模擬環境の Firestore と Storage で確かめる（I-02）。取得は偽物で、県のサイトへは出ない。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentRecord } from "@hpai/shared/read/types";
import { bucket, db } from "../../src/admin";
import { sha256Hex } from "../../src/watch/extract";
import { MAX_NEW_LINKS_PER_CHECK, allowPrefEntrance, allowPrefLink, checkPrefPage, type PageState } from "../../src/watch/page";
import { BASE, fake, html, ok, pdf, prefSource } from "../helpers/prefWatch";
import { describeFixture } from "../helpers/fixtures";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

const docsNow = async () => (await db.collection("documents").get()).docs.map((d) => d.data() as DocumentRecord).sort((a, b) => a.url.localeCompare(b.url));
const stateOf = async (id = "src1"): Promise<PageState> => JSON.parse((await bucket().file(`state/pages/${id}.json`).download())[0].toString("utf8")) as PageState;
const text = async (id: string) => (await bucket().file(`raw/${id}.txt`).download())[0].toString("utf8");

const URL1 = `${BASE}/page/816850.html`;
const T_WORD = "高病原性鳥インフルエンザについて";

describe("入口の取得", () => {
  it("etag も lastModified も送らない。指紋で見分けるので CheckResult の etag と lastModified は null", async () => {
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["本文"]), URL1) });
    const src = prefSource({ etag: 'W/"old"', lastModified: "Mon" });
    const r = await checkPrefPage(src, deps);
    expect(r).toMatchObject({ ok: true, etag: null, lastModified: null });
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(f.opts.length).toBeGreaterThan(0);
    for (const o of f.opts) {
      expect(o.etag ?? null).toBeNull();
      expect(o.lastModified ?? null).toBeNull();
    }
  });
  it("取得してよい先は、入口と同じ県の公式ドメインの https だけ。リンクは同じサイト（www の有無は同じ）だけ", () => {
    const entrance = allowPrefEntrance(URL1);
    expect(entrance(new URL("https://www.pref.okayama.jp/a"))).toBe(true);
    expect(entrance(new URL("https://pref.okayama.jp/a"))).toBe(true);
    expect(entrance(new URL("http://www.pref.okayama.jp/a"))).toBe(false);
    expect(entrance(new URL("https://pref.attacker.jp/a"))).toBe(false);
    expect(entrance(new URL("https://www.pref.hyogo.lg.jp/a"))).toBe(false); // 他の県の公式でも、入口の県ではない
    expect(entrance(new URL("https://example.com/a"))).toBe(false);
    const link = allowPrefLink(URL1);
    expect(link(new URL("https://pref.okayama.jp/uploaded/a.pdf"))).toBe(true);
    expect(link(new URL("https://www2.pref.okayama.jp/a"))).toBe(false);
    expect(link(new URL("https://www.pref.hyogo.lg.jp/a"))).toBe(false);
  });
  it("取得の失敗（TLS を含む）は ok:false で、基準を壊さない", async () => {
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["本文"]), URL1) });
    await checkPrefPage(prefSource(), deps);
    const before = await stateOf();
    for (const bad of [
      { kind: "network_error", message: "EPROTO", code: "EPROTO", tls: true },
      { kind: "http_error", status: 503 },
      { kind: "robots_denied" },
      { kind: "not_allowed", url: URL1 },
    ] as const) {
      f.pages[URL1] = bad;
      expect((await checkPrefPage(prefSource(), deps)).ok).toBe(false);
    }
    expect(await stateOf()).toEqual(before);
  });
});

describe("最初の確認は基準だけ", () => {
  it("文書を作らず、リンク先も取らない（過去の PDF を Claude に渡さない）", async () => {
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["昨季の発生の記録"], [[`${BASE}/uploaded/old.pdf`, "第1報"]]), URL1) });
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(true);
    expect(await docsNow()).toEqual([]);
    expect(f.calls).toEqual([URL1]);
    expect((await stateOf()).links).toContain(`${BASE}/uploaded/old.pdf`);
  });
});

describe("固定 URL のページを更新する県（宮城の型）: 本文の差分で検知する", () => {
  const page = (lines: string[], links: Array<[string, string]> = []) => ok(html(T_WORD, lines, links), URL1);

  it("リンクが増えなくても、足された行が文書になる。文書の本文は足された行だけ", async () => {
    const { deps, f } = fake({ [URL1]: page(["発生の状況", "令和7年12月19日 津山市で発生"]) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = page(["発生の状況", "令和7年12月19日 津山市で発生", "令和7年12月20日 備前市で疑似患畜を確認"]);
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(true);
    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ url: URL1, prefCode: "33", contentType: "html", readState: "pending", kind: null });
    const t = await text(docs[0]!.id);
    expect(t).toContain("備前市");
    expect(t).not.toContain("津山市");
  });
  it("更新日だけの変更は文書にしない。「第2報」は文書にする。消えた行だけの変更も作らない", async () => {
    const { deps, f } = fake({ [URL1]: page(["発生の状況", "更新日：2026年11月3日"]) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = page(["発生の状況", "更新日：2026年11月4日"]);
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toEqual([]);
    f.pages[URL1] = page(["更新日：2026年11月4日"]); // 行が消えただけ
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toEqual([]);
    f.pages[URL1] = page(["更新日：2026年11月4日", "第2報"]);
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toHaveLength(1);
  });
  it("同じ変更をもう一度見ても文書は増えない", async () => {
    const { deps, f } = fake({ [URL1]: page(["a"]) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = page(["a", "第2報"]);
    await checkPrefPage(prefSource(), deps);
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toHaveLength(1);
  });
});

describe("課のトップの型（熊本、大分、高知）: 足された行とリンクの文に語がなければ作らない", () => {
  const TOP = `${BASE}/soshiki/77/`;
  const top = (lines: string[], links: Array<[string, string]> = []) => ok(html("畜産課", lines, links), TOP);
  const src = () => prefSource({ url: TOP });

  it("語のない行の追加とリンクは、文書にも取得にもならない", async () => {
    const { deps, f } = fake({ [TOP]: top(["組織の案内"]) });
    await checkPrefPage(src(), deps);
    f.pages[TOP] = top(["組織の案内", "新しい補助金のお知らせ"], [[`${BASE}/page/9.html`, "補助金のご案内"]]);
    expect((await checkPrefPage(src(), deps)).ok).toBe(true);
    expect(await docsNow()).toEqual([]);
    expect(f.calls).toEqual([TOP, TOP]);
  });
  it("足された行に語があれば文書。リンクの文に語があれば取り、語のある HTML は文書にして追いかける", async () => {
    const hit = `${BASE}/page/10.html`;
    const { deps, f } = fake({ [TOP]: top(["組織の案内"]), [hit]: ok(html("津山市の事例", ["高病原性鳥インフルエンザの発生について"]), hit) });
    await checkPrefPage(src(), deps);
    f.pages[TOP] = top(["組織の案内", "鳥インフルエンザの発生を確認しました"], [[hit, "高病原性鳥インフルエンザの発生について"], [`${BASE}/page/9.html`, "補助金のご案内"]]);
    await checkPrefPage(src(), deps);
    expect((await docsNow()).map((d) => d.url).sort()).toEqual([TOP, hit].sort());
    expect(f.calls).not.toContain(`${BASE}/page/9.html`);
    expect((await stateOf()).followed.map((x) => x.url)).toEqual([hit]);
  });
  it("基準に語がない課のトップで、今回も語がなくても失敗にしない（届いたが語がないのは平時の正常）", async () => {
    const { deps } = fake({ [TOP]: top(["組織の案内"]) });
    await checkPrefPage(src(), deps);
    expect((await checkPrefPage(src(), deps)).ok).toBe(true);
    expect((await checkPrefPage(src(), deps)).ok).toBe(true);
  });
});

describe("報道発表の一覧（pref_press_list）: ページ自体は文書にしない", () => {
  const LIST = `${BASE}/press/`;
  it("足された行に語があっても作らず、リンクの文に語のあるものだけを取る", async () => {
    const hit = `${BASE}/press/1.html`;
    const { deps, f } = fake({
      [LIST]: ok(html("報道発表", ["a"]), LIST),
      [hit]: ok(html("発生", ["高病原性鳥インフルエンザの疑似患畜を確認"]), hit),
    });
    const src = prefSource({ kind: "pref_press_list", url: LIST });
    await checkPrefPage(src, deps);
    f.pages[LIST] = ok(html("報道発表", ["a", "鳥インフルエンザ関連"], [[hit, "鳥インフルエンザの発生について"], [`${BASE}/press/2.html`, "展覧会"]]), LIST);
    await checkPrefPage(src, deps);
    expect((await docsNow()).map((d) => d.url)).toEqual([hit]);
    expect(f.calls).not.toContain(`${BASE}/press/2.html`);
  });
});

describe("新しいリンク", () => {
  it("題に語のあるページは新しいリンクの PDF を文書にする。別のサイトは取得しない（要求 0 回）", async () => {
    const a = `${BASE}/uploaded/a.pdf`;
    const other = "https://example.com/x.pdf";
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["a"]), URL1), [a]: pdf(a) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = ok(html(T_WORD, ["a"], [[a, "第1報"], [other, "外部"], ["https://pref.okayama.jp/uploaded/b.pdf", "別名"]]), URL1);
    f.pages["https://pref.okayama.jp/uploaded/b.pdf"] = pdf("https://pref.okayama.jp/uploaded/b.pdf", "b");
    await checkPrefPage(prefSource(), deps);
    expect(f.calls).not.toContain(other);
    expect(f.calls).toContain("https://pref.okayama.jp/uploaded/b.pdf"); // www の有無は同じサイト
    expect((await docsNow()).filter((d) => d.contentType === "pdf").map((d) => d.url).sort()).toEqual([a, "https://pref.okayama.jp/uploaded/b.pdf"].sort());
  });
  it("文字層のない PDF は hasTextLayer:false で、指紋はバイト列の SHA-256", async () => {
    const a = `${BASE}/uploaded/a.pdf`;
    const p = pdf(a);
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["a"]), URL1), [a]: p });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = ok(html(T_WORD, ["a"], [[a, "第1報"]]), URL1);
    await checkPrefPage(prefSource(), deps);
    const [d] = await docsNow();
    expect(d).toMatchObject({ contentType: "pdf", hasTextLayer: false, readState: "pending", title: "第1報", prefCode: "33" });
    expect(d!.fingerprint).toBe(sha256Hex((p as { body: Buffer }).body));
    expect((await bucket().file(`raw/${d!.id}.pdf`).exists())[0]).toBe(true);
  });
  it("語のない HTML のリンクは文書にしない（題に語があるページでも、リンク先の本文に語がなければ）", async () => {
    const h = `${BASE}/page/9.html`;
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["a"]), URL1), [h]: ok(html("お知らせ", ["補助金"]), h) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = ok(html(T_WORD, ["a"], [[h, "お知らせ"]]), URL1);
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toEqual([]);
    expect((await stateOf()).links).toContain(h); // 取り込み済み。次回また取りに行かない
  });
  it("21 件あれば 20 件を取り、残りは次回", async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `${BASE}/uploaded/${String(i).padStart(2, "0")}.pdf`);
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["a"]), URL1), ...Object.fromEntries(urls.map((u) => [u, pdf(u, u)])) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = ok(html(T_WORD, ["a"], urls.map((u, i) => [u, `第${i}報`] as [string, string])), URL1);
    await checkPrefPage(prefSource(), deps);
    expect(MAX_NEW_LINKS_PER_CHECK).toBe(20);
    expect(await docsNow()).toHaveLength(20);
    await checkPrefPage(prefSource(), deps);
    expect(await docsNow()).toHaveLength(21);
  });
  it("取れなかったリンクは次回やり直し、3 回目で諦める（毎回取りに行かない）", async () => {
    const a = `${BASE}/uploaded/a.pdf`;
    const { deps, f } = fake({ [URL1]: ok(html(T_WORD, ["a"]), URL1) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = ok(html(T_WORD, ["a"], [[a, "第1報"]]), URL1); // a は 404
    for (let i = 0; i < 5; i++) expect((await checkPrefPage(prefSource(), deps)).ok).toBe(true); // リンクの失敗は入口の失敗に数えない
    expect(f.calls.filter((u) => u === a)).toHaveLength(3);
    expect(await docsNow()).toEqual([]);
  });
});

describe("岡山の 2 階層", () => {
  const CASE = `${BASE}/page/1013219.html`;
  const P1 = `${BASE}/uploaded/attachment/1.pdf`;
  const P2 = `${BASE}/uploaded/attachment/2.pdf`;
  const TOP = (links: Array<[string, string]> = []) => ok(html("畜産課", ["家畜の伝染病"], links), URL1);
  const CASE_LINK: [string, string] = [CASE, "高病原性鳥インフルエンザの発生について（津山市）"];
  const casePage = (pdfs: Array<[string, string]>) => ok(html("高病原性鳥インフルエンザの発生について", ["津山市の事例"], pdfs), CASE);

  it("事例ページが足されると文書になり followed に載り、次の確認で増えた第 2 報の PDF だけが新しい文書になる", async () => {
    const { deps, f } = fake({ [URL1]: TOP(), [CASE]: casePage([[P1, "第1報"]]), [P1]: pdf(P1, "1"), [P2]: pdf(P2, "2") });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = TOP([CASE_LINK]);
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).map((d) => d.url).sort()).toEqual([CASE, P1].sort());
    expect((await stateOf()).followed.map((x) => x.url)).toEqual([CASE]);

    f.pages[CASE] = casePage([[P1, "第1報"], [P2, "第2報"]]);
    f.calls.length = 0;
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).map((d) => d.url).sort()).toEqual([CASE, P1, P2].sort());
    expect(f.calls).toContain(CASE);
    expect(f.calls).not.toContain(P1); // 取り込み済みは取り直さない
  });
  it("事例ページの足された行は文書になる（日付だけなら作らない）", async () => {
    const { deps, f } = fake({ [URL1]: TOP(), [CASE]: casePage([]) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = TOP([CASE_LINK]);
    await checkPrefPage(prefSource(), deps);
    const n = (await docsNow()).length;
    f.pages[CASE] = ok(html("高病原性鳥インフルエンザの発生について", ["津山市の事例", "更新日：2026年11月5日"]), CASE);
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).length).toBe(n);
    f.pages[CASE] = ok(html("高病原性鳥インフルエンザの発生について", ["津山市の事例", "更新日：2026年11月5日", "防疫措置が完了しました"]), CASE);
    await checkPrefPage(prefSource(), deps);
    const docs = await docsNow();
    expect(docs.length).toBe(n + 1);
    const added = (await Promise.all(docs.filter((d) => d.url === CASE).map((d) => text(d.id)))).filter((t) => t === "防疫措置が完了しました");
    expect(added).toHaveLength(1); // 文書の本文は足された行だけ
  });
  it("追いかけは 60 日まで。過ぎた followed は確認しない。上限は 5 つで新しいものから", async () => {
    const { deps, f } = fake({ [URL1]: TOP(), [CASE]: casePage([]) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = TOP([CASE_LINK]);
    await checkPrefPage(prefSource(), deps);
    expect((await stateOf()).followed).toHaveLength(1);
    f.now = new Date(f.now.getTime() + 61 * 86_400_000);
    f.calls.length = 0;
    await checkPrefPage(prefSource(), deps);
    expect(f.calls).not.toContain(CASE);
    expect((await stateOf()).followed).toEqual([]);
  });
  it("followed は 5 つまで", async () => {
    const cases = Array.from({ length: 7 }, (_, i) => `${BASE}/page/${2000 + i}.html`);
    const { deps, f } = fake({ [URL1]: TOP(), ...Object.fromEntries(cases.map((c) => [c, ok(html("発生", ["高病原性鳥インフルエンザ"]), c)])) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = TOP(cases.map((c) => [c, "高病原性鳥インフルエンザ"] as [string, string]));
    await checkPrefPage(prefSource(), deps);
    expect((await stateOf()).followed).toHaveLength(5);
  });
  it("事例ページに 24 本の PDF があれば、2 回の確認で全部を拾う（1 回に 20 本まで）", async () => {
    const pdfs = Array.from({ length: 24 }, (_, i) => `${BASE}/uploaded/attachment/${100 + i}.pdf`);
    const { deps, f } = fake({ [URL1]: TOP(), [CASE]: casePage(pdfs.map((u, i) => [u, `第${i}報`] as [string, string])), ...Object.fromEntries(pdfs.map((u) => [u, pdf(u, u)])) });
    await checkPrefPage(prefSource(), deps);
    f.pages[URL1] = TOP([CASE_LINK]);
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).filter((d) => d.contentType === "pdf")).toHaveLength(20);
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).filter((d) => d.contentType === "pdf")).toHaveLength(24);
    await checkPrefPage(prefSource(), deps);
    expect((await docsNow()).filter((d) => d.contentType === "pdf")).toHaveLength(24);
  });
});

describe("200 で中身が別物（メンテナンス、ブロック、トップへの転送）は失敗に数える", () => {
  const good = (extra: string[] = []) => ok(html(T_WORD, ["発生の状況", ...extra]), URL1);

  it("基準に語があった専用のページで今回語が消えたら ok:false。基準を壊さず、戻れば成功に戻る", async () => {
    const { deps, f } = fake({ [URL1]: good() });
    await checkPrefPage(prefSource(), deps);
    const before = await stateOf();
    f.pages[URL1] = ok(html("ただいまメンテナンス中", ["しばらくお待ちください"]), URL1);
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(false);
    expect(await stateOf()).toEqual(before);
    expect(await docsNow()).toEqual([]);
    f.pages[URL1] = good();
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(true);
  });
  it("finalUrl のホストか経路が基準と違えば（トップへの転送など）ok:false。基準を壊さない", async () => {
    const { deps, f } = fake({ [URL1]: good() });
    await checkPrefPage(prefSource(), deps);
    const before = await stateOf();
    f.pages[URL1] = ok(html(T_WORD, ["発生の状況"]), `${BASE}/index.html`);
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(false);
    f.pages[URL1] = ok(html(T_WORD, ["発生の状況"]), "https://pref.okayama.jp/page/816850.html");
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(false);
    expect(await stateOf()).toEqual(before);
    f.pages[URL1] = good();
    expect((await checkPrefPage(prefSource(), deps)).ok).toBe(true);
  });
});

// 実物の控え（data/private/fixtures/okayama/、公開しない）。県のサイトへ取得しに行く試行はしない。控えは本体が置く。
const FIX = path.resolve(import.meta.dirname, "../../../data/private/fixtures/okayama");
describeFixture("岡山の実物の控え（816850 と 1013219）", [path.join(FIX, "816850.html"), path.join(FIX, "1013219.html")], () => {
  it("816850 から 1013219 を消した基準 → 実物で 1013219 に至り、2 回の確認で 24 本の PDF をすべて拾う", async () => {
    const top = fs.readFileSync(path.join(FIX, "816850.html"));
    const caseHtml = fs.readFileSync(path.join(FIX, "1013219.html"));
    const topUrl = `${BASE}/page/816850.html`;
    const caseUrl = `${BASE}/page/1013219.html`;
    const topText = top.toString("utf8");
    // 基準: 1013219 へのリンクを含む <a> を消す
    const without = topText.replace(/<a\b[^>]*1013219[^>]*>.*?<\/a>/gsu, "");
    expect(without).not.toContain("1013219");
    const { deps, f } = fake({ [topUrl]: ok(without, topUrl) });
    await checkPrefPage(prefSource({ url: topUrl }), deps);
    f.pages[topUrl] = ok(top, topUrl);
    f.pages[caseUrl] = ok(caseHtml, caseUrl);
    // 事例ページの PDF は偽の PDF で返す（実物の PDF は控えにない）
    const pdfLinks = [...caseHtml.toString("utf8").matchAll(/href="([^"]+\.pdf)"/gu)].map((m) => new URL(m[1]!, caseUrl).href);
    for (const u of pdfLinks) f.pages[u] = pdf(u, u);
    await checkPrefPage(prefSource({ url: topUrl }), deps);
    await checkPrefPage(prefSource({ url: topUrl }), deps);
    expect((await docsNow()).filter((d) => d.contentType === "pdf")).toHaveLength(24);
  });
});
