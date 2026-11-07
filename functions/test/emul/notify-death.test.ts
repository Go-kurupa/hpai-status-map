// M-13: 死亡率の基準に当たったとき、同じ農場の会員へすぐ知らせる。模擬環境（demo-hpai）。本物のメールは送らない。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@hpai/shared/dates";
import type { DeathRecord } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { handleDeathWrite } from "../../src/notify/onDeathWritten";
import { runMorningDigest } from "../../src/notify/digest";
import { settleHitSlot } from "../../src/notify/hitSlots";
import { runRetryFailed } from "../../src/notify/retryFailed";
import { fakeGeo } from "../../../shared/test/helpers/mFixtures";
import { assertEmulator, captureLogs, clearFirestore, makeDeps, NOW, reviewQueueIds, seedFarm, sentNoticeDocs } from "./mHelpers";

// 運営者の箱への登録を 1 回だけ失敗させる（enqueueReview は ../admin の db を直接使うので、deps.db の差し替えでは失敗させられない）
const queueFault = vi.hoisted(() => ({ failNext: 0 }));
vi.mock("../../src/review/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/review/queue")>();
  return {
    ...actual,
    enqueueReview: async (...a: Parameters<typeof actual.enqueueReview>) => {
      if (queueFault.failNext > 0) {
        queueFault.failNext -= 1;
        throw new Error("review queue unavailable");
      }
      return actual.enqueueReview(...a);
    },
  };
});

beforeAll(assertEmulator);
beforeEach(clearFirestore);
afterEach(() => {
  queueFault.failNext = 0;
});

// NOW は 2026-11-05（JST の昼）。
const TODAY = "2026-11-05";
const rec = (date: string, houseId: string, deaths: number, over: Partial<DeathRecord> = {}): DeathRecord => ({ date, houseId, deaths, flockSizeAt: 1000, exclusion: null, ...over });
const idOf = (r: DeathRecord) => `${r.date}_${r.houseId}`;

async function put(r: DeathRecord): Promise<void> {
  await db.doc(`farms/f1/deaths/${idOf(r)}`).set(r);
}
/** 農場の鶏舎（実在する鶏舎の記録だけが対象）。 */
async function house(id: string): Promise<void> {
  await db.doc(`farms/f1/houses/${id}`).set({ name: id, birdType: "採卵鶏", flockSize: 1000, empty: false });
}
/** 当日の前の n 日を毎日 deaths 羽（1000 羽）。 */
async function seedPast(houseId: string, n: number, today = TODAY, deaths = 1): Promise<void> {
  for (let i = 1; i <= n; i++) await put(rec(addDays(today, -i), houseId, deaths));
}
/** 確保した枠（farms/f1/hitCounters/{日付} の recordIds）。 */
async function slotIds(date = TODAY): Promise<string[]> {
  const d = (await db.doc(`farms/f1/hitCounters/${date}`).get()).data() as { recordIds?: string[] } | undefined;
  return [...(d?.recordIds ?? [])].sort();
}
/** u1 の基準の知らせの記録の状態を、記録の id ごとに。 */
async function hitStates(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of Object.values(await sentNoticeDocs())) if (d.event === "mortality_hit" && d.uid === "u1") out[d.subjectId as string] = d.state as string;
  return out;
}
/** 記録を sent にする書き込みだけを失敗させる（markSent は 1 回やり直すので、2 回とも失敗する）。戻す関数を返す。 */
function failSentUpdates(): () => void {
  const proto = Object.getPrototypeOf(db.doc("x/y")) as { update: (...a: unknown[]) => Promise<unknown> };
  const orig = proto.update;
  const spy = vi.spyOn(proto, "update").mockImplementation(function (this: unknown, ...a: unknown[]) {
    const data = a[0] as { state?: unknown } | undefined;
    if (data?.state === "sent") return Promise.reject(new Error("write unavailable"));
    return orig.apply(this, a);
  });
  return () => spy.mockRestore();
}
const authErr = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });

async function hit(houseId = "h1", today = TODAY, deaths = 5): Promise<DeathRecord> {
  await house(houseId);
  await seedPast(houseId, 21, today);
  const r = rec(today, houseId, deaths);
  await put(r);
  return r;
}

describe("handleDeathWrite", () => {
  it("過去 21 日を毎日 1 羽、当日 5 羽（1000 羽）で、会員 2 人に 2 通すぐ届く", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    const { deps, mail } = makeDeps();
    const r = await hit();
    await handleDeathWrite(deps, "f1", idOf(r), r);
    expect(mail.sent.map((m) => m.to).sort()).toEqual(["u1@example.test", "u2@example.test"]);
    expect(mail.sent[0]!.subject).toBe("【死亡数】11月5日の死亡率が届け出の基準に達している可能性があります");
    expect(mail.sent[0]!.text).toContain("https://app.example.test/record/deaths");
    const docs = await sentNoticeDocs();
    expect(docs[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "sent", timing: "immediate", subjectId: idOf(r) });
  });

  it("同じ記録を直しても 1 人 1 通のまま", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    const { deps, mail } = makeDeps();
    const r = await hit();
    await handleDeathWrite(deps, "f1", idOf(r), r);
    const fixed = { ...r, deaths: 6 };
    await put(fixed);
    await handleDeathWrite(deps, "f1", idOf(r), fixed);
    await handleDeathWrite(deps, "f1", idOf(r), fixed);
    expect(mail.sent).toHaveLength(2);
  });

  it("当たらない（当日 1 羽）、21 日に満たない、除外の日、invalid_input、削除では送らない", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();

    await seedPast("h1", 21);
    const low = rec(TODAY, "h1", 1);
    await put(low);
    await handleDeathWrite(deps, "f1", idOf(low), low);

    await seedPast("h2", 10);
    const short = rec(TODAY, "h2", 5);
    await put(short);
    await handleDeathWrite(deps, "f1", idOf(short), short);

    await seedPast("h3", 21);
    const excluded = rec(TODAY, "h3", 50, { exclusion: { kind: "equipment", note: "" } });
    await put(excluded);
    await handleDeathWrite(deps, "f1", idOf(excluded), excluded);

    await seedPast("h4", 21);
    await put(rec(addDays(TODAY, -3), "h4", -1)); // 負の数
    const invalid = rec(TODAY, "h4", 5);
    await put(invalid);
    await handleDeathWrite(deps, "f1", idOf(invalid), invalid);

    await seedPast("h5", 21);
    const deleted = rec(TODAY, "h5", 5);
    await handleDeathWrite(deps, "f1", idOf(deleted), null);

    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("別の鶏舎と混ぜない（他の鶏舎の記録で当たりも外れも変わらない）", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const a = await hit("h1");
    // h2 は毎日 100 羽（当日も 100 羽）で当たらない。混ぜると h1 の平均が上がって h1 が当たらなくなる
    await seedPast("h2", 21, TODAY, 100);
    const b = rec(TODAY, "h2", 100);
    await put(b);
    await handleDeathWrite(deps, "f1", idOf(b), b);
    expect(mail.calls).toEqual([]);
    await handleDeathWrite(deps, "f1", idOf(a), a);
    expect(mail.sent).toHaveLength(1);
  });

  it("昨日より古い日付の記録では送らない（昨日は送る）", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const old = await hit("h1", addDays(TODAY, -2));
    await handleDeathWrite(deps, "f1", idOf(old), old);
    expect(mail.calls).toEqual([]);
    const yesterday = await hit("h2", addDays(TODAY, -1));
    await handleDeathWrite(deps, "f1", idOf(yesterday), yesterday);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.subject).toBe("【死亡数】11月4日の死亡率が届け出の基準に達している可能性があります");
  });

  it("配信を止めた会員には届かない。notify の設定は見ない", async () => {
    await seedFarm("f1", "u1", {
      memberUids: ["u1", "u2"],
      unsubscribedUids: ["u2"],
      notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null },
    });
    const { deps, mail } = makeDeps();
    const r = await hit();
    await handleDeathWrite(deps, "f1", idOf(r), r);
    expect(mail.sent.map((m) => m.to)).toEqual(["u1@example.test"]);
  });

  it("文書 id が date_houseId と合わない記録、農場がない記録では何もしない", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const r = await hit();
    await handleDeathWrite(deps, "f1", "forged-id", r);
    await handleDeathWrite(deps, "nofarm", idOf(r), r);
    expect(mail.calls).toEqual([]);
  });

  it("農場の鶏舎にない houseId の記録、未来の日付の記録では送らない", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    // 鶏舎の文書を作らない（偽の記録）
    await seedPast("ghost", 21);
    const fake = rec(TODAY, "ghost", 5);
    await put(fake);
    await handleDeathWrite(deps, "f1", idOf(fake), fake);
    // 未来の日付
    const tomorrow = addDays(TODAY, 1);
    await house("hf");
    await seedPast("hf", 21, tomorrow);
    const future = rec(tomorrow, "hf", 5);
    await put(future);
    await handleDeathWrite(deps, "f1", idOf(future), future);
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });

  it("1 農場の 1 日の基準の知らせは 3 件まで（4 つ目の鶏舎では送らない）。同じ記録の直しは数えない", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4"]) recs.push(await hit(h));
    for (const r of recs) await handleDeathWrite(deps, "f1", idOf(r), r);
    expect(mail.sent).toHaveLength(3);
    // 上限で止めた分も、黙って捨てず capped の記録を残し、運営者の箱に出す（farm や鶏舎は書かない）
    const docs = await sentNoticeDocs();
    expect(Object.keys(docs)).toHaveLength(4);
    expect(docs[`f1__u1__${idOf(recs[3]!)}__mortality_hit`]).toMatchObject({ state: "capped", sentAt: null });
    expect(await reviewQueueIds()).toEqual(["alert-mortality_capped-2026-11-05"]);
    const item = (await db.doc("reviewQueue/alert-mortality_capped-2026-11-05").get()).data() as { kind: string; alert: string; message: string; caseId: null };
    expect(item).toMatchObject({ kind: "alert", alert: "mortality_capped", caseId: null });
    expect(item.message).not.toMatch(/f1|h4|u1/);
    // 3 件目までの鶏舎の記録を直した書き込みは、これまでどおり（新しく送らない）。capped は送り直しでも送らない
    await handleDeathWrite(deps, "f1", idOf(recs[0]!), { ...recs[0]!, deaths: 6 });
    await runRetryFailed(deps, fakeGeo());
    expect(mail.sent).toHaveLength(3);
  });

  it("認証が切れた日に 4 件出ても失われない。送り直しで届くのは上限の 3 件まで、4 件目は capped と箱", async () => {
    await seedFarm("f1", "u1");
    const bad = makeDeps({ fail: () => authErr });
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4"]) recs.push(await hit(h));
    for (const r of recs) await handleDeathWrite(bad.deps, "f1", idOf(r), r);
    expect(bad.mail.sent).toEqual([]);
    expect(await slotIds()).toEqual([]); // 送れなかった分の枠は、その場で返っている
    const docs = await sentNoticeDocs();
    for (const r of recs) expect(docs[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "failed" });
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);

    const ok = makeDeps();
    await runRetryFailed(ok.deps, fakeGeo());
    expect(ok.mail.sent).toHaveLength(1); // 会員ごとに 1 通（3 件をまとめて）
    expect(await hitStates()).toEqual({ "2026-11-05_h1": "sent", "2026-11-05_h2": "sent", "2026-11-05_h3": "sent", "2026-11-05_h4": "capped" });
    expect(await slotIds()).toEqual(["2026-11-05_h1", "2026-11-05_h2", "2026-11-05_h3"]);
    expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05", "alert-mortality_capped-2026-11-05"]);
    expect(ok.mail.sent[0]!.text).not.toContain("h4");
  });

  it("同じ日に 2 件届いた後、認証の停止で 3 件が失敗したら、送り直しで届くのは 1 件だけで、残り 2 件は capped", async () => {
    await seedFarm("f1", "u1");
    const ok = makeDeps();
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) recs.push(await hit(h));
    for (const r of recs.slice(0, 2)) await handleDeathWrite(ok.deps, "f1", idOf(r), r);
    expect(ok.mail.sent).toHaveLength(2);
    const bad = makeDeps({ fail: () => authErr });
    for (const r of recs.slice(2)) await handleDeathWrite(bad.deps, "f1", idOf(r), r);
    expect(bad.mail.sent).toEqual([]);
    expect(await slotIds()).toEqual(["2026-11-05_h1", "2026-11-05_h2"]);

    await runRetryFailed(ok.deps, fakeGeo());
    expect(ok.mail.sent).toHaveLength(3);
    expect(ok.mail.sent[2]!.subject).toBe("【死亡数】11月5日の死亡率が届け出の基準に達している可能性があります"); // 1 件だけの文面
    expect(await hitStates()).toEqual({
      "2026-11-05_h1": "sent", "2026-11-05_h2": "sent", "2026-11-05_h3": "sent", "2026-11-05_h4": "capped", "2026-11-05_h5": "capped",
    });
    expect(await slotIds()).toHaveLength(3);
    expect(await reviewQueueIds()).toContain("alert-mortality_capped-2026-11-05");
  });

  it("送り直しを停止中と復旧後に繰り返しても、届くのは上限の 3 件まで", async () => {
    await seedFarm("f1", "u1");
    const bad = makeDeps({ fail: () => authErr });
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) recs.push(await hit(h));
    for (const r of recs) await handleDeathWrite(bad.deps, "f1", idOf(r), r);
    await runRetryFailed(bad.deps, fakeGeo()); // 停止中の送り直し
    expect(bad.mail.sent).toEqual([]);
    expect(await slotIds()).toEqual([]);
    const ok = makeDeps();
    await runRetryFailed(ok.deps, fakeGeo());
    await runRetryFailed(ok.deps, fakeGeo());
    await runMorningDigest(ok.deps, fakeGeo());
    const states = Object.values(await hitStates()).sort();
    expect(states).toEqual(["capped", "capped", "sent", "sent", "sent"]);
    expect(await slotIds()).toHaveLength(3);
  });

  it("同じ記録の別の会員への送り直しは、枠を新しく使わない（4 件目の記録は capped のまま）", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    const first = makeDeps({ emailOf: async (uid) => (uid === "u2" ? null : `${uid}@example.test`) });
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4"]) recs.push(await hit(h));
    for (const r of recs.slice(0, 3)) await handleDeathWrite(first.deps, "f1", idOf(r), r);
    expect(first.mail.sent.map((m) => m.to)).toEqual(["u1@example.test", "u1@example.test", "u1@example.test"]);
    expect(await slotIds()).toHaveLength(3);
    const ok = makeDeps();
    await runRetryFailed(ok.deps, fakeGeo()); // u2 の 3 件（枠は u1 に届いた記録のもの）
    expect(ok.mail.sent.map((m) => m.to)).toEqual(["u2@example.test"]);
    await handleDeathWrite(ok.deps, "f1", idOf(recs[3]!), recs[3]!);
    expect(ok.mail.sent).toHaveLength(1);
    expect(await slotIds()).toHaveLength(3);
  });

  it("送れた後に記録（sent）の書き込みが失敗しても、枠は返さず、送り直しで二度送らない（すぐ送る経路）", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const r = await hit("h1");
    const restore = failSentUpdates();
    try {
      await handleDeathWrite(deps, "f1", idOf(r), r);
    } finally {
      restore();
    }
    expect(mail.sent).toHaveLength(1);
    expect((await sentNoticeDocs())[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "queued" });
    expect(await slotIds()).toEqual([idOf(r)]); // 送れたので枠は使ったまま
    const later = { ...deps, now: () => new Date(NOW.getTime() + 11 * 60_000) };
    await runRetryFailed(later, fakeGeo());
    expect(mail.sent).toHaveLength(1);
    expect((await sentNoticeDocs())[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "sent" });
  });

  it("送り直しで送れた後に記録（sent）の書き込みが失敗しても、次の送り直しで二度送らない", async () => {
    await seedFarm("f1", "u1");
    const bad = makeDeps({ fail: () => authErr });
    const r = await hit("h1");
    await handleDeathWrite(bad.deps, "f1", idOf(r), r);
    const ok = makeDeps();
    const restore = failSentUpdates();
    try {
      await runRetryFailed(ok.deps, fakeGeo());
    } finally {
      restore();
    }
    expect(ok.mail.sent).toHaveLength(1);
    expect(await slotIds()).toEqual([idOf(r)]);
    await runRetryFailed(ok.deps, fakeGeo());
    expect(ok.mail.sent).toHaveLength(1);
    expect((await sentNoticeDocs())[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "sent" });
  });

  it("すぐ送る経路と送り直しの経路を同時に混ぜても、届く記録も枠も 3 件以下で、上限で止めた分は箱に出る", async () => {
    await seedFarm("f1", "u1");
    const bad = makeDeps({ fail: () => authErr });
    const old: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4"]) old.push(await hit(h));
    for (const r of old) await handleDeathWrite(bad.deps, "f1", idOf(r), r);
    const fresh: DeathRecord[] = [];
    for (const h of ["h5", "h6", "h7"]) fresh.push(await hit(h));
    const ok = makeDeps();
    await Promise.all([
      runRetryFailed(ok.deps, fakeGeo()),
      runRetryFailed(ok.deps, fakeGeo()),
      ...fresh.map((r) => handleDeathWrite(ok.deps, "f1", idOf(r), r)),
    ]);
    const states = Object.values(await hitStates());
    expect(states.filter((x) => x === "sent").length).toBeLessThanOrEqual(3);
    expect((await slotIds()).length).toBeLessThanOrEqual(3);
    expect(states.filter((x) => x === "capped").length).toBeGreaterThanOrEqual(4);
    expect(await reviewQueueIds()).toContain("alert-mortality_capped-2026-11-05");
  });

  it("確保した実行が送れずに後始末しても、同じ記録を送り直しで送っている最中の実行の枠は返さない（4 件目を通さない）", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    const X = await hit("h1");
    const eenv = Object.assign(new Error("bad rcpt"), { code: "EENVELOPE", responseCode: 550 });
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    let aEntered!: () => void;
    const aIn = new Promise<void>((r) => (aEntered = r));
    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => (releaseB = r));
    let bEntered!: () => void;
    const bIn = new Promise<void>((r) => (bEntered = r));
    // A（すぐ送る）: u1 は宛先の不備で failed、u2 は送信中に止まり、そのあと認証の失敗（1 人も届かない）
    const A = makeDeps({
      mailer: async (to) => {
        if (to === "u1@example.test") throw eenv;
        aEntered();
        await gateA;
        throw authErr;
      },
    });
    const pA = handleDeathWrite(A.deps, "f1", idOf(X), X);
    await aIn;
    // B（送り直し）: u1 の failed を拾い、同じ記録の枠（held）で送信中に止まる
    const sentTo: string[] = [];
    const B = makeDeps({
      mailer: async (to) => {
        bEntered();
        await gateB;
        sentTo.push(to);
      },
    });
    const pB = runRetryFailed(B.deps, fakeGeo());
    await bIn;
    releaseA();
    await pA;
    expect(await slotIds()).toEqual([idOf(X)]); // B が使っているので、A は返さない
    const others: DeathRecord[] = [];
    for (const h of ["h2", "h3", "h4"]) others.push(await hit(h));
    const ok = makeDeps();
    for (const r of others) await handleDeathWrite(ok.deps, "f1", idOf(r), r);
    releaseB();
    await pB;
    expect(sentTo).toEqual(["u1@example.test"]);
    const ids = await slotIds();
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids).toContain(idOf(X));
    expect(await hitStates()).toMatchObject({ [idOf(others[2]!)]: "capped" });
  });

  it("枠を返すとき、その記録が別の会員に届いていれば返さない（重なった実行で、届いた分を数え落とさない）", async () => {
    const r = "2026-11-05_h1";
    await db.doc(`farms/f1/hitCounters/${TODAY}`).set({ recordIds: [r], delivered: { [r]: ["u2"] }, holders: { [r]: ["run-a"] } });
    await settleHitSlot(db, "f1", r, { holder: "run-a", deliveredUids: [] });
    expect(await slotIds()).toEqual([r]);
    const d = (await db.doc(`farms/f1/hitCounters/${TODAY}`).get()).data() as { holders: Record<string, string[]> };
    expect(d.holders[r]).toBeUndefined(); // 自分の印は外す
  });

  it("枠を返すとき、自分以外の印が残っていれば返さず、自分の印だけを外す。最後の実行が送れなければ返す", async () => {
    const r = "2026-11-05_h1";
    await db.doc(`farms/f1/hitCounters/${TODAY}`).set({ recordIds: [r], delivered: {}, holders: { [r]: ["run-a", "run-b"] } });
    await settleHitSlot(db, "f1", r, { holder: "run-a", deliveredUids: [] });
    expect(await slotIds()).toEqual([r]);
    const d = (await db.doc(`farms/f1/hitCounters/${TODAY}`).get()).data() as { holders: Record<string, string[]> };
    expect(d.holders[r]).toEqual(["run-b"]);
    await settleHitSlot(db, "f1", r, { holder: "run-b", deliveredUids: [] });
    expect(await slotIds()).toEqual([]);
  });

  it("2 つの実行が同時に後始末（settle）しても、両方の印が消えて枠が返る（トランザクションが重ならない）", async () => {
    const r = "2026-11-05_h1";
    await db.doc(`farms/f1/hitCounters/${TODAY}`).set({ recordIds: [r], delivered: {}, holders: { [r]: ["a", "b"] } });
    await Promise.all([
      settleHitSlot(db, "f1", r, { holder: "a", deliveredUids: [] }),
      settleHitSlot(db, "f1", r, { holder: "b", deliveredUids: [] }),
    ]);
    const d = (await db.doc(`farms/f1/hitCounters/${TODAY}`).get()).data() as { holders: Record<string, string[]>; recordIds: string[] };
    expect(d.holders[r] ?? []).toEqual([]); // 両方の印が消える（片方が上書きで復活しない）
    expect(await slotIds()).toEqual([]); // 届いた会員がいないので、枠が返る
  });

  it("上限で止めた知らせの箱への登録が失敗しても、記録は capped のままで、次の回に箱へ登録し直す", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4"]) recs.push(await hit(h));
    for (const r of recs.slice(0, 3)) await handleDeathWrite(deps, "f1", idOf(r), r);
    queueFault.failNext = 1;
    await handleDeathWrite(deps, "f1", idOf(recs[3]!), recs[3]!);
    expect(queueFault.failNext).toBe(0);
    expect(mail.sent).toHaveLength(3);
    expect((await sentNoticeDocs())[`f1__u1__${idOf(recs[3]!)}__mortality_hit`]).toMatchObject({ state: "capped", cappedAlert: "pending" });
    expect(await reviewQueueIds()).toEqual([]);
    await runRetryFailed(deps, fakeGeo());
    expect(await reviewQueueIds()).toEqual(["alert-mortality_capped-2026-11-05"]);
    const capped = (await sentNoticeDocs())[`f1__u1__${idOf(recs[3]!)}__mortality_hit`]!;
    expect(capped.state).toBe("capped");
    expect(capped.cappedAlert).toBeUndefined();
    expect(mail.sent).toHaveLength(3);
  });

  it("宛先がなくて送れなかった日も枠を返す（送れた知らせだけが枠を使う）", async () => {
    await seedFarm("f1", "u1");
    const none = makeDeps({ emailOf: async () => null });
    const r = await hit("h1");
    await handleDeathWrite(none.deps, "f1", idOf(r), r);
    expect(none.mail.calls).toEqual([]);
    const counter = (await db.doc(`farms/f1/hitCounters/${TODAY}`).get()).data() as { recordIds: string[] } | undefined;
    expect(counter?.recordIds ?? []).toEqual([]);
  });

  it("枠の確保が投げても、記録は失われず failed になり、送り直しで届く（先に記録を作る）", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const broken = new Proxy(db, {
      get(t, p) {
        if (p === "runTransaction") return () => Promise.reject(new Error("transaction unavailable"));
        const v = Reflect.get(t, p) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const r = await hit("h1");
    await handleDeathWrite({ ...deps, db: broken }, "f1", idOf(r), r);
    expect(mail.calls).toEqual([]);
    expect((await sentNoticeDocs())[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "failed" });
    await runRetryFailed(deps, fakeGeo());
    expect(mail.sent).toHaveLength(1);
  });

  it("同時に 5 件書かれても 3 通まで（上限はトランザクションで確保してから送る）。確保の記録は farms/{id}/hitCounters/{日付}", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) recs.push(await hit(h));
    await Promise.all(recs.map((r) => handleDeathWrite(deps, "f1", idOf(r), r)));
    expect(mail.sent).toHaveLength(3);
    const states = Object.values(await sentNoticeDocs()).map((d) => d.state).sort();
    expect(states).toEqual(["capped", "capped", "sent", "sent", "sent"]);
    const counter = (await db.doc(`farms/f1/hitCounters/${TODAY}`).get()).data() as { recordIds: string[] };
    expect(counter.recordIds).toHaveLength(3);
    // 別の日は別の枠
    const y = await hit("h1", addDays(TODAY, -1));
    await handleDeathWrite(deps, "f1", idOf(y), y);
    expect(mail.sent).toHaveLength(4);
  });

  it("認証のエラーでは failed に残り、mail_failing が入る。ログに宛先を出さない", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    const logs = captureLogs();
    try {
      const { deps, mail } = makeDeps({ fail: () => authErr });
      const r = await hit();
      await handleDeathWrite(deps, "f1", idOf(r), r);
      expect(mail.calls).toHaveLength(1);
      expect((await sentNoticeDocs())[`f1__u1__${idOf(r)}__mortality_hit`]).toMatchObject({ state: "failed" });
      expect(await reviewQueueIds()).toEqual(["alert-mail_failing-2026-11-05"]);
      expect(logs.text()).not.toContain("example.test");
    } finally {
      logs.restore();
    }
  });
});
