import type { WatchStatus, WildBird } from "@hpai/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  onSnapshot: vi.fn(),
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  query: vi.fn((c: unknown, ...constraints: unknown[]) => ({ c, constraints })),
}));

vi.mock("../firebase", () => ({ getFirebase: m.getFirebase }));
vi.mock("firebase/firestore", () => ({
  collection: m.collection,
  where: m.where,
  query: m.query,
  onSnapshot: m.onSnapshot,
}));

import { createLiveDataSource } from "./live";

interface Listener {
  query: { c: { collection: string }; constraints: unknown[] };
  options: { includeMetadataChanges?: boolean };
  next: (snap: unknown) => void;
  error: (e: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

/** 最後の onSnapshot の引数を取り出す */
function lastListener(): Listener {
  const call = m.onSnapshot.mock.calls.at(-1)!;
  const [query, options, next, error] = call;
  return { query, options, next, error, unsub: m.onSnapshot.mock.results.at(-1)!.value };
}
function snap(rows: Array<Record<string, unknown> & { id: string }>, fromCache: boolean) {
  return { metadata: { fromCache }, docs: rows.map((r) => ({ id: r.id, data: () => r })) };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  m.getFirebase.mockReset().mockResolvedValue({ db: { fake: "db" } });
  m.onSnapshot.mockReset().mockImplementation(() => vi.fn());
  m.collection.mockClear();
  m.where.mockClear();
  m.query.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const aCase = (id: string): Record<string, unknown> & { id: string } => ({ id, season: 2025, prefCode: "33" });

describe("createLiveDataSource", () => {
  it("作っただけでは Firebase を読まない", () => {
    const ds = createLiveDataSource();
    expect(ds.mode).toBe("live");
    expect(m.getFirebase).not.toHaveBeenCalled();
  });

  it("now() は実際の時計", () => {
    const before = Date.now();
    const t = createLiveDataSource().now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});

describe("subscribeCases", () => {
  it("cases を where season で絞る", async () => {
    createLiveDataSource().subscribeCases(2025, () => {});
    await tick();
    const l = lastListener();
    expect(l.query.c).toEqual({ collection: "cases" });
    expect(l.query.constraints).toEqual([{ field: "season", op: "==", value: 2025 }]);
  });

  it("includeMetadataChanges:true で受ける", async () => {
    createLiveDataSource().subscribeCases(2025, () => {});
    await tick();
    expect(lastListener().options).toEqual({ includeMetadataChanges: true });
  });

  it("サーバーの結果（fromCache:false）は空でも行ありでも cb を呼ぶ", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeCases(2025, cb);
    await tick();
    const l = lastListener();
    l.next(snap([aCase("h2025-1")], false));
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ id: "h2025-1", season: 2025 })]);
    l.next(snap([], false));
    expect(cb).toHaveBeenLastCalledWith([]);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("端末の控え（fromCache:true）は空でも行ありでも cb を呼ばない", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeCases(2025, cb);
    await tick();
    const l = lastListener();
    l.next(snap([], true));
    l.next(snap([aCase("h2025-1")], true));
    expect(cb).not.toHaveBeenCalled();
  });

  it("error では cb を呼ばない（『何もない』に見せない）", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeCases(2025, cb);
    await tick();
    lastListener().error(new Error("permission-denied"));
    expect(cb).not.toHaveBeenCalled();
  });

  it("Firebase の初期化に失敗しても cb を呼ばない", async () => {
    m.getFirebase.mockRejectedValue(new Error("init failed"));
    const cb = vi.fn();
    createLiveDataSource().subscribeCases(2025, cb);
    await tick();
    expect(cb).not.toHaveBeenCalled();
    expect(m.onSnapshot).not.toHaveBeenCalled();
  });

  it("初期化の前に解除すると、購読が残らない", async () => {
    let resolve!: (v: unknown) => void;
    m.getFirebase.mockReturnValue(new Promise((r) => (resolve = r)));
    const off = createLiveDataSource().subscribeCases(2025, () => {});
    off();
    resolve({ db: {} });
    await tick();
    expect(m.onSnapshot).not.toHaveBeenCalled();
  });

  it("購読の後の解除は Firestore の購読を 1 度だけ外す", async () => {
    const off = createLiveDataSource().subscribeCases(2025, () => {});
    await tick();
    const { unsub } = lastListener();
    off();
    off();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("解除の後に届いた結果は cb を呼ばない", async () => {
    const cb = vi.fn();
    const off = createLiveDataSource().subscribeCases(2025, cb);
    await tick();
    const l = lastListener();
    off();
    l.next(snap([aCase("x")], false));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("subscribeWildBirds", () => {
  it("wildBirds を where season で絞り、cases と同じく控えと error では cb を呼ばない", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeWildBirds(2025, cb as (b: WildBird[]) => void);
    await tick();
    const l = lastListener();
    expect(l.query.c).toEqual({ collection: "wildBirds" });
    expect(l.query.constraints).toEqual([{ field: "season", op: "==", value: 2025 }]);
    l.next(snap([], true));
    l.error(new Error("x"));
    expect(cb).not.toHaveBeenCalled();
    l.next(snap([{ id: "w1" }], false));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeWatchStatus", () => {
  it("error では cb([])（読めていない、と画面が分かる）", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeWatchStatus(cb as (a: WatchStatus[]) => void);
    await tick();
    expect(lastListener().query).toEqual({ collection: "watchStatus" }); // 絞り込みなし
    lastListener().error(new Error("x"));
    expect(cb).toHaveBeenLastCalledWith([]);
  });

  it("fromCache:true は cb([])、fromCache:false は行を渡す", async () => {
    const cb = vi.fn();
    createLiveDataSource().subscribeWatchStatus(cb as (a: WatchStatus[]) => void);
    await tick();
    const l = lastListener();
    l.next(snap([{ id: "33", prefCode: "33", ok: true }], true));
    expect(cb).toHaveBeenLastCalledWith([]);
    l.next(snap([{ id: "33", prefCode: "33", ok: true }], false));
    expect(cb).toHaveBeenLastCalledWith([expect.objectContaining({ prefCode: "33", ok: true })]);
  });

  it("Firebase の初期化に失敗したら cb([])", async () => {
    m.getFirebase.mockRejectedValue(new Error("init failed"));
    const cb = vi.fn();
    createLiveDataSource().subscribeWatchStatus(cb as (a: WatchStatus[]) => void);
    await tick();
    expect(cb).toHaveBeenCalledWith([]);
  });

  it("初期化の前に解除すると購読が残らず、cb も呼ばない", async () => {
    let resolve!: (v: unknown) => void;
    m.getFirebase.mockReturnValue(new Promise((r) => (resolve = r)));
    const cb = vi.fn();
    const off = createLiveDataSource().subscribeWatchStatus(cb as (a: WatchStatus[]) => void);
    off();
    resolve({ db: {} });
    await tick();
    expect(m.onSnapshot).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("loadHistory", () => {
  it("/history/cases.json を読む", async () => {
    const rows = [{ season: 2024, no: 1 }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createLiveDataSource().loadHistory()).resolves.toEqual(rows);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/history\/cases\.json$/);
  });

  it("読めなければ失敗にする（空の一覧に見せない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(createLiveDataSource().loadHistory()).rejects.toThrow();
  });
});
