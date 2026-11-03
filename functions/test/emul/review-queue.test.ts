// 運営者の確認の箱（reviewQueue）への投入口 enqueueReview を、模擬環境の Firestore で確かめる（I-02）。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ReviewItem } from "@hpai/shared/read/types";
import { db } from "../../src/admin";
import { enqueueReview, reviewAlertId, reviewDocumentId, type NewReviewItem } from "../../src/review/queue";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const NOW = new Date("2026-11-05T03:00:00Z");
const alert = (id: string): Extract<NewReviewItem, { kind: "alert" }> => ({ id, kind: "alert", alert: "watch_failing", prefCode: "33", caseId: null, message: "確認できません" });

describe("id の作り方", () => {
  it("文書は doc-、警告は alert-<種類>-<キー>", () => {
    expect(reviewDocumentId("abc_123")).toBe("doc-abc_123");
    expect(reviewAlertId("watch_failing", "33-20261105")).toBe("alert-watch_failing-33-20261105");
  });
});

describe("enqueueReview", () => {
  it("createdAt を入れ、resolvedAt は null で作る", async () => {
    expect(await enqueueReview(alert("alert-x-1"), NOW)).toBe(true);
    const item = (await db.doc("reviewQueue/alert-x-1").get()).data() as ReviewItem;
    expect(item).toMatchObject({ id: "alert-x-1", kind: "alert", alert: "watch_failing", prefCode: "33", createdAt: "2026-11-05T12:00:00+09:00", resolvedAt: null });
  });
  it("同じ id は 2 度入らず、2 度目は false で、最初の内容を変えない", async () => {
    await enqueueReview(alert("alert-x-2"), NOW);
    const again = await enqueueReview({ ...alert("alert-x-2"), message: "別の文" }, new Date("2026-11-06T03:00:00Z"));
    expect(again).toBe(false);
    expect(((await db.doc("reviewQueue/alert-x-2").get()).data() as ReviewItem & { message: string }).message).toBe("確認できません");
  });
  it("文書の腕も入る", async () => {
    const doc: NewReviewItem = { id: reviewDocumentId("d1"), kind: "document", documentId: "d1", url: "https://example.jp/a", prefCode: null, title: "題", reasons: ["ambiguous_case"], hasOutbreakWords: true };
    expect(await enqueueReview(doc, NOW)).toBe(true);
    expect(((await db.doc("reviewQueue/doc-d1").get()).data() as ReviewItem).resolvedAt).toBeNull();
  });
});
