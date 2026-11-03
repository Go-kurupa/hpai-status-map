// 運営者へのメール（I-18）を、模擬環境の Firestore で確かめる。送信の口は偽物で、実際には送らない。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { db } from "../../src/admin";
import { notifyOperator, type NotifyDeps } from "../../src/review/notifyOperator";
import { enqueueReview, reviewAlertId, reviewDocumentId, type NewReviewItem } from "../../src/review/queue";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

const T0 = new Date("2026-11-05T03:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const APP_URL = "http://127.0.0.1:5174";

const doc = (id: string, title = "岡山県のお知らせ（秘密の題）"): NewReviewItem => ({
  id: reviewDocumentId(id),
  kind: "document",
  documentId: id,
  url: "https://example.jp/a",
  prefCode: "33",
  title,
  reasons: ["ambiguous_case"],
  hasOutbreakWords: true,
});
const alert = (alertName: Extract<NewReviewItem, { kind: "alert" }>["alert"], key: string, message = "秘密の本文です"): NewReviewItem => ({
  id: reviewAlertId(alertName, key),
  kind: "alert",
  alert: alertName,
  prefCode: "33",
  caseId: null,
  message,
});

interface Sent {
  to: string;
  subject: string;
  text: string;
}
function harness(now: () => Date, failWith?: () => Error | null) {
  const sent: Sent[] = [];
  const deps: NotifyDeps = {
    to: "operator@example.com",
    appUrl: APP_URL,
    now,
    send: async (to, mail) => {
      const err = failWith?.();
      if (err) throw err;
      sent.push({ to, ...mail });
    },
  };
  return { sent, deps };
}
const lastNotifiedAt = async () => ((await db.doc("usage/operatorNotice").get()).data() as { lastNotifiedAt?: string } | undefined)?.lastNotifiedAt ?? null;

describe("notifyOperator", () => {
  it("未解決の項目を 1 通にまとめ、種類ごとの件数と運営者の画面の URL だけを入れる（題と本文は入れない）", async () => {
    await enqueueReview(doc("d1"), at(0));
    await enqueueReview(doc("d2", "別の題"), at(0));
    await enqueueReview(alert("case_stalled", "c1"), at(0));
    await enqueueReview(alert("watch_failing", "33-20261105"), at(0));
    const { sent, deps } = harness(() => at(10));

    const r = await notifyOperator(deps);

    expect(r).toEqual({ sent: true, count: 4 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("operator@example.com");
    expect(sent[0]!.subject).toBe("運営者の確認が 4 件あります");
    expect(sent[0]!.text).toContain(`${APP_URL}/operator`);
    expect(sent[0]!.text).toMatch(/文書.*2 件/);
    expect(sent[0]!.text).toMatch(/1 件/);
    expect(sent[0]!.text).not.toContain("秘密の題");
    expect(sent[0]!.text).not.toContain("別の題");
    expect(sent[0]!.text).not.toContain("秘密の本文");
    expect(sent[0]!.text).not.toContain("https://example.jp/a");
    expect(await lastNotifiedAt()).toBe("2026-11-05T12:10:00+09:00");
  });

  it("末尾のスラッシュがある APP_URL でも /operator が二重にならない", async () => {
    await enqueueReview(doc("d1"), at(0));
    const { sent, deps } = harness(() => at(1));
    await notifyOperator({ ...deps, appUrl: `${APP_URL}/` });
    expect(sent[0]!.text).toContain(`${APP_URL}/operator`);
    expect(sent[0]!.text).not.toContain("//operator");
  });

  it("解決済みの項目は数えない", async () => {
    await enqueueReview(doc("d1"), at(0));
    await enqueueReview(doc("d2"), at(0));
    await db.doc(`reviewQueue/${reviewDocumentId("d2")}`).update({ resolvedAt: "2026-11-05T12:05:00+09:00" });
    const { sent, deps } = harness(() => at(10));
    expect((await notifyOperator(deps)).count).toBe(1);
    expect(sent[0]!.subject).toBe("運営者の確認が 1 件あります");
  });

  it("新しい項目がなければ送らない。2 回呼んでも 2 度知らせない", async () => {
    const { sent, deps } = harness(() => at(10));
    expect(await notifyOperator(deps)).toEqual({ sent: false, count: 0 });
    await enqueueReview(doc("d1"), at(0));
    expect((await notifyOperator(deps)).sent).toBe(true);
    expect(await notifyOperator(deps)).toEqual({ sent: false, count: 0 });
    expect(sent).toHaveLength(1);
  });

  it("前回の後に増えた項目だけを数える（前回までの未解決は数えない）", async () => {
    await enqueueReview(doc("d1"), at(0));
    const h1 = harness(() => at(10));
    await notifyOperator(h1.deps);
    await enqueueReview(doc("d2"), at(20));
    await enqueueReview(alert("national_missing", "x"), at(21));
    const h2 = harness(() => at(30));
    const r = await notifyOperator(h2.deps);
    expect(r.count).toBe(2);
    expect(h2.sent[0]!.subject).toBe("運営者の確認が 2 件あります");
    expect(await lastNotifiedAt()).toBe("2026-11-05T12:30:00+09:00");
  });

  it("前回の通知の時刻より前の createdAt で、後から箱に入った項目（同時起動の取りこぼし窓）も、次のメールに載る", async () => {
    await enqueueReview(doc("d1"), at(0));
    await notifyOperator(harness(() => at(10)).deps);
    await enqueueReview(doc("late"), at(5)); // 長い処理の最初の now で、通知の後に箱へ入った
    const h = harness(() => at(30));
    expect(await notifyOperator(h.deps)).toEqual({ sent: true, count: 1 });
    expect(h.sent[0]!.subject).toBe("運営者の確認が 1 件あります");
    expect(await notifyOperator(harness(() => at(40)).deps)).toEqual({ sent: false, count: 0 });
  });

  it("通知済みの id は未解決のものだけ残す（解決した項目は外す）。解決して同じ id が戻ることはない", async () => {
    await enqueueReview(doc("d1"), at(0));
    await enqueueReview(doc("d2"), at(0));
    await notifyOperator(harness(() => at(10)).deps);
    expect(((await db.doc("usage/operatorNotice").get()).data() as { notifiedIds: string[] }).notifiedIds.sort()).toEqual(["doc-d1", "doc-d2"]);
    await db.doc("reviewQueue/doc-d1").update({ resolvedAt: "2026-11-05T12:20:00+09:00" });
    await enqueueReview(doc("d3"), at(25));
    await notifyOperator(harness(() => at(30)).deps);
    expect(((await db.doc("usage/operatorNotice").get()).data() as { notifiedIds: string[] }).notifiedIds.sort()).toEqual(["doc-d2", "doc-d3"]);
  });

  it("古い形式（lastNotifiedAt だけ）の記録でも、その時刻までの項目は知らせ済みとして扱う", async () => {
    await enqueueReview(doc("old"), at(0));
    await enqueueReview(doc("new"), at(20));
    await db.doc("usage/operatorNotice").set({ lastNotifiedAt: "2026-11-05T12:10:00+09:00" });
    const h = harness(() => at(30));
    expect((await notifyOperator(h.deps)).count).toBe(1);
  });

  it("送信に失敗したら lastNotifiedAt も notifiedIds も進めず、例外を投げる。直った次の回に同じ項目を知らせる", async () => {
    await enqueueReview(doc("d1"), at(0));
    let broken = true;
    const { sent, deps } = harness(() => at(10), () => (broken ? new Error("smtp down") : null));
    await expect(notifyOperator(deps)).rejects.toThrow("smtp down");
    expect(await lastNotifiedAt()).toBeNull();
    expect((await db.doc("usage/operatorNotice").get()).exists).toBe(false);
    expect(sent).toHaveLength(0);

    broken = false;
    expect((await notifyOperator(deps)).count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(await lastNotifiedAt()).not.toBeNull();
  });

  it("件名と本文に、使ってはいけない語がない（全部の種類の警告を入れても）", async () => {
    await enqueueReview(doc("d1"), at(0));
    await enqueueReview({ id: "prop-1", kind: "entrance_proposal", prefCode: "33", oldUrl: null, proposedUrl: "https://www.pref.okayama.jp/x", sourceKind: "pref_fixed", rationale: "理由" }, at(0));
    for (const a of ["case_stalled", "negation_candidate", "national_missing", "app_only_confirmed", "watch_failing", "agent_run_failed", "mail_failing"] as const) {
      await enqueueReview(alert(a, "k"), at(0));
    }
    const { sent, deps } = harness(() => at(10));
    await notifyOperator(deps);
    expect(sent[0]!.subject).toBe("運営者の確認が 9 件あります");
    expect(findForbiddenPhrases(`${sent[0]!.subject}\n${sent[0]!.text}`)).toEqual([]);
  });
});
