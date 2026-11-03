import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Farm } from "@hpai/shared/types";
import { DEFAULT_NOTIFY_FIXTURE, farmFixture, houseFixture } from "../shared/test/helpers/mFixtures";
import { createFirestoreRecordStore, createFirestoreRecordStoreWith } from "../web/src/pages/auth/firestoreRecordStore";

// 画面の記録の口（契約 3.10）を、本物のルールの上で確かめる。web/src/firebase.ts は Vite の環境を読むので、差し替える
const firebaseMock = vi.hoisted(() => ({
  getFirebase: vi.fn(),
}));
vi.mock("../web/src/firebase", () => ({ getFirebase: firebaseMock.getFirebase }));

const PROJECT_ID = "demo-hpai";
const NOW = new Date("2026-11-06T10:30:00+09:00");
const NOW_ISO = "2026-11-06T10:30:00+09:00";

let env: RulesTestEnvironment;

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
  firebaseMock.getFirebase.mockReset();
  await env.clearFirestore();
});

const asMember = (uid: string) => env.authenticatedContext(uid, { member: true }).firestore();
const asPlain = (uid: string) => env.authenticatedContext(uid).firestore();
const storeOf = (db: ReturnType<typeof asMember>, uid: string) => createFirestoreRecordStoreWith(db, uid, { now: () => NOW });

async function seed(fn: (db: Firestore) => Promise<unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.firestore() as unknown as Firestore);
  });
}
async function rawData(path: string): Promise<Record<string, unknown> | undefined> {
  let out: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), path))).data();
  });
  return out;
}

const POINT = { meshCode: "53394611", muniCode: "13101", prefCode: "13" };

describe("引数なしの生成", () => {
  it("作っただけでは Firebase を読まない", () => {
    createFirestoreRecordStore();
    expect(firebaseMock.getFirebase).not.toHaveBeenCalled();
  });

  it("未ログインの getFarm は null。getCaseDraft は Firestore を呼ばずに null", async () => {
    // db は空の偽物。Firestore を 1 度でも呼べば例外になる
    firebaseMock.getFirebase.mockResolvedValue({ db: {}, auth: { authStateReady: async () => {}, currentUser: null } });
    const store = createFirestoreRecordStore();
    expect(store.mode).toBe("firestore");
    expect(await store.getFarm()).toBeNull();
    expect(await store.getCaseDraft("c1")).toBeNull();
    expect(await store.isMailStopped()).toBe(false);
    expect(await store.listHouses()).toEqual([]);
  });

  it("ログイン済みなら、状態が戻るのを待ってから uid を読む", async () => {
    const db = asMember("alice");
    let ready = false;
    const auth = {
      authStateReady: async () => {
        await Promise.resolve();
        ready = true;
      },
      get currentUser() {
        return ready ? { uid: "alice" } : null;
      },
    };
    firebaseMock.getFirebase.mockResolvedValue({ db, auth });
    await seed(async (admin) => setDoc(doc(admin, "farms/f1"), farmFixture("alice", { name: "読めた" })));
    const farm = await createFirestoreRecordStore().getFarm();
    expect(farm?.name).toBe("読めた");
  });
});

describe("農場", () => {
  it("新しい農場は契約 2.3 の形で、実際のルールを通る。id が付く", async () => {
    const store = storeOf(asMember("alice"), "alice");
    expect(await store.getFarm()).toBeNull();

    await store.saveFarm(POINT);

    const farm = await store.getFarm();
    expect(farm).not.toBeNull();
    const { id, ...data } = farm!;
    expect(id).toMatch(/\S/);
    expect(data).toEqual({
      name: "",
      memberUids: ["alice"],
      unsubscribedUids: [],
      meshCode: "53394611",
      muniCode: "13101",
      prefCode: "13",
      frequentMuniCodes: [],
      production: null,
      housing: null,
      kahoContact: "",
      notify: DEFAULT_NOTIFY_FIXTURE,
      selfCheckDue: {},
      updatedAt: NOW_ISO,
    } satisfies Farm);
  });

  it("地点（meshCode）なしでは農場を作らない", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await expect(store.saveFarm({ name: "名前だけ" })).rejects.toThrow();
    expect(await store.getFarm()).toBeNull();
  });

  it("claim のない利用者（API でパスワード登録した人を含む）は農場を作れない", async () => {
    const store = storeOf(asPlain("mallory"), "mallory");
    await expect(store.saveFarm(POINT)).rejects.toThrow();
    expect(await rawFarmCount()).toBe(0);
  });

  it("保存のたびに updatedAt を進め、渡した項目だけを変える", async () => {
    let t = NOW;
    const db = asMember("alice");
    const store = createFirestoreRecordStoreWith(db, "alice", { now: () => t });
    await store.saveFarm({ ...POINT, name: "一回目" });
    t = new Date("2026-11-07T08:00:00+09:00");
    await store.saveFarm({ notify: { ...DEFAULT_NOTIFY_FIXTURE, level2: false, selfCheckRemindDays: 3 } });

    const farm = (await store.getFarm())!;
    expect(farm.name).toBe("一回目");
    expect(farm.meshCode).toBe("53394611");
    expect(farm.notify).toEqual({ ...DEFAULT_NOTIFY_FIXTURE, level2: false, selfCheckRemindDays: 3 });
    expect(farm.updatedAt).toBe("2026-11-07T08:00:00+09:00");
    expect(await rawFarmCount()).toBe(1);
  });

  it("saveFarm({}) でも updatedAt が進む", async () => {
    let t = NOW;
    const store = createFirestoreRecordStoreWith(asMember("alice"), "alice", { now: () => t });
    await store.saveFarm(POINT);
    t = new Date("2026-11-08T09:00:00+09:00");
    await store.saveFarm({});
    expect((await store.getFarm())!.updatedAt).toBe("2026-11-08T09:00:00+09:00");
  });

  it("農場の中身に uid、createdBy、緯度経度の項目がない", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    const id = (await store.getFarm())!.id;
    const keys = Object.keys((await rawData(`farms/${id}`))!);
    for (const bad of ["uid", "createdBy", "lat", "lng", "latitude", "longitude", "address"]) expect(keys).not.toContain(bad);
  });

  it("他の人の農場は見えない", async () => {
    await seed(async (admin) => setDoc(doc(admin, "farms/f2"), farmFixture("bob")));
    expect(await storeOf(asMember("alice"), "alice").getFarm()).toBeNull();
    expect((await storeOf(asMember("bob"), "bob").getFarm())?.id).toBe("f2");
  });

  it("農場の会員が増えても、どちらも同じ農場を読む（農場の招待の後）", async () => {
    await seed(async (admin) => setDoc(doc(admin, "farms/f1"), farmFixture("alice", { memberUids: ["alice", "carol"] })));
    expect((await storeOf(asMember("carol"), "carol").getFarm())?.id).toBe("f1");
  });
});

async function rawFarmCount(): Promise<number> {
  let n = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { getDocs, collection } = await import("firebase/firestore");
    n = (await getDocs(collection(ctx.firestore(), "farms"))).size;
  });
  return n;
}

describe("鶏舎", () => {
  it("saveHouse は id なしで新しく、id ありで同じ文書に保存し、listHouses が読める", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);

    await store.saveHouse(houseFixture({ name: "1 号舎" }));
    await store.saveHouse(houseFixture({ name: "2 号舎", flockSize: 50 }));
    const houses = await store.listHouses();
    expect(houses.map((h) => h.name).sort()).toEqual(["1 号舎", "2 号舎"]);
    expect(houses.every((h) => typeof h.id === "string" && h.id !== "")).toBe(true);

    const first = houses.find((h) => h.name === "1 号舎")!;
    await store.saveHouse({ ...first, flockSize: 80, empty: true }); // 一覧で受け取った id 付きのまま保存し直せる
    const after = await store.listHouses();
    expect(after).toHaveLength(2);
    expect(after.find((h) => h.id === first.id)).toEqual({ id: first.id, name: "1 号舎", birdType: "採卵鶏", flockSize: 80, empty: true });
  });

  it("鶏舎の中身に id、uid、createdBy がない", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    await store.saveHouse(houseFixture());
    const farmId = (await store.getFarm())!.id;
    const h = (await store.listHouses())[0]!;
    expect(Object.keys((await rawData(`farms/${farmId}/houses/${h.id}`))!).sort()).toEqual(["birdType", "empty", "flockSize", "name"]);
  });

  it("農場がないとき、listHouses は空で、saveHouse は断る", async () => {
    const store = storeOf(asMember("alice"), "alice");
    expect(await store.listHouses()).toEqual([]);
    await expect(store.saveHouse(houseFixture())).rejects.toThrow();
  });
});

describe("死亡数と点検", () => {
  it("死亡数の ID は {date}_{houseId}、中身は項目だけ", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    const farmId = (await store.getFarm())!.id;
    const rec = { date: "2026-11-05", houseId: "h1", deaths: 3, flockSizeAt: 100, exclusion: null };
    await store.saveDeath(rec);
    await store.saveDeath({ ...rec, deaths: 4 }); // 同じ日、同じ鶏舎は上書き

    expect(await rawData(`farms/${farmId}/deaths/2026-11-05_h1`)).toEqual({ ...rec, deaths: 4 });
    for (const key of Object.keys((await rawData(`farms/${farmId}/deaths/2026-11-05_h1`))!)) {
      expect(["uid", "createdBy", "lat", "lng"]).not.toContain(key);
    }
  });

  it("listDeaths は日付の範囲で絞り、並べて返す", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    for (const date of ["2026-11-01", "2026-11-03", "2026-11-05", "2026-11-09"]) {
      await store.saveDeath({ date, houseId: "h1", deaths: 1, flockSizeAt: 100, exclusion: null });
    }
    const got = await store.listDeaths("2026-11-02", "2026-11-05");
    expect(got.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-05"]);
    expect(Object.keys(got[0]!).sort()).toEqual(["date", "deaths", "exclusion", "flockSizeAt", "houseId"]);
  });

  it("消毒の ID は dis_{date}_{itemId}、自己点検は self_{month}。listChecks は id を付けて返す", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    const farmId = (await store.getFarm())!.id;
    await store.saveCheck({ kind: "disinfection", date: "2026-11-05", itemId: "i1" });
    await store.saveCheck({
      kind: "self_inspection",
      date: "2026-11-05",
      month: "2026-11",
      answers: { "17": "ok", "18": "ng", "19": null, "22": "ok", "23": "ok", "25": "ok", "27": "ok" },
    });

    expect(await rawData(`farms/${farmId}/checks/dis_2026-11-05_i1`)).toEqual({ kind: "disinfection", date: "2026-11-05", itemId: "i1" });
    expect((await rawData(`farms/${farmId}/checks/self_2026-11`))?.kind).toBe("self_inspection");

    const got = await store.listChecks("2026-11-01", "2026-11-30");
    expect(got.map((c) => c.id).sort()).toEqual(["dis_2026-11-05_i1", "self_2026-11"]);
    expect(got.find((c) => c.id === "self_2026-11")).toMatchObject({ kind: "self_inspection", month: "2026-11" });
  });

  it("点検の中身に uid、createdBy、lat、lng がない", async () => {
    const store = storeOf(asMember("alice"), "alice");
    await store.saveFarm(POINT);
    const farmId = (await store.getFarm())!.id;
    await store.saveCheck({ kind: "disinfection", date: "2026-11-05", itemId: "i1" });
    const keys = Object.keys((await rawData(`farms/${farmId}/checks/dis_2026-11-05_i1`))!);
    for (const bad of ["uid", "createdBy", "lat", "lng"]) expect(keys).not.toContain(bad);
  });
});

describe("配信の停止", () => {
  it("isMailStopped は自分の uid だけを見る", async () => {
    await seed(async (admin) =>
      setDoc(doc(admin, "farms/f1"), farmFixture("alice", { memberUids: ["alice", "bob"], unsubscribedUids: ["bob"] })),
    );
    expect(await storeOf(asMember("alice"), "alice").isMailStopped()).toBe(false);
    expect(await storeOf(asMember("bob"), "bob").isMailStopped()).toBe(true);
  });

  it("農場がなければ false", async () => {
    expect(await storeOf(asMember("alice"), "alice").isMailStopped()).toBe(false);
  });
});

describe("下書き（caseDrafts）", () => {
  const draft = { caseId: "c1", workerMessage: "声かけ", source: "template", createdAt: NOW_ISO };

  it("member は読める。無い下書きは null", async () => {
    await seed(async (admin) => setDoc(doc(admin, "caseDrafts/c1"), draft));
    const store = storeOf(asMember("alice"), "alice");
    expect(await store.getCaseDraft("c1")).toEqual(draft);
    expect(await store.getCaseDraft("none")).toBeNull();
  });

  it("claim がなければ permission-denied を null に変える（画面は雛形に戻る）", async () => {
    await seed(async (admin) => setDoc(doc(admin, "caseDrafts/c1"), draft));
    expect(await storeOf(asPlain("mallory"), "mallory").getCaseDraft("c1")).toBeNull();
  });
});

describe("権限エラーを null、空、false に丸めない", () => {
  // store は alice のつもりだが、通信は mallory で行う → 本当に権限エラーになる
  const mismatched = () => storeOf(asMember("mallory"), "alice");

  it("getFarm、isMailStopped、listHouses は reject する", async () => {
    await seed(async (admin) => setDoc(doc(admin, "farms/f1"), farmFixture("alice", { unsubscribedUids: ["alice"] })));
    await expect(mismatched().getFarm()).rejects.toThrow();
    await expect(mismatched().isMailStopped()).rejects.toThrow(); // false にすると停止済みの人にメールが届く
    await expect(mismatched().listHouses()).rejects.toThrow();
    await expect(mismatched().listDeaths("2026-11-01", "2026-11-30")).rejects.toThrow();
    await expect(mismatched().listChecks("2026-11-01", "2026-11-30")).rejects.toThrow();
  });

  it("getCaseDraft の permission-denied 以外の失敗は reject する", async () => {
    const broken = {
      type: "firestore",
      toJSON: () => ({}),
    } as never;
    await expect(createFirestoreRecordStoreWith(broken, "alice").getCaseDraft("c1")).rejects.toThrow();
  });
});
