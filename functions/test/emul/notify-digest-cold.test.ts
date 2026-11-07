// M-13: 冷えた状態（契約 3.2）。loadGeoStore の未読み込みから、県をまたぐ事例の queued が例外なく送られる。
// loadGeoStore は読んだ県を使い回すので、このファイルだけで冷えた状態を保つ（他の試験と混ぜない）。
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GeoNotLoadedError } from "@hpai/shared/geo";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { jstDateOf } from "@hpai/shared/dates";
import type { Case } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { loadGeoStore } from "../../src/geo/loadGeo";
import { runMorningDigest } from "../../src/notify/digest";
import { createRebuildContext, loadSubjects, rebuildNotice } from "../../src/notify/rebuild";
import { caseFixture } from "../../../shared/test/helpers/mFixtures";
import { assertEmulator, clearFirestore, makeDeps, NOW, seedFarm, sentNoticeDocs } from "./mHelpers";

const GEO_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "data", "geo");

beforeAll(assertEmulator);
beforeEach(clearFirestore);

describe("冷えた状態から、県をまたぐ事例を朝に送る", () => {
  it("津山市の center のメッシュの農場と、鳥取市（31201）の確定の queued: 例外なく送られ、level:2、adjacent", async () => {
    const geo = await loadGeoStore(GEO_DIR);
    expect(() => geo.geometry("31201")).toThrow(GeoNotLoadedError); // 本当に冷えている
    expect(() => geo.geometry("33203")).toThrow(GeoNotLoadedError);

    const [lng, lat] = geo.index["33203"]!.center;
    const c: Case = caseFixture({
      id: "tottori-1",
      prefCode: "31",
      muniCode: "31201",
      muniName: "鳥取市",
      stages: { confirmed: { date: "2026-11-05", time: null } },
    });
    const { id, ...rest } = c;
    await db.collection("cases").doc(id).set(rest);
    await seedFarm("tsuyama", "u1", { meshCode: latLngToMesh3(lat, lng), muniCode: "33203", prefCode: "33" });
    const key = `tsuyama__u1__${id}__confirmed`;
    await db.doc(`sentNotices/${key}`).set({ farmId: "tsuyama", uid: "u1", subjectId: id, event: "confirmed", timing: "morning", state: "queued", queuedAt: "2026-11-05T01:00:00+09:00", sentAt: null });

    // 組み立て直しの結果（段階と関係）
    const ctx = createRebuildContext(db, geo, jstDateOf(NOW));
    const rec = { ref: db.doc(`sentNotices/${key}`), id: key, data: (await db.doc(`sentNotices/${key}`).get()).data() as never };
    await loadSubjects(ctx, [rec]);
    const rebuilt = await rebuildNotice(ctx, rec);
    expect(rebuilt.kind).toBe("send");
    if (rebuilt.kind === "send") expect(rebuilt.notice).toMatchObject({ level: 2, relationKind: "adjacent", event: "confirmed" });

    // 実際の送信
    const { deps, mail } = makeDeps();
    await runMorningDigest(deps, geo);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.text).toContain("隣の町で発生しました");
    expect((await sentNoticeDocs())[key]).toMatchObject({ state: "sent" });
  });
});
