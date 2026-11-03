// 文書の発表日（announcedOn）を、取得して残すときに取り出して保存することを確かめる（I-18 の修正）。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentRecord } from "@hpai/shared/read/types";
import type { Source } from "@hpai/shared/types";
import { bucket, db } from "../../src/admin";
import { storeDocument, type StoreDocumentInput } from "../../src/watch/store";

const PROJECT = "demo-hpai";
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("模擬環境の外です。npm run test:emul で実行してください");
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await bucket().deleteFiles({ force: true });
});

const source = (kind: Source["kind"]): Source => ({ id: "s", prefCode: kind.startsWith("pref_") ? "33" : null, url: "https://www.pref.okayama.jp/a", kind, confirmedOn: "2026-11-03", note: null, group: 0, enabled: true, lastCheckedAt: null, lastOkAt: null, etag: null, lastModified: null, fingerprint: null, failureCount: 0 });

function input(o: Partial<StoreDocumentInput> & { text: string; srcKind?: Source["kind"] }): StoreDocumentInput {
  return {
    url: `https://www.pref.okayama.jp/${Math.random().toString(36).slice(2)}`,
    title: "題",
    contentType: "html",
    body: Buffer.from(o.text),
    fingerprint: "a".repeat(64),
    textForRead: o.text,
    hasTextLayer: true,
    prefCode: "33",
    fetchedAt: "2025-12-22T12:00:00+09:00",
    readState: "pending",
    ...o,
    source: source(o.srcKind ?? "pref_fixed"),
  };
}
const read = async (id: string) => (await db.doc(`documents/${id}`).get()).data() as DocumentRecord;

describe("storeDocument: announcedOn", () => {
  it("本文のラベルつきの日付から取り出して保存する", async () => {
    const { id } = await storeDocument(input({ text: "掲載日：令和7年12月20日\n本日、津山市の農場で" }));
    expect((await read(id)).announcedOn).toBe("2025-12-20");
  });
  it("取り出せなければ null（確認中に倒れる今までの動き）", async () => {
    const { id } = await storeDocument(input({ text: "本日、津山市の農場で疑似患畜を確認しました" }));
    expect((await read(id)).announcedOn).toBeNull();
  });
  it("呼び手が渡した発表日（RSS の日付）は、本文にラベルつきの日付がなければ使う。同じ日付ならそのまま", async () => {
    const a = await storeDocument(input({ text: "本日、津山市の農場で", announcedOn: "2025-12-21" }));
    expect((await read(a.id)).announcedOn).toBe("2025-12-21");
    const b = await storeDocument(input({ text: "掲載日：令和7年12月20日", announcedOn: "2025-12-20", fingerprint: "b".repeat(64) }));
    expect((await read(b.id)).announcedOn).toBe("2025-12-20");
  });
  it("渡された日付と本文のラベルつきの日付が食い違えば null（確認中に倒す）", async () => {
    const { id } = await storeDocument(input({ text: "掲載日：令和7年12月20日", announcedOn: "2025-12-21" }));
    expect((await read(id)).announcedOn).toBeNull();
  });
  it("本文に公開日と別の更新日が併記されていれば、公開日を採る。更新日だけなら null", async () => {
    const a = await storeDocument(input({ text: "公開日：令和7年12月20日\n最終更新日：令和7年12月22日" }));
    expect((await read(a.id)).announcedOn).toBe("2025-12-20");
    const b = await storeDocument(input({ text: "最終更新日：令和7年12月20日", fingerprint: "b".repeat(64) }));
    expect((await read(b.id)).announcedOn).toBeNull();
  });
  it("取得の日より後の発表日は信用せず null", async () => {
    const { id } = await storeDocument(input({ text: "掲載日：令和7年12月25日" }));
    expect((await read(id)).announcedOn).toBeNull();
    const b = await storeDocument(input({ text: "x", announcedOn: "2025-12-25", fingerprint: "b".repeat(64) }));
    expect((await read(b.id)).announcedOn).toBeNull();
  });
  it("国の報道発表は見出しの日付を取る", async () => {
    const { id } = await storeDocument(input({ srcKind: "maff_press", prefCode: null, text: "題\n令和7年12月20日\n農林水産省\n本日、岡山県津山市の" }));
    expect((await read(id)).announcedOn).toBe("2025-12-20");
  });
});
