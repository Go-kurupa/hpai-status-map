import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 契約 4.2。alice は f1、bob は f2 の会員。
const PROJECT_ID = "demo-hpai";

let env: RulesTestEnvironment;

function farm(uid: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "テスト農場",
    memberUids: [uid],
    unsubscribedUids: [],
    meshCode: "53394611",
    muniCode: "33001",
    prefCode: "33",
    frequentMuniCodes: [],
    production: null,
    housing: null,
    kahoContact: "",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {},
    updatedAt: "2026-11-03T09:00:00+09:00",
    ...over,
  };
}

const house = (over: Record<string, unknown> = {}) => ({ name: "1 号舎", birdType: "layer", flockSize: 100, empty: false, ...over });
const death = (over: Record<string, unknown> = {}) => ({
  date: "2026-11-03",
  houseId: "h1",
  deaths: 0,
  flockSizeAt: 100,
  exclusion: null,
  ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "farms/f1"), farm("alice"));
    await setDoc(doc(db, "farms/f2"), farm("bob"));
    for (const f of ["f1", "f2"]) {
      await setDoc(doc(db, `farms/${f}/houses/h1`), house());
      await setDoc(doc(db, `farms/${f}/deaths/2026-11-03_h1`), death());
      await setDoc(doc(db, `farms/${f}/checks/c1`), { kind: "disinfection", date: "2026-11-03", itemId: "i1" });
    }
    await setDoc(doc(db, "cases/c1"), { id: "c1", season: 2026 });
    await setDoc(doc(db, "wildBirds/w1"), { id: "w1", season: 2026 });
    await setDoc(doc(db, "watchStatus/33"), { prefCode: "33" });
    await setDoc(doc(db, "caseDrafts/c1"), { caseId: "c1" });
    await setDoc(doc(db, "reviewQueue/r1"), { id: "r1" });
    await setDoc(doc(db, "sources/s1"), { url: "https://example.test/" });
    await setDoc(doc(db, "documents/d1"), { id: "d1" });
    await setDoc(doc(db, "invites/abc"), { kind: "signup" });
    await setDoc(doc(db, "invites/_attempts/uids/alice"), { count: 1 });
    await setDoc(doc(db, "invites/_membership/uids/alice"), { touchedAt: "2026-11-03T09:00:00+09:00", farmId: "f1" }); // 1 会員 1 農場の鍵（redeemInvite が書く形と同じ）
    await setDoc(doc(db, "sentNotices/n1"), { state: "queued" });
    await setDoc(doc(db, "usage/settings"), { softLimitJpy: 2000 });
    await setDoc(doc(db, "somethingElse/x"), { a: 1 });
  });
});

const alice = () => env.authenticatedContext("alice", { member: true }).firestore();
const bob = () => env.authenticatedContext("bob", { member: true }).firestore();
const operator = () => env.authenticatedContext("op", { operator: true }).firestore();
const operatorMember = () => env.authenticatedContext("op", { operator: true, member: true }).firestore();
const memberOnly = () => env.authenticatedContext("carol", { member: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe("hitCounters（基準の知らせの上限の確保。サーバーだけが書く）", () => {
  it("自分の農場の会員でも、operator でも、未ログインでも、読めず書けない（既存の全拒否に落ちる）", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "farms/f1/hitCounters/2026-11-05"), { recordIds: ["2026-11-05_h1"] });
    });
    for (const db of [alice(), memberOnly(), operator(), operatorMember(), anon()]) {
      await assertFails(getDoc(doc(db, "farms/f1/hitCounters/2026-11-05")));
      await assertFails(getDocs(collection(db, "farms/f1/hitCounters")));
      await assertFails(setDoc(doc(db, "farms/f1/hitCounters/2026-11-06"), { recordIds: [] }));
      await assertFails(updateDoc(doc(db, "farms/f1/hitCounters/2026-11-05"), { recordIds: [] }));
      await assertFails(deleteDoc(doc(db, "farms/f1/hitCounters/2026-11-05")));
    }
  });
});

describe("§16 権限: 読めない", () => {
  it("他の農場の農場、鶏舎、死亡数、点検を読めない", async () => {
    const db = alice();
    await assertFails(getDoc(doc(db, "farms/f2")));
    await assertFails(getDoc(doc(db, "farms/f2/houses/h1")));
    await assertFails(getDoc(doc(db, "farms/f2/deaths/2026-11-03_h1")));
    await assertFails(getDoc(doc(db, "farms/f2/checks/c1")));
    await assertFails(getDocs(collection(db, "farms/f2/houses")));
  });

  it("operator でも農場と死亡数を読めない", async () => {
    for (const db of [operator(), operatorMember()]) {
      await assertFails(getDoc(doc(db, "farms/f1")));
      await assertFails(getDoc(doc(db, "farms/f1/deaths/2026-11-03_h1")));
    }
  });

  it("member の claim だけでは読めない", async () => {
    const db = memberOnly();
    await assertFails(getDoc(doc(db, "farms/f1")));
    await assertFails(getDoc(doc(db, "farms/f1/houses/h1")));
  });

  it("未ログインは読めない", async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, "farms/f1")));
    await assertFails(getDoc(doc(db, "farms/f1/deaths/2026-11-03_h1")));
  });

  it("array-contains で自分の農場を探せ、全件の取得は落ちる", async () => {
    const db = alice();
    const mine = await assertSucceeds(getDocs(query(collection(db, "farms"), where("memberUids", "array-contains", "alice"))));
    if (mine.size !== 1 || mine.docs[0]?.id !== "f1") throw new Error(`自分の農場だけのはず: ${mine.size}`);
    await assertFails(getDocs(collection(db, "farms")));
    await assertFails(getDocs(query(collection(db, "farms"), where("memberUids", "array-contains", "bob"))));
  });
});

describe("書き込み: 農場", () => {
  it("自分の農場は読み書きできる", async () => {
    const db = alice();
    await assertSucceeds(getDoc(doc(db, "farms/f1")));
    await assertSucceeds(getDoc(doc(db, "farms/f1/houses/h1")));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { name: "改名", updatedAt: "2026-11-04T09:00:00+09:00" }));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { production: "layer", housing: "open" }));
    await assertSucceeds(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: "2 号舎" })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/2026-11-04_h1"), death({ date: "2026-11-04", deaths: 3 })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/checks/c2"), { kind: "disinfection", date: "2026-11-04", itemId: "i2" }));
    await assertSucceeds(
      setDoc(doc(db, "farms/f1/checks/c3"), {
        kind: "self_inspection",
        date: "2026-11-04",
        month: "2026-11",
        answers: { "17": "ok", "18": null },
      }),
    );
  });

  it("他の農場には書けない", async () => {
    const db = alice();
    await assertFails(updateDoc(doc(db, "farms/f2"), { name: "のっとり" }));
    await assertFails(setDoc(doc(db, "farms/f2/houses/h9"), house()));
    await assertFails(setDoc(doc(db, "farms/f2/deaths/x"), death()));
  });

  it("作成は member が要る", async () => {
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/carol"), farm("carol")));
    const noClaim = env.authenticatedContext("dave").firestore();
    await assertFails(setDoc(doc(noClaim, "farms/dave"), farm("dave")));
    await assertFails(setDoc(doc(anon(), "farms/x"), farm("x")));
    await assertFails(setDoc(doc(operator(), "farms/op"), farm("op")));
  });

  it("作成で memberUids に他人、unsubscribedUids が空でないと落ちる", async () => {
    const db = memberOnly();
    await assertFails(setDoc(doc(db, "farms/carol"), farm("carol", { memberUids: ["carol", "bob"] })));
    await assertFails(setDoc(doc(db, "farms/carol"), farm("carol", { memberUids: ["bob"] })));
    await assertFails(setDoc(doc(db, "farms/carol"), farm("carol", { memberUids: [] })));
    await assertFails(setDoc(doc(db, "farms/carol"), farm("carol", { unsubscribedUids: ["carol"] })));
  });

  it("更新で memberUids と unsubscribedUids を変えられない", async () => {
    const db = alice();
    await assertFails(updateDoc(doc(db, "farms/f1"), { memberUids: ["alice", "bob"] }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { memberUids: ["bob"] }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { unsubscribedUids: ["alice"] }));
  });

  it("直接消せない", async () => {
    await assertFails(deleteDoc(doc(alice(), "farms/f1")));
  });

  it("他の農場（f2）の checks の作成、houses・deaths・checks の更新と削除が落ちる", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f2/checks/new"), { kind: "disinfection", date: "2026-11-04", itemId: "i" }));
    await assertFails(updateDoc(doc(db, "farms/f2/houses/h1"), { name: "x" }));
    await assertFails(updateDoc(doc(db, "farms/f2/deaths/2026-11-03_h1"), { deaths: 9 }));
    await assertFails(updateDoc(doc(db, "farms/f2/checks/c1"), { itemId: "x" }));
    await assertFails(deleteDoc(doc(db, "farms/f2/houses/h1")));
    await assertFails(deleteDoc(doc(db, "farms/f2/deaths/2026-11-03_h1")));
    await assertFails(deleteDoc(doc(db, "farms/f2/checks/c1")));
    // 未ログインと operator も同じ
    await assertFails(deleteDoc(doc(anon(), "farms/f1/houses/h1")));
    await assertFails(updateDoc(doc(operator(), "farms/f1/deaths/2026-11-03_h1"), { deaths: 9 }));
  });

  it("自分の農場の houses・deaths・checks は更新も削除もできる", async () => {
    const db = alice();
    await assertSucceeds(updateDoc(doc(db, "farms/f1/houses/h1"), { flockSize: 50 }));
    await assertSucceeds(updateDoc(doc(db, "farms/f1/deaths/2026-11-03_h1"), { deaths: 2 }));
    await assertSucceeds(updateDoc(doc(db, "farms/f1/checks/c1"), { itemId: "i9" }));
    await assertSucceeds(deleteDoc(doc(db, "farms/f1/houses/h1")));
    await assertSucceeds(deleteDoc(doc(db, "farms/f1/deaths/2026-11-03_h1")));
    await assertSucceeds(deleteDoc(doc(db, "farms/f1/checks/c1")));
  });

  it("hasOnly: Farm にないキーを持てない", async () => {
    await assertFails(updateDoc(doc(alice(), "farms/f1"), { extra: 1 }));
    await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { extra: 1 })));
  });

  it("hasOnly: houses / deaths / checks にないキーを持てない", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ extra: 1 })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ extra: 1 })));
    await assertFails(setDoc(doc(db, "farms/f1/checks/x"), { kind: "disinfection", date: "2026-11-04", itemId: "i", extra: 1 }));
  });
});

describe("地点と入力者", () => {
  it("lat、lng、latitude、longitude、address を持てない", async () => {
    const db = alice();
    for (const key of ["lat", "lng", "latitude", "longitude", "address"]) {
      await assertFails(updateDoc(doc(db, "farms/f1"), { [key]: key === "address" ? "どこか" : 35.1 }));
      await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { [key]: key === "address" ? "どこか" : 35.1 })));
    }
  });

  it("meshCode は 8 桁の数字だけ", async () => {
    const db = alice();
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { meshCode: "53394611" }));
    for (const bad of ["5339461", "533946111", "abcdefgh", "5339461a", "", "5339 461"]) {
      await assertFails(updateDoc(doc(db, "farms/f1"), { meshCode: bad }));
      await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { meshCode: bad })));
    }
    await assertFails(updateDoc(doc(db, "farms/f1"), { meshCode: 53394611 }));
  });

  it("deaths、checks に uid、createdBy を持てない", async () => {
    const db = alice();
    for (const key of ["uid", "createdBy"]) {
      await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ [key]: "alice" })));
      await assertFails(setDoc(doc(db, "farms/f1/checks/x"), { kind: "disinfection", date: "2026-11-04", itemId: "i", [key]: "alice" }));
      await assertFails(updateDoc(doc(db, "farms/f1/deaths/2026-11-03_h1"), { [key]: "alice" }));
    }
  });
});

describe("数の型（§8）", () => {
  const bad: Array<[string, unknown]> = [
    ["文字", "3"],
    ["負の数", -1],
    ["小数", 1.5],
  ];

  it("deaths.deaths の文字、負の数、小数が落ち、0 は通る", async () => {
    const db = alice();
    for (const [, v] of bad) await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ deaths: v })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/x"), death({ deaths: 0 })));
  });

  it("deaths.flockSizeAt の文字、負の数、小数が落ち、0 は通る", async () => {
    const db = alice();
    for (const [, v] of bad) await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ flockSizeAt: v })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/x"), death({ flockSizeAt: 0 })));
  });

  it("houses.flockSize の文字、負の数、小数が落ち、0 は通る", async () => {
    const db = alice();
    for (const [, v] of bad) await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ flockSize: v })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/houses/h2"), house({ flockSize: 0 })));
  });

  it("production、housing の null は通る", async () => {
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { production: null, housing: null })));
    await assertSucceeds(updateDoc(doc(alice(), "farms/f1"), { production: null, housing: null }));
  });
});

describe("公開と非公開", () => {
  it("cases、wildBirds、watchStatus は全員読めて誰も書けない", async () => {
    for (const db of [anon(), alice(), memberOnly(), operator()]) {
      await assertSucceeds(getDoc(doc(db, "cases/c1")));
      await assertSucceeds(getDoc(doc(db, "wildBirds/w1")));
      await assertSucceeds(getDoc(doc(db, "watchStatus/33")));
      await assertSucceeds(getDocs(collection(db, "cases")));
      await assertFails(setDoc(doc(db, "cases/new"), { id: "new" }));
      await assertFails(updateDoc(doc(db, "cases/c1"), { season: 1 }));
      await assertFails(deleteDoc(doc(db, "cases/c1")));
      await assertFails(setDoc(doc(db, "wildBirds/new"), { id: "new" }));
      await assertFails(setDoc(doc(db, "watchStatus/34"), { prefCode: "34" }));
    }
  });

  it("caseDrafts は member だけ読め、誰も書けない", async () => {
    await assertSucceeds(getDoc(doc(alice(), "caseDrafts/c1")));
    await assertSucceeds(getDoc(doc(memberOnly(), "caseDrafts/c1")));
    await assertFails(getDoc(doc(operator(), "caseDrafts/c1")));
    await assertFails(getDoc(doc(anon(), "caseDrafts/c1")));
    await assertFails(setDoc(doc(alice(), "caseDrafts/c2"), { caseId: "c2" }));
    await assertFails(updateDoc(doc(alice(), "caseDrafts/c1"), { workerMessage: "x" }));
    await assertFails(deleteDoc(doc(alice(), "caseDrafts/c1")));
  });

  it("reviewQueue は operator だけ読め、誰も書けない", async () => {
    await assertSucceeds(getDoc(doc(operator(), "reviewQueue/r1")));
    await assertSucceeds(getDoc(doc(operatorMember(), "reviewQueue/r1")));
    await assertFails(getDoc(doc(alice(), "reviewQueue/r1")));
    await assertFails(getDoc(doc(anon(), "reviewQueue/r1")));
    await assertFails(setDoc(doc(operator(), "reviewQueue/r2"), { id: "r2" }));
    await assertFails(updateDoc(doc(operator(), "reviewQueue/r1"), { resolvedAt: "x" }));
    await assertFails(deleteDoc(doc(operator(), "reviewQueue/r1")));
  });

  it("sources、documents、invites、_attempts、_membership、sentNotices、usage、書かれていない集合は operator でも読めない", async () => {
    const paths = [
      "sources/s1",
      "documents/d1",
      "invites/abc",
      "invites/_attempts/uids/alice",
      "invites/_membership/uids/alice",
      "sentNotices/n1",
      "usage/settings",
      "somethingElse/x",
      "neverWritten/x",
    ];
    for (const db of [operator(), operatorMember(), alice(), anon()]) {
      for (const p of paths) {
        await assertFails(getDoc(doc(db, p)));
        await assertFails(setDoc(doc(db, p), { a: 1 }));
      }
    }
  });
});

// 公開前のセキュリティ確認（S-18、N-1、N-2）。画面を通さず SDK から書いても、入れ子の中身まで縛られる
describe("入れ子の中身（S-18）", () => {
  const notifyOf = (over: Record<string, unknown> = {}) => ({
    level1: true,
    level2: true,
    level3: true,
    morningDigest: true,
    selfCheckRemindDays: null,
    ...over,
  });

  it("notify の中に緯度経度や知らないキーを入れられない", async () => {
    const db = alice();
    for (const extra of [{ lat: 35.1 }, { lng: 135.2 }, { latitude: 35.1, longitude: 135.2 }, { address: "どこか" }, { x: { lat: 35.1 } }]) {
      await assertFails(updateDoc(doc(db, "farms/f1"), { notify: notifyOf(extra) }));
      await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { notify: notifyOf(extra) })));
    }
  });

  it("selfCheckDue、production、housing、frequentMuniCodes に、緯度経度を入れた入れ子を入れられない", async () => {
    const db = alice();
    const geo = { lat: 35.1, lng: 135.2 };
    await assertFails(updateDoc(doc(db, "farms/f1"), { production: geo }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { housing: geo }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { frequentMuniCodes: geo }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { selfCheckDue: "2026-11" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { name: geo }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { kahoContact: geo }));
  });

  it("鶏舎、死亡数、点検の入れ子にも、緯度経度や知らないキーを入れられない", async () => {
    const db = alice();
    const geo = { lat: 35.1, lng: 135.2 };
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: geo })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ birdType: geo })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ empty: "no" })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: "", ...geo } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: geo })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ houseId: geo })));
    await assertFails(setDoc(doc(db, "farms/f1/checks/x"), { kind: "disinfection", date: "2026-11-04", itemId: geo }));
    await assertFails(
      setDoc(doc(db, "farms/f1/checks/x"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: { "17": "ok", ...geo } }),
    );
  });
});

describe("期限の知らせの数（N-1）", () => {
  it("selfCheckRemindDays が 100000 だと落ちる。0〜7 の整数と null は通る", async () => {
    const db = alice();
    const withDays = (v: unknown) => ({ level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: v });
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: withDays(100000) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: withDays(8) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: withDays(-1) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: withDays(2.5) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: withDays("3") }));
    await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { notify: withDays(100000) })));
    for (const ok of [null, 0, 1, 3, 7]) await assertSucceeds(updateDoc(doc(db, "farms/f1"), { notify: withDays(ok) }));
  });

  it("selfCheckDue が 400 件だと落ちる。1 季分（8 件）と、2 季分の余裕は通る", async () => {
    const db = alice();
    const months = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, "2026-11-20"]));
    await assertFails(updateDoc(doc(db, "farms/f1"), { selfCheckDue: months(400) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { selfCheckDue: months(41) }));
    await assertFails(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { selfCheckDue: months(400) })));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { selfCheckDue: months(8) }));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { selfCheckDue: months(16) }));
  });
});

describe("農場は 1 会員 1 つ（N-2）", () => {
  it("農場の id が自分の uid でないと作れない。自分の uid の id なら作れる", async () => {
    const db = memberOnly();
    await assertFails(setDoc(doc(db, "farms/f9"), farm("carol")));
    await assertFails(setDoc(doc(db, "farms/f10"), farm("carol")));
    await assertSucceeds(setDoc(doc(db, "farms/carol"), farm("carol")));
  });

  it("2 つ目の農場（別の id）を作れない", async () => {
    const db = memberOnly();
    await assertSucceeds(setDoc(doc(db, "farms/carol"), farm("carol")));
    await assertFails(setDoc(doc(db, "farms/carol2"), farm("carol")));
    await assertFails(setDoc(doc(db, "farms/f2x"), farm("carol")));
  });

  it("招待で他の農場に入っている人（鍵の農場が残っている）は、自分の農場を作れない（I-3）", async () => {
    // alice は招待で f1 に入った人の形（鍵 invites/_membership/uids/alice が f1 を指し、f1 がある）
    await assertFails(setDoc(doc(alice(), "farms/alice"), farm("alice")));
  });

  it("入った農場が消された人（鍵が消えた農場を指す）は、自分の農場を作れる。鍵がない人も作れる", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), "farms/f1"));
    });
    await assertSucceeds(setDoc(doc(alice(), "farms/alice"), farm("alice")));
    // 鍵がない人（自分で農場を作る人）は、もともと作れる
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/carol"), farm("carol")));
  });

  it("他人の uid の id の農場を、自分の会員として作れない", async () => {
    await assertFails(setDoc(doc(memberOnly(), "farms/bob"), farm("carol")));
  });
});

describe("画面と同じ形の保存は通り、外れた値は落ちる", () => {
  it("農場: 列挙、桁、長さ、件数の境目", async () => {
    const db = alice();
    for (const v of ["layer", "broiler", null]) await assertSucceeds(updateDoc(doc(db, "farms/f1"), { production: v }));
    for (const v of ["windowless", "open", "free_range", null]) await assertSucceeds(updateDoc(doc(db, "farms/f1"), { housing: v }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { production: "duck" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { housing: "cage" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { production: 1 }));

    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { name: "あ".repeat(60), kahoContact: "あ".repeat(300) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { name: "あ".repeat(61) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { kahoContact: "あ".repeat(301) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { updatedAt: "x".repeat(41) }));

    const munis = (n: number) => Array.from({ length: n }, (_, i) => String(13101 + i));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { frequentMuniCodes: munis(20) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { frequentMuniCodes: munis(21) }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { frequentMuniCodes: "13101" }));

    // 町のコードは 5 桁で、先頭 2 桁が県のコードと一致する
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { muniCode: "13101", prefCode: "13" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { muniCode: "13101", prefCode: "33" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { muniCode: "1310", prefCode: "13" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { muniCode: "33001", prefCode: "3" }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { muniCode: 33001 }));
  });

  it("農場: 2 季分の期限の保存（画面は 1 季 8 か月）と、知らせの全部の組が通る", async () => {
    const db = alice();
    const season = (y: number) => [10, 11, 12].map((m) => `${y}-${m}`).concat([1, 2, 3, 4, 5].map((m) => `${y + 1}-0${m}`));
    const due = Object.fromEntries([...season(2026), ...season(2027)].map((m) => [m.replace(/-(\d)$/, "-0$1"), "2026-11-20"]));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { selfCheckDue: due }));
    for (const days of [1, 2, 3, 5, 7]) {
      await assertSucceeds(
        updateDoc(doc(db, "farms/f1"), {
          notify: { level1: false, level2: true, level3: false, morningDigest: true, selfCheckRemindDays: days },
        }),
      );
    }
    // 知らせの項目が欠けたり、bool でなかったりすると落ちる
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: { level1: true, level2: true, level3: true, morningDigest: true } }));
    await assertFails(
      updateDoc(doc(db, "farms/f1"), { notify: { level1: "yes", level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null } }),
    );
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: null }));
    await assertFails(updateDoc(doc(db, "farms/f1"), { notify: "all" }));
  });

  it("鶏舎: 画面の鳥の種類（日本語）と長さの境目", async () => {
    const db = alice();
    for (const t of ["採卵鶏", "肉用鶏", "種鶏", "あひる", "うずら", "その他"]) {
      await assertSucceeds(setDoc(doc(db, "farms/f1/houses/h2"), house({ birdType: t })));
    }
    await assertSucceeds(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: "あ".repeat(40) })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: "あ".repeat(41) })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ birdType: "あ".repeat(21) })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: 1 })));
  });

  it("死亡数: 除外の種類と注記、日付の形", async () => {
    const db = alice();
    for (const kind of ["disease", "equipment", "temperature", "disaster", "empty", "other"]) {
      await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind, note: "" } })));
    }
    await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: "あ".repeat(300) } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: "あ".repeat(301) } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "bogus", note: "" } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { note: "" } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: "other" })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ date: "2026-11-3" })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ date: 20261103 })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ houseId: "h".repeat(129) })));
  });

  it("点検: 消毒と自己点検の形、答えの値", async () => {
    const db = alice();
    const answers = { "17": "ok", "18": "ng", "19": null, "22": "ok", "23": "ok", "25": "ok", "27": "ok" };
    await assertSucceeds(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: { "17": "maybe" } }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: { "99": "ok" } }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-1", answers }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", answers }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: "ok" }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04", itemId: "i".repeat(65) }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04" }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "unknown", date: "2026-11-04", itemId: "i" }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026/11/04", itemId: "i" }));
  });
});

describe("selfCheckDue と frequentMuniCodes の中身（C-1）", () => {
  const geo = { lat: 35.1, lng: 135.2 };
  const db = () => alice();
  const put = (patch: Record<string, unknown>) => updateDoc(doc(db(), "farms/f1"), patch);

  it("selfCheckDue: 値が入れ子、数、巨大な文字、日付でない文字だと落ちる", async () => {
    await assertFails(put({ selfCheckDue: { "2026-11": geo } }));
    await assertFails(put({ selfCheckDue: { lat: "35.1" } }));
    await assertFails(put({ selfCheckDue: { "2026-11": "x".repeat(500000) } }));
    await assertFails(put({ selfCheckDue: { "2026-11": 20261120 } }));
    await assertFails(put({ selfCheckDue: { "2026-11": "来週" } }));
    await assertFails(put({ selfCheckDue: { "2026-11": null } }));
    await assertFails(put({ selfCheckDue: { "2026-11": ["2026-11-20"] } }));
    await assertFails(put({ selfCheckDue: { "2026-11": "2026-11-20", "2026-12": "2026-12-20x" } }));
  });

  it("selfCheckDue: 長いキーや月でないキーだと落ちる", async () => {
    await assertFails(put({ selfCheckDue: { ["k".repeat(1000)]: "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { lat: "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-1": "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-11-01": "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-11\n": "2026-11-20" } }));
  });

  it("selfCheckDue: コンマで 1 つに詰めた形と、13 月などの月は落ちる", async () => {
    await assertFails(put({ selfCheckDue: { "2026-11,2026-12": "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-11": "2026-11-20,2026-12-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-11,2026-12": "2026-11-20,2026-12-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-11,2026-12,2027-01": "2026-11-20", "2027-02": "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-13": "2026-11-20" } }));
    await assertFails(put({ selfCheckDue: { "2026-00": "2026-11-20" } }));
    await assertSucceeds(put({ selfCheckDue: { "2026-12": "2026-11-20", "2027-01": "2026-12-20" } }));
  });

  it("selfCheckDue: 空の {}、1 件、40 件ちょうどは通り、41 件は落ちる。作成時の {} も通る", async () => {
    const months = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, "2026-11-20"]));
    await assertSucceeds(put({ selfCheckDue: {} }));
    await assertSucceeds(put({ selfCheckDue: { "2026-11": "2026-12-05" } }));
    await assertSucceeds(put({ selfCheckDue: months(40) }));
    await assertFails(put({ selfCheckDue: months(41) }));
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { selfCheckDue: {} })));
  });

  it("selfCheckDue: 今季と前季の 16 件に絞った保存は、古い季が 40 件たまっていても通る（I-1）", async () => {
    const season = (y: number) => [`${y}-10`, `${y}-11`, `${y}-12`, `${y + 1}-01`, `${y + 1}-02`, `${y + 1}-03`, `${y + 1}-04`, `${y + 1}-05`];
    const all = [2021, 2022, 2023, 2024, 2025].flatMap(season);
    expect(all).toHaveLength(40);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "farms/f1"), { selfCheckDue: Object.fromEntries(all.map((m) => [m, "2026-01-06"])) });
    });
    // 6 季目を足すと 48 件で落ちる（絞らない保存）
    await assertFails(put({ selfCheckDue: Object.fromEntries([...all, ...season(2026)].map((m) => [m, "2026-01-06"])) }));
    // 絞った保存（前季 2025 と今季 2026）は通る
    await assertSucceeds(put({ selfCheckDue: Object.fromEntries([...season(2025), ...season(2026)].map((m) => [m, "2026-01-06"])) }));
  });

  it("frequentMuniCodes: 要素が入れ子、数、長い文字、5 桁でない文字だと落ちる", async () => {
    await assertFails(put({ frequentMuniCodes: [geo] }));
    await assertFails(put({ frequentMuniCodes: ["x".repeat(500000)] }));
    await assertFails(put({ frequentMuniCodes: ["abc"] }));
    await assertFails(put({ frequentMuniCodes: [1, 2, 3] }));
    await assertFails(put({ frequentMuniCodes: [13101] }));
    await assertFails(put({ frequentMuniCodes: ["13101", "1310"] }));
    await assertFails(put({ frequentMuniCodes: ["13101", null] }));
  });

  it("frequentMuniCodes: 20 件の正しい並びのどの位置を悪い値に替えても落ちる", async () => {
    const good = Array.from({ length: 20 }, (_, i) => String(13101 + i));
    await assertSucceeds(put({ frequentMuniCodes: good }));
    for (let i = 0; i < 20; i++) {
      for (const bad of ["bad", 13101, null, geo]) {
        await assertFails(put({ frequentMuniCodes: good.map((m, j) => (j === i ? bad : m)) }));
      }
    }
  });

  it("frequentMuniCodes: 空、1 件、20 件ちょうどは通り、21 件は落ちる。作成時の [] も通る", async () => {
    const munis = (n: number) => Array.from({ length: n }, (_, i) => String(13101 + i));
    await assertSucceeds(put({ frequentMuniCodes: [] }));
    await assertSucceeds(put({ frequentMuniCodes: ["13101"] }));
    await assertSucceeds(put({ frequentMuniCodes: munis(20) }));
    await assertFails(put({ frequentMuniCodes: munis(21) }));
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/carol"), farm("carol", { frequentMuniCodes: [] })));
  });
});

describe("入れ子の穴を塞いだことの変異の確認（I-2）", () => {
  const geo = { lat: 35.1, lng: 135.2 };
  const answers = { "17": "ok", "18": "ng", "19": null, "22": "ok", "23": "ok", "25": "ok", "27": "ok" };

  it("死亡数: 除外の note が map や list だと落ちる", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: geo } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: ["a"] } })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ exclusion: { kind: "other", note: 1 } })));
  });

  it("自己点検: 7 つのキーのどれに 'maybe' を入れても落ちる", async () => {
    const db = alice();
    for (const k of ["17", "18", "19", "22", "23", "25", "27"]) {
      await assertFails(
        setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: { ...answers, [k]: "maybe" } }),
      );
    }
    await assertSucceeds(setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers }));
  });

  it("消毒に month を、自己点検に itemId を入れた入れ子は落ちる", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04", itemId: "a", month: geo }));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04", itemId: "a", answers: {} }));
    await assertFails(
      setDoc(doc(db, "farms/f1/checks/s1"), { kind: "self_inspection", date: "2026-11-04", month: "2026-11", answers: {}, itemId: geo }),
    );
  });
});

describe("数の上限、空の名前、記録の id の長さ（M-1）", () => {
  it("羽数と死亡数に上限（1 億）がある", async () => {
    const db = alice();
    await assertSucceeds(setDoc(doc(db, "farms/f1/houses/h2"), house({ flockSize: 100_000_000 })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ flockSize: 100_000_001 })));
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ flockSize: 9007199254740991 })));
    await assertSucceeds(setDoc(doc(db, "farms/f1/deaths/x"), death({ deaths: 100_000_000, flockSizeAt: 100_000_000 })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ deaths: 100_000_001 })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ flockSizeAt: 100_000_001 })));
  });

  it("空の鶏舎の名前、空の itemId、空の houseId は落ちる", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f1/houses/h2"), house({ name: "" })));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04", itemId: "" }));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ houseId: "" })));
  });

  it("houseId は 100 字まで。100 字でも、死亡数の id（日付_houseId）が 128 字に収まって保存できる", async () => {
    const db = alice();
    const h100 = "h".repeat(100);
    await assertSucceeds(setDoc(doc(db, `farms/f1/deaths/2026-11-04_${h100}`), death({ date: "2026-11-04", houseId: h100 })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ houseId: "h".repeat(101) })));
  });

  it("記録の id が 128 字を超えると落ちる", async () => {
    const db = alice();
    const long = "a".repeat(129);
    const ok = "a".repeat(128);
    await assertFails(setDoc(doc(db, `farms/f1/houses/${long}`), house()));
    await assertFails(setDoc(doc(db, `farms/f1/deaths/${long}`), death()));
    await assertFails(setDoc(doc(db, `farms/f1/checks/${long}`), { kind: "disinfection", date: "2026-11-04", itemId: "i" }));
    await assertSucceeds(setDoc(doc(db, `farms/f1/houses/${ok}`), house()));
    await assertSucceeds(setDoc(doc(db, `farms/f1/deaths/${ok}`), death()));
    await assertSucceeds(setDoc(doc(db, `farms/f1/checks/${ok}`), { kind: "disinfection", date: "2026-11-04", itemId: "i" }));
  });

  it("date は 4 桁-2 桁-2 桁の形だけ（点検・死亡数）", async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ date: "2026-11-04T00:00" })));
    await assertFails(setDoc(doc(db, "farms/f1/deaths/x"), death({ date: "26-11-04" })));
    await assertFails(setDoc(doc(db, "farms/f1/checks/d1"), { kind: "disinfection", date: "2026-11-04 ", itemId: "i" }));
  });
});
