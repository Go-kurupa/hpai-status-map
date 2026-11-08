// M-04: 農場の全データの削除。模擬環境（demo-hpai）で、消えるものと残るものを確かめる。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/admin";
import { getAuth } from "firebase-admin/auth";
import { JUDGE_FARM_ID, JUDGE_FARM_NAME, JUDGE_UID } from "@hpai/shared/judge";
import { handleDeleteFarmData } from "../../src/farm/deleteFarmData";
import { ensureJudgeFarm } from "../../src/farm/judgeFarm";
import { farmFixture, houseFixture } from "../../../shared/test/helpers/mFixtures";

const PROJECT = "demo-hpai";

beforeAll(() => {
  // 本番に書き込む事故を防ぐ。模擬環境の外では動かさない。
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("模擬環境の外です。npm run test:emul で実行してください");
  }
});
beforeEach(async () => {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST!;
  await fetch(`http://${fsHost}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}

/** 農場 A（会員 uA、uB）と農場 B（会員 uC）、それぞれにサブコレクション、知らせの記録、招待を置く */
async function seed() {
  for (const [id, uids, name] of [
    ["farmA", ["uA", "uB"], "見本農場"],
    ["farmB", ["uC"], "ほかの農場"],
  ] as const) {
    const ref = db.collection("farms").doc(id);
    await ref.set(farmFixture(uids[0], { name, memberUids: [...uids] }));
    await ref.collection("houses").doc("h1").set(houseFixture());
    await ref.collection("deaths").doc("2026-11-05_h1").set({ date: "2026-11-05", houseId: "h1", deaths: 1, flockSizeAt: 100, exclusion: null });
    await ref.collection("checks").doc("self_2026-11").set({ kind: "self_inspection", date: "2026-11-05", month: "2026-11", answers: {} });
    await db.collection("sentNotices").doc(`${id}__u__s1__confirmed`).set({ farmId: id, uid: uids[0], subjectId: "s1", event: "confirmed", state: "sent" });
    await db.collection("invites").doc(`inv-${id}`).set({ kind: "farm", farmId: id, maxUses: 1, usedBy: [], expiresAt: null });
  }
  // 農場に結びつかない招待、公開の事例、下書き
  await db.collection("invites").doc("inv-signup").set({ kind: "signup", farmId: null, maxUses: 5, usedBy: [], expiresAt: null });
  await db.collection("cases").doc("c1").set({ muniCode: "33203" });
  await db.collection("caseDrafts").doc("c1").set({ caseId: "c1", workerMessage: "x" });
}

const exists = async (path: string) => (await db.doc(path).get()).exists;

describe("handleDeleteFarmData", () => {
  it("農場の名前が合えば、農場とサブコレクション、その農場の sentNotices と招待を消す。他の農場、公開の事例、caseDrafts は残る", async () => {
    await seed();
    const res = await handleDeleteFarmData(db, "uA", { farmId: "farmA", confirmName: "見本農場" });
    expect(res).toEqual({ deleted: true });

    expect(await exists("farms/farmA")).toBe(false);
    expect(await exists("farms/farmA/houses/h1")).toBe(false);
    expect(await exists("farms/farmA/deaths/2026-11-05_h1")).toBe(false);
    expect(await exists("farms/farmA/checks/self_2026-11")).toBe(false);
    expect(await exists("sentNotices/farmA__u__s1__confirmed")).toBe(false);
    expect(await exists("invites/inv-farmA")).toBe(false);

    expect(await exists("farms/farmB")).toBe(true);
    expect(await exists("farms/farmB/houses/h1")).toBe(true);
    expect(await exists("farms/farmB/deaths/2026-11-05_h1")).toBe(true);
    expect(await exists("sentNotices/farmB__u__s1__confirmed")).toBe(true);
    expect(await exists("invites/inv-farmB")).toBe(true);
    expect(await exists("invites/inv-signup")).toBe(true);
    expect(await exists("cases/c1")).toBe(true);
    expect(await exists("caseDrafts/c1")).toBe(true);
  });

  it("同じ農場の会員なら、だれでも消せる（説明のとおり）", async () => {
    await seed();
    await handleDeleteFarmData(db, "uB", { farmId: "farmA", confirmName: "見本農場" });
    expect(await exists("farms/farmA")).toBe(false);
  });

  it("会員でなければ permission-denied で、何も消えない", async () => {
    await seed();
    expect(await codeOf(handleDeleteFarmData(db, "uC", { farmId: "farmA", confirmName: "見本農場" }))).toBe("permission-denied");
    expect(await codeOf(handleDeleteFarmData(db, "stranger", { farmId: "farmA", confirmName: "見本農場" }))).toBe("permission-denied");
    expect(await exists("farms/farmA")).toBe(true);
    expect(await exists("farms/farmA/houses/h1")).toBe(true);
    expect(await exists("sentNotices/farmA__u__s1__confirmed")).toBe(true);
    expect(await exists("invites/inv-farmA")).toBe(true);
  });

  it("名前が違えば failed-precondition で何も消えない（空、前後の空白違い、一部だけも同じ）", async () => {
    await seed();
    for (const confirmName of ["", "見本", "ほかの農場", "見本農場 "]) {
      expect(await codeOf(handleDeleteFarmData(db, "uA", { farmId: "farmA", confirmName }))).toBe("failed-precondition");
    }
    expect(await exists("farms/farmA")).toBe(true);
    expect(await exists("farms/farmA/deaths/2026-11-05_h1")).toBe(true);
    expect(await exists("sentNotices/farmA__u__s1__confirmed")).toBe(true);
  });

  it("農場の名前が空のままの農場は、空の確認では消せない", async () => {
    await db.collection("farms").doc("farmE").set(farmFixture("uA", { name: "" }));
    expect(await codeOf(handleDeleteFarmData(db, "uA", { farmId: "farmE", confirmName: "" }))).toBe("failed-precondition");
    expect(await exists("farms/farmE")).toBe(true);
  });

  it("ログインしていなければ unauthenticated、指定が不正なら invalid-argument、農場がなければ not-found", async () => {
    await seed();
    expect(await codeOf(handleDeleteFarmData(db, undefined, { farmId: "farmA", confirmName: "見本農場" }))).toBe("unauthenticated");
    for (const bad of [null, {}, { farmId: 1, confirmName: "x" }, { farmId: "", confirmName: "x" }, { farmId: "a/b", confirmName: "x" }, { farmId: "farmA", confirmName: 5 }]) {
      expect(await codeOf(handleDeleteFarmData(db, "uA", bad))).toBe("invalid-argument");
    }
    expect(await codeOf(handleDeleteFarmData(db, "uA", { farmId: "nope", confirmName: "x" }))).toBe("not-found");
    expect(await exists("farms/farmA")).toBe(true);
  });

  it("審査員用の見本の農場は、審査員の会員が名前を合わせても消せない（failed-precondition）", async () => {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Auth の模擬環境が要ります");
    await ensureJudgeFarm({ db, auth: getAuth(), now: () => new Date("2026-11-08T10:00:00+09:00") });
    const err = await handleDeleteFarmData(db, JUDGE_UID, { farmId: JUDGE_FARM_ID, confirmName: JUDGE_FARM_NAME }).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("failed-precondition");
    expect((err as Error).message).toBe("審査員用の見本の農場は消せません");
    expect(await exists(`farms/${JUDGE_FARM_ID}`)).toBe(true);
    expect(await exists(`farms/${JUDGE_FARM_ID}/houses/house-1`)).toBe(true);
  });
});
