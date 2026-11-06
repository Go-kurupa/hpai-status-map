// 引用の全件照合（verify-cards）の試験。ネットには出ない（取得は偽物に差し替える）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import { normalizeForMatch } from "@hpai/shared/text";
import type { ConsultCard, ConsultCardsFile, ConsultSource } from "@hpai/shared/consult/types";
import type { FetchOutcome } from "../../functions/src/watch/politeFetch";
import {
  europePmcAbstractUrl,
  europePmcUrl,
  findAttachmentLinks,
  defaultDeps,
  htmlToText,
  mergeVerify,
  normalizeDraft,
  quoteSha256,
  runVerifyCards,
  verifyAll,
  verifyQuotes,
  xmlToText,
  type VerifyDeps,
  type VerifyFile,
} from "../consult/verify-cards";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CARDS_JSON = path.join(ROOT, "data", "consult", "cards.json");
const VERIFY_JSON = path.join(ROOT, "data", "consult", "verify.json");

function card(over: Partial<ConsultCard> = {}): ConsultCard {
  return {
    id: "c1",
    origin: "M01",
    action: "防鳥ネットを張る",
    appliesTo: "すべての農場",
    evidence: "obligation",
    evidenceNote: "",
    quote: "網目の大きさが二センチメートル以下のもの",
    sourceId: "s1",
    locator: "p1",
    caveats: [],
    conditionTags: [],
    approved: false,
    ...over,
  };
}

function source(over: Partial<ConsultSource> = {}): ConsultSource {
  return {
    id: "s1",
    title: "資料",
    publisher: "農林水産省",
    url: "https://www.maff.go.jp/a.pdf",
    fetchedAt: "2026-11-06",
    domestic: true,
    kind: "guideline",
    license: "PDL1.0",
    licenseVerified: true,
    studyDesign: null,
    ...over,
  };
}

describe("verifyQuotes（本文との照合）", () => {
  const texts = new Map([["s1", "野生動物の侵入を防止する防鳥ネット（網目の大きさが 二センチメートル以下のもの）を設置する。"]]);

  it("本文にある引用は true（空白や改行の違いは見ない）", () => {
    expect(verifyQuotes([card()], texts)).toEqual([{ id: "c1", verified: true }]);
  });

  it("引用を書き換えたカードは false", () => {
    const changed = card({ id: "c2", quote: "網目の大きさが三センチメートル以下のもの" });
    expect(verifyQuotes([card(), changed], texts)).toEqual([
      { id: "c1", verified: true },
      { id: "c2", verified: false },
    ]);
  });

  it("資料の本文がない（取れなかった）カードは false", () => {
    expect(verifyQuotes([card({ sourceId: "s9" })], texts)).toEqual([{ id: "c1", verified: false }]);
  });
});

describe("normalizeDraft（下書きを本番の形にする）", () => {
  const draft = {
    sources: [source()],
    cards: [
      { ...card(), approved: undefined, continuesWith: "c2", referenceOnly: true, overlapsWith: ["c3"] },
      { ...card({ id: "c2" }), approved: undefined },
    ],
  };
  it("補助の項目を外し、approved: false を足すと parseCardsFile に通る", () => {
    const out = normalizeDraft(draft);
    const parsed = parseCardsFile(out);
    expect(parsed.cards.map((c) => c.approved)).toEqual([false, false]);
    expect(Object.keys((out as { cards: object[] }).cards[0]!)).not.toContain("continuesWith");
    expect(() => parseCardsFile(draft)).toThrow();
  });
  it("元の入力は書き換えない", () => {
    normalizeDraft(draft);
    expect(draft.cards[0]).toHaveProperty("continuesWith");
  });
  it("cards.json の形では何もしない（approved はそのまま）", () => {
    const file: ConsultCardsFile = { sources: [source()], cards: [card({ approved: true }), card({ id: "c2", approved: false })] };
    expect(normalizeDraft(file)).toEqual(file);
  });
  it("オブジェクトでない入力はそのまま返す", () => {
    expect(normalizeDraft(null)).toBeNull();
    expect(normalizeDraft("x")).toBe("x");
  });
});

describe("本文の取り出し", () => {
  it("HTML: タグ、script、style、コメントを取り、文字参照を戻す", () => {
    const html = `<html><head><style>p{color:red}</style><script>var a="x < y"</script></head><body><!-- c --><p>Risk &amp; <b>factor</b> &#x27;A&#39; &lt;5&gt; it&rsquo;s&nbsp;ok</p></body></html>`;
    const text = htmlToText(html).replace(/\s+/g, " ");
    expect(text).toContain("Risk & factor 'A' <5> it’s ok");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var a");
    expect(text).not.toContain("<b>");
  });
  it("XML: タグを取り、文字参照を戻す", () => {
    expect(xmlToText(`<?xml version="1.0"?><p>OR&#160;0.3 (<italic>p</italic> &lt; 0.05)</p>`)).toMatch(/OR\s0\.3\s+\(\s*p\s+<\s0\.05\)/);
  });
  it("Word の document.xml: 段落の文字をつなぐ", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Are any openings </w:t></w:r><w:r><w:t>covered?</w:t></w:r></w:p></w:body></w:document>`;
    expect(xmlToText(xml).replace(/\s+/g, "")).toBe("Areanyopeningscovered?");
  });
  it("Europe PMC の URL は PMC の論文だけ作る", () => {
    expect(europePmcUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC12629688/")).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12629688/fullTextXML",
    );
    expect(europePmcUrl("https://pubmed.ncbi.nlm.nih.gov/39808886/")).toBeNull();
    expect(europePmcUrl("https://www.maff.go.jp/a.pdf")).toBeNull();
  });
  it("PubMed の論文は Europe PMC の検索結果（抄録）の URL にする（PubMed は Cookie の確認ページを返す）", () => {
    expect(europePmcAbstractUrl("https://pubmed.ncbi.nlm.nih.gov/39808886/")).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:39808886%20AND%20SRC:MED&resultType=core&format=xml",
    );
    expect(europePmcAbstractUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/")).toBeNull();
  });
  it("XML: 文字参照のまま入った HTML のタグ（抄録）も取り、不等号の本文は残す", () => {
    const text = xmlToText(`<abstractText>&lt;h4&gt;Results&lt;/h4&gt;OR 18.7 (95 % CI 3.1-148, p &lt; 0.05)&lt;br/&gt;end</abstractText>`).replace(/\s+/g, " ");
    expect(text).toContain("Results OR 18.7 (95 % CI 3.1-148, p < 0.05) end");
  });
  it("添付の docx と pdf のリンクだけ拾う（相対 URL は基準で解く、重複は 1 つ）", () => {
    const html = `<a href="https://assets.publishing.service.gov.uk/media/1/a.docx">w</a><a href="/media/2/b.pdf?x=1">p</a><a href="https://assets.publishing.service.gov.uk/media/1/a.docx">dup</a><a href="/media/3/c.odt">o</a><a href="/about">x</a>`;
    expect(findAttachmentLinks(html, "https://www.gov.uk/government/publications/x")).toEqual([
      "https://assets.publishing.service.gov.uk/media/1/a.docx",
      "https://www.gov.uk/media/2/b.pdf?x=1",
    ]);
  });
});

// ── 偽の取得 ──

/** 本文として使う最低の文字数（300）を超えるための詰め物。 */
const FILL = " filler text".repeat(40);
/** 照合の結果から quoteSha256 を除いた形（結果の比べやすさのため）。 */
const brief = (o: VerifyFile) => o.cards.map(({ quoteSha256: _q, ...rest }) => rest);

const ok = (finalUrl: string, contentType: string, body: string | Buffer): FetchOutcome => ({
  kind: "ok",
  status: 200,
  finalUrl,
  contentType,
  body: Buffer.isBuffer(body) ? body : Buffer.from(body),
  etag: null,
  lastModified: null,
  fetchedAt: "2026-11-06T10:00:00+09:00",
});

function fakeDeps(routes: Record<string, FetchOutcome>, extra: Partial<VerifyDeps> = {}): { deps: VerifyDeps; requested: string[] } {
  const requested: string[] = [];
  const deps: VerifyDeps = {
    fetch: async (url) => {
      requested.push(url);
      return routes[url] ?? { kind: "http_error", status: 404 };
    },
    waitForHost: async () => {},
    pdfText: async (body) => body.toString("utf8"),
    pdftotext: async (body) => body.toString("utf8"),
    docxText: async (body) => body.toString("utf8"),
    now: () => new Date("2026-11-06T01:00:00Z"),
    ...extra,
  };
  return { deps, requested };
}

describe("verifyAll（取得を偽物にした全件照合）", () => {
  it("HTML の資料: 引用が本文にあれば true、sha256 と実際の URL を残す", async () => {
    const file: ConsultCardsFile = {
      sources: [source({ id: "h", url: "https://example.org/a" })],
      cards: [card({ id: "ok", sourceId: "h", quote: "a b c" }), card({ id: "ng", sourceId: "h", quote: "xyz" })],
    };
    const { deps } = fakeDeps({ "https://example.org/a": ok("https://example.org/a2", "text/html; charset=utf-8", "<p>a<b>b</b> c</p>" + FILL) });
    const out = await verifyAll(file, deps);
    expect(brief(out)).toEqual([
      { id: "ok", verified: true, method: "html" },
      { id: "ng", verified: false },
    ]);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ id: "h", status: "ok", effectiveUrl: "https://example.org/a2" });
    expect(out.sources[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.checkedAt).toMatch(/^2026-11-06T10:00:00/);
  });

  it("取れなかった資料: 理由を残し、そのカードは false", async () => {
    const file: ConsultCardsFile = {
      sources: [source({ id: "d", url: "https://example.org/denied" }), source({ id: "e", url: "https://example.org/404" })],
      cards: [card({ id: "c-d", sourceId: "d" }), card({ id: "c-e", sourceId: "e" })],
    };
    const { deps } = fakeDeps({ "https://example.org/denied": { kind: "robots_denied" } });
    const out = await verifyAll(file, deps);
    expect(out.cards.map((c) => c.verified)).toEqual([false, false]);
    expect(out.sources.find((s) => s.id === "d")).toMatchObject({ status: "robots_denied", sha256: null });
    expect(out.sources.find((s) => s.id === "e")).toMatchObject({ status: "http_error", detail: "404", sha256: null });
  });

  it("PDF: 1 回目の本文で落ちたカードだけ pdftotext の本文でもう一度見る", async () => {
    const file: ConsultCardsFile = {
      sources: [source({ id: "p", url: "https://example.org/a.pdf" })],
      cards: [card({ id: "a", sourceId: "p", quote: "first" }), card({ id: "b", sourceId: "p", quote: "second" }), card({ id: "c", sourceId: "p", quote: "nowhere" })],
    };
    const body = Buffer.from("%PDF-1.7 raw");
    const { deps } = fakeDeps(
      { "https://example.org/a.pdf": ok("https://example.org/a.pdf", "application/pdf", body) },
      { pdfText: async () => "first only" + FILL, pdftotext: async () => "first and second" + FILL },
    );
    const out = await verifyAll(file, deps);
    expect(brief(out)).toEqual([
      { id: "a", verified: true, method: "pdf-unpdf" },
      { id: "b", verified: true, method: "pdf-pdftotext" },
      { id: "c", verified: false },
    ]);
  });

  it("PDF の文字の取り出しに失敗しても pdftotext で続ける", async () => {
    const file: ConsultCardsFile = { sources: [source({ id: "p", url: "https://example.org/a.pdf" })], cards: [card({ id: "a", sourceId: "p", quote: "first" })] };
    const { deps } = fakeDeps(
      { "https://example.org/a.pdf": ok("https://example.org/a.pdf", "application/octet-stream", "%PDF-1.7") },
      {
        pdfText: async () => {
          throw new Error("bad pdf");
        },
        pdftotext: async () => "first" + FILL,
      },
    );
    const out = await verifyAll(file, deps);
    expect(brief(out)).toEqual([{ id: "a", verified: true, method: "pdf-pdftotext" }]);
    expect(out.sources[0]).toMatchObject({ status: "ok" });
  });

  it("論文（PMC）は Europe PMC の全文 XML で照合し、その URL を残す", async () => {
    const epmc = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC1/fullTextXML";
    const file: ConsultCardsFile = {
      sources: [source({ id: "paper", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/", kind: "paper", license: "CC BY 4.0" })],
      cards: [card({ id: "x", sourceId: "paper", quote: "wild birds" })],
    };
    const { deps, requested } = fakeDeps({ [epmc]: ok(epmc, "application/xml", "<article><p>seen <italic>wild</italic> birds</p></article>" + FILL) });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([epmc]);
    expect(brief(out)).toEqual([{ id: "x", verified: true, method: "xml" }]);
    expect(out.sources[0]).toMatchObject({ effectiveUrl: epmc, status: "ok" });
  });

  it("PubMed の論文: Europe PMC の抄録で照合し、その URL を残す", async () => {
    const epmc = europePmcAbstractUrl("https://pubmed.ncbi.nlm.nih.gov/7/")!;
    const file: ConsultCardsFile = {
      sources: [source({ id: "pm", url: "https://pubmed.ncbi.nlm.nih.gov/7/", kind: "paper", license: "CC BY 4.0" })],
      cards: [card({ id: "pm1", sourceId: "pm", quote: "wild waterfowl" })],
    };
    const { deps, requested } = fakeDeps({ [epmc]: ok(epmc, "application/xml;charset=UTF-8", "<result><abstractText>&lt;b&gt;wild&lt;/b&gt; waterfowl</abstractText></result>" + FILL) });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([epmc]);
    expect(brief(out)).toEqual([{ id: "pm1", verified: true, method: "xml" }]);
    expect(out.sources[0]).toMatchObject({ effectiveUrl: epmc });
  });

  it("gov.uk: ページに引用がなければ添付の docx を取り、転送先の URL を残す", async () => {
    const page = "https://www.gov.uk/government/publications/aipz";
    const docx = "https://assets.publishing.service.gov.uk/media/1/a.docx";
    const docxNew = "https://assets.publishing.service.gov.uk/media/2/a.docx";
    const file: ConsultCardsFile = {
      sources: [source({ id: "g", url: page, license: "OGL v3.0" })],
      cards: [card({ id: "q1", sourceId: "g", quote: "mesh or netting" }), card({ id: "q2", sourceId: "g", quote: "not anywhere" })],
    };
    const { deps, requested } = fakeDeps({
      [page]: ok(page, "text/html", `<p>Checklist</p><a href="${docx}">Word</a>${FILL}`),
      [docx]: ok(docxNew, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK-docx"),
    }, { docxText: async () => "covered with mesh or netting" });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([page, docx]);
    expect(brief(out)).toEqual([
      { id: "q1", verified: true, method: "docx" },
      { id: "q2", verified: false },
    ]);
    expect(out.sources[0]).toMatchObject({ effectiveUrl: docxNew, status: "ok" });
    expect(out.sources[0]!.parts?.map((p) => p.url)).toEqual([page, docxNew]);
  });

  it("全部がページで照合できたら添付は取りに行かない", async () => {
    const page = "https://www.gov.uk/government/publications/aipz";
    const file: ConsultCardsFile = { sources: [source({ id: "g", url: page })], cards: [card({ id: "q1", sourceId: "g", quote: "Checklist" })] };
    const { deps, requested } = fakeDeps({ [page]: ok(page, "text/html", `<p>Checklist</p><a href="/media/1/a.docx">Word</a>${FILL}`) });
    await verifyAll(file, deps);
    expect(requested).toEqual([page]);
  });

  it("同じ資料を使うカードは 1 回だけ取りに行く", async () => {
    const url = "https://example.org/a";
    const file: ConsultCardsFile = { sources: [source({ id: "h", url })], cards: [card({ id: "1", sourceId: "h", quote: "a" }), card({ id: "2", sourceId: "h", quote: "a" })] };
    const { deps, requested } = fakeDeps({ [url]: ok(url, "text/html", "a" + FILL) });
    await verifyAll(file, deps);
    expect(requested).toEqual([url]);
  });
});

describe("verifyAll: 取得の失敗を本文にしない", () => {
  const url = "https://example.org/a";
  const one = (u: string, quote = "needle"): ConsultCardsFile => ({ sources: [source({ id: "h", url: u })], cards: [card({ id: "c", sourceId: "h", quote })] });
  const okWith = (over: Partial<Extract<FetchOutcome, { kind: "ok" }>>): FetchOutcome => ({ ...(ok(url, "text/html", "needle" + FILL) as Extract<FetchOutcome, { kind: "ok" }>), ...over });

  it("200 以外（203 の Cookie 確認ページ）は本文にせず unexpected_status にする（引用が書いてあっても false）", async () => {
    const { deps } = fakeDeps({ [url]: okWith({ status: 203 }) });
    const out = await verifyAll(one(url), deps);
    expect(out.sources[0]).toMatchObject({ status: "unexpected_status", detail: "http_203", sha256: null });
    expect(brief(out)).toEqual([{ id: "c", verified: false }]);
  });

  it("URL が .pdf なのに中身が HTML なら kind_mismatch", async () => {
    const pdfUrl = "https://example.org/a.pdf";
    const { deps } = fakeDeps({ [pdfUrl]: ok(pdfUrl, "text/html", "needle" + FILL) });
    const out = await verifyAll(one(pdfUrl), deps);
    expect(out.sources[0]).toMatchObject({ status: "kind_mismatch", detail: "expected_pdf_got_html", sha256: null });
    expect(brief(out)).toEqual([{ id: "c", verified: false }]);
  });

  it("URL が .docx なのに中身が HTML でも kind_mismatch", async () => {
    const docxUrl = "https://example.org/a.docx";
    const { deps } = fakeDeps({ [docxUrl]: ok(docxUrl, "text/html", "needle" + FILL) });
    expect((await verifyAll(one(docxUrl), deps)).sources[0]).toMatchObject({ status: "kind_mismatch" });
  });

  it("取り出した本文が 300 文字未満なら empty_text（引用が書いてあっても false）", async () => {
    const { deps } = fakeDeps({ [url]: ok(url, "text/html", "<p>needle</p>") });
    const out = await verifyAll(one(url), deps);
    expect(out.sources[0]).toMatchObject({ status: "empty_text", sha256: null });
    expect(brief(out)).toEqual([{ id: "c", verified: false }]);
  });

  it("PDF の unpdf の本文が短くても pdftotext の本文が十分なら、そちらで続ける", async () => {
    const pdfUrl = "https://example.org/a.pdf";
    const { deps } = fakeDeps({ [pdfUrl]: ok(pdfUrl, "application/pdf", "%PDF-1.7") }, { pdfText: async () => "", pdftotext: async () => "needle" + FILL });
    const out = await verifyAll(one(pdfUrl), deps);
    expect(out.sources[0]).toMatchObject({ status: "ok" });
    expect(brief(out)).toEqual([{ id: "c", verified: true, method: "pdf-pdftotext" }]);
  });

  it("PDF が両方の方法で短ければ empty_text", async () => {
    const pdfUrl = "https://example.org/a.pdf";
    const { deps } = fakeDeps({ [pdfUrl]: ok(pdfUrl, "application/pdf", "%PDF-1.7") }, { pdfText: async () => "x", pdftotext: async () => "needle" });
    expect((await verifyAll(one(pdfUrl), deps)).sources[0]).toMatchObject({ status: "empty_text" });
  });

  it("失敗の detail に Error.message や例外の文を入れない", async () => {
    const docxUrl = "https://example.org/a.docx";
    const marker = "boom /home/someone/private-marker.docx";
    const docxFail = fakeDeps({ [docxUrl]: ok(docxUrl, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK") }, {
      docxText: async () => {
        throw new Error(marker);
      },
    });
    const a = await verifyAll(one(docxUrl), docxFail.deps);
    expect(a.sources[0]).toMatchObject({ status: "extract_error", detail: "extract_failed" });

    const net = fakeDeps({ [url]: { kind: "network_error", message: marker, code: "ECONNRESET", tls: false } });
    const b = await verifyAll(one(url), net.deps);
    expect(b.sources[0]).toMatchObject({ status: "network_error", detail: "ECONNRESET" });

    const boom = fakeDeps({}, {
      fetch: async () => {
        throw new Error(marker);
      },
    });
    const c = await verifyAll(one(url), boom.deps);
    expect(c.sources[0]).toMatchObject({ status: "internal_error", detail: "internal_error" });
    expect(JSON.stringify([a, b, c])).not.toContain("marker");
  });

  it("gov.uk の添付は www.gov.uk の完全一致のときだけ辿る（別のホストの ○○.gov.uk は辿らない）", async () => {
    const page = "https://evil.gov.uk/x";
    const { deps, requested } = fakeDeps({ [page]: ok(page, "text/html", `<a href="/m/a.docx">w</a>${FILL}`) });
    await verifyAll(one(page), deps);
    expect(requested).toEqual([page]);
  });

  it("カードごとに normalizeForMatch した引用の sha256 を残す（空白や全角の違いは同じ値、書き換えると変わる）", async () => {
    const { deps } = fakeDeps({ [url]: ok(url, "text/html", "needle" + FILL) });
    const file: ConsultCardsFile = {
      sources: [source({ id: "h", url })],
      cards: [
        card({ id: "1", sourceId: "h", quote: "need le" }),
        card({ id: "2", sourceId: "h", quote: "ｎｅｅｄｌｅ" }),
        card({ id: "3", sourceId: "h", quote: "needle2" }),
      ],
    };
    const out = await verifyAll(file, deps);
    const expected = createHash("sha256").update(normalizeForMatch("needle")).digest("hex");
    expect(out.cards.map((c) => c.quoteSha256)).toEqual([expected, expected, quoteSha256("needle2")]);
    expect(out.cards[2]!.quoteSha256).not.toBe(expected);
    expect(out.cards.map((c) => c.verified)).toEqual([true, true, false]);
  });
});

describe("mergeVerify（一部の資料だけ取り直した結果を重ねる）", () => {
  const file: ConsultCardsFile = {
    sources: [source({ id: "a" }), source({ id: "b" })],
    cards: [card({ id: "a1", sourceId: "a" }), card({ id: "b1", sourceId: "b" })],
  };
  const prev: VerifyFile = {
    checkedAt: "2026-11-06T10:00:00+09:00",
    sources: [
      { id: "a", effectiveUrl: "https://a/", sha256: "aa", status: "ok" },
      { id: "b", effectiveUrl: "https://b/", sha256: null, status: "http_error", detail: "500" },
    ],
    cards: [{ id: "a1", verified: true, quoteSha256: "h1", method: "html" }, { id: "b1", verified: false, quoteSha256: "h2" }],
  };
  const next: VerifyFile = {
    checkedAt: "2026-11-06T11:00:00+09:00",
    sources: [{ id: "b", effectiveUrl: "https://b2/", sha256: "bb", status: "ok", checkedAt: "2026-11-06T11:00:00+09:00" }],
    cards: [{ id: "b1", verified: true, quoteSha256: "h2", method: "xml" }],
  };
  it("取り直した資料とカードだけ入れ替え、順はファイルのまま。前の資料には前の日時を付ける", () => {
    const merged = mergeVerify(prev, next, file);
    expect(merged.checkedAt).toBe(next.checkedAt);
    expect(merged.sources.map((s) => [s.id, s.status, s.checkedAt])).toEqual([
      ["a", "ok", prev.checkedAt],
      ["b", "ok", next.checkedAt],
    ]);
    expect(merged.cards).toEqual([
      { id: "a1", verified: true, quoteSha256: "h1", method: "html" },
      { id: "b1", verified: true, quoteSha256: "h2", method: "xml" },
    ]);
  });
});

describe("runVerifyCards（入口）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "consult-verify-test-"));
    dirs.push(d);
    return d;
  };
  const url = "https://example.org/a";
  /** 補助の項目つき・approved なしの下書き。 */
  const draft = (quotes: string[]) => ({
    sources: [source({ id: "h", url })],
    cards: quotes.map((q, i) => ({ ...card({ id: `c${i + 1}`, sourceId: "h", quote: q }), approved: undefined, continuesWith: "c2", referenceOnly: true, overlapsWith: [] })),
  });
  const setup = (quotes: string[]) => {
    const dir = tmp();
    const input = path.join(dir, "draft.json");
    fs.writeFileSync(input, JSON.stringify(draft(quotes)));
    return { dir, input, out: path.join(dir, "out", "verify.json") };
  };
  const run = async (args: string[], routes: Record<string, FetchOutcome>) => {
    let text = "";
    const { deps, requested } = fakeDeps(routes);
    const code = await runVerifyCards(args, (s) => (text += s), deps);
    return { code, text, requested };
  };
  const page = { [url]: ok(url, "text/html", "needle haystack" + FILL) };

  it("下書きを normalizeDraft を通して読み、全部一致なら 0 で --out に書く（フォルダも作る）", async () => {
    const { input, out } = setup(["needle", "haystack"]);
    const r = await run([input, "--out", out], page);
    expect(r.code).toBe(0);
    const written = JSON.parse(fs.readFileSync(out, "utf8")) as VerifyFile;
    expect(written.cards.map((c) => [c.id, c.verified])).toEqual([["c1", true], ["c2", true]]);
    expect(r.text).toContain("2 枚のうち 2 枚が一致");
  });

  it("不一致のカードがあれば 1 で、id を出す", async () => {
    const { input, out } = setup(["needle", "absent"]);
    const r = await run([input, "--out", out], page);
    expect(r.code).toBe(1);
    expect(r.text).toContain("不一致: c2");
    expect((JSON.parse(fs.readFileSync(out, "utf8")) as VerifyFile).cards.map((c) => c.verified)).toEqual([true, false]);
  });

  it("使い方が違えば 2（入力なし、知らない引数）", async () => {
    expect((await run([], {})).code).toBe(2);
    expect((await run(["--nope"], {})).code).toBe(2);
  });

  it("--only: 入力にない資料の id は 2（取りに行かない）", async () => {
    const { input, out } = setup(["needle"]);
    const r = await run([input, "--out", out, "--only", "nothing"], page);
    expect(r.code).toBe(2);
    expect(r.requested).toEqual([]);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("--only: 前の verify.json がなければ 2（取りに行かない）", async () => {
    const { input, out } = setup(["needle"]);
    const r = await run([input, "--out", out, "--only", "h"], page);
    expect(r.code).toBe(2);
    expect(r.requested).toEqual([]);
  });

  it("--only: 前の verify.json に重ねる", async () => {
    const { input, out } = setup(["needle"]);
    expect((await run([input, "--out", out], page)).code).toBe(0);
    const r = await run([input, "--out", out, "--only", "h"], page);
    expect(r.code).toBe(0);
    expect(r.requested).toEqual([url]);
    expect((JSON.parse(fs.readFileSync(out, "utf8")) as VerifyFile).sources).toHaveLength(1);
  });
});

// 実際のコマンドの包み。小さな PDF と docx を試験の中で作る。コマンドがない環境では skip（理由: 外のコマンドに依存するため）。
const has = (cmd: string): boolean => spawnSync("which", [cmd]).status === 0;

/** 1 ページに 1 行の文字がある最小の PDF。 */
function tinyPdf(line: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("外のコマンドの包み（defaultDeps）", () => {
  it.skipIf(!has("pdftotext"))("pdftotext: 小さな PDF から文字を取る。壊れた PDF は定型の理由で失敗し、中身の文は入らない", async () => {
    const deps = defaultDeps();
    expect(await deps.pdftotext(tinyPdf("Hello biosecurity net"))).toContain("Hello biosecurity net");
    const err = await deps.pdftotext(Buffer.from("not a pdf at all marker")).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^pdftotext_failed_exit_\w+$/);
  });

  it.skipIf(!has("pdftotext"))("unpdf: 同じ小さな PDF から文字を取る", async () => {
    expect(await defaultDeps().pdfText(tinyPdf("Hello biosecurity net"))).toContain("Hello biosecurity net");
  });

  it.skipIf(!has("unzip") || !has("zip"))("unzip: 小さな docx の document.xml からタグを取る。壊れた docx は定型の理由で失敗する", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consult-verify-test-"));
    try {
      fs.mkdirSync(path.join(dir, "word"));
      fs.writeFileSync(path.join(dir, "word", "document.xml"), "<w:document><w:body><w:p><w:r><w:t>mesh &amp; netting</w:t></w:r></w:p></w:body></w:document>");
      expect(spawnSync("zip", ["-qr", "t.docx", "word"], { cwd: dir }).status).toBe(0);
      const deps = defaultDeps();
      expect(await deps.docxText(fs.readFileSync(path.join(dir, "t.docx")))).toMatch(/mesh\s*&\s*netting/);
      const err = await deps.docxText(Buffer.from("not a zip marker")).catch((e: Error) => e);
      expect((err as Error).message).toMatch(/^unzip_failed_exit_\w+$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("data/consult の verify.json（cards.json ができるまでは skip）", () => {
  // 理由: cards.json は T 後続（カードの確定）で作る。まだない間は照合の対象がない。
  it.skipIf(!fs.existsSync(CARDS_JSON))("approved: true のカードはすべて verified: true で、引用が照合のときのまま", () => {
    const cards = parseCardsFile(JSON.parse(fs.readFileSync(CARDS_JSON, "utf8"))).cards;
    expect(fs.existsSync(VERIFY_JSON), "verify.json がありません。npx tsx scripts/consult/verify-cards.ts を流してください").toBe(true);
    const verify = JSON.parse(fs.readFileSync(VERIFY_JSON, "utf8")) as VerifyFile;
    const byId = new Map(verify.cards.map((c) => [c.id, c]));
    const notVerified = cards.filter((c) => c.approved && byId.get(c.id)?.verified !== true).map((c) => c.id);
    expect(notVerified).toEqual([]);
    // 照合のあとで引用を書き換えたカード
    const changed = cards.filter((c) => c.approved && byId.get(c.id)?.quoteSha256 !== quoteSha256(c.quote)).map((c) => c.id);
    expect(changed).toEqual([]);
  });
});
