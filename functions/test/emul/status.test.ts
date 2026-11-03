// 見回りの結果の記録（確認状況 47 件、運営者の箱）を、模擬環境の Firestore で確かめる（I-02）。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { summarizeWatch } from "@hpai/shared/level";
import type { ReviewItem } from "@hpai/shared/read/types";
import type { Source, WatchStatus } from "@hpai/shared/types";
import { bucket, db } from "../../src/admin";
import type { MissingNote, ReviewNote } from "../../src/watch/deps";
import { checkPrefPage } from "../../src/watch/page";
import { recordTick } from "../../src/watch/record";
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
    expect((await queue()).filter((q) => q.kind === "alert" && q.alert === "watch_failing")).toHaveLength(2);
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
