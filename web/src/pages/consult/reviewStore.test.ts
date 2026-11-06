// 足した項目の口。firebase は偽物に差し替え、規則が許す形（addedAt と addedBy だけ）で書くことを確かめる。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  getDocs: vi.fn(async () => ({ docs: [{ id: "maff-M01" }, { id: "aphis-A02" }] })),
  doc: vi.fn((...a: unknown[]) => ({ path: a.slice(1).join("/") })),
  collection: vi.fn((...a: unknown[]) => ({ path: a.slice(1).join("/") })),
  serverTimestamp: vi.fn(() => "SERVER_TS"),
}));
vi.mock("firebase/firestore", () => fsMock);
const auth = vi.hoisted(() => ({ currentUser: { uid: "u1" } as { uid: string } | null, authStateReady: async () => {} }));
vi.mock("../../firebase", () => ({ getFirebase: async () => ({ auth, db: { name: "db" } }) }));

import { createReviewStore } from "./reviewStore";

beforeEach(() => {
  for (const f of Object.values(fsMock)) f.mockClear();
  auth.currentUser = { uid: "u1" };
});

describe("createReviewStore", () => {
  it("addReview は farms/{農場}/reviews/{カード} に addedAt（サーバーの時刻）と addedBy だけを書く", async () => {
    await createReviewStore(async () => "farm1").addReview("maff-M01");
    expect(fsMock.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fsMock.setDoc.mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe("farms/farm1/reviews/maff-M01");
    expect(data).toEqual({ addedAt: "SERVER_TS", addedBy: "u1" });
  });

  it("農場がない、ログインしていないときは、書かずに失敗する", async () => {
    await expect(createReviewStore(async () => null).addReview("x")).rejects.toThrow();
    auth.currentUser = null;
    await expect(createReviewStore(async () => "farm1").addReview("x")).rejects.toThrow();
    expect(fsMock.setDoc).not.toHaveBeenCalled();
  });

  it("農場がないときの失敗は code が no-farm で、農場を登録する案内の文になる", async () => {
    for (const run of [
      () => createReviewStore(async () => null).addReview("x"),
      () => createReviewStore(async () => null).removeReview("x"),
    ]) {
      await expect(run()).rejects.toMatchObject({
        code: "no-farm",
        message: "対策項目に足すには、先に『農場と通知の設定』で農場を登録してください。",
      });
    }
  });

  it("listReviews はカードの id の一覧を返す。農場がなければ空", async () => {
    expect(await createReviewStore(async () => "farm1").listReviews()).toEqual(["maff-M01", "aphis-A02"]);
    expect((fsMock.collection.mock.calls[0] as unknown[]).slice(1).join("/")).toBe("farms/farm1/reviews");
    fsMock.getDocs.mockClear();
    expect(await createReviewStore(async () => null).listReviews()).toEqual([]);
    expect(fsMock.getDocs).not.toHaveBeenCalled();
  });

  it("removeReview はその項目を消す", async () => {
    await createReviewStore(async () => "farm1").removeReview("maff-M01");
    expect((fsMock.deleteDoc.mock.calls[0] as unknown as [{ path: string }])[0].path).toBe("farms/farm1/reviews/maff-M01");
  });

  it("読み書きの失敗は丸めずに投げる（「ない」と読み違えない）", async () => {
    fsMock.getDocs.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(createReviewStore(async () => "farm1").listReviews()).rejects.toThrow("permission-denied");
  });
});
