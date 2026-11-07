// 農場の「飼い方」（rearing: ケージ飼い "cage"・平飼い "floor"・未設定 null）。2026-11-07 作者の決定 B。
// 鶏舎の造り（housing）とは別の項目。項目がない前からの農場も、そのまま更新できる（未登録のまま）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-hpai";
let env: RulesTestEnvironment;

// rearing の項目がない（この項目ができる前に登録した）農場の形
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
  });
});

const alice = () => env.authenticatedContext("alice", { member: true }).firestore();
const bob = () => env.authenticatedContext("bob", { member: true }).firestore();
const carol = () => env.authenticatedContext("carol", { member: true }).firestore();

describe("農場の飼い方（rearing）", () => {
  it("会員は cage・floor・null を保存でき、消す（項目なしに戻す）こともできる", async () => {
    const db = alice();
    for (const v of ["cage", "floor", null]) await assertSucceeds(updateDoc(doc(db, "farms/f1"), { rearing: v }));
    await assertSucceeds(updateDoc(doc(db, "farms/f1"), { rearing: deleteField() }));
  });

  it("画面と同じ保存（名前・飼育目的・鶏舎の造り・飼い方を一度に）が通る", async () => {
    await assertSucceeds(updateDoc(doc(alice(), "farms/f1"), { name: "A 農場", production: "layer", housing: "open", rearing: "floor" }));
  });

  it("列挙の外（鶏舎の造りの値、空、大文字、別の語）と型の違いは落ちる", async () => {
    const db = alice();
    for (const v of ["open", "windowless", "free_range", "", "CAGE", "平飼い", "barn", 1, true, ["cage"], { v: "cage" }]) {
      await assertFails(updateDoc(doc(db, "farms/f1"), { rearing: v }));
    }
  });

  it("項目がない前からの農場は、飼い方に触れずに更新できる（未登録のまま）", async () => {
    await assertSucceeds(updateDoc(doc(alice(), "farms/f1"), { name: "A 農場", production: "broiler" }));
  });

  it("新しく作る農場にも付けられ、列挙の外は作れない", async () => {
    await assertSucceeds(setDoc(doc(carol(), "farms/carol"), farm("carol", { rearing: "cage" })));
    await env.clearFirestore();
    await assertFails(setDoc(doc(carol(), "farms/carol"), farm("carol", { rearing: "open" })));
  });

  it("ほかの農場の飼い方は書けない", async () => {
    await assertFails(updateDoc(doc(bob(), "farms/f1"), { rearing: "floor" }));
  });
});
