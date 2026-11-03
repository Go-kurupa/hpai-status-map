// M-02: 事例の書き込みで、誰にいつどの文面を送るか。模擬環境（demo-hpai）。本物のメールは送らない。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeReviewingCase } from "@hpai/shared/cases";
import { planCaseNotices } from "@hpai/shared/notices";
import { hasOutbreakWords } from "@hpai/shared/read/publish";
import type { Case } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { dispatchNotices, noteMailStop } from "../../src/notify/dispatch";
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
    expect(r).toEqual({ mailStopped: false });
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
      expect(r).toEqual({ mailStopped: false });
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
  ])("%sのエラーは残りへ送らず failed に残し（連打しない）、mail_failing が 1 日 1 件入り、mailStopped:true", async (_name, stop) => {
    await seedImmediate();
    await seedFarm("f2", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" }); // ②（朝）
    const logs = captureLogs();
    try {
      const { deps, mail } = makeDeps({ fail: () => stop });
      const c = caseFixture();
      const notices = await plan(c);
      expect(notices.map((n) => n.timing)).toEqual(expect.arrayContaining(["immediate", "morning"]));
      const r = await dispatchNotices(deps, notices);
      expect(r).toEqual({ mailStopped: true });
      expect(mail.calls).toHaveLength(1); // 最初の 1 回だけ
      const docs = await sentNoticeDocs();
      const immediate = notices.filter((n) => n.timing === "immediate");
      expect(immediate).toHaveLength(3);
      for (const n of immediate) expect(docs[idOf(n.farmId, n.uid, c, "confirmed")]).toMatchObject({ state: "failed", sentAt: null });
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
    expect(r).toEqual({ mailStopped: false });
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

// ── 通数（索引 Q3 の既定 A: 文書ごとに送る）──
const FIX = path.resolve(import.meta.dirname, "../../../data/private/fixtures/okayama");
describeFixture("岡山の 1 事例の控え（通数）", [path.join(FIX, "1013219.html"), path.join(FIX, "pdf")], () => {
  it("hasOutbreakWords が true の本数だけ rev- の事例を流すと、同じ農場の会員 1 人に同じ通数が届く", async () => {
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
      const rev = makeReviewingCase({ documentId: `okayama-${i}`, season: 2025, prefCode: "33", sourceUrl: `https://example.test/pdf/${i}` }, NOW);
      await handleCaseWrite(deps, null, rev, geo);
    }
    expect(mail.sent).toHaveLength(flagged.length);
    expect(new Set(mail.sent.map((m) => m.to))).toEqual(new Set(["u1@example.test"]));
    expect(Object.keys(await sentNoticeDocs())).toHaveLength(flagged.length);
  });
});
