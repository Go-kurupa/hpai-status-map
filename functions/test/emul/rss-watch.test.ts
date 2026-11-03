// 県の RSS の見回り（checkRss）を、模擬環境の Firestore と Storage で確かめる（I-02）。県のサイトへは出ない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentRecord, ReviewItem } from "@hpai/shared/read/types";
import { bucket, db } from "../../src/admin";
import { checkRss } from "../../src/watch/rss";
import { BASE, fake, html, ok, prefSource } from "../helpers/prefWatch";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

const docsNow = async () => (await db.collection("documents").get()).docs.map((d) => d.data() as DocumentRecord).sort((a, b) => a.url.localeCompare(b.url));
const queueNow = async () => (await db.collection("reviewQueue").get()).docs.map((d) => d.data() as ReviewItem);
const text = async (id: string) => (await bucket().file(`raw/${id}.txt`).download())[0].toString("utf8");

const RSS_URL = `${BASE}/rss/10/list1.xml`;
const src = () => prefSource({ id: "rss1", kind: "pref_rss", url: RSS_URL });
const item = (title: string, link: string, description = "") => `<item><title>${title}</title><link>${link}</link><description>${description}</description></item>`;
const feed = (...items: string[]) => ok(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>新着</title>${items.join("")}</channel></rss>`, RSS_URL, "application/xml");

const SCHOOL = item("インフルエンザ様疾患による学校の臨時休業について（第23報）", `${BASE}/page/s1.html`, "インフルエンザによる学級閉鎖");
const OLD = item("昔の鳥インフルエンザ", `${BASE}/page/old.html`);

describe("県の RSS", () => {
  it("条件付きの取得の印は送らない。最初の確認は基準だけで文書を作らず、リンク先も取らない", async () => {
    const { deps, f } = fake({ [RSS_URL]: feed(OLD, SCHOOL) });
    const r = await checkRss(src(), deps);
    expect(r).toMatchObject({ ok: true, etag: null, lastModified: null });
    expect(await docsNow()).toEqual([]);
    expect(f.calls).toEqual([RSS_URL]);
    for (const o of f.opts) {
      expect(o.etag ?? null).toBeNull();
      expect(o.lastModified ?? null).toBeNull();
    }
  });
  it("「インフルエンザ」だけの学校の臨時休業は拾わず、説明文に「高病原性鳥」があれば拾う", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD), [hit]: ok(html("家きんの疾病", ["津山市の農場で確認しました"]), hit) });
    await checkRss(src(), deps);
    const school2 = item("インフルエンザ様疾患による学校の臨時休業について（第24報）", `${BASE}/page/s2.html`, "インフルエンザ");
    f.pages[RSS_URL] = feed(item("家きんの疾病について", hit, "高病原性鳥インフルエンザの疑似患畜を確認しました"), school2, OLD, SCHOOL);
    expect((await checkRss(src(), deps)).ok).toBe(true);
    const docs = await docsNow();
    expect(docs.map((d) => d.url)).toEqual([hit]);
    expect(docs[0]).toMatchObject({ readState: "pending", prefCode: "33", contentType: "html", sourceId: "rss1" });
    expect(await text(docs[0]!.id)).toContain("津山市");
    expect(f.calls).not.toContain(`${BASE}/page/s2.html`);
  });
  it("同じ項目を 2 回見ても文書は増えず、リンク先を取り直さない", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD), [hit]: ok(html("発生", ["高病原性鳥インフルエンザ"]), hit) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生", hit), OLD);
    await checkRss(src(), deps);
    await checkRss(src(), deps);
    expect(await docsNow()).toHaveLength(1);
    expect(f.calls.filter((u) => u === hit)).toHaveLength(1);
  });
  it("別のサイトのリンクは取得しない。項目の題と説明を文書にする", async () => {
    const other = "https://example.com/news/1";
    const { deps, f } = fake({ [RSS_URL]: feed(OLD) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生について", other, "県内の農場で確認"), OLD);
    await checkRss(src(), deps);
    expect(f.calls).not.toContain(other);
    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.url).toBe(other);
    expect(await text(docs[0]!.id)).toContain("県内の農場で確認");
  });
  it("リンク先の取得に失敗した項目は次回やり直し、3 回目で項目の文を文書にして運営者の箱にも入れる。入口の失敗には数えない", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生", hit, "説明"), OLD); // hit は 404
    for (let i = 0; i < 2; i++) {
      expect((await checkRss(src(), deps)).ok).toBe(true);
      expect(await docsNow()).toEqual([]);
    }
    expect((await checkRss(src(), deps)).ok).toBe(true);
    expect(await docsNow()).toHaveLength(1);
    expect(f.calls.filter((u) => u === hit)).toHaveLength(3);
    const q = await queueNow();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "document", url: hit, reasons: ["link_unreachable"], documentId: (await docsNow())[0]!.id });
  });
  it("robots_denied、not_allowed のリンクは再試行せず、すぐ項目の文を文書にして箱に入れる", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生", hit, "説明"), OLD);
    f.pages[hit] = { kind: "robots_denied" };
    expect((await checkRss(src(), deps)).ok).toBe(true);
    expect(f.calls.filter((u) => u === hit)).toHaveLength(1);
    expect(await docsNow()).toHaveLength(1);
    expect((await queueNow()).map((q) => q.id)).toEqual([`doc-${(await docsNow())[0]!.id}`]);
  });
  it("基準に項目があったのに 0 項目の RSS（200 で空）は失敗にして基準を上書きしない。基準がもともと 0 項目なら成功", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD), [hit]: ok(html("発生", ["鳥インフルエンザ"]), hit) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = feed();
    expect((await checkRss(src(), deps)).ok).toBe(false);
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生", hit), OLD); // 基準が空で上書きされていれば OLD も新しい項目になり文書が 2 つできる
    expect((await checkRss(src(), deps)).ok).toBe(true);
    expect((await docsNow()).map((d) => d.url)).toEqual([hit]);
    const fresh = fake({ [RSS_URL]: feed() });
    const s2 = prefSource({ id: "rss2", kind: "pref_rss", url: RSS_URL });
    expect((await checkRss(s2, fresh.deps)).ok).toBe(true);
    expect((await checkRss(s2, fresh.deps)).ok).toBe(true);
  });
  it("Atom も読める", async () => {
    const hit = `${BASE}/page/h1.html`;
    const atom = (entries: string) => ok(`<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>${entries}</feed>`, RSS_URL, "application/atom+xml");
    const entry = (id: string, title: string, href: string) => `<entry><title>${title}</title><link href="${href}"/><id>${id}</id></entry>`;
    const { deps, f } = fake({ [RSS_URL]: atom(entry("1", "昔", `${BASE}/o`)), [hit]: ok(html("発生", ["鳥インフルエンザ"]), hit) });
    await checkRss(src(), deps);
    f.pages[RSS_URL] = atom(entry("1", "昔", `${BASE}/o`) + entry("2", "鳥インフルエンザの発生", hit));
    await checkRss(src(), deps);
    expect((await docsNow()).map((d) => d.url)).toEqual([hit]);
  });
  it("壊れた XML、取得の失敗（TLS を含む）は ok:false で、基準を壊さない。直れば続きから", async () => {
    const hit = `${BASE}/page/h1.html`;
    const { deps, f } = fake({ [RSS_URL]: feed(OLD), [hit]: ok(html("発生", ["鳥インフルエンザ"]), hit) });
    await checkRss(src(), deps);
    for (const bad of [ok("<rss><channel><item>", RSS_URL, "application/xml"), { kind: "network_error", message: "EPROTO", code: "EPROTO", tls: true } as const, { kind: "http_error", status: 500 } as const]) {
      f.pages[RSS_URL] = bad;
      expect((await checkRss(src(), deps)).ok).toBe(false);
    }
    f.pages[RSS_URL] = feed(item("鳥インフルエンザの発生", hit), OLD);
    expect((await checkRss(src(), deps)).ok).toBe(true);
    expect(await docsNow()).toHaveLength(1);
  });
});
