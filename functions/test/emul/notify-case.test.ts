// M-02: 事例の書き込みで、誰にいつどの文面を送るか。模擬環境（demo-hpai）。本物のメールは送らない。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeReviewingCase } from "@hpai/shared/cases";
import { planCaseNotices, REVIEWING_QUEUED_GRACE_MINUTES } from "@hpai/shared/notices";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import type { Case } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { dispatchNotices, noteMailStop } from "../../src/notify/dispatch";
import { STALE_IMMEDIATE_MINUTES } from "../../src/notify/digest";
import { handleCaseWrite } from "../../src/notify/onCaseWritten";
import { extractPdfText } from "../../src/watch/extract";
import { describeFixture } from "../helpers/fixtures";
import { caseFixture, FAR_B, fakeGeo, GEO_A, GEO_B, GEO_D, IN_A, IN_D } from "../../../shared/test/helpers/mFixtures";
import { assertEmulator, captureLogs, clearFirestore, makeDeps, NOW, reviewQueueIds, seedFarm, sentNoticeDocs } from "./mHelpers";

beforeAll(assertEmulator);
beforeEach(clearFirestore);

const stage = (date: string) => ({ date, time: null });
const suspected = (over: Partial<Case> = {}) => caseFixture({ stages: { suspected: stage("2026-11-04") }, ...over });
const negated = () => suspected({ negation: "negated", negatedAt: "2026-11-06T09:00:00+09:00" });
const idOf = (farmId: string, uid: string, c: Case, event: string) => `${farmId}__${uid}__${c.id}__${event}`;

/** f1 ①（A の内）、f2 ②（B で遠い）、f3 ③（D、登録した町に A）、f4 ④（D）。 */
async function seedFour(): Promise<void> {
  await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
  await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
  await seedFarm("f3", "u3", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34", frequentMuniCodes: [GEO_A] });
  await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
}

describe("handleCaseWrite: 疑い", () => {
  it("① はすぐ送って sent、②③ は queued、④ は記録なし", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected();
    await handleCaseWrite(deps, null, c, fakeGeo());

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("u1@example.test");
    expect(mail.sent[0]!.subject.startsWith("【疑い】")).toBe(true);

    const docs = await sentNoticeDocs();
    expect(Object.keys(docs).sort()).toEqual([idOf("f1", "u1", c, "suspected"), idOf("f2", "u2", c, "suspected"), idOf("f3", "u3", c, "suspected")].sort());
    expect(docs[idOf("f1", "u1", c, "suspected")]).toMatchObject({ farmId: "f1", uid: "u1", subjectId: c.id, event: "suspected", timing: "immediate", state: "sent", queuedAt: "2026-11-05T12:00:00+09:00", sentAt: "2026-11-05T12:00:00+09:00" });
    expect(docs[idOf("f2", "u2", c, "suspected")]).toMatchObject({ timing: "morning", state: "queued", sentAt: null });
    expect(docs[idOf("f3", "u3", c, "suspected")]).toMatchObject({ timing: "morning", state: "queued", sentAt: null });
  });

  it("記録にはメールアドレスや農場名を入れない（決まったキーだけ）", async () => {
    await seedFour();
    const { deps } = makeDeps();
    await handleCaseWrite(deps, null, suspected(), fakeGeo());
    for (const d of Object.values(await sentNoticeDocs())) {
      expect(Object.keys(d).sort()).toEqual(["event", "farmId", "queuedAt", "sentAt", "state", "subjectId", "timing", "uid"]);
    }
  });

  it("同じ書き込みの 2 回目で 1 通のまま、記録も増えない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected();
    await handleCaseWrite(deps, null, c, fakeGeo());
    await handleCaseWrite(deps, null, c, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(Object.keys(await sentNoticeDocs())).toHaveLength(3);
  });

  it("並べて同時に 2 回走っても、1 通のまま（create で重複を止める）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected();
    await Promise.all([handleCaseWrite(deps, null, c, fakeGeo()), handleCaseWrite(deps, null, c, fakeGeo())]);
    expect(mail.sent).toHaveLength(1);
  });

  it("after が null（削除）と再現（replay）は何もしない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, suspected(), null, fakeGeo());
    await handleCaseWrite(deps, null, suspected({ confirmState: "replay" }), fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("変化のない書き込みは何もしない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = caseFixture();
    await handleCaseWrite(deps, c, { ...c, updatedAt: "2026-11-06T00:00:00+09:00" }, fakeGeo());
    expect(mail.calls).toEqual([]);
  });

  it("県を読む前の GeoStore でも落ちない（先に県を読む）。否定された事例でも距離を計算できる", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const before = suspected();
    await handleCaseWrite(deps, before, negated(), fakeGeo());
    // 受け取っていない ① は【お知らせ】で、すぐ届く
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject.startsWith("【お知らせ】")).toBe(true);
  });
});

describe("handleCaseWrite: 今季の新しい出来事だけ", () => {
  const old = (over: Partial<Case> = {}) => caseFixture({ id: "h2025-3", season: 2025, confirmState: "national", stages: { confirmed: stage("2026-01-10") }, ...over });

  it("前季の事例（h…、national）を書いても、メールも記録も出ない。解除の段階があっても同じ", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, null, old(), fakeGeo());
    await handleCaseWrite(deps, null, old({ id: "h2025-4", stages: { confirmed: stage("2026-01-10"), shipment_lifted: stage("2026-01-20"), movement_lifted: stage("2026-02-01") } }), fakeGeo());
    await handleCaseWrite(deps, old({ id: "h2025-5" }), old({ id: "h2025-5", negation: "negated", negatedAt: "2026-02-01T09:00:00+09:00" }), fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("シーズンの切れ目: 今季の初日（6/1）からは今季の事例として送る", async () => {
    await seedFour();
    const { deps, mail } = makeDeps({ now: () => new Date("2026-06-01T03:00:00Z") });
    await handleCaseWrite(deps, null, caseFixture({ season: 2026, stages: { confirmed: stage("2026-06-01") } }), fakeGeo());
    expect(mail.sent).toHaveLength(1);
  });

  it("今季でも、段階の日付が 14 日より前の変化は出さない（14 日前までは出す）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps(); // 2026-11-05
    await handleCaseWrite(deps, null, caseFixture({ id: "c-old", stages: { confirmed: stage("2026-10-21") } }), fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
    await handleCaseWrite(deps, null, caseFixture({ id: "c-edge", stages: { confirmed: stage("2026-10-22") } }), fakeGeo());
    expect(mail.sent).toHaveLength(1);
    // 古い事例への遅れた解除も出さない
    await handleCaseWrite(deps, caseFixture({ id: "c-old" , stages: { confirmed: stage("2026-10-01") } }), caseFixture({ id: "c-old", stages: { confirmed: stage("2026-10-01"), movement_lifted: stage("2026-10-15") } }), fakeGeo());
    expect(Object.keys(await sentNoticeDocs()).filter((k) => k.includes("c-old"))).toEqual([]);
  });

  it("出来事ごとに判断する: 古い確定と新しい解除が同時なら、解除だけ出す", async () => {
    await seedFour();
    const { deps } = makeDeps();
    const before = caseFixture({ id: "c-mix", stages: { confirmed: stage("2026-10-01") } });
    const after = caseFixture({ id: "c-mix", stages: { confirmed: stage("2026-10-01"), movement_lifted: stage("2026-11-04") } });
    await handleCaseWrite(deps, before, after, fakeGeo());
    expect(Object.keys(await sentNoticeDocs()).every((k) => k.endsWith("__movement_lifted"))).toBe(true);
  });
});

describe("handleCaseWrite: 否定（訂正）", () => {
  it("疑いを受け取った全員へ【訂正】: ① はすぐ、②③ は朝。④ と受け取っていない人には出ない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const s = suspected();
    await handleCaseWrite(deps, null, s, fakeGeo());
    expect(mail.sent).toHaveLength(1);

    await handleCaseWrite(deps, s, negated(), fakeGeo());
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]!.to).toBe("u1@example.test");
    expect(mail.sent[1]!.subject.startsWith("【訂正】")).toBe(true);

    const docs = await sentNoticeDocs();
    const n = negated();
    expect(docs[idOf("f1", "u1", n, "negated")]).toMatchObject({ state: "sent", timing: "immediate" });
    expect(docs[idOf("f2", "u2", n, "negated")]).toMatchObject({ state: "queued", timing: "morning" });
    expect(docs[idOf("f3", "u3", n, "negated")]).toMatchObject({ state: "queued", timing: "morning" });
    expect(docs[idOf("f4", "u4", n, "negated")]).toBeUndefined();
  });
});

describe("handleCaseWrite: 確認中", () => {
  const rev = () => makeReviewingCase({ documentId: "d1", season: 2026, prefCode: "33", sourceUrl: "https://example.test/pdf1" }, NOW);

  it("同じ県の会員へすぐ送る（設定で止めない）。他の県には送らない。市町村を書かない", async () => {
    await seedFour();
    await db.doc("farms/f1").update({ notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null } });
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, null, rev(), fakeGeo());
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
    for (const m of mail.sent) {
      expect(m.subject).toBe("【確認中】岡山県の発表を確認しています");
      expect(m.text).not.toContain("町A");
    }
    const docs = await sentNoticeDocs();
    expect(Object.values(docs).every((d) => d.timing === "immediate" && d.state === "sent")).toBe(true);
    expect(Object.keys(docs)).toHaveLength(2);
  });

  it("配信停止の会員には送らない", async () => {
    await seedFour();
    await db.doc("farms/f1").update({ unsubscribedUids: ["u1"] });
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, null, rev(), fakeGeo());
    expect(mail.sent.map((m) => m.to)).toEqual(["u2@example.test"]);
  });
});

// ── 確認中の続報（Q-m の B: 同じ県の確認中が開いている間は、最初の 1 通だけ）──
describe("handleCaseWrite: 確認中の続報は 1 通だけ（Q-m）", () => {
  const revIn = (id: string, prefCode: string, now: Date = NOW) => makeReviewingCase({ documentId: id, season: 2026, prefCode, sourceUrl: `https://example.test/pdf/${id}` }, now);
  /** onCaseWritten と同じ順: 事例を cases に書いてから、書き込みの処理を呼ぶ。 */
  async function arrive(deps: ReturnType<typeof makeDeps>["deps"], c: Case): Promise<void> {
    await db.doc(`cases/${c.id}`).set(c);
    await handleCaseWrite(deps, null, c, fakeGeo());
  }
  const closeRev = (id: string) => db.doc(`cases/${id}`).delete();
  const reviewingDocs = async () => Object.keys(await sentNoticeDocs()).filter((k) => k.endsWith("__reviewing"));

  it("同じ県の確認中の文書が続けて来ても、会員 1 人に確認中のメールは 1 通。記録も増えない", async () => {
    await seedFour(); // f1、f2 は 33 県
    const { deps, mail } = makeDeps();
    for (let i = 1; i <= 6; i++) await arrive(deps, revIn(`d${i}`, "33"));
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
    expect(await reviewingDocs()).toEqual([idOf("f1", "u1", revIn("d1", "33"), "reviewing"), idOf("f2", "u2", revIn("d1", "33"), "reviewing")].sort());
  });

  it("確認中が開いている間でも、疑い、確定は今までどおり届く（① すぐ、②③ 朝の記録）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent).toHaveLength(2); // 確認中の 1 通ずつ
    const c = caseFixture({ stages: { confirmed: stage("2026-11-04") } });
    await db.doc(`cases/${c.id}`).set(c);
    await handleCaseWrite(deps, null, c, fakeGeo());
    expect(mail.sent.filter((m) => m.subject.startsWith("【確定】")).map((m) => m.to)).toEqual(["u1@example.test"]);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", c, "confirmed")]).toMatchObject({ state: "queued", timing: "morning" });
    expect(docs[idOf("f3", "u3", c, "confirmed")]).toMatchObject({ state: "queued", timing: "morning" });
  });

  it("確認中が閉じた（rev- が消えた）後に、同じ県で新しい確認中が開いたら、また 1 通届く", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent).toHaveLength(2);
    await closeRev("rev-d1");
    await closeRev("rev-d2");
    await arrive(deps, revIn("d3", "33"));
    await arrive(deps, revIn("d4", "33"));
    expect(mail.sent).toHaveLength(4);
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u1@example.test", "u2@example.test", "u2@example.test"]);
  });

  it("知らせた確認中が閉じて、知らせていない別の確認中が開いたままなら、次の文書で 1 通送る（減らさない側）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    await arrive(deps, revIn("d2", "33"));
    await closeRev("rev-d1"); // d1 が閉じても d2 は開いている。ただし知らせた d1 は閉じたので、数え直す
    await arrive(deps, revIn("d3", "33"));
    // 知らせの元になった d1 は閉じ、d2 には知らせていないので、d3 は新しい 1 通として届く（減らさない側）
    expect(mail.sent).toHaveLength(4);
    await arrive(deps, revIn("d4", "33"));
    expect(mail.sent).toHaveLength(4); // d3 の知らせが開いているので黙る
  });

  it("別の県の確認中は、県ごとに 1 通ずつ届く", async () => {
    await seedFour(); // f1、f2 は 33 県、f3、f4 は 34 県
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("a1", "33"));
    await arrive(deps, revIn("b1", "34"));
    await arrive(deps, revIn("a2", "33"));
    await arrive(deps, revIn("b2", "34"));
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test", "u3@example.test", "u4@example.test"]);
    expect(mail.sent.filter((m) => m.subject.includes("岡山県"))).toHaveLength(2);
    expect(mail.sent.filter((m) => m.subject.includes("広島県"))).toHaveLength(2);
  });

  it("確認中が開いた後に入った会員は、続報の最初の 1 通を受け取る（すでに知らせた会員には送らない）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    expect(mail.sent).toHaveLength(2);
    await seedFarm("f5", "u5", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent.map((m) => m.to)).toEqual(["u1@example.test", "u2@example.test", "u5@example.test"]);
  });

  it("知らせた記録が abandoned（届いていない）なら、続報で送る", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    await db.doc(`sentNotices/${idOf("f1", "u1", revIn("d1", "33"), "reviewing")}`).update({ state: "abandoned" });
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent.filter((m) => m.to === "u1@example.test")).toHaveLength(2);
    expect(mail.sent.filter((m) => m.to === "u2@example.test")).toHaveLength(1);
  });

  it("最初の 1 通から 14 日をこえて開いたままなら、続報でもう一度送る（古い確認中で新しい発表を黙らせない）", async () => {
    await seedFour();
    const first = makeDeps();
    await arrive(first.deps, revIn("d1", "33"));
    expect(first.mail.sent).toHaveLength(2);
    // 13 日後: 黙る
    const d13 = new Date(NOW.getTime() + 13 * 86_400_000);
    const a = makeDeps({ now: () => d13 });
    await arrive(a.deps, revIn("d2", "33", d13));
    expect(a.mail.sent).toHaveLength(0);
    // 15 日後: 送る
    const d15 = new Date(NOW.getTime() + 15 * 86_400_000);
    const b = makeDeps({ now: () => d15 });
    await arrive(b.deps, revIn("d3", "33", d15));
    expect(b.mail.sent).toHaveLength(2);
  });

  it("1 通目が failed のまま続報が来たら、その会員に送る（数えるのは sent と、いま送っている最中の queued だけ）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    expect(mail.sent).toHaveLength(2);
    await db.doc(`sentNotices/${idOf("f1", "u1", revIn("d1", "33"), "reviewing")}`).update({ state: "failed", sentAt: null });
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent.filter((m) => m.to === "u1@example.test")).toHaveLength(2);
    expect(mail.sent.filter((m) => m.to === "u2@example.test")).toHaveLength(1);
  });

  it("「いま送っている最中」の 10 分は、送り直しが queued を拾う待ち（digest.ts）と同じ値", () => {
    expect(REVIEWING_QUEUED_GRACE_MINUTES).toBe(STALE_IMMEDIATE_MINUTES);
  });

  it("10 分をこえて queued のままの記録は数えない。10 分以内の queued は数える", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    const queuedAt = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
    await db.doc(`sentNotices/${idOf("f1", "u1", revIn("d1", "33"), "reviewing")}`).update({ state: "queued", sentAt: null, queuedAt: queuedAt(30) });
    await db.doc(`sentNotices/${idOf("f2", "u2", revIn("d1", "33"), "reviewing")}`).update({ state: "queued", sentAt: null, queuedAt: queuedAt(5) });
    await arrive(deps, revIn("d2", "33"));
    expect(mail.sent.filter((m) => m.to === "u1@example.test")).toHaveLength(2);
    expect(mail.sent.filter((m) => m.to === "u2@example.test")).toHaveLength(1);
  });

  it("ほぼ同時に書かれた 2 件の確認中は、会員 1 人あたり 1〜2 通（2 通を超えない）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const a = revIn("d1", "33");
    const b = revIn("d2", "33");
    await Promise.all([db.doc(`cases/${a.id}`).set(a), db.doc(`cases/${b.id}`).set(b)]);
    await Promise.all([handleCaseWrite(deps, null, a, fakeGeo()), handleCaseWrite(deps, null, b, fakeGeo())]);
    for (const to of ["u1@example.test", "u2@example.test"]) {
      const n = mail.sent.filter((m) => m.to === to).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
    expect(mail.sent.filter((m) => m.to === "u3@example.test" || m.to === "u4@example.test")).toHaveLength(0);
  });

  it("前季の rev- と、その知らせの記録（14 日以内）があっても、今季の確認中では 1 通出る", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const old = { ...revIn("old1", "33"), season: 2025 };
    await db.doc(`cases/${old.id}`).set(old);
    for (const [farmId, uid] of [["f1", "u1"], ["f2", "u2"]] as const) {
      await db.doc(`sentNotices/${idOf(farmId, uid, old, "reviewing")}`).set({ farmId, uid, subjectId: old.id, event: "reviewing", timing: "immediate", state: "sent", queuedAt: NOW.toISOString(), sentAt: NOW.toISOString() });
    }
    await arrive(deps, revIn("d1", "33"));
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
  });

  it("開いている確認中が 31 件以上あっても、30 件ずつに分けて記録を読む（31 件目以降の記録も見る）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) {
      const c = revIn(`x${String(i).padStart(2, "0")}`, "33");
      ids.push(c.id);
      await db.doc(`cases/${c.id}`).set(c);
    }
    // 知らせの記録は、並びの最後の確認中（2 つ目のかたまり）にだけある
    const last = ids.sort().at(-1)!;
    await db.doc(`sentNotices/f1__u1__${last}__reviewing`).set({ farmId: "f1", uid: "u1", subjectId: last, event: "reviewing", timing: "immediate", state: "sent", queuedAt: NOW.toISOString(), sentAt: NOW.toISOString() });
    await arrive(deps, revIn("new", "33"));
    expect(mail.sent.map((m) => m.to)).toEqual(["u2@example.test"]); // u1 は知らせ済みなので黙り、u2 には送る
  });

  it("開いている確認中が 200 件を超えたら、読むのをやめて送る側に倒す", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const batch = db.batch();
    for (let i = 0; i < 205; i++) {
      const c = revIn(`y${String(i).padStart(3, "0")}`, "33");
      batch.set(db.doc(`cases/${c.id}`), c);
    }
    await batch.commit();
    await db.doc("sentNotices/f1__u1__rev-y000__reviewing").set({ farmId: "f1", uid: "u1", subjectId: "rev-y000", event: "reviewing", timing: "immediate", state: "sent", queuedAt: NOW.toISOString(), sentAt: NOW.toISOString() });
    const logs = captureLogs();
    try {
      await arrive(deps, revIn("new", "33"));
    } finally {
      logs.restore();
    }
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
  });

  it("開いている確認中を調べる読み込みが失敗しても、送る側に倒す", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await arrive(deps, revIn("d1", "33"));
    const realDb = deps.db;
    const failing = new Proxy(realDb, {
      get(t, k, r) {
        if (k === "collection") {
          return (name: string) => {
            if (name === "cases") throw new Error("読み込みの失敗");
            return t.collection(name);
          };
        }
        const v = Reflect.get(t, k, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const logs = captureLogs();
    try {
      const c = revIn("d2", "33");
      await db.doc(`cases/${c.id}`).set(c);
      await handleCaseWrite({ ...deps, db: failing as typeof realDb }, null, c, fakeGeo());
    } finally {
      logs.restore();
    }
    expect(mail.sent).toHaveLength(4);
  });
});

describe("handleCaseWrite: 解除", () => {
  it("①②③ は朝（queued）、④ なし", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const before = caseFixture();
    const after = caseFixture({ stages: { confirmed: stage("2026-11-05"), shipment_lifted: stage("2026-11-15") } });
    await handleCaseWrite(deps, before, after, fakeGeo());
    expect(mail.calls).toEqual([]);
    const docs = await sentNoticeDocs();
    expect(Object.keys(docs).sort()).toEqual([idOf("f1", "u1", after, "shipment_lifted"), idOf("f2", "u2", after, "shipment_lifted"), idOf("f3", "u3", after, "shipment_lifted")].sort());
    expect(Object.values(docs).every((d) => d.timing === "morning" && d.state === "queued")).toBe(true);
  });
});

describe("dispatchNotices: 送信", () => {
  /** u1、u1b が ①（同じ農場 f1）、u5 が別の農場 f5 の ①。 */
  async function seedImmediate() {
    await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33", memberUids: ["u1", "u1b"] });
    await seedFarm("f5", "u5", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
  }
  async function plan(c = caseFixture()) {
    const geo = fakeGeo({ preload: true });
    const farms = (await db.collection("farms").get()).docs.map((d) => ({ id: d.id, ...(d.data() as never as object) })) as never as Parameters<typeof planCaseNotices>[0]["farms"];
    return planCaseNotices({ event: "confirmed", caseDoc: c, farms, geo, alreadySent: [] });
  }

  it("1 回の mailer の宛先は 1 人（農場の会員が 2 人なら 2 回）", async () => {
    await seedImmediate();
    const { deps, mail } = makeDeps();
    const r = await dispatchNotices(deps, await plan());
    expect(r).toEqual({ mailStopped: false, recordFailures: 0 });
    expect(mail.calls.sort()).toEqual(["u1@example.test", "u1b@example.test", "u5@example.test"]);
    expect(mail.calls.every((to) => !/[,;\s]/.test(to))).toBe(true);
  });

  it("1 人の失敗（宛先の不備）で他へ送り続け、その人は failed に残す。mail_failing は入らない。ログにメールアドレスがない", async () => {
    await seedImmediate();
    const logs = captureLogs();
    try {
      const bad = Object.assign(new Error("550 5.1.1 u1@example.test does not exist"), { code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 u1@example.test does not exist" });
      const { deps, mail } = makeDeps({ fail: (to) => (to === "u1@example.test" ? bad : undefined) });
      const c = caseFixture();
      const r = await dispatchNotices(deps, await plan(c));
      expect(r).toEqual({ mailStopped: false, recordFailures: 0 });
      expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1b@example.test", "u5@example.test"]);
      const docs = await sentNoticeDocs();
      expect(docs[idOf("f1", "u1", c, "confirmed")]).toMatchObject({ state: "failed", sentAt: null });
      expect(docs[idOf("f1", "u1b", c, "confirmed")]).toMatchObject({ state: "sent" });
      expect(await reviewQueueIds()).toEqual([]);
      expect(logs.text()).not.toContain("example.test");
    } finally {
      logs.restore();
    }
  });

  it.each([
    ["認証", Object.assign(new Error("Invalid login: 535-5.7.8 u1@example.test"), { code: "EAUTH", responseCode: 535 })],
    ["上限", Object.assign(new Error("550 5.4.5 Daily user sending quota exceeded. u1@example.test"), { responseCode: 550, response: "550 5.4.5 Daily user sending quota exceeded." })],
    ["一時的な制限（421 4.7.0）", Object.assign(new Error("421-4.7.0 Try again later u1@example.test"), { responseCode: 421, response: "421-4.7.0 Try again later, closing connection." })],
    ["通信の時間切れ", Object.assign(new Error("Connection timeout u1@example.test"), { code: "ETIMEDOUT" })],
    ["接続の失敗", Object.assign(new Error("Connection closed u1@example.test"), { code: "ECONNECTION" })],
  ])("%sのエラーは残りへ送らず（連打しない）、失敗した 1 件は failed、残りは queued に残し、mail_failing が 1 日 1 件入り、mailStopped:true", async (_name, stop) => {
    await seedImmediate();
    await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" }); // ②（朝）
    const logs = captureLogs();
    try {
      const { deps, mail } = makeDeps({ fail: () => stop });
      const c = caseFixture();
      const notices = await plan(c);
      expect(notices.map((n) => n.timing)).toEqual(expect.arrayContaining(["immediate", "morning"]));
      const r = await dispatchNotices(deps, notices);
      expect(r).toEqual({ mailStopped: true, recordFailures: 0 });
      expect(mail.calls).toHaveLength(1); // 最初の 1 回だけ
      const docs = await sentNoticeDocs();
      const immediate = notices.filter((n) => n.timing === "immediate");
      expect(immediate).toHaveLength(3);
      expect(docs[idOf(immediate[0]!.farmId, immediate[0]!.uid, c, "confirmed")]).toMatchObject({ state: "failed", sentAt: null });
      for (const n of immediate.slice(1)) expect(docs[idOf(n.farmId, n.uid, c, "confirmed")]).toMatchObject({ state: "queued", timing: "immediate", sentAt: null }); // 送り直し（M-13）が拾う
      expect(docs[idOf("f2", "u2", c, "confirmed")]).toMatchObject({ state: "queued" }); // 朝の分は残す
      expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
      const item = (await db.doc("reviewQueue/alert-mail_failing-2026-11-05").get()).data();
      expect(item).toMatchObject({ kind: "alert", alert: "mail_failing", resolvedAt: null });
      expect(logs.text()).not.toContain("example.test");

      // 同じ日の 2 回目でも 1 件。翌日は新しく 1 件
      await dispatchNotices(deps, await plan(caseFixture({ id: "33101-2026-11-06-1" })));
      expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
      const tomorrow = makeDeps({ fail: () => stop, now: () => new Date(NOW.getTime() + 24 * 3_600_000) }).deps;
      await dispatchNotices(tomorrow, await plan(caseFixture({ id: "33101-2026-11-07-1" })));
      expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05", "alert-mail_failing-2026-11-06"]);
    } finally {
      logs.restore();
    }
  });

  it("二段: 送る前に、宛先の全件を queued で記録する（途中で打ち切られても全件が送り直しの対象になる）", async () => {
    await seedImmediate();
    await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
    const c = caseFixture();
    const notices = await plan(c);
    expect(notices).toHaveLength(4);
    let seen: Record<string, FirebaseFirestore.DocumentData> | null = null;
    const { deps, mail } = makeDeps({
      mailer: async () => {
        seen ??= await sentNoticeDocs(); // 最初の送信の時点
        throw Object.assign(new Error("stop"), { code: "ETIMEDOUT" });
      },
    });
    await dispatchNotices(deps, notices);
    expect(mail.calls).toEqual([]); // 上の mailer は別物（記録を見るために差し替えた）
    expect(Object.keys(seen!)).toHaveLength(4);
    expect(Object.values(seen!).every((d) => d.state === "queued")).toBe(true);
  });

  it("送る直前に記録を読み直し、queued でなければ（他で sent になっていれば）送らない", async () => {
    await seedImmediate();
    const c = caseFixture();
    const notices = await plan(c); // f1/u1、f1/u1b、f5/u5
    const calls: string[] = [];
    const { deps } = makeDeps({
      mailer: async (to) => {
        calls.push(to);
        if (calls.length === 1) await db.doc(`sentNotices/${idOf("f1", "u1b", c, "confirmed")}`).update({ state: "sent", sentAt: "2026-11-05T12:00:01+09:00" });
      },
    });
    await dispatchNotices(deps, notices);
    expect(calls).toEqual(["u1@example.test", "u5@example.test"]);
    expect((await sentNoticeDocs())[idOf("f1", "u1b", c, "confirmed")]).toMatchObject({ state: "sent", sentAt: "2026-11-05T12:00:01+09:00" });
  });

  it("noteMailStop は JST の今日の id で 1 件だけ入れる（JST の日付で切り替わる）", async () => {
    const { deps } = makeDeps({ now: () => new Date("2026-11-05T14:59:00Z") }); // JST 23:59
    await noteMailStop(deps);
    await noteMailStop(deps);
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
    await noteMailStop(makeDeps({ now: () => new Date("2026-11-05T15:00:00Z") }).deps); // JST 翌日 0:00
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05", "alert-mail_failing-2026-11-06"]);
  });

  it("宛先が取れない会員（null、取得の失敗）は failed。他へは送り続ける", async () => {
    await seedImmediate();
    const { deps, mail } = makeDeps({
      emailOf: async (uid) => {
        if (uid === "u1") return null;
        if (uid === "u1b") throw new Error("auth/user-not-found");
        return `${uid}@example.test`;
      },
    });
    const c = caseFixture();
    const r = await dispatchNotices(deps, await plan(c));
    expect(r).toEqual({ mailStopped: false, recordFailures: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual(["u5@example.test"]);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f1", "u1", c, "confirmed")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f1", "u1b", c, "confirmed")]).toMatchObject({ state: "failed" });
    expect(await reviewQueueIds()).toEqual([]);
  });

  it("送る直前に配信停止を確かめる: 停止済み、会員でない、農場がない会員には送らず記録も作らない", async () => {
    await seedImmediate();
    const c = caseFixture();
    const notices = await plan(c); // u1、u1b、u5 の 3 通
    await db.doc("farms/f1").update({ unsubscribedUids: ["u1"], memberUids: ["u1", "u1b"] });
    await db.doc("farms/f5").delete();
    const { deps, mail } = makeDeps();
    await dispatchNotices(deps, notices);
    expect(mail.sent.map((m) => m.to)).toEqual(["u1b@example.test"]);
    expect(Object.keys(await sentNoticeDocs())).toEqual([idOf("f1", "u1b", c, "confirmed")]);
  });

  it("農場の配信停止の欄が読めないときは送らず、failed の記録を残す（読めなければ送らない側に倒す）", async () => {
    await seedImmediate();
    const c = caseFixture();
    const notices = await plan(c);
    await db.doc("farms/f5").update({ unsubscribedUids: "oops" });
    const { deps, mail } = makeDeps();
    await dispatchNotices(deps, notices);
    expect(mail.calls).not.toContain("u5@example.test");
    expect((await sentNoticeDocs())[idOf("f5", "u5", c, "confirmed")]).toMatchObject({ state: "failed", sentAt: null });
  });

  it("朝の分はこの場で送らない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const geo = fakeGeo({ preload: true });
    const farms = (await db.collection("farms").get()).docs.map((d) => ({ id: d.id, ...(d.data() as never as object) })) as never as Parameters<typeof planCaseNotices>[0]["farms"];
    const c = caseFixture();
    const morning = planCaseNotices({ event: "confirmed", caseDoc: c, farms, geo, alreadySent: [] }).filter((n) => n.timing === "morning");
    expect(morning).toHaveLength(2);
    await dispatchNotices(deps, morning);
    expect(mail.calls).toEqual([]);
  });
});

// ── 通数（Q-m の B: 同じ県の確認中が開いている間は最初の 1 通だけ。以前の既定 A は文書ごとに送って 23 通）──
const FIX = path.resolve(import.meta.dirname, "../../../data/private/fixtures/okayama");
describeFixture("岡山の 1 事例の控え（通数）", [path.join(FIX, "1013219.html"), path.join(FIX, "pdf")], () => {
  it("hasOutbreakWords が true の本数だけ rev- の事例を流しても、同じ農場の会員 1 人に確認中のメールは 1 通", async () => {
    const html = fs.readFileSync(path.join(FIX, "1013219.html"), "utf8");
    const docs = [...html.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>(.*?)<\/a>/gsu)].map((m) => ({
      file: m[1]!.split("/").pop()!,
      title: m[2]!.replace(/<[^>]+>/gu, "").replace(/\s*\[PDFファイル.*$/u, "").trim(),
    }));
    expect(docs).toHaveLength(24);

    // 判定は題と本文の両方に対して（パイプラインと同じ docText = 題 + "\n" + 本文）
    const flagged: typeof docs = [];
    let titleOnly = 0;
    for (const d of docs) {
      const { text } = await extractPdfText(fs.readFileSync(path.join(FIX, "pdf", d.file)));
      if (hasOutbreakWords(d.title)) titleOnly++;
      if (hasOutbreakWords(`${d.title}\n${text}`)) flagged.push(d);
    }
    // 第 2〜15 報の 14 本はすべて数える
    const progress = docs.filter((d) => /（第[0-9０-９]+報、/u.test(d.title));
    expect(progress).toHaveLength(14);
    for (const d of progress) expect(flagged).toContain(d);
    // 実測（2026-11-04）: 題だけで 18 本、題と本文で 23 本
    expect(titleOnly).toBe(18);
    expect(flagged).toHaveLength(23);

    await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
    const { deps, mail } = makeDeps();
    const geo = fakeGeo();
    for (const [i] of flagged.entries()) {
      const rev = makeReviewingCase({ documentId: `okayama-${i}`, season: 2026, prefCode: "33", sourceUrl: `https://example.test/pdf/${i}` }, NOW);
      await db.doc(`cases/${rev.id}`).set(rev); // onCaseWritten と同じ順: 事例を書いてから処理する
      await handleCaseWrite(deps, null, rev, geo);
    }
    // Q-m（利用者の決定 B）: 同じ県の確認中が開いている間は最初の 1 通だけ。23 本が続けて来ても会員 1 人に 1 通（直す前は 23 通）
    expect(mail.sent).toHaveLength(1);
    expect(new Set(mail.sent.map((m) => m.to))).toEqual(new Set(["u1@example.test"]));
    expect(Object.keys(await sentNoticeDocs())).toHaveLength(1);
  });
});
