// resolveReviewItem と getReviewDetail の中身（handleResolveReviewItem、handleGetReviewDetail）を、模擬環境の Firestore で確かめる（I-07）。
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import { makeReviewingCase } from "@hpai/shared/cases";
import type { CorrectedCaseValues, ResolveRequest } from "@hpai/shared/read/review";
import type { DocumentRecord, ReadResult, ReviewItem } from "@hpai/shared/read/types";
import type { Case, Source } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { handleGetReviewDetail, handleResolveReviewItem, type ResolveDeps } from "../../src/review/resolve";
import { getDoc, listIds, loadGeo, realCase, requireEmulator } from "../helpers/readHarness";

const NOW = new Date("2025-12-22T03:30:00Z"); // JST 12:30
const NOW_JST = "2025-12-22T12:30:00+09:00";
const OP = { uid: "op1", operator: true };
const MEMBER = { uid: "m1", operator: false };

let geo: GeoStore;
let deps: ResolveDeps;
beforeAll(async () => {
  requireEmulator();
  geo = await loadGeo();
  deps = { db, geo, now: () => NOW };
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-hpai/databases/(default)/documents`, { method: "DELETE" });
});

const sha24 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 24);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}
const resolve = (req: ResolveRequest, caller: { uid: string; operator: boolean } | null = OP) => handleResolveReviewItem(deps, caller, req);

// ── 置くもの ──
const QUOTE = "令和7年12月20日、岡山県津山市の養鶏場において簡易検査で陽性を確認しました。";
const q = <T>(value: T | null) => ({ value, quote: value === null ? null : QUOTE });
const primary: ReadResult = {
  kind: "suspected",
  kindQuote: QUOTE,
  multipleCases: false,
  prefecture: q("岡山県"),
  municipality: q("津山市"),
  nationalNo: q(null),
  prefNo: q(null),
  birdUse: q("採卵鶏"),
  housing: q(null),
  headCount: q(12000),
  negationBasis: q(null),
  primaryStage: "suspected",
  primaryDate: { year: null, month: 12, day: 20, time: null },
  primaryDateQuote: QUOTE,
  stageEvents: [],
  radiiKm: [{ km: 3, quote: QUOTE }],
  estimates: [],
  wildBirds: [],
};

async function seedDocument(id = "d1", over: Partial<DocumentRecord> = {}): Promise<DocumentRecord> {
  const rec: DocumentRecord = {
    id,
    sourceId: "src1",
    prefCode: "33",
    url: `https://example.test/${id}`,
    title: "高病原性鳥インフルエンザの発生について",
    contentType: "html",
    storagePath: `raw/${id}.html`,
    fetchedAt: "2025-12-22T12:00:00+09:00",
    fingerprint: "f".repeat(64),
    hasTextLayer: true,
    kind: "suspected",
    readState: "review_public",
    primary,
    second: null,
    verify: { pass: false, issues: [{ field: "municipality", check: "muni_exists", mandatory: true, detail: `津山市 ${QUOTE}` }], droppedOptional: [], normalized: null },
    compare: { match: false, mismatches: ["primaryDate"] },
    caseId: null,
    error: null,
    reasons: ["municipality:muni_exists"],
    ...over,
  };
  await db.doc(`documents/${id}`).set(rec);
  return rec;
}

async function seedItem(item: { id: string } & Record<string, unknown>): Promise<string> {
  const full = { createdAt: "2025-12-22T10:00:00+09:00", resolvedAt: null, ...item };
  await db.doc(`reviewQueue/${item.id}`).set(full);
  return item.id;
}

/** 文書の項目（id は doc-<documentId> とは限らない）、文書、確認中の事例を置く。 */
async function seedDocItem(o: { itemId?: string; documentId?: string; withDoc?: boolean } = {}): Promise<{ itemId: string; documentId: string }> {
  const documentId = o.documentId ?? "d1";
  const itemId = o.itemId ?? `doc-${documentId}`;
  const rec = o.withDoc === false ? null : await seedDocument(documentId);
  await seedItem({
    id: itemId,
    kind: "document",
    documentId,
    url: rec?.url ?? `https://example.test/${documentId}`,
    prefCode: "33",
    title: "題",
    reasons: ["municipality:muni_exists"],
    hasOutbreakWords: true,
  });
  await db.doc(`cases/rev-${documentId}`).set(makeReviewingCase({ documentId, season: 2025, prefCode: "33", sourceUrl: `https://example.test/${documentId}` }, NOW));
  return { itemId, documentId };
}

const values = (o: Partial<CorrectedCaseValues> = {}): CorrectedCaseValues => ({
  prefCode: "33",
  muniCode: "33203",
  stage: "suspected",
  date: "2025-12-20",
  time: null,
  nationalNo: null,
  prefNo: null,
  birdUse: "採卵鶏",
  housing: null,
  headCount: 12000,
  radiiKm: [3, 10],
  ...o,
});

const itemOf = async (id: string) => (await getDoc(`reviewQueue/${id}`)) as (ReviewItem & { resolvedBy?: string; resolvedAction?: string }) | undefined;

// ── 権限 ──
describe("権限（サーバーで確かめる）", () => {
  it("ログインなしは unauthenticated、claim がなければ member でも permission-denied。何も変わらない", async () => {
    const { itemId } = await seedDocItem();
    const req: ResolveRequest = { itemId, action: "mark_irrelevant" };
    expect(await codeOf(resolve(req, null))).toBe("unauthenticated");
    expect(await codeOf(resolve(req, MEMBER))).toBe("permission-denied");
    expect((await itemOf(itemId))!.resolvedAt).toBeNull();
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    expect((await getDoc("documents/d1"))!.readState).toBe("review_public");
  });
  it("getReviewDetail も同じ", async () => {
    const { itemId } = await seedDocItem();
    expect(await codeOf(handleGetReviewDetail(deps, null, { itemId }))).toBe("unauthenticated");
    expect(await codeOf(handleGetReviewDetail(deps, MEMBER, { itemId }))).toBe("permission-denied");
  });
});

// ── 入力 ──
describe("入力の検査", () => {
  it.each([
    ["itemId に /", { itemId: "a/b", action: "dismiss_alert" }],
    ["未知の操作", { itemId: "x", action: "wipe" }],
    ["values なし", { itemId: "x", action: "publish_corrected" }],
    ["日付が実在しない", { itemId: "x", action: "publish_corrected", values: { ...values(), date: "2025-02-30" } }],
    ["null", null],
  ])("%s は invalid-argument", async (_n, data) => {
    expect(await codeOf(handleResolveReviewItem(deps, OP, data))).toBe("invalid-argument");
  });
  it("項目がなければ not-found", async () => {
    expect(await codeOf(resolve({ itemId: "doc-nothing", action: "mark_irrelevant" }))).toBe("not-found");
  });
});

// ── 値を直して載せる ──
describe("publish_corrected", () => {
  it("rev の事例が消え、operator の事例ができる。項目は resolvedAt、resolvedBy を持ち、文書は published", async () => {
    const { itemId } = await seedDocItem();
    const res = await resolve({ itemId, action: "publish_corrected", values: values({ time: "09:30" }) });
    expect(res).toEqual({ ok: true, caseId: "33203-2025-12-20-1" });
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1"]);
    const c = (await getDoc("cases/33203-2025-12-20-1")) as Case;
    expect(c).toMatchObject({
      id: "33203-2025-12-20-1",
      season: 2025,
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      birdUse: "採卵鶏",
      headCount: 12000,
      radiiKm: [3, 10],
      confirmState: "operator",
      negation: "none",
      stages: { suspected: { date: "2025-12-20", time: "09:30" } },
      sourceUrls: ["https://example.test/d1"],
      updatedAt: NOW_JST,
    });
    const item = (await itemOf(itemId))!;
    expect(item.resolvedAt).toBe(NOW_JST);
    expect(item.resolvedBy).toBe("op1");
    expect(item.resolvedAction).toBe("publish_corrected");
    const doc = (await getDoc("documents/d1"))!;
    expect(doc.readState).toBe("published");
    expect(doc.caseId).toBe("33203-2025-12-20-1");
  });

  it("項目の id が doc-<documentId> でなくても（解決済みの後に作り直した doc-<id>-<ms>）、項目の documentId で rev- を探して消す", async () => {
    const { itemId } = await seedDocItem({ itemId: "doc-d1-1766000000000" });
    await resolve({ itemId, action: "publish_corrected", values: values() });
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1"]);
  });

  it("同じ事例があれば足して、id は変わらない", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ stages: { suspected: { date: "2025-12-20", time: null } } }));
    const { itemId } = await seedDocItem();
    const res = await resolve({ itemId, action: "publish_corrected", values: values({ stage: "confirmed", date: "2025-12-21", time: "10:00", headCount: 13000 }) });
    expect(res.caseId).toBe("33203-2025-12-20-1");
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1"]);
    const c = (await getDoc("cases/33203-2025-12-20-1")) as Case;
    expect(c.stages).toEqual({ suspected: { date: "2025-12-20", time: null }, confirmed: { date: "2025-12-21", time: "10:00" } });
    expect(c.headCount).toBe(13000);
    expect(c.confirmState).toBe("operator");
    expect(c.sourceUrls).toEqual(["https://example.test/old", "https://example.test/d1"]);
  });

  it("国内の番号が違う別の事例には足さず、新しい id（連番 2）になる", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ nationalNo: 5, stages: { suspected: { date: "2025-12-20", time: null } } }));
    const { itemId } = await seedDocItem();
    const res = await resolve({ itemId, action: "publish_corrected", values: values({ nationalNo: 9 }) });
    expect(res.caseId).toBe("33203-2025-12-20-2");
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1", "33203-2025-12-20-2"]);
    expect(((await getDoc("cases/33203-2025-12-20-1")) as Case).nationalNo).toBe(5);
  });

  it("N03 にない市町村のコード、別の県の市町村は invalid-argument。何も変わらない", async () => {
    const { itemId } = await seedDocItem();
    expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ muniCode: "99999" }) }))).toBe("invalid-argument");
    expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ muniCode: "34202" }) }))).toBe("invalid-argument"); // 広島県の市
    expect((await itemOf(itemId))!.resolvedAt).toBeNull();
    expect(await listIds("cases")).toEqual(["rev-d1"]);
    expect((await getDoc("documents/d1"))!.readState).toBe("review_public");
  });

  it("迷う（ambiguous）ときは failed-precondition で候補を返し、何も変えない", async () => {
    await db.doc("cases/33203-2025-12-18-1").set(realCase({ id: "33203-2025-12-18-1", stages: { suspected: { date: "2025-12-18", time: null } } }));
    await db.doc("cases/33203-2025-12-22-1").set(realCase({ id: "33203-2025-12-22-1", stages: { suspected: { date: "2025-12-22", time: null } } }));
    const { itemId } = await seedDocItem();
    let err: { code?: string; details?: unknown } | null = null;
    try {
      await resolve({ itemId, action: "publish_corrected", values: values() });
    } catch (e) {
      err = e as { code?: string; details?: unknown };
    }
    expect(err?.code).toBe("failed-precondition");
    expect(err?.details).toEqual({ candidateIds: expect.arrayContaining(["33203-2025-12-18-1", "33203-2025-12-22-1"]) });
    expect((await itemOf(itemId))!.resolvedAt).toBeNull();
    expect(await listIds("cases")).toEqual(["33203-2025-12-18-1", "33203-2025-12-22-1", "rev-d1"]);
  });

  it("事例がないのに疑い・確定でない段階だけでは載せない（failed-precondition）", async () => {
    const { itemId } = await seedDocItem();
    expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ stage: "movement_lifted" }) }))).toBe("failed-precondition");
    expect(await listIds("cases")).toEqual(["rev-d1"]);
  });

  it("種類の違う項目（知らせ）には使えない", async () => {
    const id = await seedItem({ id: "alert-watch_failing-33", kind: "alert", alert: "watch_failing", prefCode: "33", caseId: null, message: "m" });
    expect(await codeOf(resolve({ itemId: id, action: "publish_corrected", values: values() }))).toBe("failed-precondition");
  });
});

// ── 無関係 ──
describe("mark_irrelevant", () => {
  it("rev が消え、文書は discarded。公開の事例は増えず、他の事例は残る", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase());
    const { itemId } = await seedDocItem();
    const res = await resolve({ itemId, action: "mark_irrelevant" });
    expect(res).toEqual({ ok: true, caseId: null });
    expect(await listIds("cases")).toEqual(["33203-2025-12-20-1"]);
    expect((await getDoc("documents/d1"))!.readState).toBe("discarded");
    expect((await itemOf(itemId))!.resolvedAt).toBe(NOW_JST);
    expect((await itemOf(itemId))!.resolvedAction).toBe("mark_irrelevant");
  });
  it("文書の記録が消えていても、項目は閉じられる", async () => {
    const { itemId } = await seedDocItem({ withDoc: false });
    await resolve({ itemId, action: "mark_irrelevant" });
    expect(await listIds("cases")).toEqual([]);
    expect((await itemOf(itemId))!.resolvedAt).toBe(NOW_JST);
  });
});

// ── 否定 ──
describe("否定の候補", () => {
  const seedNeg = async (caseOver: Partial<Case> = {}) => {
    await db.doc("cases/33203-2025-12-20-1").set(
      realCase({ stages: { suspected: { date: "2025-12-20", time: null } }, negation: "candidate", ...caseOver }),
    );
    return seedItem({ id: "alert-negation_candidate-33203-2025-12-20-1-d9", kind: "alert", alert: "negation_candidate", prefCode: "33", caseId: "33203-2025-12-20-1", message: "m" });
  };

  it("確定: negated、negatedAt あり、段階と記録は消さない", async () => {
    const id = await seedNeg();
    const res = await resolve({ itemId: id, action: "confirm_negation" });
    expect(res).toEqual({ ok: true, caseId: "33203-2025-12-20-1" });
    const c = (await getDoc("cases/33203-2025-12-20-1")) as Case;
    expect(c.negation).toBe("negated");
    expect(c.negatedAt).toBe(NOW_JST);
    expect(c.stages.suspected).toEqual({ date: "2025-12-20", time: null });
    expect(c.sourceUrls).toEqual(["https://example.test/old"]);
    expect((await itemOf(id))!.resolvedAt).toBe(NOW_JST);
  });
  it("退ける: none（§10.2）", async () => {
    const id = await seedNeg();
    await resolve({ itemId: id, action: "reject_negation" });
    const c = (await getDoc("cases/33203-2025-12-20-1")) as Case;
    expect(c.negation).toBe("none");
    expect(c.negatedAt).toBeNull();
    expect((await itemOf(id))!.resolvedAction).toBe("reject_negation");
  });
  it("確定の段階がある事例（候補が退けられた後）を否定にはできない（failed-precondition。事例も項目も変えない）", async () => {
    const id = await seedNeg({ negation: "none", stages: { suspected: { date: "2025-12-20", time: null }, confirmed: { date: "2025-12-21", time: null } } });
    expect(await codeOf(resolve({ itemId: id, action: "confirm_negation" }))).toBe("failed-precondition");
    expect(((await getDoc("cases/33203-2025-12-20-1")) as Case).negation).toBe("none");
    expect((await itemOf(id))!.resolvedAt).toBeNull();
  });
  it("候補でなくなった事例への「退ける」は、事例を変えずに項目を閉じる", async () => {
    const id = await seedNeg({ negation: "none" });
    await resolve({ itemId: id, action: "reject_negation" });
    expect(((await getDoc("cases/33203-2025-12-20-1")) as Case).negation).toBe("none");
    expect((await itemOf(id))!.resolvedAt).toBe(NOW_JST);
  });
  it("事例が見つからなければ failed-precondition", async () => {
    const id = await seedItem({ id: "alert-negation_candidate-x", kind: "alert", alert: "negation_candidate", prefCode: "33", caseId: "no-such-case", message: "m" });
    expect(await codeOf(resolve({ itemId: id, action: "confirm_negation" }))).toBe("failed-precondition");
  });
  it("否定の候補は「確認した」だけでは閉じられない", async () => {
    const id = await seedNeg();
    expect(await codeOf(resolve({ itemId: id, action: "dismiss_alert" }))).toBe("failed-precondition");
  });
});

// ── 入口の提案 ──
describe("入口の提案", () => {
  const OLD = "https://www.pref.okayama.jp/old/index.html";
  const NEW = "https://www.pref.okayama.jp/new/index.html";
  const source = (url: string, over: Partial<Source> = {}): Source => ({
    id: sha24(url),
    prefCode: "33",
    url,
    kind: "pref_fixed",
    confirmedOn: "2025-11-01",
    note: null,
    group: 0,
    enabled: true,
    lastCheckedAt: "2025-12-21T10:00:00+09:00",
    lastOkAt: null,
    etag: null,
    lastModified: null,
    fingerprint: null,
    failureCount: 4,
    ...over,
  });
  const seedProposal = async (oldUrl: string | null = OLD) => {
    await db.doc(`sources/${sha24(OLD)}`).set(source(OLD));
    return seedItem({ id: "entr-1", kind: "entrance_proposal", prefCode: "33", oldUrl, proposedUrl: NEW, sourceKind: "pref_fixed", rationale: "新しい年度の入口" });
  };
  const sourcesSnapshot = async () => JSON.stringify(await Promise.all((await listIds("sources")).map(async (id) => [id, await getDoc(`sources/${id}`)])));

  it("承認: sources に足し（id、enabled、group、confirmedOn）、古い URL を無効にする", async () => {
    const id = await seedProposal();
    const res = await resolve({ itemId: id, action: "approve_entrance" });
    expect(res).toEqual({ ok: true, caseId: null });
    const nid = sha24(NEW);
    const s = (await getDoc(`sources/${nid}`)) as Source;
    expect(s).toMatchObject({ id: nid, prefCode: "33", url: NEW, kind: "pref_fixed", enabled: true, confirmedOn: "2025-12-22", lastCheckedAt: null, lastOkAt: null, etag: null, lastModified: null, fingerprint: null, failureCount: 0 });
    expect(s.group).toBe(parseInt(nid.slice(0, 8), 16) % 3);
    const old = (await getDoc(`sources/${sha24(OLD)}`)) as Source;
    expect(old.enabled).toBe(false);
    expect(old.failureCount).toBe(4); // 他の欄は触らない
    expect((await itemOf(id))!.resolvedAt).toBe(NOW_JST);
  });
  it("古い URL がなくても（oldUrl が null、sources に無い）承認できる", async () => {
    const id = await seedItem({ id: "entr-2", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: NEW, sourceKind: "pref_rss", rationale: "r" });
    await resolve({ itemId: id, action: "approve_entrance" });
    expect(await listIds("sources")).toEqual([sha24(NEW)]);
    const id2 = await seedItem({ id: "entr-3", kind: "entrance_proposal", prefCode: "33", oldUrl: "https://www.pref.okayama.jp/gone", proposedUrl: "https://www.pref.okayama.jp/other", sourceKind: "pref_rss", rationale: "r" });
    await resolve({ itemId: id2, action: "approve_entrance" });
    expect(await listIds("sources")).toEqual([sha24(NEW), sha24("https://www.pref.okayama.jp/other")].sort());
  });
  it("新しい URL がすでにあれば上書きせず、有効にするだけ（数えた失敗の回数を消さない）", async () => {
    const id = await seedProposal();
    await db.doc(`sources/${sha24(NEW)}`).set(source(NEW, { enabled: false, failureCount: 3, group: 2 }));
    await resolve({ itemId: id, action: "approve_entrance" });
    const s = (await getDoc(`sources/${sha24(NEW)}`)) as Source;
    expect(s.enabled).toBe(true);
    expect(s.failureCount).toBe(3);
    expect(s.group).toBe(2);
  });
  it("承認なしでは変わらない／退けても変わらない（§13）", async () => {
    const id = await seedProposal();
    const before = await sourcesSnapshot();
    const res = await resolve({ itemId: id, action: "reject_entrance" });
    expect(res.ok).toBe(true);
    expect(await sourcesSnapshot()).toBe(before);
    expect((await itemOf(id))!.resolvedAt).toBe(NOW_JST);
    expect((await itemOf(id))!.resolvedAction).toBe("reject_entrance");
  });
  it("https でない提案の URL は承認できない（failed-precondition。sources は変わらない）", async () => {
    await db.doc(`sources/${sha24(OLD)}`).set(source(OLD));
    const id = await seedItem({ id: "entr-4", kind: "entrance_proposal", prefCode: "33", oldUrl: OLD, proposedUrl: "javascript:alert(1)", sourceKind: "pref_fixed", rationale: "r" });
    const before = await sourcesSnapshot();
    expect(await codeOf(resolve({ itemId: id, action: "approve_entrance" }))).toBe("failed-precondition");
    expect(await sourcesSnapshot()).toBe(before);
    expect((await itemOf(id))!.resolvedAt).toBeNull();
  });
});

// ── 知らせ、解決済み、種類違い ──
describe("知らせ・解決済み・種類違い", () => {
  const alertItem = (alert: string, id = `alert-${alert}-k`) =>
    seedItem({ id, kind: "alert", alert, prefCode: "33", caseId: null, message: "m" });

  it.each(["case_stalled", "national_missing", "app_only_confirmed", "watch_failing", "agent_run_failed", "mail_failing"])("%s は「確認した」で閉じる", async (a) => {
    const id = await alertItem(a);
    expect(await resolve({ itemId: id, action: "dismiss_alert" })).toEqual({ ok: true, caseId: null });
    const item = (await itemOf(id))!;
    expect(item.resolvedAt).toBe(NOW_JST);
    expect(item.resolvedBy).toBe("op1");
  });
  it("解決済みの項目への操作は failed-precondition（2 度閉じない）", async () => {
    const id = await alertItem("watch_failing");
    await resolve({ itemId: id, action: "dismiss_alert" });
    expect(await codeOf(resolve({ itemId: id, action: "dismiss_alert" }))).toBe("failed-precondition");
  });
  it("種類違いの操作は failed-precondition", async () => {
    const alertId = await alertItem("watch_failing");
    const { itemId: docItemId } = await seedDocItem();
    for (const action of ["mark_irrelevant", "confirm_negation", "reject_negation", "approve_entrance", "reject_entrance"] as const) {
      expect(await codeOf(resolve({ itemId: alertId, action }))).toBe("failed-precondition");
    }
    for (const action of ["dismiss_alert", "confirm_negation", "approve_entrance"] as const) {
      expect(await codeOf(resolve({ itemId: docItemId, action }))).toBe("failed-precondition");
    }
    expect((await itemOf(alertId))!.resolvedAt).toBeNull();
    expect((await itemOf(docItemId))!.resolvedAt).toBeNull();
  });
});

// ── 詳細 ──
describe("getReviewDetail", () => {
  it("読んだ値と検査の結果を返す。引用（quote）も原文の文も含めない", async () => {
    const { itemId } = await seedDocItem({ itemId: "doc-d1-1766000000000" });
    const d = await handleGetReviewDetail(deps, OP, { itemId });
    expect(d).toMatchObject({ kind: "suspected", prefecture: "岡山県", municipality: "津山市", primaryStage: "suspected", headCount: 12000, birdUse: "採卵鶏", radiiKm: [3], mismatches: ["primaryDate"], error: null });
    expect(d.issues).toEqual([{ field: "municipality", check: "muni_exists", mandatory: true }]);
    const json = JSON.stringify(d);
    expect(json).not.toContain("quote");
    expect(json).not.toContain("簡易検査");
    expect(json).not.toContain(QUOTE);
  });
  it("文書の項目でなければ failed-precondition、項目がなければ not-found、文書がなければ not-found", async () => {
    const alertId = await seedItem({ id: "alert-x", kind: "alert", alert: "watch_failing", prefCode: null, caseId: null, message: "m" });
    expect(await codeOf(handleGetReviewDetail(deps, OP, { itemId: alertId }))).toBe("failed-precondition");
    expect(await codeOf(handleGetReviewDetail(deps, OP, { itemId: "nothing" }))).toBe("not-found");
    const { itemId } = await seedDocItem({ documentId: "d2", withDoc: false });
    expect(await codeOf(handleGetReviewDetail(deps, OP, { itemId }))).toBe("not-found");
    expect(await codeOf(handleGetReviewDetail(deps, OP, { itemId: "a/b" }))).toBe("invalid-argument");
  });
});

// ── すべての操作で resolvedAt ──
describe("すべての操作で resolvedAt が入る", () => {
  it("6 つの種類の操作が、それぞれ resolvedAt と resolvedBy を残す", async () => {
    const { itemId: d1 } = await seedDocItem({ documentId: "da" });
    const { itemId: d2 } = await seedDocItem({ documentId: "db" });
    await db.doc("cases/33203-2025-12-01-1").set(realCase({ id: "33203-2025-12-01-1", negation: "candidate", stages: { suspected: { date: "2025-12-01", time: null } } }));
    const n1 = await seedItem({ id: "n1", kind: "alert", alert: "negation_candidate", prefCode: "33", caseId: "33203-2025-12-01-1", message: "m" });
    const n2 = await seedItem({ id: "n2", kind: "alert", alert: "negation_candidate", prefCode: "33", caseId: "33203-2025-12-01-1", message: "m" });
    const e1 = await seedItem({ id: "e1", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: "https://www.pref.okayama.jp/a", sourceKind: "pref_fixed", rationale: "r" });
    const e2 = await seedItem({ id: "e2", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: "https://www.pref.okayama.jp/b", sourceKind: "pref_fixed", rationale: "r" });
    const a1 = await seedItem({ id: "a1", kind: "alert", alert: "mail_failing", prefCode: null, caseId: null, message: "m" });
    const reqs: ResolveRequest[] = [
      { itemId: d1, action: "publish_corrected", values: values() },
      { itemId: d2, action: "mark_irrelevant" },
      { itemId: n1, action: "reject_negation" },
      { itemId: n2, action: "reject_negation" },
      { itemId: e1, action: "approve_entrance" },
      { itemId: e2, action: "reject_entrance" },
      { itemId: a1, action: "dismiss_alert" },
    ];
    for (const r of reqs) {
      await resolve(r);
      const item = (await itemOf(r.itemId))!;
      expect(item.resolvedAt, r.action).toBe(NOW_JST);
      expect(item.resolvedBy, r.action).toBe("op1");
      expect(item.resolvedAction, r.action).toBe(r.action);
    }
  });
});

// ── レビュー 1 回目の修正 ──
describe("直した日付の検査（読み手の経路と同じ決まり）", () => {
  const unchanged = async (itemId: string) => {
    expect((await itemOf(itemId))!.resolvedAt).toBeNull();
    expect(await listIds("cases")).toContain("rev-d1");
    expect((await getDoc("documents/d1"))!.readState).toBe("review_public");
  };
  it("未来の日付と、年の打ち間違いは invalid-argument。何も変えない", async () => {
    const { itemId } = await seedDocItem();
    for (const date of ["2025-12-23", "2052-12-20", "2024-12-20"]) {
      expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ date }) })), date).toBe("invalid-argument");
    }
    await unchanged(itemId);
    expect((await listIds("cases")).filter((id) => id !== "rev-d1")).toEqual([]);
  });
  it("既にある段階の日付と違う入力は拒み、正しい日付を上書きしない", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ stages: { suspected: { date: "2025-12-20", time: null } } }));
    const { itemId } = await seedDocItem();
    expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ date: "2025-12-19" }) }))).toBe("failed-precondition");
    expect(((await getDoc("cases/33203-2025-12-20-1")) as Case).stages).toEqual({ suspected: { date: "2025-12-20", time: null } });
    await unchanged(itemId);
  });
  it("段階の順序が逆になる日付（確定より後の疑い）は拒む", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ stages: { confirmed: { date: "2025-12-21", time: null } } }));
    const { itemId } = await seedDocItem();
    expect(await codeOf(resolve({ itemId, action: "publish_corrected", values: values({ stage: "suspected", date: "2025-12-22" }) }))).toBe("failed-precondition");
    await unchanged(itemId);
  });
  it("同じ段階の同じ日付への足しは通る（時刻の補い）", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ stages: { suspected: { date: "2025-12-20", time: null } } }));
    const { itemId } = await seedDocItem();
    await resolve({ itemId, action: "publish_corrected", values: values({ time: "08:00" }) });
    expect(((await getDoc("cases/33203-2025-12-20-1")) as Case).stages.suspected).toEqual({ date: "2025-12-20", time: "08:00" });
  });
});

describe("載せるの前と後の記録", () => {
  it("読み取った値（前）、直した値（後）、足す前の段階を項目に残す", async () => {
    await db.doc("cases/33203-2025-12-20-1").set(realCase({ stages: { suspected: { date: "2025-12-20", time: null } } }));
    const { itemId } = await seedDocItem();
    const v = values({ stage: "confirmed", date: "2025-12-21", headCount: 13000 });
    await resolve({ itemId, action: "publish_corrected", values: v });
    const r = ((await getDoc(`reviewQueue/${itemId}`)) as { resolution?: any }).resolution;
    expect(r.before).toMatchObject({ prefecture: "岡山県", municipality: "津山市", primaryStage: "suspected", headCount: 12000, birdUse: "採卵鶏" });
    expect(JSON.stringify(r)).not.toContain("quote");
    expect(r.after).toEqual(v);
    expect(r.caseBefore).toEqual({ stages: { suspected: { date: "2025-12-20", time: null } } });
  });
  it("新しい事例のとき caseBefore は null、文書の記録がなければ before は null", async () => {
    const { itemId } = await seedDocItem({ withDoc: false });
    await resolve({ itemId, action: "publish_corrected", values: values() });
    const r = ((await getDoc(`reviewQueue/${itemId}`)) as { resolution?: any }).resolution;
    expect(r.before).toBeNull();
    expect(r.caseBefore).toBeNull();
    expect(r.after).toEqual(values());
  });
});

describe("入口の承認は、その県の公式ドメインの https だけ（多重の守り）", () => {
  it.each([
    ["別のドメイン", "https://evil.example/x"],
    ["似たドメイン", "https://pref.okayama.jp.evil.example/x"],
    ["別の県の公式ドメイン", "https://www.pref.hyogo.lg.jp/x"],
    ["ポート", "https://www.pref.okayama.jp:8443/x"],
    ["利用者情報つき", "https://user:pw" + "@www.pref.okayama.jp/x"],
    ["http", "http://www.pref.okayama.jp/x"],
  ])("%s の URL は承認できない（failed-precondition。sources は変わらず、項目も解決しない）", async (_n, url) => {
    const id = await seedItem({ id: "entr-dom", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: url, sourceKind: "pref_fixed", rationale: "r" });
    expect(await codeOf(resolve({ itemId: id, action: "approve_entrance" }))).toBe("failed-precondition");
    expect(await listIds("sources")).toEqual([]);
    expect((await itemOf(id))!.resolvedAt).toBeNull();
  });
});

describe("入口の承認は項目の県の source だけ", () => {
  it("同じ URL が別の県の source として登録されていれば、有効にせず failed-precondition", async () => {
    const url = "https://www.pref.okayama.jp/new/index.html";
    const id = sha24(url);
    await db.doc(`sources/${id}`).set({ id, prefCode: "34", url, kind: "pref_fixed", confirmedOn: "2025-11-01", note: null, group: 0, enabled: false, lastCheckedAt: null, lastOkAt: null, etag: null, lastModified: null, fingerprint: null, failureCount: 0 });
    const item = await seedItem({ id: "entr-x", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: url, sourceKind: "pref_fixed", rationale: "r" });
    expect(await codeOf(resolve({ itemId: item, action: "approve_entrance" }))).toBe("failed-precondition");
    expect(((await getDoc(`sources/${id}`)) as Source).enabled).toBe(false);
    expect((await itemOf(item))!.resolvedAt).toBeNull();
  });
});
