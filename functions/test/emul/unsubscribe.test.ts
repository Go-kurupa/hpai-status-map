// M-13: 配信停止のリンク（handleUnsubscribe）と配信の再開（handleResumeMail）。模擬環境（demo-hpai）。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@hpai/shared/dates";
import { db } from "../../src/admin";
import { handleCaseWrite } from "../../src/notify/onCaseWritten";
import { handleDeathWrite } from "../../src/notify/onDeathWritten";
import { handleResumeMail } from "../../src/notify/resumeMail";
import { handleUnsubscribe, handleUnsubscribeConfirm, queryOf, routeUnsubscribe } from "../../src/notify/unsubscribe";
import { signUnsubscribe } from "../../src/notify/unsubscribeSig";
import { caseFixture, fakeGeo, GEO_A, IN_A } from "../../../shared/test/helpers/mFixtures";
import { assertEmulator, clearFirestore, makeDeps, seedFarm, sentNoticeDocs } from "./mHelpers";

beforeAll(assertEmulator);
beforeEach(clearFirestore);

const KEY = "test-secret-not-real";
const q = (farm: string, uid: string, sig = signUnsubscribe(farm, uid, KEY)) => ({ farm, uid, sig });
const stoppedOf = async (farmId: string): Promise<string[]> => ((await db.doc(`farms/${farmId}`).get()).data() as { unsubscribedUids: string[] }).unsubscribedUids;

describe("handleUnsubscribe", () => {
  it("正しいリンクで、その会員とその農場だけが止まる。画面に理由と戻し方が出る", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    await seedFarm("f2", "u1");
    const res = await handleUnsubscribe(db, q("f1", "u1"), KEY);
    expect(res.status).toBe(200);
    expect(res.html).toContain("基準に当たった知らせと期限の知らせも止まります。画面の表示は止まりません");
    expect(res.html).toContain("知らせの設定で戻せます");
    expect(await stoppedOf("f1")).toEqual(["u1"]);
    expect(await stoppedOf("f2")).toEqual([]);
  });

  it("署名が違えば 403 で何も変えず、受け取った値を HTML に埋め込まない", async () => {
    await seedFarm("f1", "u1");
    const res = await handleUnsubscribe(db, q("f1", "u1", "bad-sig"), KEY);
    expect(res.status).toBe(403);
    expect(await stoppedOf("f1")).toEqual([]);
    const evil = await handleUnsubscribe(db, { farm: "f1<script>alert(1)</script>", uid: "u1", sig: "x" }, KEY);
    expect(evil.status).toBe(403);
    expect(evil.html).not.toContain("script");
    expect(evil.html).not.toContain("alert");
    // 別の会員の署名を流用しても止まらない
    const swapped = await handleUnsubscribe(db, { farm: "f1", uid: "u2", sig: signUnsubscribe("f1", "u1", KEY) }, KEY);
    expect(swapped.status).toBe(403);
  });

  it("欄が欠けた、鍵が違う、鍵が空でも例外にせず 403", async () => {
    await seedFarm("f1", "u1");
    expect((await handleUnsubscribe(db, {}, KEY)).status).toBe(403);
    expect((await handleUnsubscribe(db, q("f1", "u1"), "other-key")).status).toBe(403);
    expect((await handleUnsubscribe(db, q("f1", "u1"), "")).status).toBe(403);
  });

  it("2 回開いても 1 回分", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"] });
    await handleUnsubscribe(db, q("f1", "u1"), KEY);
    const second = await handleUnsubscribe(db, q("f1", "u1"), KEY);
    expect(second.status).toBe(200);
    expect(await stoppedOf("f1")).toEqual(["u1"]);
  });

  it("農場が消えていても 200（何も作らない）", async () => {
    const res = await handleUnsubscribe(db, q("gone", "u1"), KEY);
    expect(res.status).toBe(200);
    expect((await db.doc("farms/gone").get()).exists).toBe(false);
  });

  it("会員でない uid は止める対象にしない（農場の欄を変えない）", async () => {
    await seedFarm("f1", "u1");
    const res = await handleUnsubscribe(db, q("f1", "u9"), KEY);
    expect(res.status).toBe(200);
    expect(await stoppedOf("f1")).toEqual([]);
  });

  it("止めた後は、事例でも基準でも届かない", async () => {
    await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33" });
    await handleUnsubscribe(db, q("f1", "u1"), KEY);
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, null, caseFixture(), fakeGeo());
    const today = "2026-11-05";
    await db.doc("farms/f1/houses/h1").set({ name: "h1", birdType: "採卵鶏", flockSize: 1000, empty: false });
    for (let i = 1; i <= 21; i++) await db.doc(`farms/f1/deaths/${addDays(today, -i)}_h1`).set({ date: addDays(today, -i), houseId: "h1", deaths: 1, flockSizeAt: 1000, exclusion: null });
    const r = { date: today, houseId: "h1", deaths: 5, flockSizeAt: 1000, exclusion: null };
    await db.doc(`farms/f1/deaths/${today}_h1`).set(r);
    await handleDeathWrite(deps, "f1", `${today}_h1`, r);
    expect(mail.calls).toEqual([]);
    expect(await sentNoticeDocs()).toEqual({});
  });
});

describe("配信停止の確認の画面（GET）と停止（POST）", () => {
  it("確認の画面は何も変えず、ボタンの POST で止まる。署名が違えば 403", async () => {
    await seedFarm("f1", "u1");
    const confirm = await handleUnsubscribeConfirm(q("f1", "u1"), KEY);
    expect(confirm.status).toBe(200);
    expect(confirm.html).toContain("配信を止めますか");
    expect(confirm.html).toMatch(/<form method="post" action="\/unsubscribe">/);
    expect(confirm.html).toContain('name="sig"');
    expect(await stoppedOf("f1")).toEqual([]);
    const bad = await handleUnsubscribeConfirm(q("f1", "u1", "bad"), KEY);
    expect(bad.status).toBe(403);
    expect(bad.html).not.toContain("<form");
  });

  it("確認の画面の hidden 欄は HTML エスケープする（署名が合う値でも）", async () => {
    const evilFarm = 'a"><b>';
    const res = await handleUnsubscribeConfirm({ farm: evilFarm, uid: "u1", sig: signUnsubscribe(evilFarm, "u1", KEY) }, KEY);
    expect(res.status).toBe(200);
    expect(res.html).not.toContain(evilFarm);
    expect(res.html).toContain("&quot;&gt;&lt;b&gt;");
  });

  it("経路: GET では農場が変わらない（メール検査ソフトの先読み）。POST で止まる。署名違いの POST は 403。HEAD は何もしない", async () => {
    await seedFarm("f1", "u1");
    const sig = signUnsubscribe("f1", "u1", KEY);
    const get = await routeUnsubscribe(db, "GET", { farm: "f1", uid: "u1", sig }, {}, KEY);
    expect(get.status).toBe(200);
    expect(get.html).toContain("配信を止めますか");
    expect(await stoppedOf("f1")).toEqual([]);
    expect((await routeUnsubscribe(db, "HEAD", { farm: "f1", uid: "u1", sig }, {}, KEY)).html).toBe("");
    expect(await stoppedOf("f1")).toEqual([]);

    expect((await routeUnsubscribe(db, "POST", {}, { farm: "f1", uid: "u1", sig: "bad" }, KEY)).status).toBe(403);
    expect((await routeUnsubscribe(db, "POST", { farm: "f1", uid: "u1", sig }, {}, KEY)).status).toBe(403); // query だけでは止めない
    expect(await stoppedOf("f1")).toEqual([]);

    const post = await routeUnsubscribe(db, "POST", {}, { farm: "f1", uid: "u1", sig }, KEY);
    expect(post.status).toBe(200);
    expect(post.html).toContain("基準に当たった知らせと期限の知らせも止まります。画面の表示は止まりません");
    expect(await stoppedOf("f1")).toEqual(["u1"]);
    expect((await routeUnsubscribe(db, "PUT", {}, { farm: "f1", uid: "u1", sig }, KEY)).status).toBe(405);
  });
});

describe("queryOf（要求の query から文字列だけを取る）", () => {
  it("配列、入れ子、数は捨てる", () => {
    expect(queryOf({ farm: "f1", uid: ["a", "b"], sig: { x: 1 }, extra: 3 })).toEqual({ farm: "f1" });
    expect(queryOf(undefined)).toEqual({});
    expect(queryOf(null)).toEqual({});
  });
});

describe("handleResumeMail", () => {
  it("自分だけを戻す（他の会員の停止は残る）", async () => {
    await seedFarm("f1", "u1", { memberUids: ["u1", "u2"], unsubscribedUids: ["u1", "u2"] });
    await handleResumeMail(db, "u1", "f1");
    expect(await stoppedOf("f1")).toEqual(["u2"]);
    await handleResumeMail(db, "u1", "f1"); // 2 回目も同じ
    expect(await stoppedOf("f1")).toEqual(["u2"]);
  });

  it("会員でない人、ログインしていない人、農場がない場合は失敗し、何も変えない", async () => {
    await seedFarm("f1", "u1", { unsubscribedUids: ["u1"] });
    await expect(handleResumeMail(db, "u9", "f1")).rejects.toMatchObject({ code: "permission-denied" });
    await expect(handleResumeMail(db, undefined, "f1")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handleResumeMail(db, "u1", "gone")).rejects.toMatchObject({ code: "not-found" });
    await expect(handleResumeMail(db, "u1", "")).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(handleResumeMail(db, "u1", "a/b")).rejects.toMatchObject({ code: "invalid-argument" });
    expect(await stoppedOf("f1")).toEqual(["u1"]);
  });

  it("戻した後は事例の知らせが届く", async () => {
    await seedFarm("f1", "u1", { meshCode: IN_A, muniCode: GEO_A, prefCode: "33", unsubscribedUids: ["u1"] });
    await handleResumeMail(db, "u1", "f1");
    const { deps, mail } = makeDeps();
    await handleCaseWrite(deps, null, caseFixture(), fakeGeo());
    expect(mail.sent).toHaveLength(1);
  });
});
