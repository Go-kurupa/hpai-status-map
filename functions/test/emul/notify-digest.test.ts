// M-13: 朝のまとめ（runMorningDigest）と送り直し（runRetryFailed）。模擬環境（demo-hpai）。本物のメールは送らない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SELF_CHECK_MAX_MONTHS_PER_RUN } from "@hpai/shared/notices";
import { PREFS } from "@hpai/shared/pref";
import type { Case, WildBird } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { deliverQueued, readQueue, runMorningDigest } from "../../src/notify/digest";
import { dispatchNotices } from "../../src/notify/dispatch";
import { handleCaseWrite } from "../../src/notify/onCaseWritten";
import { handleWildBirdWrite } from "../../src/notify/onWildBirdWritten";
import { runRetryFailed } from "../../src/notify/retryFailed";
import { caseFixture, FAR_B, fakeGeo, GEO_A, GEO_B, GEO_D, IN_A, IN_D, NEAR_B, wildBirdFixture } from "../../../shared/test/helpers/mFixtures";
import { DEFAULT_RUNTIME_SETTINGS, type HistoryCase } from "@hpai/shared/types";
import { findWordingViolations, FIXED_TEXT } from "@hpai/shared/wording";
import { mesh3Center } from "@hpai/shared/mesh";
import { prepareDailyOverview, type OverviewOptions } from "../../src/notify/overview";
import { assertEmulator, captureLogs, claudeMessage, clearFirestore, fakeClient, makeDeps, NOW, reviewQueueIds, seedFarm, sentNoticeDocs } from "./mHelpers";

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

  it("会員が 3100 を超える月のキーと日数 100000 を書いても、1 日に出る期限の知らせは上限以下（N-1）", async () => {
    await seedFarm("f1", "u1");
    const due: Record<string, string> = {};
    for (let y = 1900; y < 2300; y++) for (let m = 1; m <= 12; m++) due[`${y}-${String(m).padStart(2, "0")}`] = "2026-11-07";
    for (const m of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]) due[m] = "2026-11-07";
    expect(Object.keys(due).length).toBeGreaterThan(3100);
    await db.doc("farms/f1").update({ selfCheckDue: due, "notify.selfCheckRemindDays": 100000 });
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.length).toBeGreaterThan(0);
    expect(mail.sent.length).toBeLessThanOrEqual(SELF_CHECK_MAX_MONTHS_PER_RUN);
    const dueRecords = Object.values(await sentNoticeDocs()).filter((d) => (d as { event: string }).event === "self_check_due");
    expect(dueRecords.length).toBeLessThanOrEqual(SELF_CHECK_MAX_MONTHS_PER_RUN);
  });

  it("3 つの月の期限が近く、2 か月分が送り済みなら、その日に 3 つ目の月の知らせが送られる（送り済みは上限に数えない）", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update({
      selfCheckDue: { "2026-11": "2026-11-06", "2026-12": "2026-11-07", "2027-01": "2026-11-08" },
      "notify.selfCheckRemindDays": 7,
    });
    for (const month of ["2026-11", "2026-12"]) {
      await db.doc(`sentNotices/f1__u1__${month}__self_check_due`).set({
        farmId: "f1", uid: "u1", subjectId: month, event: "self_check_due", timing: "immediate", state: "sent",
        queuedAt: "2026-11-04T06:00:00+09:00", sentAt: "2026-11-04T06:00:10+09:00",
      });
    }
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.map((m) => m.subject)).toEqual(["【自己点検】11月8日が期限です"]);
    const docs = await sentNoticeDocs();
    expect(docs["f1__u1__2027-01__self_check_due"]).toMatchObject({ state: "sent" });
  });

  it("送り済みの月が一部の会員にだけなら、届いていない会員には送る（月は全員に届くまで送り済みにしない）", async () => {
    await seedFarm("f1", "u1");
    await db.doc("farms/f1").update({
      memberUids: ["u1", "u2"], selfCheckDue: { "2026-11": "2026-11-06" }, "notify.selfCheckRemindDays": 7,
    });
    await db.doc("sentNotices/f1__u1__2026-11__self_check_due").set({
      farmId: "f1", uid: "u1", subjectId: "2026-11", event: "self_check_due", timing: "immediate", state: "sent",
      queuedAt: "2026-11-04T06:00:00+09:00", sentAt: "2026-11-04T06:00:10+09:00",
    });
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo());
    expect(mail.sent.map((m) => m.to)).toEqual(["u2@example.test"]);
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

  it("宛先の取得が一時的な障害で投げ続けても、回数に数えず abandoned にならない。直れば送る。ログは件数だけ", async () => {
    await seedFour();
    await seedCase(suspected({ id: "c1" }));
    const key = idOf("f1", "u1", "c1", "suspected");
    await seedNotice("f1", "u1", "c1", "suspected", "failed", "immediate");
    await seedNotice("f2", "u2", "c1", "suspected", "queued", "morning");
    const broken = makeDeps({ emailOf: async () => Promise.reject(Object.assign(new Error("u1@example.test unavailable"), { code: "auth/internal-error" })) });
    const logs = captureLogs();
    try {
      await runMorningDigest(broken.deps, fakeGeo());
      for (let i = 0; i < 6; i++) await runRetryFailed(broken.deps, fakeGeo());
      expect(logs.text()).not.toContain("example.test");
    } finally {
      logs.restore();
    }
    expect(broken.mail.calls).toEqual([]);
    const docs = await sentNoticeDocs();
    expect(docs[key]).toMatchObject({ state: "failed" });
    expect(docs[key]!.retries ?? 0).toBe(0);
    // 朝の queued は、次の朝を待たず毎時の送り直しに回る（failed、回数は数えない）
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "failed" });
    expect(docs[idOf("f2", "u2", "c1", "suspected")]!.retries ?? 0).toBe(0);

    const ok = makeDeps();
    await runRetryFailed(ok.deps, fakeGeo());
    expect(ok.mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
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

describe("毎朝の全国まとめ", () => {
  const SENTENCE = "今季は 1 件、直近 14 日は 1 件です。";
  const AI_LABEL = "AI の要約";
  const HISTORY: HistoryCase[] = [
    { season: 2025, no: 1, prefCode: "33", muniCode: GEO_A, muniNameThen: "町A", date: "2025-10-30", birdUse: null, housing: null, headCount: null, sourceUrl: "https://example.test/h.pdf", related: false },
    { season: 2024, no: 1, prefCode: "33", muniCode: GEO_A, muniNameThen: "町A", date: "2024-10-30", birdUse: null, housing: null, headCount: null, sourceUrl: "https://example.test/h.pdf", related: false },
    { season: 2024, no: 2, prefCode: "33", muniCode: GEO_A, muniNameThen: "町A", date: "2024-11-01", birdUse: null, housing: null, headCount: null, sourceUrl: "https://example.test/h.pdf", related: false },
  ];
  const options = (reply: Parameters<typeof fakeClient>[0] = claudeMessage(SENTENCE)) => {
    const fake = fakeClient(reply);
    const overview: OverviewOptions = { client: () => fake.client, history: async () => HISTORY };
    return { overview, calls: fake.calls };
  };
  const firstCase = () => caseFixture({ id: "c1", stages: { confirmed: stage("2026-11-04") } });
  const nextMorning = () => new Date(NOW.getTime() + 86_400_000);
  /** 47 県を確認済みにする（except の県は未確認）。確認は 6 時間で古くなるので、翌朝の試験は入れ直す。 */
  const seedWatch = async (at: Date = NOW, except: readonly string[] = []) => {
    const batch = db.batch();
    for (const p of PREFS) batch.set(db.doc(`watchStatus/${p.code}`), { prefCode: p.code, checkedAt: jst(at), ok: !except.includes(p.code), lastOkAt: jst(at), failingSince: null });
    await batch.commit();
  };
  /** 前回のまとめの印（前の朝に送った）。 */
  const seedMarker = (over: Record<string, unknown> = {}) => db.doc("usage/overviewMarker").set({ date: "2026-11-04", caseIds: [], birdIds: [], ...over });
  const overviewOf = async (date = "2026-11-05") => (await db.doc(`dailyOverviews/${date}`).get()).data()!;

  beforeEach(() => seedWatch());

  it("変化があった朝は、待ち行列のない会員にも 1 通送り、記録と日付の文書を残す", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    await seedMarker();
    const { deps, mail } = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(deps, fakeGeo(), overview);

    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!;
    expect(m.to).toBe("u4@example.test");
    expect(m.subject).toBe("【全国の状況】11月5日");
    for (const s of ["今季の全国の発生: 1 件", "直近 14 日の全国の発生: 1 件", "過去 2 シーズンの同じ日までの件数: 1〜2 件", "野鳥の陽性: 0 件", "岡山県町A（11月4日）", "約 60km 以内の今季の発生: 0 件", "今回新しく載せた発生: 1 件", "時点", "出典", "https://app.example.test", SENTENCE, FIXED_TEXT.riskAnywhere]) {
      expect(m.text).toContain(s);
    }
    expect(m.text).toContain("配信停止: https://app.example.test/unsubscribe?farm=f4&uid=u4&sig=");
    expect(findWordingViolations(`${m.subject}\n${m.text}`)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]!.messages)).toContain("newCaseCount");
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f4", "u4", "2026-11-05", "daily_overview")]).toMatchObject({ state: "sent", timing: "morning" });
    expect((await db.doc("dailyOverviews/2026-11-05").get()).data()).toMatchObject({ seasonCount: 1, sentence: SENTENCE });
    expect((await db.doc("usage/overviewMarker").get()).data()).toMatchObject({ date: "2026-11-05", caseIds: ["c1"], birdIds: [] });
  });

  it("変化がない朝は送らず、Claude を呼ばない（翌朝）", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const first = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(first.deps, fakeGeo(), overview);
    expect(first.mail.sent).toHaveLength(1);

    const next = makeDeps({ now: nextMorning });
    await runMorningDigest(next.deps, fakeGeo(), overview);
    expect(next.mail.calls).toEqual([]);
    expect(calls).toHaveLength(1);
    expect((await db.doc("dailyOverviews/2026-11-06").get()).exists).toBe(false);
  });

  it("発生も発表もなければ送らない", async () => {
    await seedFarm("f4", "u4");
    const { deps, mail } = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.calls).toEqual([]);
    expect(calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("翌朝に野鳥の発表だけが増えれば送る", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview } = options();
    await runMorningDigest(makeDeps().deps, fakeGeo(), overview);
    await seedBird(wildBirdFixture({ id: "b1" }));
    const next = makeDeps({ now: nextMorning });
    await runMorningDigest(next.deps, fakeGeo(), overview);
    expect(next.mail.sent).toHaveLength(1);
    expect(next.mail.sent[0]!.text).toContain("野鳥の陽性: 1 件");
  });

  it("同じ朝に 2 回動いても二重に送らず、Claude は 1 回", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    await seedCase(caseFixture({ id: "c2", stages: { confirmed: stage("2026-11-05") } })); // 実行の間に増えても、この朝の分は作り直さない
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.sent).toHaveLength(1);
    expect(calls).toHaveLength(1);

    // 間に増えた事例は、翌朝の変化として残る
    await seedWatch(nextMorning());
    const next = makeDeps({ now: nextMorning });
    await runMorningDigest(next.deps, fakeGeo(), overview);
    expect(next.mail.sent).toHaveLength(1);
    expect(next.mail.sent[0]!.text).toContain("今季の全国の発生: 2 件");
  });

  it("途中で止まった朝のやり直しは、記録のない会員だけに送る", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview, calls } = options();
    await runMorningDigest(makeDeps().deps, fakeGeo(), overview);
    await seedFarm("f5", "u5", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await db.doc("usage/overviewMarker").delete(); // 文書を作った後、印を書く前に止まった朝
    const again = makeDeps();
    await runMorningDigest(again.deps, fakeGeo(), overview);
    expect(again.mail.calls).toEqual(["u5@example.test"]);
    expect(calls).toHaveLength(1);
    expect((await db.doc("usage/overviewMarker").get()).exists).toBe(true);
  });

  it("朝の知らせがある会員には 1 通にまとめ、全国の状況が先頭に来る", async () => {
    await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    await seedMarker();
    const { overview } = options(claudeMessage("今季は 1 件で、岡山県町Aで疑いの発表がありました。"));
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!;
    expect(m.subject).toBe("【朝のまとめ】全国の状況とお知らせ 1 件");
    expect(m.text.startsWith("■ 全国の状況")).toBe(true);
    expect(m.text.indexOf("■ 全国の状況")).toBeLessThan(m.text.indexOf("【疑い】"));
    expect(m.text.match(/配信停止:/gu)).toHaveLength(1);
    const docs = await sentNoticeDocs();
    expect(docs[idOf("f2", "u2", "c1", "suspected")]).toMatchObject({ state: "sent" });
    expect(docs[idOf("f2", "u2", "2026-11-05", "daily_overview")]).toMatchObject({ state: "sent" });
    expect(m.text).toContain(`AI の要約`);
    expect(m.text).toContain("今季は 1 件で、岡山県町Aで疑いの発表がありました。");
  });

  it("送れなかった分の送り直しは Claude を呼ばず、同じ総括と数字で届く", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview, calls } = options();
    const down = makeDeps({ fail: () => badRecipient });
    await runMorningDigest(down.deps, fakeGeo(), overview);
    expect(down.mail.sent).toEqual([]);
    expect((await sentNoticeDocs())[idOf("f4", "u4", "2026-11-05", "daily_overview")]).toMatchObject({ state: "failed" });

    await seedCase(caseFixture({ id: "c2", stages: { confirmed: stage("2026-11-05") } })); // 後で増えても、その朝の数字のまま
    const later = makeDeps();
    await runRetryFailed(later.deps, fakeGeo());
    expect(later.mail.sent).toHaveLength(1);
    expect(later.mail.sent[0]!.text).toContain(SENTENCE);
    expect(later.mail.sent[0]!.text).toContain("今季の全国の発生: 1 件");
    expect(calls).toHaveLength(1);
  });

  it("送信が止まった朝は failed にして送り直しへ回す", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview } = options();
    const down = makeDeps({ fail: () => authErr });
    await runMorningDigest(down.deps, fakeGeo(), overview);
    expect((await sentNoticeDocs())[idOf("f4", "u4", "2026-11-05", "daily_overview")]).toMatchObject({ state: "failed" });
    expect(await reviewQueueIds()).toContain("alert-mail_failing-2026-11-05");
  });

  it("2 日より前の分は送らず記録を消す（次の朝の数字に任せる）", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview } = options();
    await runMorningDigest(makeDeps({ fail: () => badRecipient }).deps, fakeGeo(), overview);
    const later = makeDeps({ now: () => new Date(NOW.getTime() + 2 * 86_400_000) });
    await runRetryFailed(later.deps, fakeGeo());
    expect(later.mail.calls).toEqual([]);
    expect((await sentNoticeDocs())[idOf("f4", "u4", "2026-11-05", "daily_overview")]).toBeUndefined();
  });

  it.each([
    ["数字の違い", "今季は 9 件です。"],
    ["知らない町", "今季は 1 件で、架空市で発生しました。"],
    ["禁句", "今季は 1 件で、安全です。"],
    ["少なさを軽く読ませる語", "今季は 1 件で、落ち着いています。"],
    ["2 文", "今季は 1 件です。直近 14 日は 1 件です。"],
    ["URL", "今季は 1 件です https://example.test/x。"],
    ["打ち消しで軽く読ませる", "今季は 1 件のみで、近くでは確認されていません。"],
    ["最初の朝の新規の件数", "新たに 1 件です。"],
  ])("検査に落ちた総括（%s）は外し、定型だけを送る", async (_name, sentence) => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview, calls } = options(claudeMessage(sentence));
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(calls).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).not.toContain(sentence);
    expect(mail.sent[0]!.text).not.toContain(AI_LABEL);
    expect(mail.sent[0]!.text).toContain("今季の全国の発生: 1 件");
    const doc = (await db.doc("dailyOverviews/2026-11-05").get()).data()!;
    expect(doc.sentence).toBeNull();
    expect((doc.sentenceFailures as string[]).length).toBeGreaterThan(0);
  });

  it("Claude の失敗でも定型を送る（失敗で総括を作り直さない）", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview, calls } = options(new Error("api down"));
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(calls).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).not.toContain(AI_LABEL);
    expect((await db.doc("dailyOverviews/2026-11-05").get()).data()!.sentenceFailures).toEqual(["claude:api_error"]);
  });

  it("鍵を読めないなど client を作れなくても定型を送る", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo(), { client: () => { throw new Error("no key"); }, history: async () => HISTORY });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).not.toContain(AI_LABEL);
  });

  it("予算が止まっていれば Claude を呼ばず、定型を送る", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    await db.doc("usage/2026-11").set({ estimatedJpy: DEFAULT_RUNTIME_SETTINGS.softLimitJpy });
    const { deps, mail } = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(calls).toEqual([]);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).not.toContain(AI_LABEL);
    expect((await db.doc("dailyOverviews/2026-11-05").get()).data()!.sentenceFailures).toEqual(["budget_stopped"]);
  });

  it("呼んだ分の費用を積む", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { overview } = options();
    await runMorningDigest(makeDeps().deps, fakeGeo(), overview);
    expect((await db.doc("usage/2026-11").get()).data()).toMatchObject({ inputTokens: 1000, outputTokens: 200 });
  });

  it("0 件の朝（野鳥だけの変化）: 件数の前に riskAnywhere を置き、軽く読ませる文がない", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedBird(wildBirdFixture({ id: "b1" }));
    const { deps, mail } = makeDeps();
    const { overview } = options(claudeMessage("今季は 0 件で、野鳥の陽性は 1 件です。"));
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.sent).toHaveLength(1);
    const text = mail.sent[0]!.text;
    expect(text.indexOf(FIXED_TEXT.riskAnywhere)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(FIXED_TEXT.riskAnywhere)).toBeLessThan(text.indexOf("今季の全国の発生: 0 件"));
    expect(findWordingViolations(`${mail.sent[0]!.subject}\n${text}`)).toEqual([]);
    for (const w of ["大丈夫", "落ち着", "心配", "収ま", "問題ありません"]) expect(text).not.toContain(w);
  });

  it("再現の事例は数えず、変化にも Claude の入力にも入れない", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(caseFixture({ id: "replay-1", confirmState: "replay", muniCode: GEO_B, muniName: "町B" }));
    const quiet = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(quiet.deps, fakeGeo(), overview);
    expect(quiet.mail.calls).toEqual([]);
    expect(calls).toEqual([]);

    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.sent[0]!.text).toContain("今季の全国の発生: 1 件");
    expect(mail.sent[0]!.text).not.toContain("町B");
    expect(JSON.stringify(calls[0]!.messages)).not.toContain("町B");
  });

  it("朝の分のオフの農場には送らず、記録も作らない。朝に切った分は消す", async () => {
    await seedFarm("off", "u1", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34", notify: { level1: true, level2: true, level3: true, morningDigest: false, selfCheckRemindDays: null } });
    await seedFarm("on", "u2", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.calls).toEqual(["u2@example.test"]);
    expect((await sentNoticeDocs())[idOf("off", "u1", "2026-11-05", "daily_overview")]).toBeUndefined();

    await seedNotice("off", "u1", "2026-11-05", "daily_overview", "failed", "morning");
    const later = makeDeps();
    await runRetryFailed(later.deps, fakeGeo());
    expect(later.mail.calls).toEqual([]);
    expect((await sentNoticeDocs())[idOf("off", "u1", "2026-11-05", "daily_overview")]).toBeUndefined();
  });

  it("配信を止めた会員には送らず、後から止めた分も消す", async () => {
    await seedFarm("f1", "u1", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34", memberUids: ["u1", "u9"], unsubscribedUids: ["u9"] });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    expect(mail.calls).toEqual(["u1@example.test"]);
    expect((await sentNoticeDocs())[idOf("f1", "u9", "2026-11-05", "daily_overview")]).toBeUndefined();

    await seedNotice("f1", "u9", "2026-11-05", "daily_overview", "failed", "morning");
    const later = makeDeps();
    await runRetryFailed(later.deps, fakeGeo());
    expect(later.mail.calls).toEqual([]);
    expect((await sentNoticeDocs())[idOf("f1", "u9", "2026-11-05", "daily_overview")]).toBeUndefined();
  });

  it("本文と Claude の入力に、農場の名前、マス目、緯度経度が出ない。距離と町名は出る", async () => {
    await seedFarm("near", "u1", { name: "架空の農場", meshCode: NEAR_B, muniCode: GEO_B, prefCode: "33", frequentMuniCodes: [GEO_A] });
    await seedFarm("same", "u2", { name: "架空の農場", meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const { overview, calls } = options();
    await runMorningDigest(deps, fakeGeo(), overview);
    const near = mail.sent.find((m) => m.to === "u1@example.test")!.text;
    const same = mail.sent.find((m) => m.to === "u2@example.test")!.text;
    expect(near).toMatch(/約 60km 以内の今季の発生: 1 件\n・岡山県町A 約 \d+ km 1 件（登録した町）/u);
    expect(near).toContain("登録した町の今季の発生: 1 件");
    expect(same).toMatch(/約 60km 以内の今季の発生: 1 件\n・岡山県町A 同じ町 1 件/u);
    const prompt = JSON.stringify([calls[0]!.system, calls[0]!.messages]);
    for (const mesh of [NEAR_B, IN_A]) {
      const { lat, lng } = mesh3Center(mesh);
      for (const s of [mesh, String(lat).slice(0, 5), String(lng).slice(0, 5)]) {
        expect(near + same).not.toContain(s);
        expect(prompt).not.toContain(s);
      }
    }
    expect(near + same + prompt).not.toContain("架空の農場");
    expect(prompt).not.toContain("example.test");
  });

  it("県の形を読めない朝は、近くの件数を 0 と書かず、全国の分は送る", async () => {
    await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
    await seedCase(firstCase());
    const geo = fakeGeo();
    const { deps, mail } = makeDeps();
    const { overview } = options();
    const logs = captureLogs();
    try {
      await runMorningDigest(deps, { ...geo, ensurePrefs: () => Promise.reject(new Error("bad topo")) }, overview);
    } finally {
      logs.restore();
    }
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).toContain("今季の全国の発生: 1 件");
    expect(mail.sent[0]!.text).toContain("約 60km 以内の今季の発生は、今朝は出せませんでした");
    expect(mail.sent[0]!.text).not.toContain("約 60km 以内の今季の発生: 0 件");
  });

  it("まとめの準備が失敗しても、今までの朝の知らせは送る", async () => {
    await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" });
    const { deps, mail } = makeDeps();
    const c = suspected({ id: "c1" });
    await handleCaseWrite(deps, null, c, fakeGeo());
    await seedCase(c);
    const logs = captureLogs();
    try {
      await runMorningDigest({ ...deps, db: new Proxy(deps.db, { get: (t, k) => (k === "doc" ? (p: string) => { if (p.startsWith("dailyOverviews/")) throw new Error("read failed"); return t.doc(p); } : Reflect.get(t, k)) }) }, fakeGeo(), options().overview);
    } finally {
      logs.restore();
    }
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject.startsWith("【疑い】")).toBe(true);
    expect((await db.doc("usage/overviewMarker").get()).exists).toBe(false);
  });

  it("時間の上限は渡された始まりの時刻から数える（残りは queued のまま）", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const fake = fakeClient(claudeMessage(SENTENCE));
    const first = makeDeps();
    await prepareDailyOverview(first.deps, fakeGeo(), { client: () => fake.client, history: async () => HISTORY });
    const logs = captureLogs();
    try {
      await deliverQueued(first.deps, fakeGeo(), await readQueue(db, NOW, true), { failRestOnStop: true, startedAt: Date.now() - 481_000 });
    } finally {
      logs.restore();
    }
    expect(first.mail.calls).toEqual([]);
    expect((await sentNoticeDocs())[idOf("f4", "u4", "2026-11-05", "daily_overview")]).toMatchObject({ state: "queued" });
  });

  it("過去の記録を読めない朝は、幅を出せないと書く", async () => {
    await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    await seedCase(firstCase());
    const { deps, mail } = makeDeps();
    const fake = fakeClient(claudeMessage(SENTENCE));
    await runMorningDigest(deps, fakeGeo(), { client: () => fake.client, history: () => Promise.reject(new Error("no file")) });
    expect(mail.sent[0]!.text).toContain("過去のシーズンの同じ日までの件数は、今朝は出せませんでした");
  });

  describe("最初の朝（印がない）", () => {
    it("今季の全件を新規に数えず、新規の節を出さず、Claude にも新規の件数と町を渡さない", async () => {
      await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      await seedCase(firstCase());
      await seedCase(caseFixture({ id: "c2", muniCode: GEO_B, muniName: "町B", stages: { confirmed: stage("2026-11-01") } }));
      await seedBird(wildBirdFixture({ id: "b1" }));
      const { deps, mail } = makeDeps();
      const { overview, calls } = options(claudeMessage("今季は 2 件です。"));
      await runMorningDigest(deps, fakeGeo(), overview);

      expect(mail.sent).toHaveLength(1);
      const text = mail.sent[0]!.text;
      expect(text).toContain("今季の全国の発生: 2 件");
      expect(text).toContain("今季は 2 件です。");
      expect(text).not.toContain("今回新しく載せた");
      const prompt = JSON.stringify(calls[0]!.messages);
      expect(prompt).not.toContain("newCaseCount");
      expect(prompt).not.toContain("places");
      expect(prompt).not.toContain("町B");
      expect(await overviewOf()).toMatchObject({ newCaseCount: null, newBirdCount: null, newCases: [], newBirds: [] });
    });

    it("シーズンの途中で最初の会員が登録した朝も同じ。次の朝からは新規の節が出る", async () => {
      await seedCase(firstCase());
      const { overview } = options();
      const nobody = makeDeps();
      await runMorningDigest(nobody.deps, fakeGeo(), overview);
      expect((await db.doc("usage/overviewMarker").get()).exists).toBe(false); // 宛先がない間は進まない

      await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      const first = makeDeps();
      await runMorningDigest(first.deps, fakeGeo(), overview);
      expect(first.mail.sent[0]!.text).not.toContain("今回新しく載せた");

      await seedCase(caseFixture({ id: "c2", stages: { confirmed: stage("2026-11-05") } }));
      await seedWatch(nextMorning());
      const next = makeDeps({ now: nextMorning });
      await runMorningDigest(next.deps, fakeGeo(), options(new Error("api down")).overview);
      expect(next.mail.sent[0]!.text).toContain("今回新しく載せた発生: 1 件");
    });
  });

  describe("訂正", () => {
    const u4 = () => seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
    /** 1 日目に送り、翌朝に変えて送る。翌朝の本文を返す。 */
    const nextAfter = async (first: Case[], change: () => Promise<void>) => {
      await u4();
      for (const c of first) await seedCase(c);
      await runMorningDigest(makeDeps().deps, fakeGeo(), options().overview);
      await change();
      await seedWatch(nextMorning());
      const next = makeDeps({ now: nextMorning });
      const { overview, calls } = options(new Error("api down"));
      await runMorningDigest(next.deps, fakeGeo(), overview);
      return { mail: next.mail, calls };
    };

    it("疑いが否定された朝にまとめが出て、訂正の行があり、印から消える", async () => {
      const c = suspected({ id: "c1" });
      const { mail, calls } = await nextAfter([c], () => seedCase({ ...c, negation: "negated", negatedAt: "2026-11-05T15:00:00+09:00" }));
      expect(mail.sent).toHaveLength(1);
      const text = mail.sent[0]!.text;
      expect(text).toContain("訂正: 岡山県町Aの疑いは否定されました");
      expect(text).toContain("今季の全国の発生: 0 件");
      expect(findWordingViolations(text)).toEqual([]);
      expect(calls).toHaveLength(1);
      expect((await db.doc("usage/overviewMarker").get()).data()).toMatchObject({ date: "2026-11-06", caseIds: [] });
    });

    it("否定の候補の段階では、まとめも訂正も出さない（人が確かめて消す）", async () => {
      const c = suspected({ id: "c1" });
      const { mail, calls } = await nextAfter([c], () => seedCase({ ...c, negation: "candidate" }));
      expect(mail.sent).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("疑いから確定に変わった朝にまとめが出て、翌々朝は同じ訂正を繰り返さない", async () => {
      const c = suspected({ id: "c1" });
      const { mail } = await nextAfter([c], () => seedCase({ ...c, stages: { suspected: stage("2026-11-04"), confirmed: stage("2026-11-05") } }));
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.text).toContain("訂正: 岡山県町Aは疑いから確定に変わりました");

      const later = () => new Date(NOW.getTime() + 2 * 86_400_000);
      await seedWatch(later());
      const after = makeDeps({ now: later });
      await runMorningDigest(after.deps, fakeGeo(), options().overview);
      expect(after.mail.sent).toEqual([]);
    });

    it("文書が消えた朝にまとめが出て、前回の名前で書く", async () => {
      const { mail } = await nextAfter([firstCase()], async () => {
        await db.collection("cases").doc("c1").delete();
      });
      expect(mail.sent[0]!.text).toContain("訂正: 前回載せた岡山県町Aの発生は、今回の件数に入れていません");
    });

    it("段階を持たない古い印で、配備の朝に訂正を出さない", async () => {
      await u4();
      await seedCase(suspected({ id: "c1" }));
      await seedMarker({ caseIds: ["c1"] });
      const { deps, mail } = makeDeps();
      await runMorningDigest(deps, fakeGeo(), options().overview);
      expect(mail.sent).toEqual([]);
    });

    it("印の段階を書く前の日付の文書（古い形）でも、やり直しで投げず本文を組める", async () => {
      await u4();
      await seedCase(firstCase());
      await seedMarker();
      await runMorningDigest(makeDeps({ fail: () => badRecipient }).deps, fakeGeo(), options().overview);
      const ref = db.doc("dailyOverviews/2026-11-05");
      const { corrections: _c, reviewingPrefCodes: _r, caseMarks: _m, birdMarks: _b, ...old } = (await ref.get()).data()!;
      await ref.set(old);
      const later = makeDeps();
      await runRetryFailed(later.deps, fakeGeo());
      expect(later.mail.sent).toHaveLength(1);
      expect(later.mail.sent[0]!.text).not.toContain("訂正:");
    });
  });

  describe("未確認の県", () => {
    const seedOne = async () => {
      await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      await seedCase(firstCase());
    };

    it("一部の県が未確認の朝は、確認できた範囲の形にし、今季の件数を総括に書かせない", async () => {
      await seedOne();
      await seedWatch(NOW, ["33", "34"]);
      const { deps, mail } = makeDeps();
      const { overview, calls } = options();
      await runMorningDigest(deps, fakeGeo(), overview);
      const text = mail.sent[0]!.text;
      expect(text).toContain("今季の全国の発生: 確認できた範囲では 1 件（2 県は確認できていません）");
      expect(text).toContain("約 60km 以内の今季の発生: 確認できた範囲では 0 件（2 県は確認できていません）");
      expect(text).not.toContain(SENTENCE); // 素の件数の総括は外す
      expect(JSON.stringify(calls[0]!.messages)).not.toContain("seasonCount");
      expect((await overviewOf()).sentenceFailures).toContain("number_unchecked");
    });

    it("全県が未確認の朝は、件数を見出しにしない", async () => {
      await seedOne();
      await seedWatch(NOW, PREFS.map((p) => p.code));
      const { deps, mail } = makeDeps();
      await runMorningDigest(deps, fakeGeo(), options(claudeMessage("野鳥の陽性は 0 件です。")).overview);
      const text = mail.sent[0]!.text;
      expect(text).toContain("今季の全国の発生: まだ確認できていません");
      expect(text).not.toContain("今季の全国の発生: 1 件");
      expect(text).toContain("野鳥の陽性は 0 件です。");
    });

    it("確認中の事例がある県を書く（件数には入れず、町を出さない）", async () => {
      await seedOne();
      await seedCase(caseFixture({ id: "rev-1", prefCode: "31", muniCode: null, muniName: null, confirmState: "reviewing" }));
      const { deps, mail } = makeDeps();
      await runMorningDigest(deps, fakeGeo(), options().overview);
      const text = mail.sent[0]!.text;
      expect(text).toContain("確認中の発表がある県: 鳥取県。件数にはまだ入れていません。");
      expect(text).toContain("今季の全国の発生: 1 件");
    });
  });

  describe("記録を作れなかった朝", () => {
    /** u5 の全国まとめの記録だけ作れない db。 */
    const failingCreate = (uid: string) =>
      new Proxy(db, {
        get: (t, k) => {
          if (k !== "doc") return Reflect.get(t, k);
          return (p: string) => {
            const ref = t.doc(p);
            if (!p.startsWith(`sentNotices/f5__${uid}__`)) return ref;
            return new Proxy(ref, { get: (r, key) => (key === "create" ? () => Promise.reject(Object.assign(new Error("unavailable"), { code: 14 })) : Reflect.get(r, key)) });
          };
        },
      });
    const seedTwo = async () => {
      await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      await seedFarm("f5", "u5", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      await seedCase(firstCase());
    };

    it("dispatchNotices は作れなかった数を返す（すでにある記録は失敗に数えない）", async () => {
      await seedTwo();
      const logs = captureLogs();
      const notice = (farmId: string, uid: string) => ({ farmId, uid, subjectId: "2026-11-05", event: "daily_overview" as const, timing: "morning" as const, level: null, relationKind: null, facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: null }, isCorrection: false });
      try {
        const r = await dispatchNotices({ ...makeDeps().deps, db: failingCreate("u5") }, [notice("f4", "u4"), notice("f5", "u5")]);
        expect(r).toEqual({ mailStopped: false, recordFailures: 1 });
        const again = await dispatchNotices(makeDeps().deps, [notice("f4", "u4")]);
        expect(again).toEqual({ mailStopped: false, recordFailures: 0 });
      } finally {
        logs.restore();
      }
    });

    it("印を進めず、作れた会員には 1 通。毎時の送り直しが残りの会員だけに送り、二重に送らず、印を進める", async () => {
      await seedTwo();
      const { overview, calls } = options();
      const down = makeDeps();
      const logs = captureLogs();
      try {
        await runMorningDigest({ ...down.deps, db: failingCreate("u5") }, fakeGeo(), overview);
      } finally {
        logs.restore();
      }
      expect(down.mail.calls).toEqual(["u4@example.test"]);
      expect((await db.doc("usage/overviewMarker").get()).exists).toBe(false);

      const retry = makeDeps();
      await runRetryFailed(retry.deps, fakeGeo());
      expect(retry.mail.calls).toEqual(["u5@example.test"]);
      expect(calls).toHaveLength(1);
      expect((await db.doc("usage/overviewMarker").get()).data()).toMatchObject({ date: "2026-11-05", caseIds: ["c1"] });

      const again = makeDeps();
      await runRetryFailed(again.deps, fakeGeo());
      expect(again.mail.calls).toEqual([]);
    });

    it("送り直しでも作れなければ印を進めない。翌朝は印との差でまとめ直す", async () => {
      await seedTwo();
      const { overview } = options();
      const down = makeDeps();
      const logs = captureLogs();
      try {
        await runMorningDigest({ ...down.deps, db: failingCreate("u5") }, fakeGeo(), overview);
        await runRetryFailed({ ...makeDeps().deps, db: failingCreate("u5") }, fakeGeo());
      } finally {
        logs.restore();
      }
      expect((await db.doc("usage/overviewMarker").get()).exists).toBe(false);

      await seedWatch(nextMorning());
      const next = makeDeps({ now: nextMorning });
      await runMorningDigest(next.deps, fakeGeo(), overview);
      expect(next.mail.calls.sort()).toEqual(["u4@example.test", "u5@example.test"]);
    });

    it("送り直しの追いつきは、その日の文書がなければ何も読まず、朝の queued を送らない", async () => {
      await seedFarm("f4", "u4", { meshCode: IN_D, muniCode: GEO_D, prefCode: "34" });
      await seedNotice("f4", "u4", "c1", "confirmed", "queued", "morning");
      const later = makeDeps();
      await runRetryFailed(later.deps, fakeGeo());
      expect(later.mail.calls).toEqual([]);
    });
  });
});
