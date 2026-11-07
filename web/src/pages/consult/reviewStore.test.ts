// 足した項目の口。firebase は偽物に差し替え、規則が許す形（足すときは addedAt と addedBy だけ、実施の記録は
// status か note のどちらかと updatedAt・updatedBy）で書くことを確かめる。偽物は書いた文書を覚え、読み直せる。
import { beforeEach, describe, expect, it, vi } from "vitest";

const SERVER_TS = vi.hoisted(() => ({ sentinel: "SERVER_TS" }));
const mem = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const fakeTimestamp = (iso: string) => ({ toDate: () => new Date(iso) });
const fsMock = vi.hoisted(() => {
  const stamp = (data: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === SERVER_TS ? { toDate: () => new Date("2026-11-08T06:30:00+09:00") } : v]),
    );
  return {
    setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      mem.set(ref.path, stamp(data));
    }),
    updateDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      const prev = mem.get(ref.path);
      if (!prev) throw Object.assign(new Error("missing"), { code: "permission-denied" });
      mem.set(ref.path, { ...prev, ...stamp(data) });
    }),
    deleteDoc: vi.fn(async (ref: { path: string }) => {
      mem.delete(ref.path);
    }),
    getDocs: vi.fn(async (col: { path: string }) => ({
      docs: [...mem]
        .filter(([p]) => p.startsWith(`${col.path}/`))
        .map(([p, d]) => ({ id: p.slice(col.path.length + 1), data: () => d })),
    })),
    doc: vi.fn((...a: unknown[]) => ({ path: a.slice(1).join("/") })),
    collection: vi.fn((...a: unknown[]) => ({ path: a.slice(1).join("/") })),
    serverTimestamp: vi.fn(() => SERVER_TS),
  };
});
vi.mock("firebase/firestore", () => fsMock);
const auth = vi.hoisted(() => ({ currentUser: { uid: "u1" } as { uid: string } | null, authStateReady: async () => {} }));
vi.mock("../../firebase", () => ({ getFirebase: async () => ({ auth, db: { name: "db" } }) }));

import { createReviewStore } from "./reviewStore";

const store = () => createReviewStore(async () => "farm1");

beforeEach(() => {
  for (const f of Object.values(fsMock)) f.mockClear();
  mem.clear();
  mem.set("farms/farm1/reviews/maff-M01", { addedAt: fakeTimestamp("2026-11-07T09:00:00+09:00"), addedBy: "u1" });
  mem.set("farms/farm1/reviews/aphis-A02", { addedAt: fakeTimestamp("2026-11-07T09:00:00+09:00"), addedBy: "u2" });
  auth.currentUser = { uid: "u1" };
});

describe("createReviewStore", () => {
  it("addReview は farms/{農場}/reviews/{カード} に addedAt（サーバーの時刻）と addedBy だけを書く（状態は付けない）", async () => {
    await store().addReview("maff-M07");
    expect(fsMock.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fsMock.setDoc.mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe("farms/farm1/reviews/maff-M07");
    expect(data).toEqual({ addedAt: SERVER_TS, addedBy: "u1" });
  });

  it("農場がない、ログインしていないときは、書かずに失敗する", async () => {
    await expect(createReviewStore(async () => null).addReview("x")).rejects.toThrow();
    auth.currentUser = null;
    await expect(store().addReview("x")).rejects.toThrow();
    expect(fsMock.setDoc).not.toHaveBeenCalled();
  });

  it("農場がないときの失敗は code が no-farm で、農場を登録する案内の文になる", async () => {
    for (const run of [
      () => createReviewStore(async () => null).addReview("x"),
      () => createReviewStore(async () => null).removeReview("x"),
      () => createReviewStore(async () => null).markReview("x", { status: "done" }),
    ]) {
      await expect(run()).rejects.toMatchObject({
        code: "no-farm",
        message: "対策項目に追加するには、先に『農場と通知の設定』で農場を登録してください。",
      });
    }
  });

  it("listReviews はカードの id の一覧を返す（相談の画面の足し済みの判定）。農場がなければ空", async () => {
    expect(await store().listReviews()).toEqual(["maff-M01", "aphis-A02"]);
    expect((fsMock.collection.mock.calls[0] as unknown[]).slice(1).join("/")).toBe("farms/farm1/reviews");
    fsMock.getDocs.mockClear();
    expect(await createReviewStore(async () => null).listReviews()).toEqual([]);
    expect(fsMock.getDocs).not.toHaveBeenCalled();
  });

  it("removeReview はその項目を消す", async () => {
    await store().removeReview("maff-M01");
    expect((fsMock.deleteDoc.mock.calls[0] as unknown as [{ path: string }])[0].path).toBe("farms/farm1/reviews/maff-M01");
  });

  it("読み書きの失敗は丸めずに投げる（「ない」と読み違えない）", async () => {
    fsMock.getDocs.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(store().listReviews()).rejects.toThrow("permission-denied");
    fsMock.getDocs.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(store().listReviewItems()).rejects.toThrow("permission-denied");
  });
});

describe("実施の記録（markReview と listReviewItems）", () => {
  it("前に足した文書（状態なし）は、状態 null・メモ空・更新なしとして読む（消さない、「やった」にしない）", async () => {
    expect(await store().listReviewItems()).toEqual([
      { id: "maff-M01", status: null, note: "", updatedAt: null, mine: null },
      { id: "aphis-A02", status: null, note: "", updatedAt: null, mine: null },
    ]);
  });

  it("状態を押すと、status と updatedAt（サーバーの時刻）と updatedBy だけを updateDoc で書く（メモは送らない）", async () => {
    await store().markReview("maff-M01", { status: "later" });
    expect(fsMock.setDoc).not.toHaveBeenCalled();
    const [ref, data] = fsMock.updateDoc.mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe("farms/farm1/reviews/maff-M01");
    expect(data).toEqual({ status: "later", updatedAt: SERVER_TS, updatedBy: "u1" });
  });

  it("メモの保存は note と updatedAt と updatedBy だけを書く（状態は送らない）", async () => {
    await store().markReview("maff-M01", { note: "資材を用意してから再確認" });
    const [, data] = fsMock.updateDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(data).toEqual({ note: "資材を用意してから再確認", updatedAt: SERVER_TS, updatedBy: "u1" });
  });

  it("保存して読み直すと、状態とメモと更新の時刻が残り、自分の更新と分かる。足した人と日時は変わらない", async () => {
    await store().markReview("maff-M01", { status: "later" });
    await store().markReview("maff-M01", { note: "資材を用意してから再確認" });
    const items = await store().listReviewItems();
    expect(items[0]).toEqual({
      id: "maff-M01",
      status: "later",
      note: "資材を用意してから再確認",
      updatedAt: new Date("2026-11-08T06:30:00+09:00"),
      mine: true,
    });
    expect(mem.get("farms/farm1/reviews/maff-M01")?.["addedBy"]).toBe("u1");
  });

  it("戻す（pending）と状態は「まだ」になり、メモは残る", async () => {
    await store().markReview("maff-M01", { status: "done" });
    await store().markReview("maff-M01", { note: "点検した" });
    await store().markReview("maff-M01", { status: "pending" });
    const [first] = await store().listReviewItems();
    expect(first).toMatchObject({ status: "pending", note: "点検した" });
  });

  it("同じ農場の別の会員が更新したものは mine: false（uid は返さない）", async () => {
    auth.currentUser = { uid: "u2" };
    await store().markReview("aphis-A02", { status: "done" });
    auth.currentUser = { uid: "u1" };
    const items = await store().listReviewItems();
    expect(items[1]).toEqual({ id: "aphis-A02", status: "done", note: "", updatedAt: new Date("2026-11-08T06:30:00+09:00"), mine: false });
    expect(JSON.stringify(items)).not.toContain("u2");
  });

  it("知らない状態の値は null（「まだ」）として読み、「やった」と読まない", async () => {
    mem.set("farms/farm1/reviews/maff-M01", { addedAt: null, addedBy: "u1", status: "finished", note: 3 });
    expect((await store().listReviewItems())[0]).toMatchObject({ status: null, note: "" });
  });

  it("40 を超えるメモ、改行のあるメモ、知らない状態は書かずに失敗する", async () => {
    for (const change of [{ note: "あ".repeat(41) }, { note: "資材\n再確認" }, { status: "finished" }] as const) {
      // @ts-expect-error 知らない状態も試す
      await expect(store().markReview("maff-M01", change)).rejects.toThrow();
    }
    expect(fsMock.updateDoc).not.toHaveBeenCalled();
  });

  it("ログインしていないと書かない。外された文書への更新は失敗のまま投げる（作り直さない）", async () => {
    auth.currentUser = null;
    await expect(store().markReview("maff-M01", { status: "done" })).rejects.toThrow();
    expect(fsMock.updateDoc).not.toHaveBeenCalled();
    auth.currentUser = { uid: "u1" };
    await expect(store().markReview("gone-X99", { status: "done" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(mem.has("farms/farm1/reviews/gone-X99")).toBe(false);
    expect(fsMock.setDoc).not.toHaveBeenCalled();
  });
});
