// 計画（planApply）の書き込み側を、模擬環境で確かめる（I-05）: 運営者の箱への足し方、野鳥、否定、確認中の事例の検査。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import { db } from "../../src/admin";
import { readDocument } from "../../src/read/pipeline";
import { upsertCaseIn } from "../../src/read/upsert";
import {
  CONFIRM_TAIL,
  NOW,
  agreeing,
  bodyOf,
  clearAll,
  fakeClient,
  getDoc,
  listIds,
  loadGeo,
  message,
  realCase,
  requireEmulator,
  seedDoc,
  sentenceOf,
  setSettings,
  type Scenario,
} from "../helpers/readHarness";

let geo: GeoStore;
beforeAll(async () => {
  requireEmulator();
  geo = await loadGeo();
});
beforeEach(clearAll);

const TITLE = "高病原性鳥インフルエンザの発生について";
const run = (id: string, client: ReturnType<typeof agreeing>["client"]) => readDocument(id, { client, geo, now: () => NOW });
const sc = (kind: Scenario["kind"], stage: Scenario["stage"], month: number, day: number, tail: string): Scenario => ({
  kind,
  stage,
  pref: "岡山県",
  muni: "津山市",
  month,
  day,
  sentence: sentenceOf({ muni: "津山市", month, day, tail }),
});

describe("運営者の箱に同じ文書の項目がすでにあるとき（見回りが pending の文書に doc-<id> を入れる）", () => {
  const watchItem = (o: Record<string, unknown> = {}) => ({
    id: "doc-d1",
    kind: "document",
    documentId: "d1",
    url: "https://example.test/d1",
    prefCode: null,
    title: TITLE,
    reasons: ["unreadable"],
    hasOutbreakWords: true,
    createdAt: "2025-12-22T11:00:00+09:00",
    resolvedAt: null,
    ...o,
  });

  it("未解決なら既存の項目に理由を足す。作成時刻、解決の状態は変えず、項目は 1 件のまま", async () => {
    const s = sc("confirmed", "confirmed", 12, 20, CONFIRM_TAIL);
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s.sentence) });
    await db.doc("reviewQueue/doc-d1").set(watchItem());
    await run("d1", agreeing(s).client);
    expect(await listIds("reviewQueue")).toEqual(["doc-d1"]);
    const item = await getDoc("reviewQueue/doc-d1");
    expect(item?.reasons).toEqual(["unreadable", "auto_publish_off"]);
    expect(item).toMatchObject({ createdAt: "2025-12-22T11:00:00+09:00", resolvedAt: null, prefCode: "33", hasOutbreakWords: true });
  });

  it("見回りの項目の理由は、新しい理由に置き換えられない（同じ理由は重ねない）", async () => {
    const s = sc("confirmed", "confirmed", 12, 20, CONFIRM_TAIL);
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s.sentence) });
    await db.doc("reviewQueue/doc-d1").set(watchItem({ reasons: ["auto_publish_off", "ambiguous_case"], prefCode: "33" }));
    await run("d1", agreeing(s).client);
    expect((await getDoc("reviewQueue/doc-d1"))?.reasons).toEqual(["auto_publish_off", "ambiguous_case"]);
  });

  it("解決済みなら新しい内容を失わないよう別の id で作る。解決済みの項目は動かさない", async () => {
    const s = sc("confirmed", "confirmed", 12, 20, CONFIRM_TAIL);
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s.sentence) });
    const resolved = watchItem({ resolvedAt: "2025-12-22T11:30:00+09:00" });
    await db.doc("reviewQueue/doc-d1").set(resolved);
    await run("d1", agreeing(s).client);
    expect(await getDoc("reviewQueue/doc-d1")).toEqual(resolved);
    const ids = await listIds("reviewQueue");
    expect(ids).toEqual(["doc-d1", `doc-d1-${NOW.getTime()}`]);
    expect(await getDoc(`reviewQueue/doc-d1-${NOW.getTime()}`)).toMatchObject({ documentId: "d1", resolvedAt: null, reasons: ["auto_publish_off"] });
  });
});

describe("野鳥", () => {
  const birdBody = (test: "screening_positive" | "negative") => {
    const sentence =
      test === "negative"
        ? "令和7年12月1日、宮城県栗原市で回収されたコハクチョウについて、遺伝子検査の結果、高病原性ではないことを確認しました。陰性です。"
        : "令和7年12月1日、宮城県栗原市で回収されたコハクチョウについて、簡易検査で陽性を確認しました。";
    const title = "野鳥の回収について";
    const row = { date: { year: null, month: 12, day: 1, time: null }, prefecture: "宮城県", municipality: "栗原市", species: "コハクチョウ", test, quote: sentence };
    const wild = (extra: Record<string, unknown>) => JSON.stringify({ kind: "wild_bird", multipleCases: false, primaryStage: null, primaryDate: null, ...extra });
    const primary = wild({ kindQuote: null, facts: [], primaryDateQuote: null, stageEvents: [], radiiKm: [], estimates: [], wildBirds: [row] });
    const second = wild({ prefecture: null, municipality: null, wildBirds: [{ date: row.date, prefecture: "宮城県", municipality: "栗原市", test }] });
    return { title, text: bodyOf(title, sentence), primary, second };
  };

  it("全行を書く。陽性 → 陰性は同じ id で上書きし、消さない。focusZone は null", async () => {
    await setSettings({ autoPublishEnabled: true });
    const pos = birdBody("screening_positive");
    await seedDoc({ id: "w1", title: pos.title, text: pos.text, prefCode: null });
    expect(await run("w1", fakeClient({ primary: message(pos.primary), second: message(pos.second) }).client)).toMatchObject({ readState: "published", caseId: null });
    const ids = await listIds("wildBirds");
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^wb-[0-9a-f]{24}$/);
    expect(await getDoc(`wildBirds/${ids[0]}`)).toMatchObject({ season: 2025, date: "2025-12-01", prefCode: "04", muniName: "栗原市", species: "コハクチョウ", test: "screening_positive", focusZone: { from: null, to: null }, sourceUrl: "https://example.test/w1" });

    const neg = birdBody("negative");
    await seedDoc({ id: "w2", title: neg.title, text: neg.text, prefCode: null });
    await run("w2", fakeClient({ primary: message(neg.primary), second: message(neg.second) }).client);
    expect(await listIds("wildBirds")).toEqual(ids);
    expect(await getDoc(`wildBirds/${ids[0]}`)).toMatchObject({ test: "negative", sourceUrl: "https://example.test/w2" });
    expect(await listIds("cases")).toEqual([]);
  });
});

describe("否定の候補", () => {
  const negated = () => {
    const sentence = "令和7年12月21日、岡山県津山市の養鶏場で採取した検体について、遺伝子検査の結果、陰性であることを確認しました。";
    const s: Scenario = { kind: "negated", stage: null, pref: "岡山県", muni: "津山市", month: 12, day: 21, sentence };
    return s;
  };

  it("疑いの事例は段階をそのまま candidate にし、negation_candidate の知らせを箱に入れる", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sus = realCase({ id: "33203-2025-12-19-1", stages: { suspected: { date: "2025-12-19", time: null } } });
    await db.doc(`cases/${sus.id}`).set(sus);
    await seedDoc({ id: "d1", title: "疑われる事例に係る遺伝子検査の結果について", text: bodyOf("疑われる事例に係る遺伝子検査の結果について", negated().sentence) });
    expect(await run("d1", agreeing(negated()).client)).toMatchObject({ readState: "published", caseId: sus.id });
    expect(await getDoc(`cases/${sus.id}`)).toMatchObject({ negation: "candidate", stages: sus.stages, id: sus.id });
    const alerts = (await listIds("reviewQueue")).filter((id) => id.startsWith("alert-negation_candidate-"));
    expect(alerts).toHaveLength(1);
    expect(await getDoc(`reviewQueue/${alerts[0]}`)).toMatchObject({ kind: "alert", alert: "negation_candidate", caseId: sus.id, prefCode: "33" });
  });

  it("確定があれば退ける（negation_on_confirmed）。事例は変わらない", async () => {
    await setSettings({ autoPublishEnabled: true });
    await db.doc("cases/33203-2025-12-20-1").set(realCase());
    await seedDoc({ id: "d1", title: "遺伝子検査の結果について", text: bodyOf("遺伝子検査の結果について", negated().sentence) });
    expect(await run("d1", agreeing(negated()).client)).toMatchObject({ readState: "review_private", caseId: null });
    expect(await getDoc("cases/33203-2025-12-20-1")).toEqual(realCase());
    expect((await getDoc("documents/d1"))?.reasons).toEqual(["negation_on_confirmed"]);
  });
});

describe("後の段階と迷い", () => {
  it("事例がないのに搬出解除 / 移動解除だけが来ても事例を作らない（no_case_for_stage）", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = "令和7年12月30日、岡山県津山市の養鶏場の周辺区域について、移動制限を解除します。";
    const s: Scenario = { kind: "zone_lifted", stage: "movement_lifted", pref: "岡山県", muni: "津山市", month: 12, day: 30, sentence };
    await seedDoc({ id: "d1", title: "移動制限区域を解除しました", text: bodyOf("移動制限区域を解除しました", sentence) });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_private", caseId: null });
    expect(await listIds("cases")).toEqual([]);
    expect((await getDoc("documents/d1"))?.reasons).toEqual(["no_case_for_stage"]);
  });

  it("進行中の 2 事例に解除が来たら別の事例にせず、rev の確認中（ambiguous_case）", async () => {
    await setSettings({ autoPublishEnabled: true });
    await db.doc("cases/33203-2025-12-20-1").set(realCase());
    await db.doc("cases/33203-2025-12-21-1").set(realCase({ id: "33203-2025-12-21-1", stages: { confirmed: { date: "2025-12-21", time: null } } }));
    const sentence = "令和7年12月30日、岡山県津山市の養鶏場の周辺区域について、移動制限を解除します。発生農場の防疫措置は完了しています。";
    const s: Scenario = { kind: "zone_lifted", stage: "movement_lifted", pref: "岡山県", muni: "津山市", month: 12, day: 30, sentence };
    await seedDoc({ id: "d1", title: "高病原性鳥インフルエンザの移動制限区域を解除しました", text: bodyOf("高病原性鳥インフルエンザの移動制限区域を解除しました", sentence) });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_public" });
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1", "33203-2025-12-21-1", "rev-d1"]);
    expect((await getDoc("documents/d1"))?.reasons).toEqual(["ambiguous_case"]);
  });
});

describe("upsertCaseIn（トランザクション版）", () => {
  it("確認中に読み取った値が混ざっていれば reject し、同じトランザクションの他の書き込みも消える", async () => {
    const leaky = { ...realCase({ id: "rev-x", confirmState: "reviewing", stages: {} }), muniCode: "33203" };
    await expect(
      db.runTransaction(async (tx) => {
        tx.set(db.doc("probe/p1"), { a: 1 });
        upsertCaseIn(tx, leaky);
      }),
    ).rejects.toThrow(RangeError);
    expect(await getDoc("probe/p1")).toBeUndefined();
    expect(await getDoc("cases/rev-x")).toBeUndefined();
  });

  it("確認中でない事例が rev- の id なら reject", async () => {
    await expect(db.runTransaction(async (tx) => upsertCaseIn(tx, realCase({ id: "rev-y" })))).rejects.toThrow(RangeError);
    expect(await getDoc("cases/rev-y")).toBeUndefined();
  });
});
