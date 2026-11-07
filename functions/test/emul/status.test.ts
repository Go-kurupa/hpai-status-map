// 見回りの結果の記録（確認状況 47 件、運営者の箱）を、模擬環境の Firestore で確かめる（I-02）。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { summarizeWatch } from "@hpai/shared/level";
import type { ReviewItem } from "@hpai/shared/read/types";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { bucket, db } from "../../src/admin";
import type { MissingNote, ReviewNote } from "../../src/watch/deps";
import { checkPrefPage } from "../../src/watch/page";
import { enqueueReview, reviewAlertId } from "../../src/review/queue";
import { notifyOperator } from "../../src/review/notifyOperator";
import { closeIfOpen, recordTick } from "../../src/watch/record";
import { stalledWatchItem } from "../../src/watch/reconcile";
import { runWatch } from "../../src/watch/run";
import { firestoreIo } from "../../src/watch/tick";
import { BASE, fake, html, ok, prefSource } from "../helpers/prefWatch";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

const T0 = new Date("2026-11-05T03:00:00Z"); // JST 12:00 → group 0
const at = (hoursAfter: number, minutes = 0) => new Date(T0.getTime() + hoursAfter * 3_600_000 + minutes * 60_000);
const seed = async (...sources: Source[]) => {
  for (const s of sources) await db.doc(`sources/${s.id}`).set(s);
};
const status = async (code: string) => (await db.doc(`watchStatus/${code}`).get()).data() as WatchStatus;
const queue = async () => (await db.collection("reviewQueue").get()).docs.map((d) => d.data() as ReviewItem);
const checked = (o: Partial<Source> = {}) => prefSource({ lastCheckedAt: "2026-11-05T11:30:00+09:00", lastOkAt: "2026-11-05T11:30:00+09:00", ...o });

describe("recordTick: 確認状況", () => {
  it("見回りのたびに 47 件書く。全入口が成功の県は ok、失敗がある県は ok:false", async () => {
    await seed(checked({ id: "a", prefCode: "33" }), checked({ id: "b", prefCode: "34", failureCount: 2 }));
    await recordTick({ reviews: [], missing: [] }, T0);
    expect((await db.collection("watchStatus").get()).size).toBe(47);
    expect(await status("33")).toMatchObject({ prefCode: "33", ok: true, failingSince: null });
    expect(await status("34")).toMatchObject({ ok: false, failingSince: "2026-11-05T12:00:00+09:00" });
    expect(await status("01")).toMatchObject({ ok: false, checkedAt: null }); // 有効な入口がない県
    await recordTick({ reviews: [], missing: [] }, at(1));
    expect((await db.collection("watchStatus").get()).size).toBe(47);
    expect((await status("34")).failingSince).toBe("2026-11-05T12:00:00+09:00"); // 最初の時刻を保つ
  });
  it("未来の時刻の入口は確認済みに数えず、壊れた時刻も書かない", async () => {
    await seed(checked({ id: "a", prefCode: "33", lastCheckedAt: "2026-11-06T11:30:00+09:00" }));
    await recordTick({ reviews: [], missing: [] }, T0);
    const s = await status("33");
    expect(s.ok).toBe(false);
    expect(s.checkedAt === null || Date.parse(s.checkedAt) <= T0.getTime()).toBe(true);
  });
  it("失敗が 23 時間 59 分では watch_failing を入れず、24 時間で 1 件だけ入れる。何度見回っても 1 件", async () => {
    await seed(checked({ id: "a", prefCode: "34", failureCount: 3 }));
    await recordTick({ reviews: [], missing: [] }, T0);
    await recordTick({ reviews: [], missing: [] }, at(23, 59));
    expect(await queue()).toEqual([]);
    await recordTick({ reviews: [], missing: [] }, at(24));
    await recordTick({ reviews: [], missing: [] }, at(25));
    await recordTick({ reviews: [], missing: [] }, at(30));
    const items = await queue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "alert", alert: "watch_failing", prefCode: "34", resolvedAt: null });
  });
  it("直ってまた失敗した別の期間は、新しい 1 件になる", async () => {
    await seed(checked({ id: "a", prefCode: "34", failureCount: 3 }));
    await recordTick({ reviews: [], missing: [] }, T0);
    await recordTick({ reviews: [], missing: [] }, at(25));
    await db.doc("sources/a").update({ failureCount: 0, lastCheckedAt: "2026-11-06T13:00:00+09:00" });
    await recordTick({ reviews: [], missing: [] }, at(26));
    expect((await status("34")).failingSince).toBeNull();
    await db.doc("sources/a").update({ failureCount: 1 });
    await recordTick({ reviews: [], missing: [] }, at(27));
    await recordTick({ reviews: [], missing: [] }, at(27 + 24));
    const items = (await queue()).filter((q) => q.kind === "alert" && q.alert === "watch_failing");
    expect(items).toHaveLength(2);
    // 1 件目は直ったときに自動で閉じ、新しい失敗の 2 件目は開いている（閉じた後の失敗を取りこぼさない）
    expect(items.filter((q) => q.resolvedAt !== null)).toMatchObject([{ resolvedAction: "auto_recovered" }]);
    expect(items.filter((q) => q.resolvedAt === null)).toHaveLength(1);
  });
});

describe("recordTick: 直った県の見回りの失敗の知らせを自動で閉じる", () => {
  const failing = async () => (await queue()).filter((q) => q.kind === "alert" && q.alert === "watch_failing");
  /** 34 を 24 時間失敗させて知らせを 1 件入れ、33 は失敗のまま。 */
  const failBoth = async () => {
    await seed(checked({ id: "a", prefCode: "34", failureCount: 3 }), checked({ id: "b", prefCode: "33", failureCount: 3 }));
    await recordTick({ reviews: [], missing: [] }, T0);
    await recordTick({ reviews: [], missing: [] }, at(25));
    expect((await failing()).filter((q) => q.resolvedAt === null)).toHaveLength(2);
  };
  const recover34 = () => db.doc("sources/a").update({ failureCount: 0, lastCheckedAt: "2026-11-06T13:30:00+09:00" });

  it("ok に戻った県の知らせは閉じ（記録は残す）、失敗中の県の知らせは残す", async () => {
    await failBoth();
    await recover34();
    await recordTick({ reviews: [], missing: [] }, at(26));
    const items = await failing();
    expect(items).toHaveLength(2); // 消さない
    expect(items.find((q) => q.prefCode === "34")).toMatchObject({ resolvedAt: "2026-11-06T14:00:00+09:00", resolvedBy: "system", resolvedAction: "auto_recovered" });
    expect(items.find((q) => q.prefCode === "33")).toMatchObject({ resolvedAt: null });
    expect(items.find((q) => q.prefCode === "33")).not.toHaveProperty("resolvedBy");
  });
  it("運営者のまとめのメールは、閉じた知らせを数えない", async () => {
    await failBoth();
    await recover34();
    await recordTick({ reviews: [], missing: [] }, at(26));
    const sent: string[] = [];
    const r = await notifyOperator({ send: async (_to, m) => void sent.push(m.text), to: "op@example.jp", appUrl: "http://127.0.0.1", now: () => at(26) });
    expect(r).toEqual({ sent: true, count: 1 });
    expect(sent[0]).toContain("見回りが止まっている県: 1 件");
  });
  it("運営者がすでに閉じた知らせは書き換えない", async () => {
    await failBoth();
    const id = (await failing()).find((q) => q.prefCode === "34")!.id;
    await db.doc(`reviewQueue/${id}`).update({ resolvedAt: "2026-11-06T13:10:00+09:00", resolvedBy: "operator-uid", resolvedAction: "dismiss_alert" });
    await recover34();
    await recordTick({ reviews: [], missing: [] }, at(26));
    expect((await db.doc(`reviewQueue/${id}`).get()).data()).toMatchObject({ resolvedAt: "2026-11-06T13:10:00+09:00", resolvedBy: "operator-uid", resolvedAction: "dismiss_alert" });
  });
  it("見回り全体の停止の知らせ（突き合わせが入れる、記録なしの id も）も、ok に戻れば閉じる", async () => {
    await seed(checked({ id: "a", prefCode: "34", lastCheckedAt: "2026-11-05T11:30:00+09:00" }));
    const none = stalledWatchItem({ prefCode: "34", ok: false, checkedAt: null, lastOkAt: null, failingSince: null }, T0);
    expect(none.id).toBe(reviewAlertId("watch_failing", "34-none"));
    await enqueueReview(none, T0);
    await recordTick({ reviews: [], missing: [] }, T0);
    expect((await db.doc(`reviewQueue/${none.id}`).get()).data()).toMatchObject({ resolvedBy: "system", resolvedAction: "auto_recovered" });
  });
  it("突き合わせが確認の時刻から作った id の知らせも、ok に戻れば閉じる", async () => {
    await seed(checked({ id: "a", prefCode: "34" }));
    const item = stalledWatchItem({ prefCode: "34", ok: true, checkedAt: "2026-11-04T09:00:00+09:00", lastOkAt: "2026-11-04T09:00:00+09:00", failingSince: null }, T0);
    expect(item.id).not.toBe(reviewAlertId("watch_failing", "34-none"));
    await enqueueReview(item, T0);
    await recordTick({ reviews: [], missing: [] }, T0);
    expect((await db.doc(`reviewQueue/${item.id}`).get()).data()).toMatchObject({ resolvedBy: "system", resolvedAction: "auto_recovered" });
  });
  it("読んだ後に運営者が閉じていた項目は、取引の中で確かめて書き換えない", async () => {
    const item = stalledWatchItem({ prefCode: "34", ok: false, checkedAt: null, lastOkAt: null, failingSince: null }, T0);
    await enqueueReview(item, T0);
    const ref = db.doc(`reviewQueue/${item.id}`);
    await ref.update({ resolvedAt: "2026-11-05T12:10:00+09:00", resolvedBy: "operator-uid", resolvedAction: "dismiss_alert" });
    expect(await closeIfOpen(ref, T0)).toBe(false);
    expect((await ref.get()).data()).toMatchObject({ resolvedBy: "operator-uid", resolvedAction: "dismiss_alert" });
    expect(await closeIfOpen(db.doc("reviewQueue/alert-watch_failing-none-missing"), T0)).toBe(false); // 消えた項目は作らない
    expect((await db.doc("reviewQueue/alert-watch_failing-none-missing").get()).exists).toBe(false);
  });
  it("ok でも確認が 24 時間より古い県の知らせ、ほかの種類の知らせ、文書の項目は閉じない", async () => {
    await seed(checked({ id: "a", prefCode: "34", lastCheckedAt: "2026-11-04T11:00:00+09:00" }));
    const stale = stalledWatchItem({ prefCode: "34", ok: true, checkedAt: "2026-11-04T11:00:00+09:00", lastOkAt: "2026-11-04T11:00:00+09:00", failingSince: null }, T0);
    await enqueueReview(stale, T0);
    await seed(checked({ id: "b", prefCode: "33" }));
    await enqueueReview({ id: reviewAlertId("case_stalled", "c1"), kind: "alert", alert: "case_stalled", prefCode: "33", caseId: "c1", message: "続報なし" }, T0);
    await recordTick({ reviews: [{ documentId: "d1", url: "https://example.jp/d1", prefCode: "33", title: "お知らせ", reason: "ambiguous_case" } as ReviewNote], missing: [] }, T0);
    expect((await queue()).every((q) => q.resolvedAt === null)).toBe(true);
  });
});

describe("recordTick: 運営者の箱", () => {
  it("I-01 の review（ambiguous_case、muni_not_found など）を文書の項目 doc-<id> として入れる。二重には入れない", async () => {
    const notes: ReviewNote[] = [
      { url: "https://www.maff.go.jp/j/press/a.html", title: "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）について", prefCode: "33", reason: "ambiguous_case", documentId: "d1" },
      { url: "https://www.maff.go.jp/j/press/b.html", title: "北海道における高病原性鳥インフルエンザの疑似患畜の確認について", prefCode: "01", reason: "muni_not_found", documentId: "d2" },
    ];
    await recordTick({ reviews: notes, missing: [] }, T0);
    await recordTick({ reviews: notes, missing: [] }, at(1));
    const items = (await queue()).filter((q) => q.kind === "document");
    expect(items.map((q) => q.id).sort()).toEqual(["doc-d1", "doc-d2"]);
    expect(items.find((q) => q.id === "doc-d1")).toMatchObject({ kind: "document", documentId: "d1", prefCode: "33", reasons: ["ambiguous_case"], hasOutbreakWords: true, resolvedAt: null });
  });
  it("解除の missing は national_missing として入れる", async () => {
    const m: MissingNote = { url: "https://www.maff.go.jp/j/press/l.html", prefCode: "33", muniName: "津山市", nationalNos: [8], date: "2026-01-21" };
    await recordTick({ reviews: [], missing: [m] }, T0);
    await recordTick({ reviews: [], missing: [m] }, at(1));
    const items = await queue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "alert", alert: "national_missing", prefCode: "33", caseId: null });
    expect(items[0]!.id).not.toContain("/");
  });
});

describe("runWatch: 見回りの結果が捨てられない", () => {
  const URL1 = `${BASE}/page/816850.html`;

  it("TLS の失敗の入口の県は watchStatus.ok が false で、summarizeWatch の failedPrefCodes に入る（回避しない）", async () => {
    await seed(prefSource({ id: "tls", prefCode: "33", url: URL1, group: 0 }), prefSource({ id: "fine", prefCode: "34", url: `${BASE}/page/2.html`, group: 0 }));
    const { deps } = fake({
      [URL1]: { kind: "network_error", message: "EPROTO", code: "EPROTO", tls: true },
      [`${BASE}/page/2.html`]: ok(html("高病原性鳥インフルエンザ", ["本文"]), `${BASE}/page/2.html`),
    });
    const report = await runWatch(deps, firestoreIo(), { pref_fixed: checkPrefPage });
    expect(report.checked.map((c) => [c.id, c.ok]).sort()).toEqual([["fine", true], ["tls", false]]);
    expect(await status("33")).toMatchObject({ ok: false });
    expect(await status("34")).toMatchObject({ ok: true });
    const all = (await db.collection("watchStatus").get()).docs.map((d) => d.data() as WatchStatus);
    expect(summarizeWatch(all, T0).failedPrefCodes).toContain("33");
    expect(summarizeWatch(all, T0).failedPrefCodes).not.toContain("34");
  });
  it("tick の reviews と missing が箱に入る", async () => {
    const note: ReviewNote = { url: "https://www.maff.go.jp/j/press/a.html", title: "題", prefCode: null, reason: "unreadable", documentId: "dX" };
    const { deps } = fake();
    await runWatch(deps, firestoreIo(), {});
    expect(await queue()).toEqual([]);
    const handler = async (_s: Source, _d: unknown, sink: { reviews: ReviewNote[] }) => {
      sink.reviews.push(note);
      return { ok: true, etag: null, lastModified: null, fingerprint: null };
    };
    await seed(prefSource({ id: "x", prefCode: "33", url: URL1, group: 0 }));
    await runWatch(deps, firestoreIo(), { pref_fixed: handler });
    expect((await queue()).map((q) => q.id)).toEqual(["doc-dX"]);
  });
  it("見回りが途中で throw しても、それまでの reviews と missing は箱に入り、確認状況も書かれ、元の例外が投げ直される", async () => {
    const note: ReviewNote = { url: "https://www.maff.go.jp/j/press/a.html", title: "題", prefCode: null, reason: "unreadable", documentId: "dX" };
    const miss: MissingNote = { url: "https://www.maff.go.jp/j/press/b.html", prefCode: "33", muniName: "岡山県津山市", nationalNos: [3], date: "2026-11-05" };
    const { deps } = fake();
    await seed(prefSource({ id: "a", prefCode: "33", url: URL1, group: 0 }), prefSource({ id: "b", prefCode: "34", url: `${BASE}/page/2.html`, group: 0 }), prefSource({ id: "c", prefCode: "35", url: `${BASE}/page/3.html`, group: 0 }));
    const boom = new Error("sources の更新に失敗");
    const real = firestoreIo();
    const io = { ...real, updateSource: async (id: string, patch: Partial<Source>) => (id === "b" ? Promise.reject(boom) : real.updateSource(id, patch)) };
    const handler = async (s: Source, _d: unknown, sink: { reviews: ReviewNote[]; missing: MissingNote[] }) => {
      if (s.id === "a") sink.reviews.push(note);
      if (s.id === "b") sink.missing.push(miss);
      return { ok: true, etag: null, lastModified: null, fingerprint: null };
    };
    await expect(runWatch(deps, io, { pref_fixed: handler })).rejects.toBe(boom);
    expect((await queue()).map((q) => q.id).sort()).toEqual(["alert-national_missing-33-3-2026-11-05", "doc-dX"]);
    expect((await db.collection("watchStatus").get()).size).toBe(47);
  });
});
