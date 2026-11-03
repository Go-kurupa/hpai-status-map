// readDocument（読み取りの流れ）を、模擬環境の Firestore と Storage、偽の client で確かめる（I-05）。実際の Claude は呼ばない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { estimateUsd } from "@hpai/shared/budget";
import type { GeoStore } from "@hpai/shared/geo";
import { DEFAULT_RUNTIME_SETTINGS } from "@hpai/shared/types";
import { readDocument } from "../../src/read/pipeline";
import {
  CONFIRM_TAIL,
  NOW,
  PRIMARY_MODEL,
  SECOND_MODEL,
  SUSPECT_TAIL,
  agreeing,
  bodyOf,
  clearAll,
  fakeClient,
  getDoc,
  listIds,
  loadGeo,
  message,
  primaryWire,
  realCase,
  refusal,
  requireEmulator,
  secondWire,
  seedDoc,
  seedSource,
  sentenceOf,
  setSettings,
  type Scenario,
} from "../helpers/readHarness";
import { db } from "../../src/admin";

let geo: GeoStore;
beforeAll(async () => {
  requireEmulator();
  geo = await loadGeo();
});
beforeEach(clearAll);

const TITLE = "高病原性鳥インフルエンザの発生について";
const run = (id: string, client: ReturnType<typeof agreeing>["client"]) => readDocument(id, { client, geo, now: () => NOW });

const tsuyamaConfirmed = (): Scenario => {
  const sentence = sentenceOf({ muni: "津山市", month: 12, day: 20, tail: CONFIRM_TAIL });
  return { kind: "confirmed", stage: "confirmed", pref: "岡山県", muni: "津山市", month: 12, day: 20, sentence };
};
const seedTsuyama = async (id = "d1", s = tsuyamaConfirmed(), over: Partial<Parameters<typeof seedDoc>[0]> = {}) =>
  seedDoc({ id, title: TITLE, text: bodyOf(TITLE, s.sentence), ...over });

describe("入口の守り", () => {
  it("pending 以外は何もしない（読まない、書かない）", async () => {
    await seedTsuyama("d1", tsuyamaConfirmed(), { readState: "published" });
    const { client, calls } = agreeing(tsuyamaConfirmed());
    expect(await run("d1", client)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(0);
    expect((await getDoc("documents/d1"))?.readState).toBe("published");
    expect(await run("nothing", client)).toEqual({ status: "skipped" });
  });

  it("同じ文書を同時に 2 回起動しても読み取りは 1 回（主 1、別の読み手 1）", async () => {
    await seedTsuyama();
    const { client, calls } = agreeing(tsuyamaConfirmed());
    const [a, b] = await Promise.all([run("d1", client), run("d1", client)]);
    expect([a.status, b.status].sort()).toEqual(["done", "skipped"]);
    expect(calls.filter((c) => c.model === PRIMARY_MODEL)).toHaveLength(1);
    expect(calls.filter((c) => c.model === SECOND_MODEL)).toHaveLength(1);
  });

  it("別の読み手の引数に主の結果がなく、同じ入力だけを渡す", async () => {
    await seedTsuyama();
    const { client, calls } = agreeing(tsuyamaConfirmed());
    await run("d1", client);
    const primary = calls.find((c) => c.model === PRIMARY_MODEL)!;
    const second = calls.find((c) => c.model === SECOND_MODEL)!;
    expect(second.messages).toEqual(primary.messages);
    expect(JSON.stringify(second)).not.toContain("kindQuote");
    expect(JSON.stringify(second.messages)).not.toContain("primaryStage");
  });
});

describe("公開の判断（autoPublishEnabled）", () => {
  it("既定（false）は正しい読み取りでも確認中。県名とリンクだけの rev- を出し、箱に 1 件入れる", async () => {
    await seedTsuyama();
    const { client } = agreeing(tsuyamaConfirmed());
    expect(await run("d1", client)).toMatchObject({ status: "done", readState: "review_public", caseId: null });
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    expect(await getDoc("cases/rev-d1")).toMatchObject({ confirmState: "reviewing", prefCode: "33", muniCode: null, stages: {}, sourceUrls: ["https://example.test/d1"] });
    const item = await getDoc("reviewQueue/doc-d1");
    expect(item).toMatchObject({ kind: "document", documentId: "d1", prefCode: "33", hasOutbreakWords: true, resolvedAt: null });
    expect(item?.reasons).toContain("auto_publish_off");
    const doc = await getDoc("documents/d1");
    expect(doc).toMatchObject({ readState: "review_public", kind: "confirmed", caseId: null, error: null });
    expect(doc?.reasons).toContain("auto_publish_off");
    expect(doc?.primary.municipality.value).toBe("津山市");
    expect(doc?.second.municipality).toBe("津山市");
    expect(doc?.verify.pass).toBe(true);
    expect(doc?.compare.match).toBe(true);
  });

  it("true なら事例ができ auto、published。確認中の rev- は出ない", async () => {
    await setSettings({ autoPublishEnabled: true });
    await seedTsuyama();
    const { client } = agreeing(tsuyamaConfirmed());
    expect(await run("d1", client)).toEqual({ status: "done", readState: "published", caseId: "33203-2025-12-20-1" });
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1"]);
    expect(await getDoc("cases/33203-2025-12-20-1")).toMatchObject({ confirmState: "auto", muniCode: "33203", muniName: "津山市", stages: { confirmed: { date: "2025-12-20", time: null } } });
    expect(await getDoc("documents/d1")).toMatchObject({ readState: "published", caseId: "33203-2025-12-20-1", reasons: [] });
    expect(await listIds("reviewQueue")).toEqual([]);
  });

  it("両者が訓練と読めば discard。何も書かず、理由を documents に残す", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = "防疫演習を実施しました。";
    const s: Scenario = { kind: "notice", stage: null, pref: "岡山県", muni: "", month: 12, day: 20, sentence };
    const wire = JSON.stringify({ ...JSON.parse(primaryWire(s)), facts: [], primaryDate: null, primaryDateQuote: null, kindQuote: null });
    const second = JSON.stringify({ ...JSON.parse(secondWire(s)), prefecture: null, municipality: null, primaryDate: null });
    await seedDoc({ id: "d1", title: "防疫演習を実施しました", text: bodyOf("防疫演習を実施しました", sentence) });
    const { client } = fakeClient({ primary: message(wire), second: message(second) });
    expect(await run("d1", client)).toMatchObject({ readState: "discarded" });
    expect(await listIds("cases")).toEqual([]);
    expect(await listIds("reviewQueue")).toEqual([]);
    expect(await getDoc("documents/d1")).toMatchObject({ readState: "discarded", reasons: ["both_read:notice"] });
  });
});

describe("読み手の失敗", () => {
  it("主の拒否は error:refusal:bio で確認中。拒否でも usage があれば積む", async () => {
    await seedTsuyama();
    const { client } = fakeClient({ primary: refusal("bio", { input_tokens: 700, output_tokens: 0 }), second: message(secondWire(tsuyamaConfirmed())) });
    expect(await run("d1", client)).toMatchObject({ readState: "review_public" });
    const doc = await getDoc("documents/d1");
    expect(doc).toMatchObject({ error: "refusal:bio", primary: null, compare: null, verify: null });
    expect(doc?.reasons).toContain("read_failed");
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    const usage = await getDoc("usage/2025-12");
    expect(usage?.inputTokens).toBe(700 + 1000); // 拒否の 700 と別の読み手の 1000
  });

  it("別の読み手だけの失敗は compare が null で確認中", async () => {
    await setSettings({ autoPublishEnabled: true });
    await seedTsuyama();
    const { client } = fakeClient({ primary: message(primaryWire(tsuyamaConfirmed())), second: refusal("bio") });
    expect(await run("d1", client)).toMatchObject({ readState: "review_public", caseId: null });
    const doc = await getDoc("documents/d1");
    expect(doc).toMatchObject({ compare: null, second: null, error: "second:refusal:bio" });
    expect(doc?.primary.kind).toBe("confirmed");
    expect(doc?.reasons).toContain("compare_missing");
    expect(await listIds("cases")).toEqual(["rev-d1"]);
  });

  it("API の失敗（usage なし）でも reading のまま止まらず確認中", async () => {
    await seedTsuyama();
    const { client } = fakeClient({ primary: new Error("network down"), second: new Error("network down") });
    expect(await run("d1", client)).toMatchObject({ readState: "review_public" });
    expect(await getDoc("documents/d1")).toMatchObject({ error: "api_error" });
    expect(await getDoc("usage/2025-12")).toBeUndefined();
  });

  it("2 モデルの usage が usage/{YYYY-MM} に積まれる", async () => {
    await seedTsuyama();
    const u1 = { input_tokens: 5000, output_tokens: 1500 };
    const u2 = { input_tokens: 4000, output_tokens: 100 };
    const s = tsuyamaConfirmed();
    const { client } = fakeClient({ primary: message(primaryWire(s), u1), second: message(secondWire(s), u2) });
    await run("d1", client);
    const usage = await getDoc("usage/2025-12");
    expect(usage).toMatchObject({ inputTokens: 9000, outputTokens: 1600 });
    const jpy = (estimateUsd(DEFAULT_RUNTIME_SETTINGS.primaryModel, u1) + estimateUsd(DEFAULT_RUNTIME_SETTINGS.secondModel, u2)) * DEFAULT_RUNTIME_SETTINGS.jpyPerUsd;
    expect(usage?.estimatedJpy).toBeCloseTo(jpy, 6);
  });
});

describe("費用の上限（§15）", () => {
  it("10,000 円では Claude を呼ばず skipped_budget。発生の語があれば確認中は公開する", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: 10000, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    await seedTsuyama();
    const { client, calls } = agreeing(tsuyamaConfirmed());
    expect(await run("d1", client)).toMatchObject({ status: "done", readState: "skipped_budget" });
    expect(calls).toHaveLength(0);
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    expect(await getDoc("documents/d1")).toMatchObject({ readState: "skipped_budget", reasons: ["budget_stop"] });
    expect(await getDoc("reviewQueue/doc-d1")).toMatchObject({ reasons: ["budget_stop"], hasOutbreakWords: true });
  });

  it("8,000 円では進捗報だけ読まない。発生の語があれば確認中は公開する。それ以外の題は読む", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: 8000, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const progressTitle = "高病原性鳥インフルエンザの発生に伴う防疫措置状況（第5報）";
    const body = bodyOf(progressTitle, "発生農場の殺処分を進めています。");
    await seedDoc({ id: "p1", title: progressTitle, text: body });
    await seedTsuyama("d2");
    const { client, calls } = agreeing(tsuyamaConfirmed());
    expect(await run("p1", client)).toMatchObject({ readState: "skipped_budget" });
    expect(calls).toHaveLength(0);
    expect(await getDoc("documents/p1")).toMatchObject({ reasons: ["budget_skip_progress"] });
    expect(await listIds("cases")).toEqual(["rev-p1"]); // 同じ県に事例がなくても、あっても rev を作る（§9.6）
    expect(await run("d2", client)).toMatchObject({ readState: "review_public" }); // 進捗報でない題は読む
    expect(calls).toHaveLength(2);
  });

  it("進捗報で発生の語がなければ、skipped_budget で箱の中だけ（公開しない）", async () => {
    await db.doc("usage/2025-12").set({ estimatedJpy: 8100, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    await seedDoc({ id: "p2", title: "防疫措置の進捗について（第3報）", text: "防疫措置の進捗について（第3報）\n作業を続けています。\n" });
    const { client, calls } = agreeing(tsuyamaConfirmed());
    expect(await run("p2", client)).toMatchObject({ readState: "skipped_budget" });
    expect(calls).toHaveLength(0);
    expect(await listIds("cases")).toEqual([]);
    expect(await getDoc("reviewQueue/doc-p2")).toMatchObject({ hasOutbreakWords: false });
  });
});

describe("事例への流し込み", () => {
  it("胎内の実例: 3 例目の確定 11/4 の後に県の疑い 11/8（N なし）は黙って足さず確認中（chronology）。3 例目は変わらない", async () => {
    await setSettings({ autoPublishEnabled: true });
    const third = realCase({ id: "15227-2025-11-04-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 3, stages: { confirmed: { date: "2025-11-04", time: null } } });
    await db.doc(`cases/${third.id}`).set(third);
    const sentence = sentenceOf({ pref: "新潟県", muni: "胎内市", month: 11, day: 8, tail: SUSPECT_TAIL });
    const s: Scenario = { kind: "suspected", stage: "suspected", pref: "新潟県", muni: "胎内市", month: 11, day: 8, sentence };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence), prefCode: "15" });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_public" });
    const doc = await getDoc("documents/d1");
    expect(doc?.verify.issues).toContainEqual(expect.objectContaining({ check: "chronology", mandatory: true }));
    expect(doc?.reasons).toContain("primaryDate:chronology");
    expect(await getDoc(`cases/${third.id}`)).toEqual(third);
    expect(await listIds("cases")).toEqual([third.id, "rev-d1"].sort());
  });

  it("判断のあとに同じ事例ができたら、書く時に今の状態で時系列の検査をやり直し、通らなければ確認中にする", async () => {
    await setSettings({ autoPublishEnabled: true });
    // 読んだ時点では 胎内に事例がなく new。書く前に別の文書が 3 例目の確定 11/4 を作る
    const third = realCase({ id: "15227-2025-11-04-1", prefCode: "15", muniCode: "15227", muniName: "胎内市", nationalNo: 3, stages: { confirmed: { date: "2025-11-04", time: null } } });
    const sentence = sentenceOf({ pref: "新潟県", muni: "胎内市", month: 11, day: 8, tail: SUSPECT_TAIL });
    const s: Scenario = { kind: "suspected", stage: "suspected", pref: "新潟県", muni: "胎内市", month: 11, day: 8, sentence };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence), prefCode: "15" });
    const out = await readDocument("d1", { client: agreeing(s).client, geo, now: () => NOW, afterJudge: async () => void (await db.doc(`cases/${third.id}`).set(third)) });
    expect(out).toMatchObject({ readState: "review_public", caseId: null });
    expect(await getDoc(`cases/${third.id}`)).toEqual(third); // 3 例目に疑いを足していない
    expect(await listIds("cases")).toEqual([third.id, "rev-d1"].sort());
    expect(await getDoc("documents/d1")).toMatchObject({ readState: "review_public", reasons: ["primaryDate:chronology"] });
    expect((await getDoc("documents/d1"))?.verify.issues).toContainEqual(expect.objectContaining({ check: "chronology", mandatory: true })); // 書いた検査の結果は、やり直したもの
    expect(await getDoc("reviewQueue/doc-d1")).toMatchObject({ hasOutbreakWords: true, reasons: ["primaryDate:chronology"] });
  });

  it("判断のあとに何も変わらなければ、そのまま公開する（確認中に倒すのは変わったときだけ）", async () => {
    await setSettings({ autoPublishEnabled: true });
    await db.doc("cases/33203-2025-12-20-1").set(realCase());
    const s1: Scenario = { ...tsuyamaConfirmed(), kind: "control_done", stage: "control_done", month: 12, day: 23, sentence: sentenceOf({ muni: "津山市", month: 12, day: 23, tail: "防疫措置を完了しました。" }) };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s1.sentence) });
    let called = 0;
    const out = await readDocument("d1", { client: agreeing(s1).client, geo, now: () => NOW, afterJudge: async () => void called++ });
    expect(called).toBe(1);
    expect(out).toMatchObject({ readState: "published", caseId: "33203-2025-12-20-1" });
  });

  it("続報は同じ事例に足す（疑い → 確定）。出典が増え id は変わらない", async () => {
    await setSettings({ autoPublishEnabled: true });
    const s1: Scenario = { kind: "suspected", stage: "suspected", pref: "岡山県", muni: "津山市", month: 12, day: 19, sentence: sentenceOf({ muni: "津山市", month: 12, day: 19, tail: SUSPECT_TAIL }) };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s1.sentence) });
    await seedTsuyama("d2");
    expect(await run("d1", agreeing(s1).client)).toMatchObject({ caseId: "33203-2025-12-19-1" });
    expect(await run("d2", agreeing(tsuyamaConfirmed()).client)).toMatchObject({ readState: "published", caseId: "33203-2025-12-19-1" });
    const c = await getDoc("cases/33203-2025-12-19-1");
    expect(Object.keys(c?.stages).sort()).toEqual(["confirmed", "suspected"]);
    expect(c?.sourceUrls).toEqual(["https://example.test/d1", "https://example.test/d2"]);
    expect(await listIds("cases")).toEqual(["33203-2025-12-19-1"]);
  });

  it("同じ事例の 2 文書（県の疑い 12/19 と国の確定 12/20 N=8）を同時に流しても事例は 1 つ", async () => {
    await setSettings({ autoPublishEnabled: true });
    const s1: Scenario = { kind: "suspected", stage: "suspected", pref: "岡山県", muni: "津山市", month: 12, day: 19, sentence: sentenceOf({ muni: "津山市", month: 12, day: 19, tail: SUSPECT_TAIL }) };
    const s2: Scenario = { ...tsuyamaConfirmed(), sentence: `${tsuyamaConfirmed().sentence}（国内8例目）`, nationalNo: 8 };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s1.sentence) });
    await seedDoc({ id: "d2", title: TITLE, text: bodyOf(TITLE, s2.sentence), prefCode: null });
    await Promise.all([run("d1", agreeing(s1).client), run("d2", agreeing(s2).client)]);
    const ids = (await listIds("cases")).filter((id) => !id.startsWith("rev-"));
    expect(ids).toHaveLength(1);
    const c = await getDoc(`cases/${ids[0]}`);
    expect(Object.keys(c?.stages).sort()).toEqual(["confirmed", "suspected"]);
    expect(c?.nationalNo).toBe(8);
    expect(c?.sourceUrls).toHaveLength(2);
  });

  it("県の入口の文書で別の県の読み取り（岡山のページの姫路）は載せない: pref_mismatch、公開しない", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = sentenceOf({ pref: "兵庫県", muni: "姫路市", month: 12, day: 20, tail: CONFIRM_TAIL });
    const s: Scenario = { kind: "confirmed", stage: "confirmed", pref: "兵庫県", muni: "姫路市", month: 12, day: 20, sentence };
    await seedSource("src1", "pref_fixed", "33");
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence), prefCode: "33" });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_private", caseId: null });
    expect(await listIds("cases")).toEqual([]);
    expect(await getDoc("reviewQueue/doc-d1")).toMatchObject({ prefCode: "33", hasOutbreakWords: false, reasons: ["pref_mismatch"] });
  });
});

describe("県名の扱い（sourcePrefCode）", () => {
  const noPref = () => {
    const sentence = "令和7年12月20日、津山市の養鶏場において、遺伝子検査を実施した結果、疑似患畜と確認しました。";
    const s: Scenario = { kind: "confirmed", stage: "confirmed", pref: "岡山県", muni: "津山市", month: 12, day: 20, sentence };
    return s;
  };

  it("県の入口（pref_*）の文書は、引用に県名がなくても取得元の県と読みの県が一致すれば都道府県は合格", async () => {
    await setSettings({ autoPublishEnabled: true });
    await seedSource("src1", "pref_fixed", "33");
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, noPref().sentence), sourceId: "src1", prefCode: "33" });
    expect(await run("d1", agreeing(noPref()).client)).toMatchObject({ readState: "published", caseId: "33203-2025-12-20-1" });
  });

  it("国の発表（maff_press）は、文書の prefCode があっても引用に県名が要る。なければ確認中", async () => {
    await setSettings({ autoPublishEnabled: true });
    await seedSource("nat", "maff_press", null);
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, noPref().sentence), sourceId: "nat", prefCode: "33" });
    expect(await run("d1", agreeing(noPref()).client)).toMatchObject({ readState: "review_public" });
    expect((await getDoc("documents/d1"))?.reasons).toContain("prefecture:value_in_quote");
  });

  it("引用が「本日」だけで年月日がないとき、文書に発表日（announcedOn）があり引用の日付と同じなら載せる", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = "本日、岡山県津山市の養鶏場において、遺伝子検査を実施した結果、疑似患畜と確認しました。";
    const s: Scenario = { kind: "confirmed", stage: "confirmed", pref: "岡山県", muni: "津山市", month: 12, day: 22, sentence };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence), announcedOn: "2025-12-22" });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "published" });
  });

  it("発表日が引用の日付と違えば、「本日」だけの引用は確認中に回る", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = "本日、岡山県津山市の養鶏場において、遺伝子検査を実施した結果、疑似患畜と確認しました。";
    const s: Scenario = { kind: "confirmed", stage: "confirmed", pref: "岡山県", muni: "津山市", month: 12, day: 22, sentence };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence), announcedOn: "2025-12-21" });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_public" });
  });

  it("引用が「本日」だけで年月日がないときは、発表日が取れていなければ確認中に回る（安全な側）", async () => {
    await setSettings({ autoPublishEnabled: true });
    const sentence = "本日、岡山県津山市の養鶏場において、遺伝子検査を実施した結果、疑似患畜と確認しました。";
    const s: Scenario = { kind: "confirmed", stage: "confirmed", pref: "岡山県", muni: "津山市", month: 12, day: 22, sentence };
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, sentence) });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_public" });
    expect((await getDoc("documents/d1"))?.reasons).toContain("primaryDate:value_in_quote");
  });
});

describe("PDF と文字層", () => {
  it("PDF は base64 を両方の読み手に渡し、照合は raw/{id}.txt の文字層で行う", async () => {
    await setSettings({ autoPublishEnabled: true });
    const pdf = Buffer.from("%PDF-1.7 fake pdf bytes");
    const s = tsuyamaConfirmed();
    await seedDoc({ id: "d1", title: TITLE, text: bodyOf(TITLE, s.sentence), contentType: "pdf", pdf });
    const { client, calls } = agreeing(s);
    expect(await run("d1", client)).toMatchObject({ readState: "published" });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const blocks = (c.messages[0]!.content as Array<{ type: string; source?: { data: string; media_type: string } }>).filter((b) => b.type === "document");
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.source).toEqual({ type: "base64", media_type: "application/pdf", data: pdf.toString("base64") });
    }
  });

  it("文字層なしの PDF は一致しても載せず、題に語があれば確認中を公開する", async () => {
    await setSettings({ autoPublishEnabled: true });
    const s = tsuyamaConfirmed();
    await seedDoc({ id: "d1", title: TITLE, text: "", contentType: "pdf", pdf: Buffer.from("%PDF"), hasTextLayer: false });
    expect(await run("d1", agreeing(s).client)).toMatchObject({ readState: "review_public" });
    expect((await getDoc("documents/d1"))?.reasons).toEqual(["no_text_layer_match"]);
    expect(await listIds("cases")).toEqual(["rev-d1"]);
  });
});

describe("取り残さない", () => {
  it("raw/{id}.txt がなくても reading のまま止まらず、題に語があれば確認中を公開する", async () => {
    await seedDoc({ id: "d1", title: TITLE, text: null });
    const { client } = agreeing(tsuyamaConfirmed());
    const out = await run("d1", client);
    expect(out).toMatchObject({ status: "done", readState: "review_public" });
    expect((await getDoc("documents/d1"))?.readState).toBe("review_public");
  });

  it("流れの途中で例外が出ても reading のまま取り残さない（pipeline_error）", async () => {
    await seedTsuyama();
    const broken = new Proxy(geo, {
      get(target, prop, receiver) {
        if (prop === "index") throw new Error("geo broken");
        return Reflect.get(target, prop, receiver);
      },
    });
    const { client } = agreeing(tsuyamaConfirmed());
    const out = await readDocument("d1", { client, geo: broken, now: () => NOW });
    expect(out).toMatchObject({ status: "done", readState: "review_public" });
    expect(await getDoc("documents/d1")).toMatchObject({ readState: "review_public", error: "pipeline_error", reasons: ["pipeline_error"] });
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    expect(await getDoc("reviewQueue/doc-d1")).toMatchObject({ reasons: ["pipeline_error"] });
  });
});
