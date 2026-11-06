// 引用の全件照合（verify-cards）の試験。ネットには出ない（取得は偽物に差し替える）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCard, ConsultCardsFile, ConsultSource } from "@hpai/shared/consult/types";
import type { FetchOutcome } from "../../functions/src/watch/politeFetch";
import {
  europePmcAbstractUrl,
  europePmcUrl,
  findAttachmentLinks,
  htmlToText,
  mergeVerify,
  normalizeDraft,
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
    const { deps } = fakeDeps({ "https://example.org/a": ok("https://example.org/a2", "text/html; charset=utf-8", "<p>a<b>b</b> c</p>") });
    const out = await verifyAll(file, deps);
    expect(out.cards).toEqual([
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
      { pdfText: async () => "first only", pdftotext: async () => "first and second" },
    );
    const out = await verifyAll(file, deps);
    expect(out.cards).toEqual([
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
        pdftotext: async () => "first",
      },
    );
    const out = await verifyAll(file, deps);
    expect(out.cards).toEqual([{ id: "a", verified: true, method: "pdf-pdftotext" }]);
    expect(out.sources[0]).toMatchObject({ status: "ok" });
  });

  it("論文（PMC）は Europe PMC の全文 XML で照合し、その URL を残す", async () => {
    const epmc = "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC1/fullTextXML";
    const file: ConsultCardsFile = {
      sources: [source({ id: "paper", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/", kind: "paper", license: "CC BY 4.0" })],
      cards: [card({ id: "x", sourceId: "paper", quote: "wild birds" })],
    };
    const { deps, requested } = fakeDeps({ [epmc]: ok(epmc, "application/xml", "<article><p>seen <italic>wild</italic> birds</p></article>") });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([epmc]);
    expect(out.cards).toEqual([{ id: "x", verified: true, method: "xml" }]);
    expect(out.sources[0]).toMatchObject({ effectiveUrl: epmc, status: "ok" });
  });

  it("PubMed の論文: Europe PMC の抄録で照合し、その URL を残す", async () => {
    const epmc = europePmcAbstractUrl("https://pubmed.ncbi.nlm.nih.gov/7/")!;
    const file: ConsultCardsFile = {
      sources: [source({ id: "pm", url: "https://pubmed.ncbi.nlm.nih.gov/7/", kind: "paper", license: "CC BY 4.0" })],
      cards: [card({ id: "pm1", sourceId: "pm", quote: "wild waterfowl" })],
    };
    const { deps, requested } = fakeDeps({ [epmc]: ok(epmc, "application/xml;charset=UTF-8", "<result><abstractText>&lt;b&gt;wild&lt;/b&gt; waterfowl</abstractText></result>") });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([epmc]);
    expect(out.cards).toEqual([{ id: "pm1", verified: true, method: "xml" }]);
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
      [page]: ok(page, "text/html", `<p>Checklist</p><a href="${docx}">Word</a>`),
      [docx]: ok(docxNew, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK-docx"),
    }, { docxText: async () => "covered with mesh or netting" });
    const out = await verifyAll(file, deps);
    expect(requested).toEqual([page, docx]);
    expect(out.cards).toEqual([
      { id: "q1", verified: true, method: "docx" },
      { id: "q2", verified: false },
    ]);
    expect(out.sources[0]).toMatchObject({ effectiveUrl: docxNew, status: "ok" });
    expect(out.sources[0]!.parts?.map((p) => p.url)).toEqual([page, docxNew]);
  });

  it("全部がページで照合できたら添付は取りに行かない", async () => {
    const page = "https://www.gov.uk/government/publications/aipz";
    const file: ConsultCardsFile = { sources: [source({ id: "g", url: page })], cards: [card({ id: "q1", sourceId: "g", quote: "Checklist" })] };
    const { deps, requested } = fakeDeps({ [page]: ok(page, "text/html", `<p>Checklist</p><a href="/media/1/a.docx">Word</a>`) });
    await verifyAll(file, deps);
    expect(requested).toEqual([page]);
  });

  it("同じ資料を使うカードは 1 回だけ取りに行く", async () => {
    const url = "https://example.org/a";
    const file: ConsultCardsFile = { sources: [source({ id: "h", url })], cards: [card({ id: "1", sourceId: "h", quote: "a" }), card({ id: "2", sourceId: "h", quote: "a" })] };
    const { deps, requested } = fakeDeps({ [url]: ok(url, "text/html", "a") });
    await verifyAll(file, deps);
    expect(requested).toEqual([url]);
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
    cards: [{ id: "a1", verified: true, method: "html" }, { id: "b1", verified: false }],
  };
  const next: VerifyFile = {
    checkedAt: "2026-11-06T11:00:00+09:00",
    sources: [{ id: "b", effectiveUrl: "https://b2/", sha256: "bb", status: "ok", checkedAt: "2026-11-06T11:00:00+09:00" }],
    cards: [{ id: "b1", verified: true, method: "xml" }],
  };
  it("取り直した資料とカードだけ入れ替え、順はファイルのまま。前の資料には前の日時を付ける", () => {
    const merged = mergeVerify(prev, next, file);
    expect(merged.checkedAt).toBe(next.checkedAt);
    expect(merged.sources.map((s) => [s.id, s.status, s.checkedAt])).toEqual([
      ["a", "ok", prev.checkedAt],
      ["b", "ok", next.checkedAt],
    ]);
    expect(merged.cards).toEqual([{ id: "a1", verified: true, method: "html" }, { id: "b1", verified: true, method: "xml" }]);
  });
});

describe("data/consult の verify.json（cards.json ができるまでは skip）", () => {
  // 理由: cards.json は T 後続（カードの確定）で作る。まだない間は照合の対象がない。
  it.skipIf(!fs.existsSync(CARDS_JSON))("approved: true のカードはすべて verified: true", () => {
    const cards = parseCardsFile(JSON.parse(fs.readFileSync(CARDS_JSON, "utf8"))).cards;
    expect(fs.existsSync(VERIFY_JSON), "verify.json がありません。npx tsx scripts/consult/verify-cards.ts を流してください").toBe(true);
    const verify = JSON.parse(fs.readFileSync(VERIFY_JSON, "utf8")) as VerifyFile;
    const byId = new Map(verify.cards.map((c) => [c.id, c.verified]));
    const notVerified = cards.filter((c) => c.approved && byId.get(c.id) !== true).map((c) => c.id);
    expect(notVerified).toEqual([]);
  });
});
