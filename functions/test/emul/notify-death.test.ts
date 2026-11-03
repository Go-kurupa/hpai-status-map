// M-13: 死亡率の基準に当たったとき、同じ農場の会員へすぐ知らせる。模擬環境（demo-hpai）。本物のメールは送らない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@hpai/shared/dates";
import type { DeathRecord } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { handleDeathWrite } from "../../src/notify/onDeathWritten";
import { assertEmulator, captureLogs, clearFirestore, makeDeps, reviewQueueIds, seedFarm, sentNoticeDocs } from "./mHelpers";

beforeAll(assertEmulator);
beforeEach(clearFirestore);

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
    expect(mail.sent[0]!.subject).toBe("【死亡数】11月5日の死亡率が基準に当たる可能性があります");
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
    expect(mail.sent[0]!.subject).toBe("【死亡数】11月4日の死亡率が基準に当たる可能性があります");
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
    expect(new Set(Object.keys(await sentNoticeDocs())).size).toBe(3);
    // 3 件目までの鶏舎の記録を直した書き込みは、これまでどおり（新しく送らない）
    await handleDeathWrite(deps, "f1", idOf(recs[0]!), { ...recs[0]!, deaths: 6 });
    expect(mail.sent).toHaveLength(3);
  });

  it("同時に 5 件書かれても 3 通まで（上限はトランザクションで確保してから送る）。確保の記録は farms/{id}/hitCounters/{日付}", async () => {
    await seedFarm("f1", "u1");
    const { deps, mail } = makeDeps();
    const recs: DeathRecord[] = [];
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) recs.push(await hit(h));
    await Promise.all(recs.map((r) => handleDeathWrite(deps, "f1", idOf(r), r)));
    expect(mail.sent).toHaveLength(3);
    expect(Object.keys(await sentNoticeDocs())).toHaveLength(3);
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
