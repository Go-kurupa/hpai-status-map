// M-13: 朝のまとめ（runMorningDigest）と送り直し（runRetryFailed）。模擬環境（demo-hpai）。本物のメールは送らない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Case, WildBird } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { runMorningDigest } from "../../src/notify/digest";
import { handleCaseWrite } from "../../src/notify/onCaseWritten";
import { handleWildBirdWrite } from "../../src/notify/onWildBirdWritten";
import { runRetryFailed } from "../../src/notify/retryFailed";
import { caseFixture, FAR_B, fakeGeo, GEO_A, GEO_B, GEO_D, IN_A, IN_D, NEAR_B, wildBirdFixture } from "../../../shared/test/helpers/mFixtures";
import { assertEmulator, captureLogs, clearFirestore, makeDeps, NOW, reviewQueueIds, seedFarm, sentNoticeDocs } from "./mHelpers";

beforeAll(assertEmulator);
beforeEach(clearFirestore);

const stage = (date: string) => ({ date, time: null });
const suspected = (over: Partial<Case> = {}) => caseFixture({ stages: { suspected: stage("2026-11-04") }, ...over });
const idOf = (farmId: string, uid: string, subjectId: string, event: string) => `${farmId}__${uid}__${subjectId}__${event}`;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const jst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";

async function seedCase(c: Case): Promise<void> {
  const { id, ...rest } = c;
  await db.collection("cases").doc(id).set(rest);
}
async function seedBird(b: WildBird): Promise<void> {
  const { id, ...rest } = b;
  await db.collection("wildBirds").doc(id).set(rest);
}
async function seedNotice(farmId: string, uid: string, subjectId: string, event: string, state: "queued" | "sent" | "failed", timing: "immediate" | "morning", queuedAt = jst(NOW)): Promise<string> {
  const id = idOf(farmId, uid, subjectId, event);
  await db.doc(`sentNotices/${id}`).set({ farmId, uid, subjectId, event, timing, state, queuedAt, sentAt: state === "sent" ? queuedAt : null });
  return id;
}

/** f2 ②（B で遠い）、f3 ③（D、登録した町に A）、f4 ④、f1 ①。 */
async function seedFour(): Promise<void> {
  await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
  await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
  await seedFarm("f3", "u3", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34", frequentMuniCodes: [GEO_A] });
  await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
}

const authErr = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
const quotaErr = Object.assign(new Error("Daily user sending quota exceeded"), { code: "EENVELOPE", responseCode: 550, response: "550 5.4.5 Daily user sending quota exceeded." });
const badRecipient = Object.assign(new Error("no such user"), { code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 The email account does not exist" });

describe("runMorningDigest: 基本", () => {
  it("何もない日は送らない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("朝の queued を会員ごとに 1 通にして、全部 sent にする（②③の疑い、確定）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c1 = suspected({ id: "c1" });
    const c2 = caseFixture({ id: "c2" });
    await handleCaseWrite(deps, null, c1, fakeGeo());
    await handleCaseWrite(deps, null, c2, fakeGeo());
    await seedCase(c1);
    await seedCase(c2);
    expect(mail.calls).toEqual(["u1@example.test", "u1@example.test"]); // ① はすぐ

    await runMorningDigest(deps, fakeGeo());
    const toU2 = mail.sent.filter((m) => m.to === "u2@example.test");
    expect(toU2).toHaveLength(1);
    expect(toU2[0]!.subject).toBe("【朝のまとめ】2 件");
    expect(mail.sent.filter((m) => m.to === "u3@example.test")).toHaveLength(1);
    expect(mail.sent.some((m) => m.to === "u4@example.test")).toBe(false);
    const docs = await sentNoticeDocs();
    for (const id of [idOf("f2", "u2", "c1", "suspected"), idOf("f2", "u2", "c2", "confirmed"), idOf("f3", "u3", "c1", "suspected")]) {
      expect(docs[id]).toMatchObject({ state: "sent", sentAt: "2026-11-05T12:00:00+09:00" });
    }
  });

  it("1 件だけの会員には、その知らせの件名で届く", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await runMorningDigest(deps, fakeGeo());
    const toU2 = mail.sent.filter((m) => m.to === "u2@example.test");
    expect(toU2).toHaveLength(1);
    expect(toU2[0]!.subject.startsWith("【疑い】")).toBe(true);
    expect(toU2[0]!.text).toContain("配信停止: https://app.example.test/unsubscribe?farm=f2&uid=u2&sig=");
  });

  it("再実行で二度送らない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await runMorningDigest(deps, fakeGeo());
    const n = mail.calls.length;
    await runMorningDigest(deps, fakeGeo());
    await runRetryFailed(deps, fakeGeo());
    expect(mail.calls).toHaveLength(n);
  });

  it("止めた会員には送らず、queued の記録を消す", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await db.doc("farms/f2").update({ unsubscribedUids: ["u2"] });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.some((m) => m.to === "u2@example.test")).toBe(false);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toBeUndefined();
    expect(docs[idOf("f3", "u3", "c1", "suspected")]).toMatchObject({ state: "sent" });
  });

  it("配信を止めた会員の failed の期限の知らせ、基準の知らせは送らず消す", async () => {
    await seedFarm("f1", "u1", { unsubscribedUids: ["u1"], selfCheckDue: { "2026-11": "2026-11-07" } });
    await seedNotice("f1", "u1", "2026-11", "self_check_due", "failed", "immediate");
    await seedNotice("f1", "u1", "2026-11-05_h1", "mortality_hit", "failed", "immediate");
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("会員でなくなった人、消えた農場の記録は送らず消す", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await seedCase(c);
    await seedNotice("f2", "u9", "c1", "suspected", "queued", "morning"); // u9 は会員でない
    await seedNotice("gone", "u8", "c1", "suspected", "queued", "morning"); // 農場がない
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("段階は朝の時点で計算し直す（農場の地点が変わっていれば ① の文面になる）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await db.doc("farms/f2").update({ meshCode: IN_A, muniCode: GEO_A });
    await runMorningDigest(deps, fakeGeo());
    const toU2 = mail.sent.filter((m) => m.to === "u2@example.test");
    expect(toU2).toHaveLength(1);
    expect(toU2[0]!.text).toContain("区域に入っている可能性があります");
  });

  it("朝の時点で設定が切られていれば送らず、④ になっていても記録を消す（否定は別）", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await db.doc("farms/f2").update({ "notify.level2": false });
    await db.doc("farms/f3").update({ frequentMuniCodes: [] }); // ③ から ④ へ
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.some((m) => m.to === "u2@example.test" || m.to === "u3@example.test")).toBe(false);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toBeUndefined();
    expect(docs[idOf("f3", "u3", "c1", "suspected")]).toBeUndefined();
  });

  it("事例が消えていれば failed、他は送る", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    const c1 = suspected({ id: "c1" });
    const c2 = suspected({ id: "c2" });
    await handleCaseWrite(deps, null, c1, fakeGeo());
    await handleCaseWrite(deps, null, c2, fakeGeo());
    await seedCase(c2); // c1 は書かない（消えた）
    await runMorningDigest(deps, fakeGeo());
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f2", "u2", "c2", "suspected")]).toMatchObject({ state: "sent" });
    expect(mail.sent.filter((m) => m.to === "u2@example.test")).toHaveLength(1);
  });

  it("欄 selfCheckDue のない農場が 1 つあっても、朝の送信は止まらない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps();
    await db.collection("farms").doc("nodue").set({
      name: "x", memberUids: ["u7"], unsubscribedUids: [], meshCode: IN_D, muniCode: GEO_D, prefCode: "34", frequentMuniCodes: [],
      notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: 3 }, updatedAt: "2026-11-03T09:00:00+09:00",
    });
    await db.doc("farms/f1").update({ selfCheckDue: { "2026-11": "2026-11-07" }, "notify.selfCheckRemindDays": 3 });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.map((m) => m.to)).toEqual(["u1@example.test"]);
    expect(mail.sent[0]!.subject).toBe("【自己点検】11月7日が期限です");
  });
});

describe("runMorningDigest: 期限の知らせ", () => {
  const farmWithDue = (over: Record<string, unknown> = {}) => ({ selfCheckDue: { "2026-11": "2026-11-07" }, "notify.selfCheckRemindDays": 3, ...over });

  it("期限の 3 日前に 1 通届き、同じ日に再実行しても、翌日になっても二度送らない", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update(farmWithDue());
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    await runMorningDigest(deps, fakeGeo());
    await runMorningDigest({ ...deps, now: () => new Date(NOW.getTime() + 86_400_000) }, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).toContain("https://app.example.test/record/self-check");
  });

  it("点検を記録済みなら送らない", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update(farmWithDue());
    await db.doc("farms/f1/checks/c1").set({ kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: {} });
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
  });

  it("selfCheckRemindDays が null なら送らない", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update(farmWithDue({ "notify.selfCheckRemindDays": null }));
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
  });

  it("期限の知らせの送信で認証のエラーが出たら、朝の queued も failed にして、送らない", async () => {
    await seedFour();
    const { deps, mail } = makeDeps({ fail: () => authErr });
    const c = suspected({ id: "c1" });
    await handleCaseWrite(makeDeps().deps, null, c, fakeGeo());
    await seedCase(c);
    await db.doc("farms/f1").update(farmWithDue());
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toHaveLength(1); // 期限の知らせの 1 通目で止まる
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f3", "u3", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
  });
});

describe("runMorningDigest: 送れないとき", () => {
  async function queueTwo(): Promise<void> {
    await seedFour();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(makeDeps().deps, null, c, fakeGeo());
    await seedCase(c);
  }

  it.each([["認証", authErr], ["上限", quotaErr]])("%s のエラーで残りに送らず、残りの morning も failed になる。mail_failing は 1 件", async (_name, err) => {
    await queueTwo();
    const { deps, mail } = makeDeps({ fail: () => err });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toHaveLength(1);
    expect(mail.sent).toEqual([]);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f3", "u3", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
  });

  it("mail_failing は同じ日の 2 回目でも 1 件、翌日は新しく 1 件。宛先の不備では入らない", async () => {
    await queueTwo();
    const failing = makeDeps({ fail: () => authErr });
    await runMorningDigest(failing.deps, fakeGeo());
    await runRetryFailed(failing.deps, fakeGeo());
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
    const tomorrow = makeDeps({ fail: () => authErr, now: () => new Date(NOW.getTime() + 86_400_000) });
    await runRetryFailed(tomorrow.deps, fakeGeo());
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05", "alert-mail_failing-2026-11-06"]);
  });

  it("宛先の不備（5.1.1）はその人だけの失敗。他へ送り続け、mail_failing は入らない", async () => {
    await queueTwo();
    const { deps, mail } = makeDeps({ fail: (to) => (to === "u2@example.test" ? badRecipient : undefined) });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual(["u2@example.test", "u3@example.test"]);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f3", "u3", "c1", "suspected")]).toMatchObject({ state: "sent" });
    expect(await reviewQueueIds()).toEqual([]);
  });

  it("宛先を取れない会員は failed、他は送る", async () => {
    await queueTwo();
    const { deps, mail } = makeDeps({ emailOf: async (uid) => (uid === "u2" ? null : `${uid}@example.test`) });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.map((m) => m.to)).toEqual(["u3@example.test"]);
    expect((await sentNoticeDocs())[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
  });

  it("ログに宛先のメールアドレスを出さない", async () => {
    await queueTwo();
    const logs = captureLogs();
    try {
      const { deps } = makeDeps({ fail: () => authErr });
      await runMorningDigest(deps, fakeGeo());
      await runRetryFailed(deps, fakeGeo());
      expect(logs.text()).not.toContain("example.test");
      expect(logs.text()).not.toContain("Invalid login");
    } finally {
      logs.restore();
    }
  });
});

describe("runMorningDigest: 組み立て直し", () => {
  it("queued の negated は、先に疑いが届いていれば【訂正】。今 ④ でも、設定を切っていても届く", async () => {
    await seedFour();
    const c = suspected({ id: "c1", negation: "negated", negatedAt: "2026-11-05T09:00:00+09:00" });
    await seedCase(c);
    await seedNotice("f2", "u2", "c1", "suspected", "sent", "morning");
    await seedNotice("f2", "u2", "c1", "negated", "queued", "morning");
    await db.doc("farms/f2").update({ "notify.level2": false, "notify.morningDigest": false, meshCode: IN_D, muniCode: GEO_D }); // 今は ④
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe("【訂正】岡山県町Aの疑いは否定されました");
  });

  it("受け取っていない会員の negated は【お知らせ】。否定済みの事例の queued の疑い・確定は送らず、記録を消す", async () => {
    await seedFour();
    const c = suspected({ id: "c1", negation: "negated", negatedAt: "2026-11-05T09:00:00+09:00" });
    await seedCase(c);
    await seedNotice("f2", "u2", "c1", "suspected", "queued", "morning");
    await seedNotice("f2", "u2", "c1", "negated", "queued", "morning");
    await seedNotice("f3", "u3", "c1", "confirmed", "failed", "morning");
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("u2@example.test");
    expect(mail.sent[0]!.subject.startsWith("【お知らせ】")).toBe(true);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toBeUndefined();
    expect(docs[idOf("f3", "u3", "c1", "confirmed")]).toBeUndefined();
    expect(docs[idOf("f2", "u2", "c1", "negated")]).toMatchObject({ state: "sent" });
  });

  it("mortality_hit と self_check_due の failed は、事例を読まずに送り直しで届く", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update({ selfCheckDue: { "2026-11": "2026-11-07" } });
    await seedNotice("f1", "u1", "2026-11-05_h1", "mortality_hit", "failed", "immediate");
    await seedNotice("f1", "u1", "2026-11", "self_check_due", "failed", "immediate");
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe("【朝のまとめ】2 件");
    expect(mail.sent[0]!.text).toContain("【死亡数】11月5日の死亡率が基準に当たる可能性があります");
    expect(mail.sent[0]!.text).toContain("【自己点検】11月7日が期限です");
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f1", "u1", "2026-11-05_h1", "mortality_hit")]).toMatchObject({ state: "sent" });
    expect(docs[idOf("f1", "u1", "2026-11", "self_check_due")]).toMatchObject({ state: "sent" });
  });

  it("点検が記録済み、または期限を過ぎた self_check_due の failed は送らず消す", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update({ selfCheckDue: { "2026-11": "2026-11-07", "2026-10": "2026-11-02" } });
    await db.doc("farms/f1/checks/c1").set({ kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: {} });
    await seedNotice("f1", "u1", "2026-11", "self_check_due", "failed", "immediate");
    await seedNotice("f1", "u1", "2026-10", "self_check_due", "failed", "immediate");
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("野鳥の queued: 判定が変わって確定でなくなっていれば送らず消す。県を読む前の GeoStore でも落ちない", async () => {
    await seedFarm("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B, prefCode: "33" });
    const { deps, mail } = makeDeps();
    const bird = wildBirdFixture();
    await seedBird(bird);
    await handleWildBirdWrite(deps, null, bird, fakeGeo());
    expect(Object.keys(await sentNoticeDocs())).toEqual([idOf("near", "u1", bird.id, "wild_bird_confirmed")]);
    await seedBird({ ...bird, test: "negative" });
    await runMorningDigest(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });
});

describe("runRetryFailed", () => {
  it("failed の morning と immediate、10 分以上の queued の immediate を会員ごとに 1 通で送る。10 分未満の queued と queued の morning は残す", async () => {
    await seedFour();
    const c1 = suspected({ id: "c1" });
    const c2 = suspected({ id: "c2" });
    const c3 = suspected({ id: "c3" });
    const c4 = suspected({ id: "c4" });
    for (const c of [c1, c2, c3, c4]) await seedCase(c);
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate");
    await seedNotice("f1", "u1", "c2", "suspected", "queued", "immediate", jst(minutesAgo(11)));
    await seedNotice("f1", "u1", "c3", "suspected", "queued", "immediate", jst(minutesAgo(5))); // 10 分未満
    await seedNotice("f2", "u2", "c1", "suspected", "failed", "morning");
    await seedNotice("f2", "u2", "c4", "suspected", "queued", "morning"); // 朝まで送らない
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());

    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
    expect(mail.sent.find((m) => m.to === "u1@example.test")!.subject).toBe("【朝のまとめ】2 件");
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f1", "u1", "c1", "suspected")]).toMatchObject({ state: "sent" });
    expect(docs[idOf("f1", "u1", "c2", "suspected")]).toMatchObject({ state: "sent" });
    expect(docs[idOf("f1", "u1", "c3", "suspected")]).toMatchObject({ state: "queued" });
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "sent" });
    expect(docs[idOf("f2", "u2", "c4", "suspected")]).toMatchObject({ state: "queued" });
  });

  it("送る直前に記録を読み直す: 事例が否定済みなら queued の疑いを送らない", async () => {
    await seedFour();
    const c = suspected({ id: "c1", negation: "negated", negatedAt: "2026-11-05T09:00:00+09:00" });
    await seedCase(c);
    await seedNotice("f1", "u1", "c1", "suspected", "queued", "immediate", jst(minutesAgo(30)));
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());
    expect(mail.calls).toEqual([]);
  });

  it("否定の訂正の failed も届く", async () => {
    await seedFour();
    const c = suspected({ id: "c1", negation: "negated", negatedAt: "2026-11-05T09:00:00+09:00" });
    await seedCase(c);
    await seedNotice("f1", "u1", "c1", "suspected", "sent", "immediate");
    await seedNotice("f1", "u1", "c1", "negated", "failed", "immediate");
    const { deps, mail } = makeDeps();
    await runRetryFailed(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject.startsWith("【訂正】")).toBe(true);
  });

  it("認証のエラーで残りに送らず failed のまま。mail_failing は朝の経路と同じ id で 1 日 1 件。連打しない", async () => {
    await seedFour();
    const c = suspected({ id: "c1" });
    await seedCase(c);
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate");
    await seedNotice("f2", "u2", "c1", "suspected", "failed", "morning");
    await seedNotice("f3", "u3", "c1", "suspected", "failed", "morning");
    const { deps, mail } = makeDeps({ fail: () => authErr });
    await runRetryFailed(deps, fakeGeo());
    expect(mail.calls).toHaveLength(1);
    const docs = await sentNoticeDocs();
    for (const f of ["f1:u1", "f2:u2", "f3:u3"]) {
      const [farm, uid] = f.split(":") as [string, string];
      expect(docs[idOf(farm, uid, "c1", "suspected")]).toMatchObject({ state: "failed" });
    }
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
  });

  it("止めるエラーのとき、failed への更新が投げても mail_failing は入る", async () => {
    await seedFour();
    const c = suspected({ id: "c1" });
    await seedCase(c);
    const id = await seedNotice("f1", "u1", "c1", "suspected", "queued", "immediate", jst(minutesAgo(30)));
    const { deps } = makeDeps();
    // 送ろうとしている間に記録が消える（更新が NOT_FOUND で投げる）状態を作る
    const mailer: typeof deps.mailer = async () => {
      await db.doc(`sentNotices/${id}`).delete();
      throw quotaErr;
    };
    await runRetryFailed({ ...deps, mailer }, fakeGeo());
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
  });
});

describe("送り直しの上限（古さ 14 日、回数 5 回）", () => {
  const daysAgo = (d: number) => jst(new Date(NOW.getTime() - d * 86_400_000));

  it("14 日より古い failed と queued は、疑い、確定、基準の知らせでも送らず、読まない印（abandoned）にする。13 日前は送る", async () => {
    await seedFour();
    const c1 = suspected({ id: "c1" });
    const c2 = suspected({ id: "c2" });
    await seedCase(c1);
    await seedCase(c2);
    await db.doc("farms/f1").update({ memberUids: ["u1", "u2"] });
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate", daysAgo(15));
    await seedNotice("f1", "u1", "2026-10-21_h1", "mortality_hit", "failed", "immediate", daysAgo(15));
    await seedNotice("f1", "u1", "c2", "suspected", "failed", "immediate", daysAgo(13));
    await seedNotice("f2", "u2", "c1", "suspected", "queued", "morning", daysAgo(15));
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("u1@example.test");
    expect(mail.sent[0]!.subject).toContain("【疑い】");
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f1", "u1", "c1", "suspected")]).toMatchObject({ state: "abandoned" });
    expect(docs[idOf("f1", "u1", "2026-10-21_h1", "mortality_hit")]).toMatchObject({ state: "abandoned" });
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "abandoned" });
    expect(docs[idOf("f1", "u1", "c2", "suspected")]).toMatchObject({ state: "sent" });
    // 二度と読まない
    await runRetryFailed(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
  });

  it("宛先を取れない会員の送り直しは 5 回まで。5 回目の失敗で abandoned になり、以後は読まない", async () => {
    await seedFour();
    await seedCase(suspected({ id: "c1" }));
    const key = idOf("f1", "u1", "c1", "suspected");
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate");
    const { deps } = makeDeps({ emailOf: async () => null });
    for (let i = 1; i <= 4; i++) {
      await runRetryFailed(deps, fakeGeo());
      expect((await sentNoticeDocs())[key]).toMatchObject({ state: "failed", retries: i });
    }
    await runRetryFailed(deps, fakeGeo());
    expect((await sentNoticeDocs())[key]).toMatchObject({ state: "abandoned", retries: 5 });
    const emailCalls: string[] = [];
    await runRetryFailed({ ...deps, emailOf: async (u) => (emailCalls.push(u), null) }, fakeGeo());
    expect(emailCalls).toEqual([]); // もう読まない
  });

  it("認証、上限のエラーでは回数を数えない（停止は記録のせいではない）", async () => {
    await seedFour();
    await seedCase(suspected({ id: "c1" }));
    const key = idOf("f1", "u1", "c1", "suspected");
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate");
    const { deps } = makeDeps({ fail: () => authErr });
    for (let i = 0; i < 6; i++) await runRetryFailed(deps, fakeGeo());
    expect((await sentNoticeDocs())[key]).toMatchObject({ state: "failed" });
    expect((await sentNoticeDocs())[key]!.retries ?? 0).toBe(0);
  });
});

describe("野鳥の知らせ", () => {
  it("朝のまとめで届く（10km 以内の農場だけ）", async () => {
    await seedFarm("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B, prefCode: "33" });
    await seedFarm("far", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
    const { deps, mail } = makeDeps();
    const bird = wildBirdFixture();
    await seedBird(bird);
    await handleWildBirdWrite(deps, null, bird, fakeGeo());
    expect(mail.calls).toEqual([]); // すぐは送らない
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "u1@example.test", subject: "【野鳥】町Aで野鳥の高病原性鳥インフルエンザが確定しました" });
  });
});
