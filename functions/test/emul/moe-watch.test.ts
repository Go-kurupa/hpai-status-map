// 環境省の野鳥の見回り（checkMoe）を、模擬環境の Firestore と Storage で確かめる（I-12）。取得は偽物で、環境省のサイトへは出ない。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentRecord } from "@hpai/shared/read/types";
import { bucket, db } from "../../src/admin";
import { sha256Hex } from "../../src/watch/extract";
import { checkMoe, type MoeState } from "../../src/watch/moe";
import { MAX_LINK_TRIES } from "../../src/watch/page";
import type { FetchOutcome } from "../../src/watch/politeFetch";
import { fake, ok, pdf, prefSource } from "../helpers/prefWatch";
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
const stateOf = async (id = "moe1"): Promise<MoeState> => JSON.parse((await bucket().file(`state/pages/${id}.json`).download())[0].toString("utf8")) as MoeState;
const stateExists = async (id = "moe1") => (await bucket().file(`state/pages/${id}.json`).exists())[0];

const H = "https://www.env.go.jp";
const ENTRANCE = `${H}/nature/dobutsu/bird_flu/`;
const SEASON_TITLE = "令和８（2026）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年10月30日現在）";
const PRESS_TITLE = (what: string) => `野鳥における高病原性鳥インフルエンザ発生状況について（${what}、宮城県栗原市）`;
const P1 = `${H}/press/111118_00083.html`;
const P2 = `${H}/press/111118_00070.html`;
const PDF1 = `${H}/content/000438579.pdf`;

const source = (o = {}) => prefSource({ id: "moe1", prefCode: null, url: ENTRANCE, kind: "moe", ...o });

/** 入口のページ。title は鳥インフルの語を持つ。 */
function entrance(links: Array<[string, string]>, title = "野鳥の鳥インフルエンザに関する情報 | 環境省", lines = ["高病原性鳥インフルエンザに関する情報"]): ReturnType<typeof ok> {
  const body = `<html><head><meta charset="utf-8"><title>${title}</title></head><body><main>${lines.map((l) => `<p>${l}</p>`).join("")}${links
    .map(([href, text]) => `<p><a href="${href}">${text}</a></p>`)
    .join("")}</main></body></html>`;
  return ok(body, ENTRANCE);
}
const pressPage = (url: string, title: string) => ok(`<html><head><meta charset="utf-8"><title>${title}</title></head><body><main><p>${title}</p><p>環境省は陽性の野鳥を確認しました。</p></main></body></html>`, url);

describe("今季の PDF", () => {
  it("指紋が変わったら文書が増え、同じなら増えない。prefCode は null、読み取り待ち", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1, "v1") });
    const r1 = await checkMoe(source(), deps);
    expect(r1.ok).toBe(true);
    expect(r1.fingerprint).toBe(sha256Hex(Buffer.from("%PDF-1.4 v1 (文字層なし)")));
    let docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ url: PDF1, title: SEASON_TITLE, contentType: "pdf", prefCode: null, sourceId: "moe1", readState: "pending", hasTextLayer: false, kind: null, caseId: null });

    await checkMoe(source(), deps); // 同じ
    expect(await docsNow()).toHaveLength(1);

    f.pages[PDF1] = pdf(PDF1, "v2"); // 更新（同じ URL で中身が変わった）
    const r3 = await checkMoe(source(), deps);
    expect(r3.fingerprint).toBe(sha256Hex(Buffer.from("%PDF-1.4 v2 (文字層なし)")));
    docs = await docsNow();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.url === PDF1)).toBe(true);
    expect(new Set(docs.map((d) => d.fingerprint)).size).toBe(2);
  });

  it("毎回取得する（入口は etag も lastModified も送らず、PDF は確認のたびに取る）", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1) });
    const src = source({ etag: 'W/"old"', lastModified: "Mon" });
    const r = await checkMoe(src, deps);
    await checkMoe(src, deps);
    expect(f.calls).toEqual([ENTRANCE, PDF1, ENTRANCE, PDF1]);
    for (const o of f.opts) {
      expect(o.etag ?? null).toBeNull();
      expect(o.lastModified ?? null).toBeNull();
    }
    expect(r).toMatchObject({ etag: null, lastModified: null });
  });

  it("URL が変わっても今季の題なら取る", async () => {
    const MOVED = `${H}/content/000999999.pdf`;
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1, "a"), [MOVED]: pdf(MOVED, "b") });
    await checkMoe(source(), deps);
    f.pages[ENTRANCE] = entrance([[MOVED, SEASON_TITLE]]);
    await checkMoe(source(), deps);
    expect((await docsNow()).map((d) => d.url).sort()).toEqual([PDF1, MOVED].sort());
  });

  it("前の季の PDF や、ほかの資料は取らない（要求 0 回）", async () => {
    const old = `${H}/content/000401155.pdf`;
    const guide = `${H}/content/900490557.pdf`;
    const { deps, f } = fake({
      [ENTRANCE]: entrance([
        [PDF1, SEASON_TITLE],
        [old, "2024-2025年シーズンのサーベイランスの結果・発生状況[PDF4.60MB]"],
        [guide, "「死亡した野鳥を見つけたら」 [PDF 447KB]"],
      ]),
      [PDF1]: pdf(PDF1),
    });
    await checkMoe(source(), deps);
    expect(f.calls).toEqual([ENTRANCE, PDF1]);
  });

  it("今季の PDF を一度も見ていない入口は ok にしない（未確認）。文書を作らず、基準も作らない", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[`${H}/content/000401155.pdf`, "2024-2025年シーズンのサーベイランスの結果・発生状況"]]) });
    const r = await checkMoe(source(), deps);
    expect(r).toEqual({ ok: false, etag: null, lastModified: null, fingerprint: null });
    expect(await docsNow()).toEqual([]);
    expect(f.calls).toEqual([ENTRANCE]);
    expect((await stateOf()).seasonPdf).toBeNull();
  });

  it("今季の PDF を取れたら、季と URL と時刻を基準に残す", async () => {
    const { deps } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1) });
    await checkMoe(source(), deps);
    expect((await stateOf()).seasonPdf).toEqual({ season: 2026, href: PDF1, seenAt: expect.stringMatching(/^2026-11-05T12:00:00\+09:00$/) });
  });

  it("一度見えた今季の PDF が入口から見つからなくなったら失敗。基準は上書きしない。戻れば成功に戻る", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1) });
    expect((await checkMoe(source(), deps)).ok).toBe(true);
    const before = (await stateOf()).seasonPdf;
    f.pages[ENTRANCE] = entrance([[`${H}/content/000999999.pdf`, "令和８年シーズンの野鳥の発生状況"]]); // 題の形が変わった
    f.now = new Date("2026-11-06T03:00:00Z");
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect((await stateOf()).seasonPdf).toEqual(before);
    expect(await docsNow()).toHaveLength(1);
    f.pages[ENTRANCE] = entrance([[PDF1, SEASON_TITLE]]);
    expect((await checkMoe(source(), deps)).ok).toBe(true);
  });

  it("見えた今季の PDF が取れなくなった（503）ときも基準は残る", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1) });
    await checkMoe(source(), deps);
    const before = (await stateOf()).seasonPdf;
    expect(before).not.toBeNull();
    f.pages[PDF1] = { kind: "http_error", status: 503 };
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect((await stateOf()).seasonPdf).toEqual(before);
  });

  it("季が替わると、前の季に見えた基準は今季の基準ではない（新しい季の PDF が出るまで未確認、出れば基準を替えて成功）", async () => {
    const old = `${H}/content/000300000.pdf`;
    const oldTitle = "令和７（2025）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年5月31日現在）";
    const { deps, f } = fake({ [ENTRANCE]: entrance([[old, oldTitle]]), [old]: pdf(old) }, new Date("2026-04-10T03:00:00Z"));
    expect((await checkMoe(source(), deps)).ok).toBe(true);
    expect((await stateOf()).seasonPdf).toMatchObject({ season: 2025, href: old });
    f.now = new Date("2026-06-10T03:00:00Z"); // 2026 季の初め。入口はまだ前の季のまま
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect((await stateOf()).seasonPdf).toMatchObject({ season: 2025 });
    f.pages[ENTRANCE] = entrance([[PDF1, SEASON_TITLE], [old, oldTitle]]);
    f.pages[PDF1] = pdf(PDF1);
    expect((await checkMoe(source(), deps)).ok).toBe(true);
    expect((await stateOf()).seasonPdf).toMatchObject({ season: 2026, href: PDF1 });
  });

  it("季が変わると前の季の題を選ばない（2026 年 4 月は 2025 季）", async () => {
    const old = `${H}/content/000300000.pdf`;
    const { deps, f } = fake(
      { [ENTRANCE]: entrance([[PDF1, SEASON_TITLE], [old, "令和７（2025）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年3月31日現在）"]]), [old]: pdf(old), [PDF1]: pdf(PDF1) },
      new Date("2026-04-10T03:00:00Z"),
    );
    await checkMoe(source(), deps);
    expect(f.calls).toEqual([ENTRANCE, old]);
  });
});

describe("報道発表（press）: 新しいものだけ", () => {
  it("初回は見つかった発表を文書にし、次回は取らない。足されたものだけ取る", async () => {
    const { deps, f } = fake({
      [ENTRANCE]: entrance([[PDF1, SEASON_TITLE], [P1, PRESS_TITLE("陰性確定")]]),
      [PDF1]: pdf(PDF1),
      [P1]: pressPage(P1, PRESS_TITLE("陰性確定")),
      [P2]: pressPage(P2, PRESS_TITLE("疑い事例")),
    });
    await checkMoe(source(), deps);
    expect((await docsNow()).map((d) => d.url).sort()).toEqual([PDF1, P1].sort());
    expect((await stateOf()).hrefs).toEqual([P1]);

    f.calls.length = 0;
    await checkMoe(source(), deps);
    expect(f.calls).toEqual([ENTRANCE, PDF1]); // 発表は取り直さない

    f.pages[ENTRANCE] = entrance([[PDF1, SEASON_TITLE], [P2, PRESS_TITLE("疑い事例")], [P1, PRESS_TITLE("陰性確定")]]);
    f.calls.length = 0;
    await checkMoe(source(), deps);
    expect(f.calls).toEqual([ENTRANCE, PDF1, P2]);
    const docs = await docsNow();
    expect(docs.filter((d) => d.contentType === "html").map((d) => d.url).sort()).toEqual([P1, P2].sort());
    expect(docs.filter((d) => d.contentType === "html").every((d) => d.prefCode === null && d.readState === "pending")).toBe(true);
    expect((await stateOf()).hrefs.sort()).toEqual([P1, P2].sort());
  });

  it("発表が取れなければ失敗にして印をつけない。次の確認でまた取る。3 回で諦める", async () => {
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE], [P1, PRESS_TITLE("陰性確定")]]), [PDF1]: pdf(PDF1) });
    for (let i = 1; i <= MAX_LINK_TRIES; i++) {
      expect((await checkMoe(source(), deps)).ok).toBe(false);
      expect((await stateOf()).hrefs).toEqual(i < MAX_LINK_TRIES ? [] : [P1]);
    }
    expect(f.calls.filter((u) => u === P1)).toHaveLength(MAX_LINK_TRIES);
    expect((await checkMoe(source(), deps)).ok).toBe(true); // 諦めた後は毎回は取りに行かない
    expect(f.calls.filter((u) => u === P1)).toHaveLength(MAX_LINK_TRIES);
    expect((await docsNow()).map((d) => d.url)).toEqual([PDF1]);
  });

  it("発表のところに別物（別のページへの転送、鳥インフルの語がない）が返ったら文書にせず、失敗にして印をつけない", async () => {
    const moved = ok("<html><head><title>環境省トップ</title></head><body><main><p>お知らせ</p><p>鳥インフルエンザ</p></main></body></html>", `${H}/`);
    const maint = ok("<html><head><title>メンテナンス中</title></head><body><main><p>しばらくお待ちください</p></main></body></html>", P2);
    const { deps } = fake({
      [ENTRANCE]: entrance([[PDF1, SEASON_TITLE], [P1, PRESS_TITLE("陰性確定")], [P2, PRESS_TITLE("疑い事例")]]),
      [PDF1]: pdf(PDF1),
      [P1]: moved,
      [P2]: maint,
    });
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect((await docsNow()).map((d) => d.url)).toEqual([PDF1]);
    expect((await stateOf()).hrefs).toEqual([]);
  });

  it("環境省の外のリンクは取得しない（要求 0 回）。見えるように失敗に数える", async () => {
    const OUT = "https://example.com/press/1.html";
    const { deps, f } = fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE], [OUT, PRESS_TITLE("陰性確定")]]), [PDF1]: pdf(PDF1) });
    const r = await checkMoe(source(), deps);
    expect(r.ok).toBe(false);
    expect(f.calls).not.toContain(OUT);
    expect(f.blocked).toEqual([OUT]);
  });
});

describe("失敗を「何もない」と見せない", () => {
  const setup = (over: Record<string, FetchOutcome> = {}) => fake({ [ENTRANCE]: entrance([[PDF1, SEASON_TITLE]]), [PDF1]: pdf(PDF1), ...over });

  it("入口が取れなければ失敗。何も変えない", async () => {
    const { deps } = fake({});
    const r = await checkMoe(source(), deps);
    expect(r).toEqual({ ok: false, etag: null, lastModified: null, fingerprint: null });
    expect(await docsNow()).toEqual([]);
    expect(await stateExists()).toBe(false);
  });
  it("今季の PDF が取れなければ失敗。文書も印も作らない", async () => {
    const { deps } = setup({ [PDF1]: { kind: "http_error", status: 503 } });
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect(await docsNow()).toEqual([]);
  });
  it("今季の PDF のところに HTML（メンテナンスなど）が返ったら失敗。文書にしない", async () => {
    const { deps } = setup({ [PDF1]: ok("<html><body>メンテナンス中</body></html>", PDF1, "text/html; charset=utf-8") });
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    expect(await docsNow()).toEqual([]);
  });
  it("入口が別のページへ転送された、または鳥インフルの語がない（200 でも別物）ときは失敗。文書も印も作らない", async () => {
    const moved = ok("<html><head><title>環境省トップ</title></head><body><main><p>お知らせ</p></main></body></html>", "https://www.env.go.jp/");
    const a = setup({ [ENTRANCE]: moved });
    expect((await checkMoe(source(), a.deps)).ok).toBe(false);
    const noWord = ok("<html><head><title>メンテナンス中</title></head><body><main><p>しばらくお待ちください</p></main></body></html>", ENTRANCE);
    const b = setup({ [ENTRANCE]: noWord });
    expect((await checkMoe(source(), b.deps)).ok).toBe(false);
    expect(await docsNow()).toEqual([]);
    expect(await stateExists()).toBe(false);
  });
  it("失敗のあと戻れば成功に戻り、文書ができる", async () => {
    const { deps, f } = setup({ [PDF1]: { kind: "http_error", status: 503 } });
    expect((await checkMoe(source(), deps)).ok).toBe(false);
    f.pages[PDF1] = pdf(PDF1);
    expect((await checkMoe(source(), deps)).ok).toBe(true);
    expect(await docsNow()).toHaveLength(1);
  });
  it("入口の取得は robots.txt の拒否や TLS の失敗も失敗に数える（回避しない）", async () => {
    const outcomes: FetchOutcome[] = [{ kind: "robots_denied" }, { kind: "network_error", message: "x", code: "EPROTO", tls: true }, { kind: "not_allowed", url: ENTRANCE }];
    for (const outcome of outcomes) {
      const { deps } = fake({ [ENTRANCE]: outcome });
      expect((await checkMoe(source(), deps)).ok).toBe(false);
    }
  });
});

// 実物の控え（data/private/fixtures/moe/、公開しない）。取得は scripts/fetch-moe-fixtures.ts
const FIX = path.resolve(import.meta.dirname, "../../../data/private/fixtures/moe");
describeFixture("環境省の実物の控え（入口と今季の PDF）", [path.join(FIX, "index.html"), path.join(FIX, "season.pdf")], () => {
  it("実物の入口と PDF で、今季の PDF が文字層つきの文書になり、2 回目は増えない", async () => {
    const { deps, f } = fake({
      [ENTRANCE]: ok(fs.readFileSync(path.join(FIX, "index.html")), ENTRANCE),
      [PDF1]: ok(fs.readFileSync(path.join(FIX, "season.pdf")), PDF1, "application/pdf"),
    });
    // 入口の実物にある発表 2 本（陰性確定、疑い事例）は、ここでは本文を作った短いページで返す
    f.pages[P1] = pressPage(P1, PRESS_TITLE("陰性確定"));
    f.pages[P2] = pressPage(P2, PRESS_TITLE("疑い事例"));
    const r = await checkMoe(source(), deps);
    expect(r.ok).toBe(true);
    const pdfDocs = (await docsNow()).filter((d) => d.contentType === "pdf");
    expect(pdfDocs).toHaveLength(1);
    expect(pdfDocs[0]).toMatchObject({ url: PDF1, hasTextLayer: true, prefCode: null, readState: "pending" });
    expect(pdfDocs[0]!.title).toContain("年シーズンの野鳥における鳥インフルエンザ発生状況");
    await checkMoe(source(), deps);
    expect((await docsNow()).filter((d) => d.contentType === "pdf")).toHaveLength(1);
  });
});
