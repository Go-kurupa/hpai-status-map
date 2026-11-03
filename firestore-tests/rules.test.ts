import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

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
    await setDoc(doc(db, "invites/_membership/uids/alice"), { farmId: "f1" }); // 1 会員 1 農場の鍵（redeemInvite が書く）
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
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/f3"), farm("carol")));
    const noClaim = env.authenticatedContext("dave").firestore();
    await assertFails(setDoc(doc(noClaim, "farms/f4"), farm("dave")));
    await assertFails(setDoc(doc(anon(), "farms/f5"), farm("x")));
    await assertFails(setDoc(doc(operator(), "farms/f6"), farm("op")));
  });

  it("作成で memberUids に他人、unsubscribedUids が空でないと落ちる", async () => {
    const db = memberOnly();
    await assertFails(setDoc(doc(db, "farms/f3"), farm("carol", { memberUids: ["carol", "bob"] })));
    await assertFails(setDoc(doc(db, "farms/f3"), farm("carol", { memberUids: ["bob"] })));
    await assertFails(setDoc(doc(db, "farms/f3"), farm("carol", { memberUids: [] })));
    await assertFails(setDoc(doc(db, "farms/f3"), farm("carol", { unsubscribedUids: ["carol"] })));
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
    await assertFails(setDoc(doc(memberOnly(), "farms/f3"), farm("carol", { extra: 1 })));
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
      await assertFails(setDoc(doc(memberOnly(), "farms/f3"), farm("carol", { [key]: key === "address" ? "どこか" : 35.1 })));
    }
  });

  it("meshCode は 8 桁の数字だけ", async () => {
    const db = alice();
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { meshCode: "53394611" }));
    for (const bad of ["5339461", "533946111", "abcdefgh", "5339461a", "", "5339 461"]) {
      await assertFails(updateDoc(doc(db, "farms/f1"), { meshCode: bad }));
      await assertFails(setDoc(doc(memberOnly(), "farms/f3"), farm("carol", { meshCode: bad })));
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
    await assertSucceeds(setDoc(doc(memberOnly(), "farms/f3"), farm("carol", { production: null, housing: null })));
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
