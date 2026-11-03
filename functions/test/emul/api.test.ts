// 公開 API と公開 MCP を、模擬環境の Firestore と本物の読み口で確かめる（X-12）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@hpai/shared/dates";
import { db } from "../../src/admin";
import { cachedReaders, createFirestoreDeps, firestoreReaders } from "../../src/api/firestoreDeps";
import { handleApi, type ApiDeps } from "../../src/api/handler";
import { createPublicMcpServer } from "../../src/mcp/server";
import { FORBIDDEN_KEYS, GEO_DIR, HISTORY_FILE, NOW, findKeys, freshStatuses, makeBird, makeCase } from "../helpers/apiDeps";

const PROJECT = "demo-hpai";
const MARKER_FARM = "目印牧場-MARKER-9f3a";
const MARKER_CONTACT = "00-0000-0000";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const getDeps = createFirestoreDeps({ geoDir: GEO_DIR, historyFile: HISTORY_FILE });
const day = (d: string) => `${d}T10:00:00+09:00`;

async function seed(): Promise<void> {
  // 公開してよいもの
  const today = "2026-11-04";
  await db.doc("cases/c1").set(makeCase({ id: "c1" }));
  await db.doc("cases/c-adj").set(makeCase({ id: "c-adj", muniCode: "33214", muniName: "美作市" }));
  await db.doc("cases/c-tokyo").set(makeCase({ id: "c-tokyo", prefCode: "13", muniCode: "13101", muniName: "千代田区" }));
  await db.doc("cases/n7").set(makeCase({ id: "n7", negation: "negated", negatedAt: day(addDays(today, -7)) }));
  await db.doc("cases/n8").set(makeCase({ id: "n8", negation: "negated", negatedAt: day(addDays(today, -8)) }));
  await db.doc("cases/rev-1").set({ ...makeCase({ id: "rev-1", confirmState: "reviewing", muniCode: null, muniName: null, headCount: 777 }), reviewReason: "内部の理由-MARKER" });
  await db.doc("cases/old").set(makeCase({ id: "old", season: 2025 })); // 前の季。今季の答えに混ざらない
  await db.doc("wildBirds/b1").set(makeBird());
  await db.doc("wildBirds/b-neg").set(makeBird({ id: "b-neg", test: "negative" }));
  for (const s of freshStatuses({ "33": { ok: false, failingSince: day(today) } })) await db.doc(`watchStatus/${s.prefCode}`).set(s);

  // 公開してはいけないもの（目印の名前）
  await db.doc("farms/f1").set({ name: MARKER_FARM, meshCode: "52334557", muniCode: "33203", memberUids: ["u-member-1"], unsubscribedUids: [], kahoContact: MARKER_CONTACT });
  await db.doc("farms/f1/houses/h1").set({ name: `${MARKER_FARM}の1号舎`, flockSize: 4321, birdType: "layer" });
  await db.doc("farms/f1/deaths/d1").set({ date: "2026-11-03", deaths: 99, flockSizeAt: 4321, createdBy: "u-member-1" });
  await db.doc("caseDrafts/cd1").set({ text: `${MARKER_FARM}の下書き` });
  await db.doc("reviewQueue/q1").set({ reason: "運営者の箱-MARKER", prefCode: "33" });
}

const ENDPOINTS: Array<[string, Record<string, string>]> = [
  ["/api/v1/cases", {}],
  ["/api/v1/cases", { season: "2025" }],
  ["/api/v1/cases", { pref: "33" }],
  ["/api/v1/areas/33203", {}],
  ["/api/v1/areas/33214", {}],
  ["/api/v1/wild-birds", {}],
  ["/api/v1/watch-status", {}],
];

describe("公開 API と公開 MCP（模擬環境の Firestore）", () => {
  it("目印の名前を入れた農場、記録、下書き、運営者の箱が、全 endpoint に出ない", async () => {
    await seed();
    const deps = await getDeps();
    for (const [p, q] of ENDPOINTS) {
      const r = await handleApi({ method: "GET", path: p, query: q }, deps, NOW);
      expect(r.status, p).toBe(200);
      const text = JSON.stringify(r.body);
      for (const m of ["MARKER", MARKER_FARM, MARKER_CONTACT, "u-member-1", "52334557", "4321"]) expect(text, `${p} ${m}`).not.toContain(m);
      expect(findKeys(r.body, FORBIDDEN_KEYS), p).toEqual([]);
    }
  });

  it("/cases は今季の事例だけ。否定は 7 日残り 8 日目に消え、確認中は県名とリンクだけ。内部の理由は出ない", async () => {
    await seed();
    const deps = await getDeps();
    const r = await handleApi({ method: "GET", path: "/api/v1/cases", query: {} }, deps, NOW);
    const body = r.body as { data: Array<{ id: string; headCount: number | null; muniCode: string | null }>; watch: { failedPrefCodes: string[] } };
    expect(body.data.map((c) => c.id).sort()).toEqual(["c-adj", "c-tokyo", "c1", "n7", "rev-1"]);
    expect(body.data.find((c) => c.id === "rev-1")).toMatchObject({ headCount: null, muniCode: null, confirmState: "reviewing" });
    expect(body.watch.failedPrefCodes).toEqual(["33"]);
    const okayama = await handleApi({ method: "GET", path: "/api/v1/cases", query: { pref: "33" } }, deps, NOW);
    expect((okayama.body as { data: Array<{ prefCode: string }> }).data.every((c) => c.prefCode === "33")).toBe(true);
  });

  it("/areas: 津山は段階 1、隣の美作の事例が adjacentCases。確認中は入らない。野鳥は否定を除く", async () => {
    await seed();
    const deps = await getDeps();
    const r = await handleApi({ method: "GET", path: "/api/v1/areas/33203", query: {} }, deps, NOW);
    const body = r.body as { data: { level: number; sameMuniCases: Array<{ id: string }>; adjacentCases: Array<{ id: string }>; wildBirds: Array<{ id: string }> } };
    expect(body.data.level).toBe(1);
    expect(body.data.sameMuniCases.map((c) => c.id)).toEqual(["c1"]);
    expect(body.data.adjacentCases.map((c) => c.id)).toEqual(["c-adj"]);
    expect(body.data.wildBirds.map((b) => b.id)).toEqual(["b1"]);
  });

  it("/wild-birds は negative を返さない。/watch-status は 47 行", async () => {
    await seed();
    const deps = await getDeps();
    const birds = await handleApi({ method: "GET", path: "/api/v1/wild-birds", query: {} }, deps, NOW);
    expect((birds.body as { data: Array<{ id: string }> }).data.map((b) => b.id)).toEqual(["b1"]);
    const watch = await handleApi({ method: "GET", path: "/api/v1/watch-status", query: {} }, deps, NOW);
    const w = watch.body as { data: { prefectures: unknown[]; okCount: number; failedPrefCodes: string[] } };
    expect(w.data.prefectures).toHaveLength(47);
    expect(w.data.okCount).toBe(46);
    expect(w.data.failedPrefCodes).toEqual(["33"]);
  });

  it("読み取りは公開の項目だけを Firestore から読む（.select()）。60 秒は同じ読み取りを使い回す", async () => {
    await seed();
    await db.doc("cases/poison").set({ ...makeCase({ id: "poison" }), farmId: "f-marker", meshCode: "52334557", memberUids: ["u-member-1"] });
    const raw = await firestoreReaders.casesBySeason(2026, null);
    expect(raw.length).toBeGreaterThan(0);
    for (const c of raw) expect(Object.keys(c).filter((k) => ["farmId", "meshCode", "memberUids", "reviewReason"].includes(k))).toEqual([]);
    expect(Object.keys((await firestoreReaders.watchStatuses())[0]!).sort()).toEqual(["checkedAt", "failingSince", "lastOkAt", "ok", "prefCode"]);

    let t = 1_000;
    const readers = cachedReaders(firestoreReaders, () => t);
    const first = await readers(false).casesBySeason(2026, "33");
    await db.doc("cases/late").set(makeCase({ id: "late" }));
    expect(await readers(false).casesBySeason(2026, "33")).toBe(first); // 60 秒の間は Firestore を読み直さない
    t += 60_001;
    expect(await readers(true).casesBySeason(2026, "33")).toBe(first); // 全体の上限のとき: 期限が過ぎていてもキャッシュから返す
    expect((await readers(true).casesBySeason(2026, "13")).map((c) => c.id)).toEqual(["c-tokyo"]); // キャッシュが無い鍵は読む
    expect((await readers(false).casesBySeason(2026, "33")).map((c) => c.id)).toContain("late");
  });

  it("過去のシーズンは同梱の資料から（2025 は 24 件）", async () => {
    const deps: ApiDeps = await getDeps();
    const r = await handleApi({ method: "GET", path: "/api/v1/cases", query: { season: "2025" } }, deps, NOW);
    expect((r.body as { data: unknown[] }).data).toHaveLength(24);
  });

  it("公開 MCP の get_area_status が同じ答えを返す", async () => {
    await seed();
    const server = createPublicMcpServer(await getDeps(), () => NOW);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(a);
    try {
      const r = (await client.callTool({ name: "get_area_status", arguments: { muniCode: "33203" } })) as unknown as { structuredContent: { data: { level: number } } };
      expect(r.structuredContent.data.level).toBe(1);
      expect(JSON.stringify(r.structuredContent)).not.toContain("MARKER");
    } finally {
      await client.close();
    }
  });
});
