// 国の報道発表の見回りを、模擬環境の Firestore と Storage で確かめる（I-01）。取得は偽物で、国のサイトへは出ない。
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentKind, DocumentRecord } from "@hpai/shared/read/types";
import { normalizeForMatch } from "@hpai/shared/text";
import type { Case, Source } from "@hpai/shared/types";
import { db, bucket } from "../../src/admin";
import { loadGeoStore } from "../../src/geo/loadGeo";
import type { MissingNote, ReviewNote, TickSink, WatchDeps } from "../../src/watch/deps";
import { applyNationalConfirmed, applyNationalLift, checkMaffPress, checkMaffSeason, maffHandlers } from "../../src/watch/maff";
import type { FetchOutcome } from "../../src/watch/politeFetch";
import { firestoreIo, runTick } from "../../src/watch/tick";

const PROJECT = "demo-hpai";
const GEO_DIR = path.resolve(import.meta.dirname, "../../../data/geo");

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

// ── 作り物の国のページ ──

const BASE = "https://www.maff.go.jp/j/press/syouan/douei/";
const INDEX_URL = "https://www.maff.go.jp/j/press/index.html";
const SEASON_URL = "https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html";

const html = (title: string, lines: string[], links: Array<[string, string]> = []) =>
  `<html><head><meta charset="utf-8"><title>${title}：農林水産省</title></head><body><main>${lines.map((l) => `<p>${l}</p>`).join("")}${links
    .map(([href, text]) => `<p><a href="${href}">${text}</a></p>`)
    .join("")}</main></body></html>`;

const T_CONFIRMED = "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について";
const T_LIFT = "岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目）に係る移動制限の解除について";

function confirmedPage(o: { date?: string; place?: string; head?: string; no?: number; pref?: string; muni?: string } = {}): string {
  const pref = o.pref ?? "岡山県";
  const muni = o.muni ?? "津山市";
  return html(T_CONFIRMED, [
    T_CONFIRMED,
    o.date ?? "令和7年12月20日",
    "農林水産省",
    `本日、${pref}${muni}の家きん農場において、家畜伝染病である高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内${o.no ?? 8}例目）されました。`,
    "1.農場の概要",
    `所在地：${o.place ?? `${pref}${muni}`}`,
    `飼養状況：${o.head ?? "約43万羽（採卵鶏）"}`,
    "2.経緯",
    "（1）令和7年12月19日（金曜日）、岡山県は、同県津山市の農場から、通報を受けて、農場への立入検査を実施しました。",
  ]);
}

function liftPage(): string {
  return html(T_LIFT, [
    "令和8年1月21日",
    "農林水産省",
    "岡山県は、津山市で確認された高病原性鳥インフルエンザ（今シーズン国内8例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年1月21日（水曜日）午前0時（1月20日（火曜日）24時）をもって、当該移動制限を解除しました。",
    "1.経緯及び今後の予定",
    "（1）岡山県は、令和7年12月20日に津山市の家きん農場において高病原性鳥インフルエンザ（今シーズン国内8例目）が発生したことを受け、設定しました。",
    "（2）岡山県は、令和8年1月10日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。",
    "（3）今般、岡山県は、国内8例目の防疫措置が完了した令和7年12月30日の翌日から起算して21日が経過する令和8年1月21日（水曜日）午前0時をもって、移動制限を解除しました。",
  ]);
}

function lift34Page(): string {
  return html("胎内市の解除", [
    "令和7年12月10日",
    "農林水産省",
    "新潟県は、胎内市で確認された高病原性鳥インフルエンザ（今シーズン国内3例目、4例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和7年12月10日（水曜日）午前0時（12月9日（火曜日）24時）をもって、当該移動制限を解除しました。",
    "1.経緯及び今後の予定",
    "（1）新潟県は、令和7年11月4日および令和7年11月9日に胎内市の家きん農場において高病原性鳥インフルエンザ（今シーズン国内3例目、4例目）が発生したことを受け、設定しました。",
    "（2）新潟県は、令和7年11月30日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。",
  ]);
}

function ok(body: string, url: string): FetchOutcome {
  return { kind: "ok", status: 200, finalUrl: url, contentType: "text/html; charset=utf-8", body: Buffer.from(body), etag: 'W/"1"', lastModified: "Tue, 05 Nov 2026 00:00:00 GMT", fetchedAt: "2025-12-21T12:00:00+09:00" };
}

// ── 偽の取得と時計 ──

const NOW = new Date("2025-12-21T03:00:00Z"); // JST 12:00 → group 0
let geo: WatchDeps["geo"];
beforeAll(async () => {
  geo = await loadGeoStore(GEO_DIR);
});

function makeDeps(pages: Record<string, FetchOutcome>, calls: string[] = []): WatchDeps {
  return {
    geo,
    now: () => NOW,
    fetch: async (url) => {
      calls.push(url);
      return pages[url] ?? { kind: "http_error", status: 404 };
    },
  };
}

const sink = (): TickSink => ({ reviews: [], missing: [] });

function pressSource(o: Partial<Source> = {}): Source {
  return {
    id: "press",
    prefCode: null,
    url: INDEX_URL,
    kind: "maff_press",
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
  };
}

function aCase(o: Partial<Case>): Case {
  return {
    id: "33203-2025-12-19-1",
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { suspected: { date: "2025-12-19", time: "21:00" } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://www.pref.okayama.jp/page/1.html"],
    updatedAt: "2025-12-19T22:00:00+09:00",
    ...o,
  };
}

const casesNow = async () => (await db.collection("cases").get()).docs.map((d) => d.data() as Case);
const docsNow = async () => (await db.collection("documents").get()).docs.map((d) => d.data() as DocumentRecord);
const text = async (p: string) => (await bucket().file(p).download())[0].toString("utf8");

describe("確定の発表（疑似患畜の確認）", () => {
  const item = `${BASE}251220.html`;
  const indexPage = (extra: Array<[string, string]> = []) =>
    ok(html("報道発表資料", [], [[item, T_CONFIRMED], ...extra]), INDEX_URL);

  it("national の事例と published の文書ができ、Claude に渡さない（pending ではない）", async () => {
    const deps = makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(confirmedPage(), item) });
    const result = await checkMaffPress(pressSource(), deps, sink());
    expect(result.ok).toBe(true);

    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: "33203-2025-12-20-1",
      season: 2025,
      nationalNo: 8,
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      headCount: 430000,
      birdUse: "採卵鶏",
      confirmState: "national",
      stages: { confirmed: { date: "2025-12-20", time: null } },
      negation: "none",
      sourceUrls: [item],
    });

    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    const d = docs[0]!;
    expect(d).toMatchObject({ sourceId: "press", prefCode: "33", url: item, contentType: "html", readState: "published", kind: "confirmed" as DocumentKind, caseId: "33203-2025-12-20-1", primary: null, second: null, error: null });
    expect(d.id).toMatch(/^[0-9a-f]{24}_[0-9a-f]{12}$/);
    expect(d.fingerprint.startsWith(d.id.split("_")[1]!)).toBe(true);
    expect(d.storagePath).toBe(`raw/${d.id}.html`);
    // 原本と、読み取りに渡す本文
    expect((await bucket().file(`raw/${d.id}.html`).exists())[0]).toBe(true);
    expect(await text(`raw/${d.id}.txt`)).toContain("津山市");
  });

  it("定型が読めない本文は pending で文書だけ作り、事例は作らない（読み取りの箱の候補になる）", async () => {
    const broken = html(T_CONFIRMED, [T_CONFIRMED, "令和7年12月20日", "農林水産省", "本日、家きん農場において、高病原性鳥インフルエンザの疑似患畜が確認されました。"]);
    const s = sink();
    const deps = makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(broken, item) });
    expect((await checkMaffPress(pressSource(), deps, s)).ok).toBe(true);
    expect(await casesNow()).toEqual([]);
    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ readState: "pending", caseId: null });
    expect(s.reviews).toEqual<ReviewNote[]>([{ url: item, title: T_CONFIRMED, prefCode: null, reason: "unreadable", documentId: docs[0]!.id }]);
  });

  it("同じ発表を 2 回見ても、事例も文書も 1 つ。事例は書き直さない", async () => {
    const calls: string[] = [];
    const deps = makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(confirmedPage(), item) }, calls);
    await checkMaffPress(pressSource(), deps, sink());
    const first = (await casesNow())[0]!;
    // 2 回目: 処理済みの印があるので、発表のページは取らない
    await checkMaffPress(pressSource(), deps, sink());
    expect(calls.filter((u) => u === item)).toHaveLength(1);
    // 印を消して 3 回目: 取り直しても同じ事例、同じ文書。事例の updatedAt も変わらない
    await bucket().file("state/maff/national-index.json").delete();
    const later: WatchDeps = { ...makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(confirmedPage(), item) }, calls), now: () => new Date("2025-12-22T03:00:00Z") };
    await checkMaffPress(pressSource(), later, sink());
    expect(calls.filter((u) => u === item)).toHaveLength(2);
    const cases = await casesNow();
    expect(cases).toEqual([first]);
    expect(await docsNow()).toHaveLength(1);
  });

  it("県の疑いの事例があれば、同じ事例に足され id が変わらない", async () => {
    const suspected = aCase({});
    await db.doc(`cases/${suspected.id}`).set(suspected);
    const deps = makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(confirmedPage(), item) });
    await checkMaffPress(pressSource(), deps, sink());
    const cases = await casesNow();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: "33203-2025-12-19-1",
      nationalNo: 8,
      headCount: 430000,
      birdUse: "採卵鶏",
      confirmState: "national",
      stages: { suspected: { date: "2025-12-19", time: "21:00" }, confirmed: { date: "2025-12-20", time: null } },
    });
    expect(cases[0]!.sourceUrls).toEqual(["https://www.pref.okayama.jp/page/1.html", item]);
    expect((await docsNow())[0]!.caseId).toBe("33203-2025-12-19-1");
  });

  it("学校の臨時休業と遺伝子解析の題は取得しない", async () => {
    const calls: string[] = [];
    const school = `${BASE}251221.html`;
    const genetic = `${BASE}251224_1.html`;
    const deps = makeDeps(
      {
        [INDEX_URL]: indexPage([
          [school, "インフルエンザ様疾患による学校の臨時休業について（第23報）"],
          [genetic, "岡山県で確認された高病原性鳥インフルエンザの疑似患畜（国内8例目）の遺伝子解析及びNA亜型の確定について"],
        ]),
        [item]: ok(confirmedPage(), item),
      },
      calls,
    );
    await checkMaffPress(pressSource(), deps, sink());
    expect(calls.sort()).toEqual([INDEX_URL, item].sort());
  });

  it("入口の取得に etag と lastModified を送る。not_modified なら何もしない", async () => {
    let seen: { etag?: string | null; lastModified?: string | null } | undefined;
    const deps: WatchDeps = {
      geo,
      now: () => NOW,
      fetch: async (_url, opts) => {
        seen = opts;
        return { kind: "not_modified" };
      },
    };
    const r = await checkMaffPress(pressSource({ etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" }), deps, sink());
    expect(seen).toMatchObject({ etag: 'W/"1"', lastModified: "Mon" });
    expect(r).toEqual({ ok: true, etag: 'W/"1"', lastModified: "Mon", fingerprint: "ff" });
    expect(await docsNow()).toEqual([]);
  });

  it("発表のページの取得に失敗したら、入口は失敗（ok:false）にして印をつけない。次の巡回でやり直す", async () => {
    const s = sink();
    const failing = makeDeps({ [INDEX_URL]: indexPage() }); // item は 404
    expect((await checkMaffPress(pressSource(), failing, s)).ok).toBe(false);
    expect(await docsNow()).toEqual([]);
    const retry = makeDeps({ [INDEX_URL]: indexPage(), [item]: ok(confirmedPage(), item) });
    expect((await checkMaffPress(pressSource(), retry, sink())).ok).toBe(true);
    expect(await casesNow()).toHaveLength(1);
  });
});

describe("applyNationalConfirmed", () => {
  const parsed = { prefCode: "33", muniName: "津山市", nationalNo: 8, date: "2025-12-20" };
  const farm = { headCount: 430000, birdUse: "採卵鶏" };
  const url = `${BASE}251220.html`;

  it("新しい事例は created、同じ発表をもう一度は merged", async () => {
    const deps = makeDeps({});
    expect(await applyNationalConfirmed({ parsed, farm, url }, deps)).toEqual({ caseId: "33203-2025-12-20-1", outcome: "created" });
    expect(await applyNationalConfirmed({ parsed, farm, url }, deps)).toEqual({ caseId: "33203-2025-12-20-1", outcome: "merged" });
    expect(await casesNow()).toHaveLength(1);
  });

  it("市町村が N03 にないときは事例を作らず review（muni_not_found）", async () => {
    const r = await applyNationalConfirmed({ parsed: { ...parsed, muniName: "架空町" }, farm, url }, makeDeps({}));
    expect(r).toEqual({ caseId: null, outcome: "review", reason: "muni_not_found" });
    expect(await casesNow()).toEqual([]);
  });

  it("候補が 2 件以上で決められないときは review（ambiguous_case）で、事例を作らない", async () => {
    await db.doc("cases/33203-2025-12-18-1").set(aCase({ id: "33203-2025-12-18-1", stages: { confirmed: { date: "2025-12-18", time: null } } }));
    await db.doc("cases/33203-2025-12-19-1").set(aCase({ id: "33203-2025-12-19-1", stages: { suspected: { date: "2025-12-19", time: null } } }));
    const r = await applyNationalConfirmed({ parsed, farm, url }, makeDeps({}));
    expect(r).toEqual({ caseId: null, outcome: "review", reason: "ambiguous_case" });
    expect(await casesNow()).toHaveLength(2);
  });

  it("同じ N の事例が別の市町村にあるときは review（number_conflict）で、重複を作らない", async () => {
    await db.doc("cases/33202-2025-12-20-1").set(aCase({ id: "33202-2025-12-20-1", muniCode: "33202", muniName: "玉野市", nationalNo: 8, stages: { confirmed: { date: "2025-12-20", time: null } } }));
    const r = await applyNationalConfirmed({ parsed, farm, url }, makeDeps({}));
    expect(r).toEqual({ caseId: null, outcome: "review", reason: "number_conflict" });
    expect(await casesNow()).toHaveLength(1);
  });

  it("同じ市町村、同じ日に別の事例があれば、連番を進める（1 つ目の id を上書きしない）", async () => {
    // 国内7例目が同じ日に同じ市町村で先に登録されている
    await db.doc("cases/33203-2025-12-20-1").set(aCase({ id: "33203-2025-12-20-1", nationalNo: 7, stages: { confirmed: { date: "2025-12-20", time: null } }, confirmState: "national" }));
    const r = await applyNationalConfirmed({ parsed, farm, url }, makeDeps({}));
    expect(r).toEqual({ caseId: "33203-2025-12-20-2", outcome: "created" });
    expect(await casesNow()).toHaveLength(2);
  });

  it("県の資料に金ヶ崎町、国の発表が金ケ崎町でも同じ市町村と判定する", async () => {
    const r = await applyNationalConfirmed({ parsed: { prefCode: "03", muniName: "金ケ崎町", nationalNo: 20, date: "2026-02-21" }, farm: { headCount: 560000, birdUse: "採卵鶏" }, url }, makeDeps({}));
    expect(r.outcome).toBe("created");
    const c = (await casesNow())[0]!;
    expect(c.muniCode).toBe("03381");
    expect(c.muniName).toBe(geo.index["03381"]!.name); // 事例の名前は N03 の表記
    expect(normalizeForMatch(c.muniName!)).toBe(normalizeForMatch("金ヶ崎町"));
  });
});

describe("applyNationalLift（移動制限の解除）", () => {
  const confirmedCase = (o: Partial<Case>): Case =>
    aCase({ confirmState: "national", ...o, stages: { confirmed: { date: "2025-12-20", time: null }, ...(o.stages ?? {}) } });

  it("1 本の解除が 3 例目と 4 例目の両方に movement_lifted を付ける", async () => {
    await db.doc("cases/15227-2025-11-04-1").set(confirmedCase({ id: "15227-2025-11-04-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 3, stages: { confirmed: { date: "2025-11-04", time: null } } }));
    await db.doc("cases/15227-2025-11-09-1").set(confirmedCase({ id: "15227-2025-11-09-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 4, stages: { confirmed: { date: "2025-11-09", time: null } } }));
    const lift = { prefCode: "15", muniName: "胎内市", nationalNos: [3, 4], date: "2025-12-10", controlDone: null, shipmentLifted: null };
    const r = await applyNationalLift({ lift, url: `${BASE}251210.html` }, makeDeps({}));
    expect(r).toEqual({ caseIds: ["15227-2025-11-04-1", "15227-2025-11-09-1"], missing: [] });
    for (const c of await casesNow()) expect(c.stages.movement_lifted).toEqual({ date: "2025-12-10", time: null });
  });

  it("完了日と搬出制限の解除日は空欄だけ埋め、すでにある日付は変えない", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(
      confirmedCase({ id: "33203-2025-12-20-1", nationalNo: 8, stages: { control_done: { date: "2025-12-29", time: null } } }),
    );
    const lift = { prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21", controlDone: "2025-12-30", shipmentLifted: "2026-01-10" };
    await applyNationalLift({ lift, url: `${BASE}260121_1.html` }, makeDeps({}));
    const c = (await casesNow())[0]!;
    expect(c.stages.control_done).toEqual({ date: "2025-12-29", time: null }); // 県が先に書いた日付を保つ
    expect(c.stages.shipment_lifted).toEqual({ date: "2026-01-10", time: null });
    expect(c.stages.movement_lifted).toEqual({ date: "2026-01-21", time: null });
    expect(c.sourceUrls).toContain(`${BASE}260121_1.html`);
  });

  it("解除に対応する事例がなければ missing で、事例を作らない。同じ N でも市町村が違えば対応づけない", async () => {
    const lift = { prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21", controlDone: null, shipmentLifted: null };
    expect(await applyNationalLift({ lift, url: `${BASE}260121_1.html` }, makeDeps({}))).toEqual({ caseIds: [], missing: [8] });
    expect(await casesNow()).toEqual([]);
    await db.doc("cases/33202-2025-12-20-1").set(confirmedCase({ id: "33202-2025-12-20-1", muniCode: "33202", muniName: "玉野市", nationalNo: 8 }));
    expect(await applyNationalLift({ lift, url: `${BASE}260121_1.html` }, makeDeps({}))).toEqual({ caseIds: [], missing: [8] });
    expect((await casesNow())[0]!.stages.movement_lifted).toBeUndefined();
  });

  it("もう一度同じ解除を見ても、事例を書き直さない（updatedAt が変わらない）", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(confirmedCase({ id: "33203-2025-12-20-1", nationalNo: 8 }));
    const lift = { prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21", controlDone: null, shipmentLifted: null };
    await applyNationalLift({ lift, url: `${BASE}260121_1.html` }, makeDeps({}));
    const first = (await casesNow())[0]!;
    await applyNationalLift({ lift, url: `${BASE}260121_1.html` }, { ...makeDeps({}), now: () => new Date("2026-01-22T00:00:00Z") });
    expect((await casesNow())[0]).toEqual(first);
  });
});

describe("解除の発表を見回りで読む", () => {
  const item = `${BASE}260121_1.html`;
  const index = ok(html("報道発表資料", [], [[item, T_LIFT]]), INDEX_URL);

  it("対応する事例があれば文書は published・zone_lifted、事例の id を持つ", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(aCase({ id: "33203-2025-12-20-1", nationalNo: 8, confirmState: "national", stages: { confirmed: { date: "2025-12-20", time: null } } }));
    await checkMaffPress(pressSource(), makeDeps({ [INDEX_URL]: index, [item]: ok(liftPage(), item) }), sink());
    expect((await docsNow())[0]).toMatchObject({ readState: "published", kind: "zone_lifted", caseId: "33203-2025-12-20-1" });
    expect((await casesNow())[0]!.stages.movement_lifted).toEqual({ date: "2026-01-21", time: null });
  });

  it("[3,4] の解除の文書は、小さい番号の事例の id を持つ", async () => {
    const i34 = `${BASE}251210.html`;
    await db.doc("cases/15227-2025-11-09-1").set(aCase({ id: "15227-2025-11-09-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 4, stages: { confirmed: { date: "2025-11-09", time: null } } }));
    await db.doc("cases/15227-2025-11-04-1").set(aCase({ id: "15227-2025-11-04-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 3, stages: { confirmed: { date: "2025-11-04", time: null } } }));
    const idx = ok(html("報道発表資料", [], [[i34, "新潟県胎内市で発生した高病原性鳥インフルエンザ（国内3例目、4例目）に係る移動制限の解除について"]]), INDEX_URL);
    await checkMaffPress(pressSource(), makeDeps({ [INDEX_URL]: idx, [i34]: ok(lift34Page(), i34) }), sink());
    expect((await docsNow())[0]!.caseId).toBe("15227-2025-11-04-1");
  });

  it("対応する事例がなければ事例を作らず、文書は review_private で残し（捨てない）、tick の結果に missing を返す", async () => {
    const s = sink();
    await checkMaffPress(pressSource(), makeDeps({ [INDEX_URL]: index, [item]: ok(liftPage(), item) }), s);
    expect(await casesNow()).toEqual([]);
    expect((await docsNow())[0]).toMatchObject({ readState: "review_private", kind: "zone_lifted", caseId: null });
    expect(s.missing).toEqual<MissingNote[]>([{ url: item, prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21" }]);
  });
});

describe("今季ページの指紋が変わった tick", () => {
  it("報道発表を前倒しで確認し、今季ページからは文書を作らない", async () => {
    const season: Source = pressSource({ id: "season", url: SEASON_URL, kind: "maff_season", group: 0, fingerprint: "古い指紋" });
    const press: Source = pressSource({ id: "press", group: 1 });
    await db.doc("sources/season").set(season);
    await db.doc("sources/press").set(press);
    const item = `${BASE}251220.html`;
    const calls: string[] = [];
    const deps = makeDeps(
      {
        [SEASON_URL]: ok(html("令和8年度 鳥インフルエンザに関する情報", ["新しい発生の情報"]), SEASON_URL),
        [INDEX_URL]: ok(html("報道発表資料", [], [[item, T_CONFIRMED]]), INDEX_URL),
        [item]: ok(confirmedPage(), item),
      },
      calls,
    );
    const report = await runTick(deps, firestoreIo(), maffHandlers);
    expect(report.early).toEqual(["press"]);
    expect(calls).toEqual([SEASON_URL, INDEX_URL, item]);
    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.url).toBe(item); // 今季ページの文書はない
    const savedSeason = (await db.doc("sources/season").get()).data() as Source;
    expect(savedSeason).toMatchObject({ failureCount: 0, etag: 'W/"1"' });
    expect(savedSeason.fingerprint).not.toBeNull();
    expect(savedSeason.fingerprint).not.toBe("古い指紋");
    expect(((await db.doc("sources/press").get()).data() as Source).lastOkAt).not.toBeNull();
  });
});


// ── I-01 レビュー 1 の指摘（Important 1〜4）──

describe("200 で中身が別物の国のページは失敗にする（Important 1）", () => {
  it("報道発表の一覧に報道発表のリンクが 1 本もない（メンテナンスなど）なら ok:false。etag と指紋を更新しない", async () => {
    const maint = ok(html("ただいまメンテナンス中です", ["しばらくお待ちください"], [["https://www.maff.go.jp/", "トップへ"]]), INDEX_URL);
    const r = await checkMaffPress(pressSource({ etag: 'W/"old"', fingerprint: "old" }), makeDeps({ [INDEX_URL]: maint }), sink());
    expect(r).toEqual({ ok: false, etag: null, lastModified: null, fingerprint: null });
    expect(await docsNow()).toEqual([]);
  });
  it("確認と解除の発表が 1 本もない平穏な週でも、報道発表のリンクがあれば ok:true", async () => {
    const quiet = ok(html("報道発表資料", [], [[`${BASE}251221.html`, "インフルエンザ様疾患による学校の臨時休業について（第23報）"]]), INDEX_URL);
    expect((await checkMaffPress(pressSource(), makeDeps({ [INDEX_URL]: quiet }), sink())).ok).toBe(true);
  });
  it("今季ページに鳥インフルの語がない、または別のページへ転送された（finalUrl が違う）なら ok:false", async () => {
    const season = pressSource({ id: "season", url: SEASON_URL, kind: "maff_season", fingerprint: "old" });
    const blank = ok(html("ただいまメンテナンス中です", ["しばらくお待ちください"]), SEASON_URL);
    expect((await checkMaffSeason(season, makeDeps({ [SEASON_URL]: blank }))).ok).toBe(false);
    const moved = ok(html("令和8年度 鳥インフルエンザに関する情報", ["新しい発生の情報"]), "https://www.maff.go.jp/index.html");
    expect((await checkMaffSeason(season, makeDeps({ [SEASON_URL]: moved }))).ok).toBe(false);
    const good = ok(html("令和8年度 鳥インフルエンザに関する情報", ["新しい発生の情報"]), SEASON_URL);
    expect((await checkMaffSeason(season, makeDeps({ [SEASON_URL]: good }))).ok).toBe(true);
  });
});

describe("題が想定外の HPAI の発表は黙って捨てない（Important 4）", () => {
  const odd = `${BASE}251230.html`;
  const T_ODD = "岡山県における高病原性鳥インフルエンザの疑似患畜の確認及び津山市の移動制限の解除について";
  const idx = () => ok(html("報道発表資料", [], [[odd, T_ODD]]), INDEX_URL);

  it("本文を取って pending の文書にし、運営者の確認の候補（title_unclassified）にする。処理済みの印をつける", async () => {
    const calls: string[] = [];
    const s = sink();
    const page = ok(html(T_ODD, [T_ODD, "令和7年12月30日", "農林水産省"]), odd);
    const deps = makeDeps({ [INDEX_URL]: idx(), [odd]: page }, calls);
    expect((await checkMaffPress(pressSource(), deps, s)).ok).toBe(true);
    const docs = await docsNow();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ url: odd, readState: "pending", kind: null, caseId: null });
    expect(await casesNow()).toEqual([]);
    expect(s.reviews).toEqual<ReviewNote[]>([{ url: odd, title: T_ODD, prefCode: null, reason: "title_unclassified", documentId: docs[0]!.id }]);
    await checkMaffPress(pressSource(), deps, sink());
    expect(calls.filter((u) => u === odd)).toHaveLength(1);
  });
  it("取得に失敗したら入口は失敗にして印をつけない（次の巡回でやり直す）", async () => {
    expect((await checkMaffPress(pressSource(), makeDeps({ [INDEX_URL]: idx() }), sink())).ok).toBe(false);
  });
});
