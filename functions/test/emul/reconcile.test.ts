// 国との突き合わせ（I-18）を、模擬環境の Firestore と Storage で確かめる。取得は偽物で、国のサイトへは出ない。メールは偽の送信の口で、実際には送らない。
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeReviewingCase } from "@hpai/shared/cases";
import type { DocumentKind, DocumentRecord, ReadResult, ReviewItem, SecondReadResult } from "@hpai/shared/read/types";
import type { Case, Source, WatchStatus } from "@hpai/shared/types";
import { bucket, db } from "../../src/admin";
import { loadGeoStore } from "../../src/geo/loadGeo";
import { enqueueReview, reviewAlertId } from "../../src/review/queue";
import type { WatchDeps } from "../../src/watch/deps";
import type { FetchOutcome } from "../../src/watch/politeFetch";
import { MAX_FACT_FETCHES, isWatchStale, reconcileAndNotify, runReconcile, stalledWatchItem } from "../../src/watch/reconcile";
import { watchFailingItem } from "../../src/watch/status";

const PROJECT = "demo-hpai";
const GEO_DIR = path.resolve(import.meta.dirname, "../../../data/geo");

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

// ── 作り物の国のページ ──

const PRESS = "https://www.maff.go.jp/j/press/";
const BASE = `${PRESS}syouan/douei/`;
const OTHER = `${PRESS}shokuhin/wasyoku/251031.html`; // 鳥インフルではない発表（一覧が別物でないことの印）

const html = (title: string, lines: string[], links: Array<[string, string]> = []) =>
  `<html><head><meta charset="utf-8"><title>${title}：農林水産省</title></head><body><main>${lines.map((l) => `<p>${l}</p>`).join("")}${links
    .map(([href, text]) => `<p><a href="${href}">${text}</a></p>`)
    .join("")}</main></body></html>`;

const ok = (body: string, url: string): FetchOutcome => ({
  kind: "ok",
  status: 200,
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body: Buffer.from(body),
  etag: null,
  lastModified: null,
  fetchedAt: "2026-01-15T12:00:00+09:00",
});

const titleConfirmed = (n: number, pref = "岡山県") => `${pref}における高病原性鳥インフルエンザの疑似患畜の確認（国内${n}例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について`;
const titleLift = (n: number, pref = "岡山県", muni = "津山市") => `${pref}${muni}で発生した高病原性鳥インフルエンザ（国内${n}例目）に係る移動制限の解除について`;

function confirmedPage(o: { n: number; date: string; pref?: string; muni?: string; head?: string }): string {
  const pref = o.pref ?? "岡山県";
  const muni = o.muni ?? "津山市";
  return html(titleConfirmed(o.n, pref), [
    titleConfirmed(o.n, pref),
    o.date,
    "農林水産省",
    `本日、${pref}${muni}の家きん農場において、家畜伝染病である高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内${o.n}例目）されました。`,
    "1.農場の概要",
    `所在地：${pref}${muni}`,
    `飼養状況：${o.head ?? "約43万羽（採卵鶏）"}`,
    "2.経緯",
  ]);
}

function liftPage(o: { n: number; date: string; pref?: string; muni?: string }): string {
  const pref = o.pref ?? "岡山県";
  const muni = o.muni ?? "津山市";
  return html(titleLift(o.n, pref, muni), [
    o.date,
    "農林水産省",
    `${pref}は、${muni}で確認された高病原性鳥インフルエンザ（今シーズン国内${o.n}例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、${o.date}（水曜日）午前0時をもって、当該移動制限を解除しました。`,
    "1.経緯及び今後の予定",
  ]);
}

/** 一覧のページ。発表のリンクと、鳥インフルではない発表を 1 本。 */
const listPage = (url: string, links: Array<[string, string]> = []) => ok(html("報道発表資料", [], [[OTHER, "和食月間について"], ...links]), url);

const NOW = new Date("2026-01-15T03:00:00Z"); // JST 12:00、今季は 2025
const LIST_URLS = [`${PRESS}index.html`, `${PRESS}arc/2510.html`, `${PRESS}arc/2511.html`, `${PRESS}arc/2512.html`];

let geo: WatchDeps["geo"];
beforeAll(async () => {
  geo = await loadGeoStore(GEO_DIR);
});

interface Opts {
  pages: Record<string, FetchOutcome>;
  now?: Date;
}
function harness(o: Opts) {
  const calls: string[] = [];
  const allowed: boolean[] = [];
  let now = o.now ?? NOW;
  const deps: WatchDeps = {
    geo,
    now: () => now,
    fetch: async (url, opts) => {
      calls.push(url);
      allowed.push(opts?.allowUrl?.(new URL(url)) === true && opts?.allowUrl?.(new URL("https://evil.example.com/")) === false);
      return o.pages[url] ?? { kind: "http_error", status: 404 };
    },
  };
  return { deps, calls, allowed, setNow: (d: Date) => (now = d) };
}

/** 一覧を 4 つとも出し、発表を新着の一覧に並べる。 */
function pagesWith(items: Array<{ url: string; title: string; body: string }>, extra: Record<string, FetchOutcome> = {}): Record<string, FetchOutcome> {
  const pages: Record<string, FetchOutcome> = {};
  for (const u of LIST_URLS) pages[u] = listPage(u, u === LIST_URLS[0] ? items.map((i) => [i.url, i.title] as [string, string]) : []);
  for (const i of items) pages[i.url] = ok(i.body, i.url);
  return { ...pages, ...extra };
}

const confirmedItem = (file: string, n: number, date: string, o: { muni?: string; pref?: string } = {}) => ({
  url: `${BASE}${file}.html`,
  title: titleConfirmed(n, o.pref),
  body: confirmedPage({ n, date, muni: o.muni, pref: o.pref }),
});
const liftItem = (file: string, n: number, date: string) => ({ url: `${BASE}${file}.html`, title: titleLift(n), body: liftPage({ n, date }) });

function aCase(o: Partial<Case>): Case {
  return {
    id: "33203-2025-12-20-1",
    season: 2025,
    nationalNo: 8,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: "09:00" } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://www.pref.okayama.jp/page/1.html"],
    updatedAt: "2025-12-20T10:00:00+09:00",
    ...o,
  };
}
const seedCase = (c: Case) => db.doc(`cases/${c.id}`).set(c);
const casesNow = async () => (await db.collection("cases").get()).docs.map((d) => d.data() as Case);
const queue = async () => (await db.collection("reviewQueue").get()).docs.map((d) => d.data() as ReviewItem);
const alertsOf = async (name: string) => (await queue()).filter((i) => i.kind === "alert" && i.alert === name);

describe("国にあって作品にない確定", () => {
  const item = confirmedItem("251220", 8, "令和7年12月20日");

  it("事例はすぐ国の情報で確定として載せ、取りこぼしの警告 national_missing は 4 時間の猶予の後に 1 件だけ入れる", async () => {
    const h = harness({ pages: pagesWith([item]) });
    const r = await runReconcile(h.deps);

    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ nationalNo: 8, muniCode: "33203", confirmState: "national", headCount: 430000, birdUse: "採卵鶏", stages: { confirmed: { date: "2025-12-20", time: null } } });
    expect(r).toMatchObject({ compared: true, appliedConfirmed: [8] });
    expect(await alertsOf("national_missing")).toHaveLength(0); // 猶予の間は警告しない

    h.setNow(new Date(NOW.getTime() + 4 * 3_600_000 - 1000)); // 3 時間 59 分 59 秒後
    await runReconcile(h.deps);
    expect(await alertsOf("national_missing")).toHaveLength(0);

    h.setNow(new Date(NOW.getTime() + 4 * 3_600_000));
    await runReconcile(h.deps);
    const alerts = await alertsOf("national_missing");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe(reviewAlertId("national_missing", "confirmed-2025-8"));
    expect(alerts[0]).toMatchObject({ prefCode: "33", caseId: "33203-2025-12-20-1", resolvedAt: null });

    h.setNow(new Date(NOW.getTime() + 10 * 3_600_000));
    await runReconcile(h.deps);
    expect(await casesNow()).toHaveLength(1);
    expect(await alertsOf("national_missing")).toHaveLength(1);
  });

  it("猶予の間に見回りが同じ発表を先に処理していれば（national-index.json に印）、警告しない", async () => {
    const h = harness({ pages: pagesWith([item]) });
    await runReconcile(h.deps);
    await bucket().file("state/maff/national-index.json").save(JSON.stringify({ processed: { [item.url]: "2025-12-21T12:30:00+09:00" } }), { contentType: "application/json", resumable: false });
    h.setNow(new Date(NOW.getTime() + 5 * 3_600_000));
    await runReconcile(h.deps);
    h.setNow(new Date(NOW.getTime() + 11 * 3_600_000));
    await runReconcile(h.deps);
    expect(await alertsOf("national_missing")).toHaveLength(0);
    expect(await casesNow()).toHaveLength(1);
  });

  it("見回りが処理済みの印を付けたのに事例がない異常は、静かに直さず猶予なしで警告する（載せ直しは行う）", async () => {
    await bucket().file("state/maff/national-index.json").save(JSON.stringify({ processed: { [item.url]: "2025-12-21T12:30:00+09:00" } }), { contentType: "application/json", resumable: false });
    const h = harness({ pages: pagesWith([item]) });
    await runReconcile(h.deps);
    expect(await casesNow()).toHaveLength(1);
    const alerts = await alertsOf("national_missing");
    expect(alerts).toHaveLength(1);
    expect((alerts[0] as { message: string }).message).toContain("処理済みの印");
    h.setNow(new Date(NOW.getTime() + 10 * 3_600_000));
    await runReconcile(h.deps);
    expect(await alertsOf("national_missing")).toHaveLength(1);
  });

  it("2 件目の追加が例外で落ちても、1 件目に載せた印（appliedAt）は保存され、猶予の後に警告が出る", async () => {
    const second = confirmedItem("251221", 9, "令和7年12月21日", { muni: "新見市" });
    const h = harness({ pages: pagesWith([item, second]) });
    // 2 回目の市町村の検索で落とす
    let reads = 0;
    const flaky = Object.create(geo, { index: { get: () => { reads += 1; if (reads === 2) throw new Error("geo exploded"); return geo.index; } } }) as WatchDeps["geo"];
    await expect(runReconcile({ ...h.deps, geo: flaky })).rejects.toBeInstanceOf(AggregateError);
    const saved = JSON.parse((await bucket().file("state/maff/national-facts.json").download())[0].toString("utf8")) as { entries: Record<string, { appliedAt?: string }> };
    expect(saved.entries[item.url]!.appliedAt).toBeDefined();
    expect((await casesNow()).map((c) => c.nationalNo)).toEqual([8]);

    h.setNow(new Date(NOW.getTime() + 4 * 3_600_000));
    await runReconcile(h.deps);
    const ids = (await alertsOf("national_missing")).map((a) => a.id);
    expect(ids).toContain(reviewAlertId("national_missing", "confirmed-2025-8"));
  });

  it("取得は農林水産省の外へ出ない（allowUrl を渡す）。見る一覧は 4 つ。2 回目は本文を取り直さない", async () => {
    const h = harness({ pages: pagesWith([item]) });
    await runReconcile(h.deps);
    expect(h.calls.filter((u) => LIST_URLS.includes(u))).toEqual(LIST_URLS);
    expect(h.calls).toContain(item.url);
    expect(h.allowed.every(Boolean)).toBe(true);
    const before = h.calls.filter((u) => u === item.url).length;
    await runReconcile(h.deps);
    expect(h.calls.filter((u) => u === item.url).length).toBe(before); // 控えた事実を使う
  });

  it("県の事例（番号なし）が同じ町にあれば、同じ事例に足す（id が変わらない）。国にない確定には数えない", async () => {
    await seedCase(aCase({ id: "33203-2025-12-20-1", nationalNo: null, stages: { confirmed: { date: "2025-12-20", time: "09:00" } } }));
    await runReconcile(harness({ pages: pagesWith([item]), now: new Date("2026-01-15T03:00:00Z") }).deps);
    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: "33203-2025-12-20-1", nationalNo: 8 });
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
  });

  it("否定された事例と食い違うときは、自動で直さず箱に回す（事例は否定のまま）", async () => {
    await seedCase(aCase({ negation: "negated", negatedAt: "2025-12-25T10:00:00+09:00" }));
    await runReconcile(harness({ pages: pagesWith([item]) }).deps);
    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ negation: "negated", confirmState: "auto" });
    const alerts = await alertsOf("national_missing");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ caseId: "33203-2025-12-20-1" });
  });

  it("市町村が地図の区画にない発表は、事例にせず national_missing だけを入れる（読み取りの文書にはしない）", async () => {
    const bad = confirmedItem("251221", 9, "令和7年12月21日", { muni: "存在しない市" });
    await runReconcile(harness({ pages: pagesWith([bad]) }).deps);
    expect(await casesNow()).toEqual([]);
    expect((await alertsOf("national_missing"))[0]).toMatchObject({ caseId: null });
    expect((await db.collection("documents").get()).size).toBe(0);
  });

  it("一覧の取得に 1 つでも失敗したら、国との比較は全部しない（載せない、国にない確定も数えない）", async () => {
    await seedCase(aCase({ id: "old-1", nationalNo: null, stages: { confirmed: { date: "2025-12-01", time: null } } }));
    const pages = pagesWith([item]);
    delete pages[LIST_URLS[2]!];
    const h = harness({ pages });
    const r = await runReconcile(h.deps);
    expect(r.compared).toBe(false);
    expect((await casesNow()).map((c) => c.id)).toEqual(["old-1"]);
    expect(await alertsOf("national_missing")).toHaveLength(0);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
    expect(h.calls).not.toContain(item.url); // 本文も取らない
  });

  it("200 でも発表のリンクが 1 本もない一覧は別物（メンテナンスなど）として、比べない", async () => {
    const pages = pagesWith([item]);
    pages[LIST_URLS[0]!] = ok(html("メンテナンス中", ["しばらくお待ちください"]), LIST_URLS[0]!);
    await seedCase(aCase({ nationalNo: null }));
    const r = await runReconcile(harness({ pages }).deps);
    expect(r.compared).toBe(false);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
  });
});

describe("作品にあって国にない確定", () => {
  const unrelated = confirmedItem("251022", 1, "令和7年10月22日", { pref: "北海道", muni: "白老町" });
  const pref = (url = "x") => aCase({ nationalNo: null, sourceUrls: [url], stages: { confirmed: { date: "2025-12-20", time: "09:00" } } });

  it("12/22 08:59 は返さず、09:00 で app_only_confirmed を 1 件だけ入れる。事例は消さない", async () => {
    await seedCase(pref());
    const pages = pagesWith([unrelated]);
    const h = harness({ pages, now: new Date("2025-12-22T08:59:00+09:00") });
    await runReconcile(h.deps);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);

    h.setNow(new Date("2025-12-22T09:00:00+09:00"));
    await runReconcile(h.deps);
    const alerts = await alertsOf("app_only_confirmed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe(reviewAlertId("app_only_confirmed", "33203-2025-12-20-1"));
    expect(alerts[0]).toMatchObject({ caseId: "33203-2025-12-20-1" });

    h.setNow(new Date("2026-01-15T03:00:00Z"));
    await runReconcile(h.deps);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(1);
    expect((await casesNow()).map((c) => c.id).sort()).toContain("33203-2025-12-20-1");
  });

  it("国の一覧に番号がある確定は、国にない確定ではない", async () => {
    await seedCase(aCase({ nationalNo: 8 }));
    await runReconcile(harness({ pages: pagesWith([confirmedItem("251220", 8, "令和7年12月20日")]) }).deps);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
  });

  it("読めない確定の発表は運営者に 1 回警告し、比較は続ける（読めた分と、題に番号があればその番号は国にあるとみなす）。毎回取り直さない", async () => {
    await seedCase(pref());
    const broken = { url: `${BASE}251230.html`, title: titleConfirmed(30), body: html(titleConfirmed(30), ["本日、家きん農場において確認されました。"]) };
    const h = harness({ pages: pagesWith([unrelated, broken]) });
    const r = await runReconcile(h.deps);
    expect(r.compared).toBe(true);
    expect(r.comparedAppOnly).toBe(true); // 黙って止まらない
    expect(await alertsOf("app_only_confirmed")).toHaveLength(1); // 読めた分の比較は続く
    const warned = (await alertsOf("national_missing")).filter((a) => (a as { message: string }).message.includes("国の発表を読めない"));
    expect(warned).toHaveLength(1);
    expect((warned[0] as { message: string }).message).toContain(broken.url);

    const before = h.calls.filter((u) => u === broken.url).length;
    await runReconcile(h.deps);
    expect(h.calls.filter((u) => u === broken.url).length).toBe(before);
    expect((await alertsOf("national_missing")).filter((a) => (a as { message: string }).message.includes("国の発表を読めない"))).toHaveLength(1);
  });

  it("読めない確定の発表の題に番号があれば、その番号の事例は国にない確定にならない", async () => {
    await seedCase(aCase({ nationalNo: 30 }));
    const broken = { url: `${BASE}251230.html`, title: titleConfirmed(30), body: html(titleConfirmed(30), ["本日、家きん農場において確認されました。"]) };
    await runReconcile(harness({ pages: pagesWith([broken]) }).deps);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
  });

  it("本文を取れない確定の発表は、取れるまでの間（3 回未満）は国にない確定を比べず、3 回失敗したら読めないものとして警告して比較を再開する", async () => {
    await seedCase(pref());
    const gone = { url: `${BASE}251230.html`, title: titleConfirmed(30), body: "" };
    const pages = pagesWith([unrelated, gone]);
    delete pages[gone.url];
    const h = harness({ pages });
    expect((await runReconcile(h.deps)).comparedAppOnly).toBe(false);
    expect((await runReconcile(h.deps)).comparedAppOnly).toBe(false);
    expect((await alertsOf("national_missing")).length).toBe(0);
    const r = await runReconcile(h.deps);
    expect(r.comparedAppOnly).toBe(true);
    expect((await alertsOf("national_missing")).filter((a) => (a as { message: string }).message.includes("国の発表を読めない"))).toHaveLength(1);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(1);
  });

  it("読めない解除の発表があっても、国にない確定の比較は続ける。解除の発表も 1 回警告して取り直さない", async () => {
    await seedCase(pref());
    const brokenLift = { url: `${BASE}260110.html`, title: titleLift(30), body: html(titleLift(30), ["解除しました。"]) };
    const h = harness({ pages: pagesWith([unrelated, brokenLift]) });
    const r = await runReconcile(h.deps);
    expect(r.comparedAppOnly).toBe(true);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(1);
    expect((await alertsOf("national_missing")).filter((a) => (a as { message: string }).message.includes("解除"))).toHaveLength(1);
    const before = h.calls.filter((u) => u === brokenLift.url).length;
    await runReconcile(h.deps);
    expect(h.calls.filter((u) => u === brokenLift.url).length).toBe(before);
  });

  it("本文の取得が上限を超える回は残りを次の回に回し、その回は国にない確定を比べない", async () => {
    await seedCase(pref());
    const items = Array.from({ length: MAX_FACT_FETCHES + 2 }, (_, i) => confirmedItem(`2601${String(i).padStart(2, "0")}`, 100 + i, "令和7年12月21日", { pref: "北海道", muni: "白老町" }));
    const h = harness({ pages: pagesWith(items) });
    const r = await runReconcile(h.deps);
    expect(r.factsFetched).toBe(MAX_FACT_FETCHES);
    expect(r.comparedAppOnly).toBe(false);
    expect(await alertsOf("app_only_confirmed")).toHaveLength(0);
  });
});

describe("解除の再適用", () => {
  it("事例ができる前に来た解除を、事例が揃った後に当て直す（movement_lifted が入る）", async () => {
    await seedCase(aCase({ nationalNo: 8, confirmState: "national", stages: { confirmed: { date: "2025-12-20", time: null } } }));
    const pages = pagesWith([confirmedItem("251220", 8, "令和7年12月20日"), liftItem("260113", 8, "令和8年1月13日")]);
    await runReconcile(harness({ pages }).deps);
    const c = (await casesNow())[0]!;
    expect(c.stages.movement_lifted).toEqual({ date: "2026-01-13", time: null });
    expect(c.stages.confirmed).toEqual({ date: "2025-12-20", time: null });
  });

  it("事例がまったくない解除は national_missing（I-02 と同じ id）にする。2 回目は増やさない", async () => {
    const pages = pagesWith([liftItem("260113", 20, "令和8年1月13日")]);
    const h = harness({ pages });
    await runReconcile(h.deps);
    await runReconcile(h.deps);
    expect(await casesNow()).toEqual([]);
    const alerts = await alertsOf("national_missing");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe(reviewAlertId("national_missing", "33-20-2026-01-13"));
  });

  it("複数の事例の解除（国内3例目、4例目）は、否定された事例を除いて当てる（否定のままの事例は変えない）", async () => {
    await seedCase(aCase({ id: "33203-2025-12-20-1", nationalNo: 8, negation: "negated", confirmState: "national", stages: { confirmed: { date: "2025-12-20", time: null } } }));
    await seedCase(aCase({ id: "33203-2025-12-21-1", nationalNo: 9, confirmState: "national", stages: { confirmed: { date: "2025-12-21", time: null } } }));
    const joint = {
      url: `${BASE}260113.html`,
      title: "岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目、9例目）に係る移動制限の解除について",
      body: liftPage({ n: 8, date: "令和8年1月13日" }).replaceAll("国内8例目", "国内8例目、9例目"),
    };
    await runReconcile(harness({ pages: pagesWith([joint]) }).deps);
    const byId = Object.fromEntries((await casesNow()).map((c) => [c.id, c]));
    expect(byId["33203-2025-12-21-1"]!.stages.movement_lifted).toEqual({ date: "2026-01-13", time: null });
    expect(byId["33203-2025-12-20-1"]!.stages.movement_lifted).toBeUndefined();
    expect(byId["33203-2025-12-20-1"]!.negation).toBe("negated");
  });

  it("前季に同じ番号・同じ市町村の事例があっても、今季に事例がない解除は前季に付けず national_missing にする", async () => {
    await seedCase(aCase({ id: "33203-2024-12-20-1", season: 2024, nationalNo: 8, confirmState: "national", stages: { confirmed: { date: "2024-12-20", time: null } } }));
    await runReconcile(harness({ pages: pagesWith([liftItem("260113", 8, "令和8年1月13日")]) }).deps);
    const prev = (await casesNow()).find((c) => c.season === 2024)!;
    expect(prev.stages.movement_lifted).toBeUndefined();
    const alerts = await alertsOf("national_missing");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe(reviewAlertId("national_missing", "33-8-2026-01-13"));
  });

  it("同じ番号でも県か市町村が違う今季の事例には当てない", async () => {
    await seedCase(aCase({ id: "13101-2025-12-20-1", nationalNo: 8, prefCode: "13", muniCode: "13101", muniName: "千代田区", confirmState: "national", stages: { confirmed: { date: "2025-12-20", time: null } } }));
    await runReconcile(harness({ pages: pagesWith([liftItem("260113", 8, "令和8年1月13日")]) }).deps);
    expect((await casesNow())[0]!.stages.movement_lifted).toBeUndefined();
    expect(await alertsOf("national_missing")).toHaveLength(1);
  });

  it("否定の発表がある（candidate）事例には自動で解除を足さない", async () => {
    await seedCase(aCase({ nationalNo: 8, negation: "candidate", confirmState: "national", stages: { confirmed: { date: "2025-12-20", time: null } } }));
    await runReconcile(harness({ pages: pagesWith([liftItem("260113", 8, "令和8年1月13日")]) }).deps);
    expect((await casesNow())[0]!.stages.movement_lifted).toBeUndefined();
    expect((await casesNow())[0]!.negation).toBe("candidate");
  });

  it("否定された事例には自動で解除を足さない", async () => {
    await seedCase(aCase({ nationalNo: 8, negation: "negated", confirmState: "national" }));
    await runReconcile(harness({ pages: pagesWith([liftItem("260113", 8, "令和8年1月13日")]) }).deps);
    expect((await casesNow())[0]!.stages.movement_lifted).toBeUndefined();
  });
});

describe("疑いのまま止まった事例", () => {
  it("疑いから 3 日で case_stalled を 1 件入れ、事例は消さない", async () => {
    await seedCase(aCase({ id: "s1", nationalNo: null, stages: { suspected: { date: "2026-01-12", time: "21:00" } } }));
    await seedCase(aCase({ id: "s2", nationalNo: null, stages: { suspected: { date: "2026-01-13", time: null } } })); // 2 日
    await seedCase(aCase({ id: "s3", nationalNo: 5, stages: { suspected: { date: "2026-01-01", time: null }, confirmed: { date: "2026-01-02", time: null } } })); // 進んでいる
    const h = harness({ pages: pagesWith([]) });
    await runReconcile(h.deps);
    await runReconcile(h.deps);
    const alerts = await alertsOf("case_stalled");
    expect(alerts.map((a) => (a as { caseId: string }).caseId)).toEqual(["s1"]);
    expect((await casesNow()).map((c) => c.id).sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("一覧が取得できない回でも行う", async () => {
    await seedCase(aCase({ id: "s1", nationalNo: null, stages: { suspected: { date: "2026-01-12", time: null } } }));
    const r = await runReconcile(harness({ pages: {} }).deps);
    expect(r.compared).toBe(false);
    expect(await alertsOf("case_stalled")).toHaveLength(1);
  });
});

describe("見回り全体が止まった場合", () => {
  const src = (prefCode: string, o: Partial<Source> = {}): Source => ({
    id: `s-${prefCode}`,
    prefCode,
    url: `https://www.pref.example.jp/${prefCode}`,
    kind: "pref_fixed",
    confirmedOn: "2026-11-03",
    note: null,
    group: 0,
    enabled: true,
    lastCheckedAt: null,
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 0,
    ...o,
  });
  const st = (prefCode: string, o: Partial<WatchStatus> = {}): WatchStatus => ({ prefCode, checkedAt: null, ok: true, lastOkAt: null, failingSince: null, ...o });
  const seed = async (sources: Source[], statuses: WatchStatus[]) => {
    for (const s of sources) await db.doc(`sources/${s.id}`).set(s);
    for (const s of statuses) await db.doc(`watchStatus/${s.prefCode}`).set(s);
  };

  it("isWatchStale: 24 時間より古い、null、読めない、未来は止まっている。ちょうど 24 時間は止まっていない", () => {
    expect(isWatchStale({ checkedAt: null }, NOW)).toBe(true);
    expect(isWatchStale({ checkedAt: "2026-01-14T11:59:59+09:00" }, NOW)).toBe(true);
    expect(isWatchStale({ checkedAt: "2026-01-14T12:00:00+09:00" }, NOW)).toBe(false);
    expect(isWatchStale({ checkedAt: "2026-01-15T11:00:00+09:00" }, NOW)).toBe(false);
    expect(isWatchStale({ checkedAt: "壊れた時刻" }, NOW)).toBe(true);
    expect(isWatchStale({ checkedAt: "2026-02-01T00:00:00+09:00" }, NOW)).toBe(true);
  });

  it("確認が古い県と、一度も確認がない県に watch_failing が入る。2 回目は増えない。新しい県と入口のない県は入らない", async () => {
    await seed(
      [src("33"), src("34"), src("35"), src("36", { enabled: false })],
      [st("33", { checkedAt: "2026-01-13T12:00:00+09:00", lastOkAt: "2026-01-13T12:00:00+09:00" }), st("34", { checkedAt: "2026-01-15T11:30:00+09:00" }), st("35", { checkedAt: null })],
    );
    const h = harness({ pages: pagesWith([]) });
    await runReconcile(h.deps);
    await runReconcile(h.deps);
    const ids = (await alertsOf("watch_failing")).map((a) => a.id).sort();
    expect(ids).toEqual([reviewAlertId("watch_failing", "33-20260113120000"), reviewAlertId("watch_failing", "35-none")].sort());
  });

  it("I-02 が入れた同じ失敗の項目と同じ id になり、2 度入らない", async () => {
    const failing = st("33", { ok: false, checkedAt: "2026-01-13T12:00:00+09:00", failingSince: "2026-01-12T12:00:00+09:00" });
    await seed([src("33")], [failing]);
    await enqueueReview(watchFailingItem(failing, new Date("2026-01-13T12:00:00+09:00"))!, new Date("2026-01-13T12:00:00+09:00"));
    await runReconcile(harness({ pages: pagesWith([]) }).deps);
    const alerts = await alertsOf("watch_failing");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toBe(watchFailingItem(failing, NOW)!.id);
  });

  it("stalledWatchItem の id は now に依らない（6 時間ごとに別の項目を作らない）", () => {
    const s = st("33", { checkedAt: "2026-01-13T12:00:00+09:00" });
    expect(stalledWatchItem(s, NOW).id).toBe(stalledWatchItem(s, new Date(NOW.getTime() + 6 * 3_600_000)).id);
    expect(stalledWatchItem(st("35"), NOW).id).toBe(stalledWatchItem(st("35"), new Date(NOW.getTime() + 6 * 3_600_000)).id);
  });
});

describe("reading の取り残し", () => {
  const rec = (id: string, o: Partial<DocumentRecord> = {}): DocumentRecord => ({
    id,
    sourceId: "s",
    prefCode: "33",
    url: `https://www.pref.okayama.jp/${id}.html`,
    title: "岡山県の鳥インフルエンザの発生について",
    contentType: "html",
    storagePath: `raw/${id}.html`,
    fetchedAt: "2026-01-15T11:00:00+09:00",
    fingerprint: "f".repeat(64),
    hasTextLayer: true,
    kind: null,
    readState: "reading",
    primary: null,
    second: null,
    verify: null,
    compare: null,
    caseId: null,
    error: null,
    ...o,
  });
  const readState = async (id: string) => ((await db.doc(`documents/${id}`).get()).data() as DocumentRecord).readState;

  it("30 分以上 reading の文書は、発生を示す語がなければ review_private で箱に入れ、公開の確認中は作らない。29 分は何もしない", async () => {
    await db.doc("documents/d1").set(rec("d1", { title: "岡山県の鳥インフルエンザ対策の周知について" }));
    await bucket().file("raw/d1.txt").save("防疫対策の周知です。", { resumable: false });
    await db.doc("documents/d2").set(rec("d2", { readState: "pending" }));
    await db.doc("documents/d3").set(rec("d3", { readState: "published" }));
    const real = Date.now();
    const h = harness({ pages: {}, now: new Date(real + 29 * 60_000) });
    await runReconcile(h.deps);
    expect(await readState("d1")).toBe("reading");
    expect(await queue()).toEqual([]);

    h.setNow(new Date(real + 31 * 60_000));
    const r = await runReconcile(h.deps);
    expect(r.stuckReading).toEqual(["d1"]);
    const doc = (await db.doc("documents/d1").get()).data() as DocumentRecord;
    expect(doc).toMatchObject({ readState: "review_private", error: "reading_stalled", reasons: ["reading_stalled"] });
    expect(await readState("d2")).toBe("pending");
    expect(await readState("d3")).toBe("published");
    const items = (await queue()).filter((i) => i.kind === "document");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "doc-d1", documentId: "d1", reasons: ["reading_stalled"], hasOutbreakWords: false, resolvedAt: null });
    expect(await casesNow()).toEqual([]);

    await runReconcile(h.deps); // 2 回目は増えない
    expect((await queue()).filter((i) => i.kind === "document")).toHaveLength(1);
  });

  it("題だけでなく本文に発生を示す語があっても、公開の確認中（rev-）を作り review_public にする", async () => {
    await db.doc("documents/d1").set(rec("d1", { title: "お知らせ" }));
    await bucket().file("raw/d1.txt").save("岡山県津山市の養鶏場で、簡易検査で陽性を確認しました。高病原性鳥インフルエンザの疑いがあります。", { resumable: false });
    const real = Date.now();
    const h = harness({ pages: {}, now: new Date(real + 31 * 60_000) });
    await runReconcile(h.deps);
    expect(await readState("d1")).toBe("review_public");
    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: "rev-d1", confirmState: "reviewing", prefCode: "33", muniCode: null });
    const items = (await queue()).filter((i) => i.kind === "document");
    expect(items[0]).toMatchObject({ id: "doc-d1", reasons: ["reading_stalled"], hasOutbreakWords: true });
    await runReconcile(h.deps);
    expect(await casesNow()).toHaveLength(1);
  });

  it("発生を示す語があっても県が分からない文書は、公開せず review_private にする（理由に pref_unknown）", async () => {
    await db.doc("documents/d1").set(rec("d1", { prefCode: null, title: "高病原性鳥インフルエンザの疑似患畜の確認について" }));
    const real = Date.now();
    await runReconcile(harness({ pages: {}, now: new Date(real + 31 * 60_000) }).deps);
    expect(await readState("d1")).toBe("review_private");
    expect(await casesNow()).toEqual([]);
    expect((await db.doc("documents/d1").get()).data()!.reasons).toContain("pref_unknown");
  });
});

describe("確認中の見直し（その県の家きんの発生でないものを人の確認から外す）", () => {
  const none = { value: null, quote: null };
  const primaryRead = (kind: DocumentKind, o: Partial<ReadResult> = {}): ReadResult => ({
    kind, kindQuote: null, multipleCases: false, prefecture: none, municipality: none, nationalNo: none, prefNo: none, birdUse: none, housing: none,
    headCount: none, negationBasis: none, primaryStage: null, primaryDate: null, primaryDateQuote: null, stageEvents: [], radiiKm: [], estimates: [], wildBirds: [], ...o,
  });
  const secondRead = (kind: DocumentKind, o: Partial<SecondReadResult> = {}): SecondReadResult => ({
    kind, multipleCases: false, prefecture: null, municipality: null, primaryStage: null, primaryDate: null, wildBirds: [], ...o,
  });
  // 県の常設ページに、他県の野鳥の知らせが足された形（作った文）。発生を示す語の判定は true
  const TEXT = [
    "A県B市で回収された死亡野鳥から、高病原性鳥インフルエンザウイルス（H5亜型）が検出されました。",
    "C県D市の死亡野鳥の簡易検査陽性の事例は、確定検査で陰性となりました。",
    "県内の家きんでの発生はありません。",
  ].join("\n");

  /** 読み取りが確認中にした状態を置く（文書、本文、公開なら rev-、箱の項目）。 */
  async function seedReviewing(id: string, o: { primary?: ReadResult | null; second?: SecondReadResult | null; text?: string | null; resolved?: boolean; readState?: DocumentRecord["readState"] } = {}) {
    const isPublic = (o.readState ?? "review_public") !== "review_private";
    const rec: DocumentRecord = {
      id, sourceId: "s", prefCode: "14", url: `https://www.pref.kanagawa.jp/${id}.html`, title: "高病原性鳥インフルエンザの発生状況", contentType: "html",
      storagePath: `raw/${id}.html`, fetchedAt: "2026-01-15T11:00:00+09:00", fingerprint: "f".repeat(64), hasTextLayer: true,
      kind: o.primary === undefined ? "wild_bird" : (o.primary?.kind ?? null), readState: o.readState ?? "review_public",
      primary: o.primary === undefined ? primaryRead("wild_bird") : o.primary, second: o.second === undefined ? secondRead("notice") : o.second,
      verify: null, compare: { match: false, mismatches: ["kind"] }, caseId: null, error: null, reasons: ["compare:kind", "auto_publish_off"],
    };
    await db.doc(`documents/${id}`).set(rec);
    const text = o.text === undefined ? TEXT : o.text;
    if (text !== null) await bucket().file(`raw/${id}.txt`).save(text, { resumable: false });
    if (isPublic) await db.doc(`cases/rev-${id}`).set(makeReviewingCase({ documentId: id, season: 2025, prefCode: "14", sourceUrl: rec.url }, NOW));
    await db.doc(`reviewQueue/doc-${id}`).set({
      id: `doc-${id}`, kind: "document", documentId: id, url: rec.url, prefCode: "14", title: rec.title, reasons: ["compare:kind", "auto_publish_off"], hasOutbreakWords: isPublic,
      createdAt: "2026-01-15T11:00:00+09:00", resolvedAt: o.resolved ? "2026-01-15T11:30:00+09:00" : null,
      ...(o.resolved ? { resolvedBy: "op", resolvedAction: "dismiss_alert" } : {}),
    });
  }
  const run = () => runReconcile(harness({ pages: {} }).deps);
  const caseIds = async () => (await casesNow()).map((c) => c.id).sort();
  const docOf = async (id: string) => (await db.doc(`documents/${id}`).get()).data() as DocumentRecord;
  const itemOf = async (id: string) => (await db.doc(`reviewQueue/doc-${id}`).get()).data() as Extract<ReviewItem, { kind: "document" }>;

  it("切: 二人とも家きんでない種類と読んだ札を外し、文書は非公開の確認中、箱の項目は「公開していない」にして理由を足す。2 回目は何もしない", async () => {
    await seedReviewing("d1");
    await seedReviewing("p1", { readState: "review_private" }); // もともと非公開は、切では触れない
    const r = await run();
    expect(r.notPoultry).toEqual({ discarded: [], lowered: ["d1"] });
    expect((await docOf("p1")).readState).toBe("review_private");
    expect((await itemOf("p1")).resolvedAt).toBeNull();
    expect(await caseIds()).toEqual([]);
    const doc = await docOf("d1");
    expect(doc.readState).toBe("review_private");
    expect(doc.reasons).toEqual(["compare:kind", "auto_publish_off", "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present"]);
    const item = await itemOf("d1");
    expect(item).toMatchObject({ hasOutbreakWords: false, resolvedAt: null });
    expect(item.reasons).toEqual(["compare:kind", "auto_publish_off", "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present"]);

    const again = await run();
    expect(again.notPoultry).toEqual({ discarded: [], lowered: [] });
    expect((await queue()).filter((i) => i.kind === "document" && i.resolvedAt === null)).toHaveLength(2);
  });

  it("入: 公開の札と非公開の確認中の両方を捨て、箱の項目は消さずに「自動で解決」の印と理由を付けて箱から出す。2 回目は何もしない", async () => {
    await db.doc("usage/settings").set({ autoPublishEnabled: true });
    await seedReviewing("d1");
    await seedReviewing("p1", { readState: "review_private" });
    await enqueueReview({ id: reviewAlertId("watch_failing", "14"), kind: "alert", alert: "watch_failing", prefCode: "14", caseId: null, message: "m" }, NOW);
    const r = await run();
    expect(r.notPoultry).toEqual({ discarded: ["d1", "p1"], lowered: [] });
    expect(await caseIds()).toEqual([]);
    for (const id of ["d1", "p1"]) {
      const doc = await docOf(id);
      expect(doc.readState).toBe("discarded");
      expect(doc.reasons).toEqual(["compare:kind", "auto_publish_off", "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present"]);
      const item = (await db.doc(`reviewQueue/doc-${id}`).get()).data()!;
      expect(item).toMatchObject({ resolvedBy: "system", resolvedAction: "auto_not_poultry_here", hasOutbreakWords: false });
      expect(typeof item.resolvedAt).toBe("string");
      expect(item.reasons).toContain("not_poultry_here");
    }
    // 箱に残るのは文書以外の項目だけ（運営者の画面とメールは resolvedAt が null のものだけを数える）
    expect((await queue()).filter((i) => i.resolvedAt === null).map((i) => i.kind)).toEqual(["alert"]);

    const again = await run();
    expect(again.notPoultry).toEqual({ discarded: [], lowered: [] });
  });

  it("入でも迷うものは触れない（読みが無い、家きんの種類と読んだ、本文を読めない、予算で読んでいない）", async () => {
    await db.doc("usage/settings").set({ autoPublishEnabled: true });
    await seedReviewing("noSecond", { second: null, readState: "review_private" });
    await seedReviewing("suspected", { second: secondRead("suspected", { primaryStage: "suspected" }) });
    await seedReviewing("noBody", { text: null, readState: "review_private" });
    await seedReviewing("budget", { primary: null, second: null, readState: "skipped_budget" });
    const r = await run();
    expect(r.notPoultry).toEqual({ discarded: [], lowered: [] });
    expect(await caseIds()).toEqual(["rev-budget", "rev-suspected"]);
    for (const id of ["noSecond", "suspected", "noBody", "budget"]) expect((await itemOf(id)).resolvedAt).toBeNull();
  });

  it("迷う札は外さない: 別の読み手が無い、家きんの種類と読んだ、否定と読んだ、本文を読めない、家きんの事例の語がある、箱の項目が解決済み、読みが無い", async () => {
    await seedReviewing("noSecond", { second: null });
    await seedReviewing("suspected", { second: secondRead("suspected", { primaryStage: "suspected" }) });
    await seedReviewing("negated", { primary: primaryRead("negated") });
    await seedReviewing("noBody", { text: null });
    await seedReviewing("farmWords", { text: `${TEXT}\nE市の養鶏場で簡易検査の陽性を確認しました。` });
    await seedReviewing("resolved", { resolved: true });
    await seedReviewing("noRead", { primary: null, second: null });
    const r = await run();
    expect(r.notPoultry).toEqual({ discarded: [], lowered: [] });
    expect(await caseIds()).toEqual(["rev-farmWords", "rev-negated", "rev-noBody", "rev-noRead", "rev-noSecond", "rev-resolved", "rev-suspected"]);
    for (const id of ["noSecond", "suspected", "negated", "noBody", "farmWords", "resolved", "noRead"]) {
      expect((await docOf(id)).readState).toBe("review_public");
      expect((await itemOf(id)).hasOutbreakWords).toBe(true);
    }
  });

  it("文書が公開の確認中でなくなっていれば（運営者が載せた、無関係とした）札にも文書にも触れない。本物の事例は見ない", async () => {
    await seedReviewing("d1", { readState: "discarded" });
    await db.doc("cases/14100-2025-12-20-1").set({ ...makeReviewingCase({ documentId: "x", season: 2025, prefCode: "14", sourceUrl: "u" }, NOW), id: "14100-2025-12-20-1", confirmState: "auto", muniCode: "14100", muniName: "横浜市" });
    const r = await run();
    expect(r.notPoultry).toEqual({ discarded: [], lowered: [] });
    expect(await caseIds()).toEqual(["14100-2025-12-20-1", "rev-d1"]);
    expect((await docOf("d1")).readState).toBe("discarded");
  });
});

describe("reconcileAndNotify: 最後に運営者へ 1 通", () => {
  const send = () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    let fail = false;
    return {
      sent,
      setFail: (v: boolean) => (fail = v),
      send: async (to: string, mail: { subject: string; text: string }) => {
        if (fail) throw new Error("smtp down");
        sent.push({ to, ...mail });
      },
    };
  };

  it("この回に増えた項目を 1 通にまとめて知らせる。2 回目は新しい項目がなければ送らない", async () => {
    const s = send();
    await seedCase(aCase({ id: "s1", nationalNo: null, stages: { suspected: { date: "2026-01-12", time: null } } })); // case_stalled が 1 件入る
    const h = harness({ pages: pagesWith([confirmedItem("251220", 8, "令和7年12月20日")]) });
    const notify = { send: s.send, to: "operator@example.com", appUrl: "http://127.0.0.1:5174", now: h.deps.now };
    await reconcileAndNotify(h.deps, notify);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.subject).toBe("運営者の確認が 1 件あります");
    expect(s.sent[0]!.text).toContain("http://127.0.0.1:5174/operator");
    await reconcileAndNotify(h.deps, notify);
    expect(s.sent).toHaveLength(1);
  });

  it("メールが失敗したら例外を投げ、lastNotifiedAt を進めない。箱に入れたものは残る", async () => {
    const s = send();
    s.setFail(true);
    await seedCase(aCase({ id: "s1", nationalNo: null, stages: { suspected: { date: "2026-01-12", time: null } } }));
    const h = harness({ pages: pagesWith([confirmedItem("251220", 8, "令和7年12月20日")]) });
    const notify = { send: s.send, to: "operator@example.com", appUrl: "http://127.0.0.1:5174", now: h.deps.now };
    await expect(reconcileAndNotify(h.deps, notify)).rejects.toThrow("smtp down");
    expect((await db.doc("usage/operatorNotice").get()).exists).toBe(false);
    expect(await alertsOf("case_stalled")).toHaveLength(1);
    s.setFail(false);
    await reconcileAndNotify(h.deps, notify);
    expect(s.sent).toHaveLength(1);
  });

  it("突き合わせの段が失敗しても、箱に入れたものは知らせてから、例外を投げる（lastNotifiedAt は進む）", async () => {
    const s = send();
    await db.doc("reviewQueue/alert-x").set({ id: "alert-x", kind: "alert", alert: "case_stalled", prefCode: "33", caseId: null, message: "m", createdAt: "2026-01-15T11:00:00+09:00", resolvedAt: null });
    const h = harness({ pages: {} });
    // 国の一覧の取得が例外で落ちる（比較の段が失敗する）
    const deps: WatchDeps = {
      ...h.deps,
      fetch: async () => {
        throw new Error("fetch exploded");
      },
    };
    const notify = { send: s.send, to: "operator@example.com", appUrl: "http://127.0.0.1:5174", now: h.deps.now };
    await expect(reconcileAndNotify(deps, notify)).rejects.toMatchObject({ errors: [expect.objectContaining({ message: "fetch exploded" })] });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.subject).toBe("運営者の確認が 1 件あります");
    expect(((await db.doc("usage/operatorNotice").get()).data() as { lastNotifiedAt: string }).lastNotifiedAt).toBe("2026-01-15T12:00:00+09:00");
  });
});
