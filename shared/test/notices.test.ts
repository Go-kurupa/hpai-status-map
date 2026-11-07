// M-02: 誰にいつ知らせるかを決める純粋な部分。メールは送らない。
import { describe, expect, it } from "vitest";
import { distanceToMuniKm, GeoNotLoadedError } from "../src/geo";
import { diffCaseEvents, eventDateOf, farmPoint, memberKeyOf, noticeDocId, planCaseNotices, renderNotice, reviewingCoveredMembers, REVIEWING_QUEUED_GRACE_MINUTES, REVIEWING_QUIET_DAYS, timingFor, type Notice, type NoticeEvent, type SentNotice } from "../src/notices";
import type { Case, Farm } from "../src/types";
import { boxAround, boxNorthOf, makeGeo } from "./fixtures/geo";
import { boxEastOfMesh, caseFixture, FAR_B, farmWithId, fakeGeo, GEO_A, GEO_B, GEO_C, GEO_D, IN_A, IN_D } from "./helpers/mFixtures";

type F = Farm & { id: string };

/** f1 は A の内（①）、f2 は B で A と隣り合うが遠い（②）、f3 は D で登録した町に A（③）、f4 は D で何もなし（④）。 */
function farms(): F[] {
  return [
    farmWithId("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" }),
    farmWithId("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" }),
    farmWithId("f3", "u3", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34", frequentMuniCodes: [GEO_A] }),
    farmWithId("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" }),
  ];
}

const geo = () => fakeGeo({ preload: true });
const stage = (date: string) => ({ date, time: null });
const suspectedCase = (o: Partial<Case> = {}) => caseFixture({ stages: { suspected: stage("2026-11-04") }, ...o });
const sent = (farmId: string, uid: string, subjectId: string, event: NoticeEvent, state: SentNotice["state"] = "sent"): SentNotice => ({
  farmId,
  uid,
  subjectId,
  event,
  timing: "immediate",
  state,
  queuedAt: "2026-11-04T10:00:00+09:00",
  sentAt: state === "sent" ? "2026-11-04T10:00:05+09:00" : null,
});

/** 農場ごとの (timing, level) の表。届かない農場は載らない。 */
function table(notices: readonly Notice[]): Record<string, string> {
  return Object.fromEntries(notices.map((n) => [n.farmId, `${n.timing}/${n.level}`]));
}

describe("farmPoint", () => {
  it("meshCode、muniCode、frequentMuniCodes だけを取り出す", () => {
    const f = farmWithId("f", "u", { meshCode: IN_A, muniCode: GEO_A, frequentMuniCodes: [GEO_B] });
    expect(farmPoint(f)).toEqual({ meshCode: IN_A, muniCode: GEO_A, frequentMuniCodes: [GEO_B] });
  });
});

describe("noticeDocId", () => {
  it("farmId、uid、subjectId、event を __ でつなぐ", () => {
    expect(noticeDocId("f1", "u1", "c1", "confirmed")).toBe("f1__u1__c1__confirmed");
  });
});

describe("diffCaseEvents", () => {
  const susp = suspectedCase();
  const conf = caseFixture();
  it("(null, 疑い) = suspected、(null, 疑いと確定) = confirmed、(疑い, 確定) = confirmed", () => {
    expect(diffCaseEvents(null, susp)).toEqual(["suspected"]);
    expect(diffCaseEvents(null, caseFixture({ stages: { suspected: stage("2026-11-04"), confirmed: stage("2026-11-05") } }))).toEqual(["confirmed"]);
    expect(diffCaseEvents(susp, caseFixture({ stages: { suspected: stage("2026-11-04"), confirmed: stage("2026-11-05") } }))).toEqual(["confirmed"]);
  });
  it("変わらない書き込みは何も出さない", () => {
    expect(diffCaseEvents(conf, conf)).toEqual([]);
    expect(diffCaseEvents(conf, { ...conf, updatedAt: "2026-11-06T00:00:00+09:00", headCount: 100 })).toEqual([]);
  });
  it("(疑い, 否定の候補) = なし、(候補, 否定) = negated", () => {
    const cand = { ...susp, negation: "candidate" as const };
    expect(diffCaseEvents(susp, cand)).toEqual([]);
    expect(diffCaseEvents(cand, { ...cand, negation: "negated", negatedAt: "2026-11-05T10:00:00+09:00" })).toEqual(["negated"]);
  });
  it("否定済みの事例の更新は何も出さず、否定された事例の段階の追加も出さない", () => {
    const neg = { ...susp, negation: "negated" as const, negatedAt: "2026-11-05T10:00:00+09:00" };
    expect(diffCaseEvents(neg, { ...neg, updatedAt: "2026-11-06T00:00:00+09:00" })).toEqual([]);
    expect(diffCaseEvents(susp, { ...neg, stages: { ...neg.stages, confirmed: stage("2026-11-05") } })).toEqual(["negated"]);
  });
  it("(null, 確認中) = reviewing。確認中のままの更新は何も出さない", () => {
    const rev = caseFixture({ id: "rev-d1", muniCode: null, muniName: null, stages: {}, confirmState: "reviewing" });
    expect(diffCaseEvents(null, rev)).toEqual(["reviewing"]);
    expect(diffCaseEvents(rev, { ...rev, updatedAt: "2026-11-06T00:00:00+09:00" })).toEqual([]);
  });
  it("解除はそれぞれの出来事", () => {
    expect(diffCaseEvents(conf, caseFixture({ stages: { confirmed: stage("2026-11-05"), shipment_lifted: stage("2026-11-15") } }))).toEqual(["shipment_lifted"]);
    expect(diffCaseEvents(conf, caseFixture({ stages: { confirmed: stage("2026-11-05"), movement_lifted: stage("2026-11-25") } }))).toEqual(["movement_lifted"]);
    expect(
      diffCaseEvents(conf, caseFixture({ stages: { confirmed: stage("2026-11-05"), shipment_lifted: stage("2026-11-15"), movement_lifted: stage("2026-11-25") } })),
    ).toEqual(["shipment_lifted", "movement_lifted"]);
  });
  it("control_done などの追加は出さない", () => {
    expect(diffCaseEvents(conf, caseFixture({ stages: { confirmed: stage("2026-11-05"), control_done: stage("2026-11-10"), culling_done: stage("2026-11-08") } }))).toEqual([]);
  });
  it("replay は何も出さない", () => {
    expect(diffCaseEvents(null, caseFixture({ confirmState: "replay" }))).toEqual([]);
  });
});

describe("eventDateOf", () => {
  it("出来事の段階の日付（確認中は updatedAt、否定は negatedAt）。無ければ null", () => {
    const c = caseFixture({ stages: { suspected: stage("2026-11-04"), confirmed: stage("2026-11-05") }, negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" });
    expect(eventDateOf("suspected", c)).toBe("2026-11-04");
    expect(eventDateOf("confirmed", c)).toBe("2026-11-05");
    expect(eventDateOf("negated", c)).toBe("2026-11-06");
    expect(eventDateOf("movement_lifted", c)).toBeNull();
    expect(eventDateOf("reviewing", caseFixture({ updatedAt: "2026-11-07T01:00:00+09:00" }))).toBe("2026-11-07");
  });
});

describe("timingFor", () => {
  it("疑い、確定、否定: ① すぐ、②③ 朝、④ なし", () => {
    for (const e of ["suspected", "confirmed", "negated"] as const) {
      expect([1, 2, 3, 4].map((l) => timingFor(e, l as 1 | 2 | 3 | 4))).toEqual(["immediate", "morning", "morning", null]);
    }
  });
  it("解除: ①②③ 朝、④ なし", () => {
    for (const e of ["shipment_lifted", "movement_lifted"] as const) {
      expect([1, 2, 3, 4].map((l) => timingFor(e, l as 1 | 2 | 3 | 4))).toEqual(["morning", "morning", "morning", null]);
    }
  });
  it("確認中は段階によらずすぐ", () => {
    expect([1, 2, 3, 4].map((l) => timingFor("reviewing", l as 1 | 2 | 3 | 4))).toEqual(["immediate", "immediate", "immediate", "immediate"]);
  });
});

describe("planCaseNotices: 宛先", () => {
  it.each(["suspected", "confirmed", "negated"] as const)("%s: f1 ① すぐ、f2 ② 朝、f3 ③ 朝、f4 なし", (event) => {
    const out = planCaseNotices({ event, caseDoc: suspectedCase(), farms: farms(), geo: geo(), alreadySent: [] });
    expect(table(out)).toEqual({ f1: "immediate/1", f2: "morning/2", f3: "morning/3" });
    expect(out.find((n) => n.farmId === "f1")).toMatchObject({ uid: "u1", subjectId: suspectedCase().id, event, relationKind: "same_muni", isCorrection: false });
    expect(out.find((n) => n.farmId === "f2")?.relationKind).toBe("adjacent");
    expect(out.find((n) => n.farmId === "f3")?.relationKind).toBe("frequent");
  });
  it.each(["shipment_lifted", "movement_lifted"] as const)("%s: ①②③ 朝、④ なし", (event) => {
    const c = caseFixture({ stages: { confirmed: stage("2026-11-05"), [event]: stage("2026-11-25") } });
    const out = planCaseNotices({ event, caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] });
    expect(table(out)).toEqual({ f1: "morning/1", f2: "morning/2", f3: "morning/3" });
  });
  it("移動制限の解除: 同じ町ではない区域内の農場（半径の内）も解除を受け取る（解除の前の関係で決める）", () => {
    const c = caseFixture({ stages: { confirmed: stage("2026-11-05"), movement_lifted: stage("2026-11-25") } });
    const g = makeGeo([{ code: GEO_A, geometry: boxEastOfMesh(FAR_B, 8) }, { code: GEO_C }], { preload: true });
    const f = farmWithId("fr", "ur", { meshCode: FAR_B, muniCode: GEO_C, prefCode: "33" });
    const out = planCaseNotices({ event: "movement_lifted", caseDoc: c, farms: [f], geo: g, alreadySent: [] });
    expect(table(out)).toEqual({ fr: "morning/1" });
    expect(out[0]!.relationKind).toBe("within_radius");
  });
  it("搬出制限の解除は、同じ事例の移動制限がもう解除されているなら出さない（移動制限の解除が先に伝わる）", () => {
    const c = caseFixture({ stages: { confirmed: stage("2026-11-05"), shipment_lifted: stage("2026-11-15"), movement_lifted: stage("2026-11-25") } });
    expect(planCaseNotices({ event: "shipment_lifted", caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] })).toEqual([]);
  });
  it("移動制限の解除の後に確定が届いた同じ町は、level 2 の same_muni のまま（文は W/M が固定文にする）", () => {
    const c = caseFixture({ stages: { confirmed: stage("2026-11-05"), movement_lifted: stage("2026-11-25") } });
    const out = planCaseNotices({ event: "confirmed", caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] });
    expect(out.find((n) => n.farmId === "f1")).toMatchObject({ level: 2, relationKind: "same_muni", timing: "morning" });
  });
  it("事実: 市町村、県、出来事の段階の日付、最後の出典", () => {
    const c = suspectedCase({ sourceUrls: ["https://example.test/a", "https://example.test/b"] });
    const n = planCaseNotices({ event: "suspected", caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] })[0]!;
    expect(n.facts).toEqual({ muniName: "町A", prefCode: "33", date: "2026-11-04", sourceUrl: "https://example.test/b" });
    const neg = planCaseNotices({
      event: "negated",
      caseDoc: suspectedCase({ negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" }),
      farms: farms(),
      geo: geo(),
      alreadySent: [],
    })[0]!;
    expect(neg.facts.date).toBe("2026-11-06");
    const lifted = planCaseNotices({
      event: "movement_lifted",
      caseDoc: caseFixture({ stages: { confirmed: stage("2026-11-05"), movement_lifted: stage("2026-11-25") } }),
      farms: farms(),
      geo: geo(),
      alreadySent: [],
    })[0]!;
    expect(lifted.facts.date).toBe("2026-11-25");
    expect(planCaseNotices({ event: "suspected", caseDoc: suspectedCase({ sourceUrls: [] }), farms: farms(), geo: geo(), alreadySent: [] })[0]!.facts.sourceUrl).toBeNull();
  });
});

describe("planCaseNotices: 境目の距離（市町村 C の農場、メッシュ FAR_B）", () => {
  const near = (km: number) => makeGeo([{ code: GEO_A, geometry: boxEastOfMesh(FAR_B, km) }, { code: GEO_C }], { preload: true });
  const farm = farmWithId("fr", "ur", { meshCode: FAR_B, muniCode: GEO_C, prefCode: "33" });
  const plan = (km: number) => planCaseNotices({ event: "confirmed", caseDoc: caseFixture(), farms: [farm], geo: near(km), alreadySent: [] });

  it("箱の見本が狙った距離になっている", () => {
    expect(distanceToMuniKm(FAR_B, GEO_A, near(10.4))).toBeCloseTo(10.4, 1);
    expect(distanceToMuniKm(FAR_B, GEO_A, near(11.1))).toBeCloseTo(11.1, 1);
  });
  it("10.4km → ① すぐ、11.1km → 送らない", () => {
    expect(table(plan(10.4))).toEqual({ fr: "immediate/1" });
    expect(plan(10.4)[0]!.relationKind).toBe("within_radius");
    expect(plan(11.1)).toEqual([]);
  });
});

describe("planCaseNotices: 距離の帯（事例ごとのメールに入れない）", () => {
  const MESH = "53394611";
  const FARM_TOWN = "13101";
  const BAND_TOWN = "13102"; // 農場から 30km。隣でない
  const bandGeo = () =>
    makeGeo(
      [
        { code: FARM_TOWN, name: "農場町", geometry: boxAround(MESH) },
        { code: BAND_TOWN, name: "帯町", geometry: boxNorthOf(MESH, 30) },
      ],
      { preload: true },
    );
  const bandCase = (o: Partial<Case> = {}) => caseFixture({ muniCode: BAND_TOWN, muniName: "帯町", prefCode: "13", ...o });
  const bandFarm = (o: Partial<F> = {}): F => farmWithId("f", "u", { meshCode: MESH, muniCode: FARM_TOWN, prefCode: "13", ...o });
  const lift = { confirmed: stage("2026-11-04"), shipment_lifted: stage("2026-12-01"), movement_lifted: stage("2026-12-20") };

  it("帯だけの農場には、疑い、確定、否定、解除のどれも送らない", () => {
    const cases: Array<[NoticeEvent, Case]> = [
      ["suspected", bandCase({ stages: { suspected: stage("2026-11-04") } })],
      ["confirmed", bandCase()],
      ["negated", bandCase({ negation: "negated", negatedAt: "2026-11-05T10:00:00+09:00" })],
      ["shipment_lifted", bandCase({ stages: { confirmed: stage("2026-11-04"), shipment_lifted: stage("2026-12-01") } })],
      ["movement_lifted", bandCase({ stages: lift })],
    ];
    for (const [event, caseDoc] of cases) {
      expect(planCaseNotices({ event, caseDoc, farms: [bandFarm()], geo: bandGeo(), alreadySent: [] }), event).toEqual([]);
    }
  });

  it("疑いや確定を受け取っていた会員への否定の訂正は、帯でも ④ と同じく朝に届く", () => {
    const caseDoc = bandCase({ negation: "negated", negatedAt: "2026-11-05T10:00:00+09:00" });
    const out = planCaseNotices({ event: "negated", caseDoc, farms: [bandFarm()], geo: bandGeo(), alreadySent: [sent("f", "u", caseDoc.id, "suspected")] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ isCorrection: true, timing: "morning", level: 4, relationKind: null });
  });

  it("帯の中の登録した町は、今までどおり登録した町として朝に届く", () => {
    const f = bandFarm({ frequentMuniCodes: [BAND_TOWN] });
    const out = planCaseNotices({ event: "confirmed", caseDoc: bandCase(), farms: [f], geo: bandGeo(), alreadySent: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ timing: "morning", level: 3, relationKind: "frequent" });
    const { text } = renderNotice(out[0]!, { unsubscribeUrl: "https://example.invalid/u", appUrl: "https://example.invalid" });
    expect(text).toContain("登録した町で発生しました。");
  });

  it("帯の中の登録した町でも、③の知らせを切った農場には届かない", () => {
    const f = bandFarm({ frequentMuniCodes: [BAND_TOWN], notify: { level1: true, level2: true, level3: false, morningDigest: true, selfCheckRemindDays: null } });
    expect(planCaseNotices({ event: "confirmed", caseDoc: bandCase(), farms: [f], geo: bandGeo(), alreadySent: [] })).toEqual([]);
  });
});

describe("planCaseNotices: 否定（訂正）", () => {
  const neg = () => suspectedCase({ negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" });
  it("疑いか確定を受け取った会員には isCorrection:true。受け取っていない ① は false", () => {
    const already = [sent("f1", "u1", neg().id, "suspected")];
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: already });
    expect(out.find((n) => n.farmId === "f1")!.isCorrection).toBe(true);
    expect(out.find((n) => n.farmId === "f2")!.isCorrection).toBe(false);
    expect(planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f1", "u1", neg().id, "confirmed")] })[0]!.isCorrection).toBe(true);
  });
  it("送れた（sent）記録にだけ当たる。queued や failed は、まだ届いていないので訂正にしない", () => {
    for (const state of ["queued", "failed"] as const) {
      const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f2", "u2", neg().id, "suspected", state)] });
      expect(out.find((n) => n.farmId === "f2")).toMatchObject({ isCorrection: false, timing: "morning" });
    }
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f2", "u2", neg().id, "suspected", "sent")] });
    expect(out.find((n) => n.farmId === "f2")!.isCorrection).toBe(true);
  });
  it("今は ④ で、疑いの記録が queued だけの会員には、訂正も【お知らせ】も出さない（届いていない）", () => {
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f4", "u4", neg().id, "suspected", "queued")] });
    expect(out.find((n) => n.farmId === "f4")).toBeUndefined();
  });
  it("別の事例や別の会員の記録では訂正にならない", () => {
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f1", "u1", "other-case", "suspected"), sent("f2", "uX", neg().id, "suspected")] });
    expect(out.every((n) => !n.isCorrection)).toBe(true);
  });
  it("今は ④ でも、受け取った会員には朝に届く", () => {
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f4", "u4", neg().id, "suspected")] });
    expect(out.find((n) => n.farmId === "f4")).toMatchObject({ timing: "morning", level: 4, relationKind: null, isCorrection: true });
  });
  it("段階の設定と朝のまとめを切っていても訂正は届く", () => {
    const fs = farms().map((f) => (f.id === "f2" ? { ...f, notify: { ...f.notify, level2: false, morningDigest: false } } : f));
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: fs, geo: geo(), alreadySent: [sent("f2", "u2", neg().id, "confirmed")] });
    expect(out.find((n) => n.farmId === "f2")).toMatchObject({ isCorrection: true, timing: "morning" });
  });
  it("配信停止の会員には訂正も届かない", () => {
    const fs = farms().map((f) => (f.id === "f1" ? { ...f, unsubscribedUids: ["u1"] } : f));
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: fs, geo: geo(), alreadySent: [sent("f1", "u1", neg().id, "suspected")] });
    expect(out.find((n) => n.farmId === "f1")).toBeUndefined();
  });
  it("①が受け取っていて今も ① なら、訂正はすぐ", () => {
    const out = planCaseNotices({ event: "negated", caseDoc: neg(), farms: farms(), geo: geo(), alreadySent: [sent("f1", "u1", neg().id, "suspected")] });
    expect(out.find((n) => n.farmId === "f1")).toMatchObject({ timing: "immediate", isCorrection: true });
  });
});

describe("planCaseNotices: 確認中", () => {
  const rev = () => caseFixture({ id: "rev-d1", prefCode: "33", muniCode: null, muniName: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.test/pdf1"] });
  it("同じ県の農場へすぐ送る。他の県へは送らない。level と relationKind は null", () => {
    const out = planCaseNotices({ event: "reviewing", caseDoc: rev(), farms: farms(), geo: geo(), alreadySent: [] });
    expect(table(out)).toEqual({ f1: "immediate/null", f2: "immediate/null" });
    expect(out[0]).toMatchObject({ level: null, relationKind: null, isCorrection: false, subjectId: "rev-d1" });
    expect(out[0]!.facts).toMatchObject({ muniName: null, prefCode: "33", sourceUrl: "https://example.test/pdf1" });
  });
  it("段階の設定や朝のまとめを切っていても届く。配信停止の会員には届かない", () => {
    const fs = farms().map((f) =>
      f.id === "f1" ? { ...f, notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null } } : f.id === "f2" ? { ...f, unsubscribedUids: ["u2"] } : f,
    );
    const out = planCaseNotices({ event: "reviewing", caseDoc: rev(), farms: fs, geo: geo(), alreadySent: [] });
    expect(table(out)).toEqual({ f1: "immediate/null" });
  });
  it("距離を計算しない（県を読む前の GeoStore でも落ちない）", () => {
    expect(() => planCaseNotices({ event: "reviewing", caseDoc: rev(), farms: farms(), geo: fakeGeo(), alreadySent: [] })).not.toThrow();
  });
});

describe("planCaseNotices: 確認中の続報（Q-m）", () => {
  const rev = () => caseFixture({ id: "rev-d2", prefCode: "33", muniCode: null, muniName: null, stages: {}, confirmState: "reviewing", sourceUrls: ["https://example.test/pdf2"] });
  it("reviewingCovered に入った会員には出さない。入っていない会員には出す", () => {
    const out = planCaseNotices({ event: "reviewing", caseDoc: rev(), farms: farms(), geo: geo(), alreadySent: [], reviewingCovered: new Set([memberKeyOf("f1", "u1")]) });
    expect(table(out)).toEqual({ f2: "immediate/null" });
  });
  it("reviewingCovered を渡さなければ今までどおり全員に出す（減らさない側）", () => {
    expect(table(planCaseNotices({ event: "reviewing", caseDoc: rev(), farms: farms(), geo: geo(), alreadySent: [] }))).toEqual({ f1: "immediate/null", f2: "immediate/null" });
  });
  it("reviewingCovered は確認中だけに効く。疑いと確定は止めない", () => {
    const covered = new Set([memberKeyOf("f1", "u1"), memberKeyOf("f2", "u2"), memberKeyOf("f3", "u3")]);
    const out = planCaseNotices({ event: "confirmed", caseDoc: caseFixture(), farms: farms(), geo: geo(), alreadySent: [], reviewingCovered: covered });
    expect(table(out)).toEqual({ f1: "immediate/1", f2: "morning/2", f3: "morning/3" });
  });
  it("reviewingCovered を渡しても、否定（訂正）と解除の知らせは減らない", () => {
    const covered = new Set([memberKeyOf("f1", "u1"), memberKeyOf("f2", "u2"), memberKeyOf("f3", "u3")]);
    const neg = suspectedCase({ negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" });
    const prior = [sent("f1", "u1", neg.id, "suspected"), sent("f2", "u2", neg.id, "suspected")];
    const base = { caseDoc: neg, farms: farms(), geo: geo(), alreadySent: prior };
    expect(planCaseNotices({ ...base, event: "negated" })).toEqual(planCaseNotices({ ...base, event: "negated", reviewingCovered: covered }));
    expect(planCaseNotices({ ...base, event: "negated", reviewingCovered: covered }).filter((n) => n.isCorrection)).toHaveLength(2);
    const lifted = caseFixture({ stages: { confirmed: stage("2026-11-01"), shipment_lifted: stage("2026-11-04"), movement_lifted: stage("2026-11-05") } });
    for (const event of ["shipment_lifted", "movement_lifted"] as const) {
      const lb = { event, caseDoc: lifted, farms: farms(), geo: geo(), alreadySent: [] as SentNotice[] };
      const withCovered = planCaseNotices({ ...lb, reviewingCovered: covered });
      expect(withCovered).toEqual(planCaseNotices(lb));
    }
    expect(planCaseNotices({ event: "movement_lifted", caseDoc: lifted, farms: farms(), geo: geo(), alreadySent: [], reviewingCovered: covered }).length).toBeGreaterThan(0);
  });
});

describe("reviewingCoveredMembers: 同じ県の確認中が開いている間に、すでに知らせた会員", () => {
  const NOW = new Date("2026-11-10T03:00:00Z");
  const rec = (farmId: string, uid: string, subjectId: string, over: Partial<SentNotice> = {}): SentNotice => ({ ...sent(farmId, uid, subjectId, "reviewing"), queuedAt: "2026-11-09T10:00:00+09:00", ...over });
  const run = (records: SentNotice[], open = ["rev-d1"]) => reviewingCoveredMembers({ openIds: new Set(open), records, now: NOW });

  it("開いている確認中の知らせが届いた（sent）会員を返す", () => {
    expect([...run([rec("f1", "u1", "rev-d1")])]).toEqual([memberKeyOf("f1", "u1")]);
  });
  it("queued は 10 分以内だけ数える（いま送っている最中）。10 分をこえた queued は数えない（送り直しの対象で、届くかわからない）", () => {
    const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
    expect(run([rec("f1", "u1", "rev-d1", { state: "queued", queuedAt: at(5) }), rec("f2", "u2", "rev-d1", { state: "queued", queuedAt: at(REVIEWING_QUEUED_GRACE_MINUTES) })]).size).toBe(2);
    expect(run([rec("f1", "u1", "rev-d1", { state: "queued", queuedAt: at(REVIEWING_QUEUED_GRACE_MINUTES + 1) })]).size).toBe(0);
  });
  it("failed は数えない（届いていない。送り直しの前に事例が閉じると、1 通も届かなくなるため）", () => {
    expect(run([rec("f1", "u1", "rev-d1", { state: "failed", queuedAt: new Date(NOW.getTime() - 60_000).toISOString() })]).size).toBe(0);
  });
  it("abandoned と capped は数えない（届いていない）", () => {
    expect(run([rec("f1", "u1", "rev-d1", { state: "abandoned" }), rec("f2", "u2", "rev-d1", { state: "capped" })]).size).toBe(0);
  });
  it("閉じた確認中（開いている id にない）の知らせは数えない", () => {
    expect(run([rec("f1", "u1", "rev-closed")]).size).toBe(0);
  });
  it("確認中以外の知らせは数えない", () => {
    expect(run([rec("f1", "u1", "rev-d1", { event: "confirmed" })]).size).toBe(0);
  });
  it(`知らせてから ${REVIEWING_QUIET_DAYS} 日より古ければ数えない（開いたままの古い確認中で、新しい発生を黙らせない）`, () => {
    const edge = new Date(NOW.getTime() - REVIEWING_QUIET_DAYS * 86_400_000).toISOString();
    const old = new Date(NOW.getTime() - REVIEWING_QUIET_DAYS * 86_400_000 - 1000).toISOString();
    expect(run([rec("f1", "u1", "rev-d1", { queuedAt: edge })]).size).toBe(1);
    expect(run([rec("f1", "u1", "rev-d1", { queuedAt: old })]).size).toBe(0);
  });
  it("時刻が読み込めない記録は数えない（減らさない側）", () => {
    expect(run([rec("f1", "u1", "rev-d1", { queuedAt: "x" })]).size).toBe(0);
  });
  it("開いている確認中がなければ空", () => {
    expect(run([rec("f1", "u1", "rev-d1")], []).size).toBe(0);
  });
});

describe("planCaseNotices: 設定、配信停止、記録", () => {
  const run = (fs: F[], event: NoticeEvent = "confirmed", already: SentNotice[] = []) => planCaseNotices({ event, caseDoc: caseFixture(), farms: fs, geo: geo(), alreadySent: already });
  const patch = (id: string, over: Partial<F>): F[] => farms().map((f) => (f.id === id ? { ...f, ...over } : f));
  const off = { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null };

  it("配信停止の会員には届かない（他の会員には届く）", () => {
    const fs = patch("f1", { memberUids: ["u1", "u1b"], unsubscribedUids: ["u1"] });
    const out = run(fs);
    expect(out.filter((n) => n.farmId === "f1").map((n) => n.uid)).toEqual(["u1b"]);
  });
  it("切った段階には届かない", () => {
    expect(table(run(patch("f1", { notify: { ...off, level1: false } })))).toEqual({ f2: "morning/2", f3: "morning/3" });
    expect(table(run(patch("f2", { notify: { ...off, level2: false } })))).toEqual({ f1: "immediate/1", f3: "morning/3" });
    expect(table(run(patch("f3", { notify: { ...off, level3: false } })))).toEqual({ f1: "immediate/1", f2: "morning/2" });
  });
  it("朝のまとめを切ると ②③ は届かず ① は届く", () => {
    const fs = farms().map((f) => ({ ...f, notify: { ...off, morningDigest: false } }));
    expect(table(run(fs))).toEqual({ f1: "immediate/1" });
  });
  it("解除は全部が朝なので、朝のまとめを切ると ① にも届かない", () => {
    const fs = farms().map((f) => ({ ...f, notify: { ...off, morningDigest: false } }));
    const c = caseFixture({ stages: { confirmed: stage("2026-11-05"), shipment_lifted: stage("2026-11-15") } });
    expect(planCaseNotices({ event: "shipment_lifted", caseDoc: c, farms: fs, geo: geo(), alreadySent: [] })).toEqual([]);
  });
  it("記録のある知らせは出ない（記録の状態によらない）", () => {
    const c = caseFixture();
    expect(table(run(farms(), "confirmed", [sent("f1", "u1", c.id, "confirmed")]))).toEqual({ f2: "morning/2", f3: "morning/3" });
    expect(table(run(farms(), "confirmed", [sent("f2", "u2", c.id, "confirmed", "failed")]))).toEqual({ f1: "immediate/1", f3: "morning/3" });
    // 別の出来事の記録は関係しない
    expect(table(run(farms(), "confirmed", [sent("f1", "u1", c.id, "suspected")]))).toEqual({ f1: "immediate/1", f2: "morning/2", f3: "morning/3" });
  });
  it("会員の読み込めない農場（配信停止の欄が配列でない）は送らない側に倒す", () => {
    const broken = patch("f1", { unsubscribedUids: undefined as unknown as string[] });
    expect(table(run(broken))).toEqual({ f2: "morning/2", f3: "morning/3" });
    const noMembers = patch("f1", { memberUids: undefined as unknown as string[] });
    expect(table(run(noMembers))).toEqual({ f2: "morning/2", f3: "morning/3" });
  });
  it("段階の設定が欠けた農場は、既定（全部入）として扱う（① を見逃さない側）", () => {
    const noNotify = patch("f1", { notify: undefined as unknown as Farm["notify"] });
    expect(table(run(noNotify))).toMatchObject({ f1: "immediate/1" });
  });
  it("県を読む前の GeoStore は、④ にせず GeoNotLoadedError を投げる", () => {
    expect(() => planCaseNotices({ event: "confirmed", caseDoc: caseFixture(), farms: farms(), geo: fakeGeo(), alreadySent: [] })).toThrow(GeoNotLoadedError);
  });
  it("否定された事例でも距離を計算できる", () => {
    const c = caseFixture({ negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" });
    const out = planCaseNotices({ event: "negated", caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] });
    expect(table(out)).toEqual({ f1: "immediate/1", f2: "morning/2", f3: "morning/3" });
  });
  it("確認中以外の事例の市町村が分からないとき（muniCode が null）は ④ として送らない", () => {
    const c = caseFixture({ muniCode: null, muniName: null });
    expect(planCaseNotices({ event: "confirmed", caseDoc: c, farms: farms(), geo: geo(), alreadySent: [] })).toEqual([]);
  });
  it("1 つの農場のデータが壊れていても（メッシュが不正）、その農場だけ飛ばして他へは出す。県を読む前の例外は飛ばさない", () => {
    const fs = farms().map((f) => (f.id === "f2" ? { ...f, meshCode: "abc" } : f));
    expect(table(run(fs))).toEqual({ f1: "immediate/1", f3: "morning/3" });
    expect(() => planCaseNotices({ event: "confirmed", caseDoc: caseFixture(), farms: farms(), geo: fakeGeo(), alreadySent: [] })).toThrow(GeoNotLoadedError);
  });
  it("事例の出来事でない出来事は受けない", () => {
    expect(() => planCaseNotices({ event: "wild_bird_confirmed", caseDoc: caseFixture(), farms: farms(), geo: geo(), alreadySent: [] })).toThrow(RangeError);
  });
});
