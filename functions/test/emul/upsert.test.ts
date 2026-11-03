import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Case } from "@hpai/shared/types";
import { makeReviewingCase } from "@hpai/shared/cases";
import { db } from "../../src/admin";
import { deleteReviewingCase, upsertCase } from "../../src/read/upsert";

const PROJECT = "demo-hpai";

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const NOW = new Date("2025-12-22T03:00:00Z");

function real(o: Partial<Case> = {}): Case {
  return {
    id: "33203-2025-12-20-1",
    season: 2025,
    nationalNo: 8,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: 12000,
    stages: { confirmed: { date: "2025-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.test/a"],
    updatedAt: "2025-12-22T12:00:00+09:00",
    ...o,
  };
}
const reviewing = () => makeReviewingCase({ documentId: "d1", season: 2025, prefCode: "33", sourceUrl: "https://example.test/a" }, NOW);

describe("upsertCase", () => {
  it("事例を cases/{id} に書き、同じ id は置き換える", async () => {
    await upsertCase(real());
    expect((await db.doc("cases/33203-2025-12-20-1").get()).data()).toEqual(real());
    await upsertCase(real({ headCount: 15000 }));
    expect((await db.doc("cases/33203-2025-12-20-1").get()).data()?.headCount).toBe(15000);
    expect((await db.collection("cases").get()).size).toBe(1);
  });

  it("確認中の事例（県名とリンクだけ）は書ける", async () => {
    await upsertCase(reviewing());
    expect((await db.doc("cases/rev-d1").get()).data()).toEqual(reviewing());
  });

  it("reviewing で muniCode、muniName、headCount、nationalNo のどれかが非 null なら reject。何も書かない", async () => {
    const bad: Array<Partial<Case>> = [{ muniCode: "33203" }, { muniName: "津山市" }, { headCount: 1 }, { nationalNo: 8 }];
    for (const o of bad) {
      await expect(upsertCase({ ...reviewing(), ...o })).rejects.toThrow();
    }
    expect((await db.collection("cases").get()).size).toBe(0);
  });

  it("reviewing で stages が空でなければ reject", async () => {
    await expect(upsertCase({ ...reviewing(), stages: { suspected: { date: "2025-12-19", time: null } } })).rejects.toThrow();
    expect((await db.collection("cases").get()).size).toBe(0);
  });

  it("reviewing で他の読み取りの値（鳥の種類、半径、見込み、否定）が入っていても reject", async () => {
    const bad: Array<Partial<Case>> = [
      { birdUse: "採卵鶏" },
      { housing: "開放" },
      { prefNo: 1 },
      { radiiKm: [3] },
      { prefEstimates: { shipment: "2026-01-05", movement: null, surveillance: null } },
      { negation: "candidate" },
    ];
    for (const o of bad) {
      await expect(upsertCase({ ...reviewing(), ...o })).rejects.toThrow();
    }
  });

  it("reviewing の id が rev- で始まらなければ reject。確認中でないのに市町村がなければ reject", async () => {
    await expect(upsertCase({ ...reviewing(), id: "33203-2025-12-20-1" })).rejects.toThrow();
    await expect(upsertCase(real({ muniCode: null }))).rejects.toThrow();
    await expect(upsertCase(real({ muniName: null }))).rejects.toThrow();
    await expect(upsertCase(real({ id: "rev-d1" }))).rejects.toThrow();
    expect((await db.collection("cases").get()).size).toBe(0);
  });

  it("id が空、または / を含めば reject", async () => {
    await expect(upsertCase(real({ id: "" }))).rejects.toThrow();
    await expect(upsertCase(real({ id: "a/b" }))).rejects.toThrow();
  });
});

describe("deleteReviewingCase", () => {
  it("rev-{documentId} だけを消す。本物の事例は消さない", async () => {
    await upsertCase(reviewing());
    await upsertCase(real());
    await deleteReviewingCase("d1");
    expect((await db.doc("cases/rev-d1").get()).exists).toBe(false);
    expect((await db.doc("cases/33203-2025-12-20-1").get()).exists).toBe(true);
  });

  it("無い確認中を消してもエラーにしない（二度目の起動）", async () => {
    await expect(deleteReviewingCase("none")).resolves.toBeUndefined();
  });

  it("documentId が空、または / を含めば reject", async () => {
    await expect(deleteReviewingCase("")).rejects.toThrow();
    await expect(deleteReviewingCase("a/b")).rejects.toThrow();
  });
});
