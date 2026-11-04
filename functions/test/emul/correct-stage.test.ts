// correctCaseStage の中身（handleCorrectCaseStage）を、模擬環境の Firestore で確かめる（Q-n）。
// 既にある段階の日付を、運営者が理由つきで直す。claim、理由、未来の日付、順序の逆転、古い画面を拒む。直した記録が残る。
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import { diffCaseEvents } from "@hpai/shared/notices";
import { computeLiftEstimate } from "@hpai/shared/lift";
import type { CorrectStageRequest } from "@hpai/shared/read/review";
import type { Case } from "@hpai/shared/types";
import { db } from "../../src/admin";
import { handleCorrectCaseStage } from "../../src/review/correct";
import type { ResolveDeps } from "../../src/review/resolve";
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
});
beforeEach(async () => {
  deps = { db, geo, now: () => NOW };
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-hpai/databases/(default)/documents`, { method: "DELETE" });
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "ok";
}

// 疑い 12/18、確定 12/19、防疫措置の完了 12/21（津山市）
const CASE_ID = "33203-2025-12-18-1";
const seed = async (o: Partial<Case> = {}): Promise<Case> => {
  const c = realCase({
    id: CASE_ID,
    stages: {
      suspected: { date: "2025-12-18", time: "09:30" },
      confirmed: { date: "2025-12-19", time: null },
      control_done: { date: "2025-12-21", time: null },
    },
    ...o,
  });
  await db.doc(`cases/${c.id}`).set(c);
  return c;
};
const req = (o: Partial<CorrectStageRequest> = {}): CorrectStageRequest => ({
  caseId: CASE_ID,
  stage: "confirmed",
  expectedDate: "2025-12-19",
  newDate: "2025-12-20",
  reason: "県の発表を見直したら 12/20 でした",
  ...o,
});
const run = (r: unknown, caller: { uid: string; operator: boolean } | null = OP) => handleCorrectCaseStage(deps, caller, r);

describe("権限", () => {
  it("運営者でない人は拒否され、何も変わらない", async () => {
    const before = await seed();
    expect(await codeOf(run(req(), MEMBER))).toBe("permission-denied");
    expect(await codeOf(run(req(), null))).toBe("unauthenticated");
    expect(await getDoc(`cases/${CASE_ID}`)).toEqual(before);
    expect(await listIds("reviewQueue")).toEqual([]);
  });
});

describe("入力の検査", () => {
  it("理由がない（空、空白だけ、ない）と拒否する", async () => {
    const before = await seed();
    expect(await codeOf(run(req({ reason: "" })))).toBe("invalid-argument");
    expect(await codeOf(run(req({ reason: "   \n" })))).toBe("invalid-argument");
    expect(await codeOf(run({ ...req(), reason: undefined }))).toBe("invalid-argument");
    expect(await getDoc(`cases/${CASE_ID}`)).toEqual(before);
    expect(await listIds("reviewQueue")).toEqual([]);
  });
  it("理由が長すぎる、日付の形が違う、実在しない日、段階が違う、事例の指定が違う、を拒否する", async () => {
    await seed();
    expect(await codeOf(run(req({ reason: "あ".repeat(201) })))).toBe("invalid-argument");
    expect(await codeOf(run(req({ newDate: "2025/12/20" })))).toBe("invalid-argument");
    expect(await codeOf(run(req({ newDate: "2025-02-30" })))).toBe("invalid-argument");
    expect(await codeOf(run(req({ stage: "unknown" as never })))).toBe("invalid-argument");
    expect(await codeOf(run(req({ caseId: "a/b" })))).toBe("invalid-argument");
    expect(await codeOf(run(null))).toBe("invalid-argument");
  });
  it("未来の日付を拒否する（今日の 12/22 は許し、12/23 は拒む）", async () => {
    await seed();
    expect(await codeOf(run(req({ stage: "control_done", expectedDate: "2025-12-21", newDate: "2025-12-23" })))).toBe("invalid-argument");
    expect(await getDoc(`cases/${CASE_ID}`)).toMatchObject({ stages: { control_done: { date: "2025-12-21" } } });
    expect(await listIds("reviewQueue")).toEqual([]);
    expect(await codeOf(run(req({ stage: "control_done", expectedDate: "2025-12-21", newDate: "2025-12-22" })))).toBe("ok");
  });
  it("事例のシーズンの外（年の打ち間違い）を拒否する", async () => {
    await seed();
    expect(await codeOf(run(req({ newDate: "2024-12-20" })))).toBe("invalid-argument");
  });
  it("元の日付と同じなら拒否する", async () => {
    await seed();
    expect(await codeOf(run(req({ newDate: "2025-12-19" })))).toBe("invalid-argument");
    expect(await listIds("reviewQueue")).toEqual([]);
  });
});

describe("段階の順序", () => {
  it("疑いより前の確定、確定より後の疑い、防疫措置の完了より後の確定を拒否する", async () => {
    const before = await seed();
    // 確定を疑い（12/18）より前にする
    expect(await codeOf(run(req({ stage: "confirmed", newDate: "2025-12-17" })))).toBe("failed-precondition");
    // 疑いを確定（12/19）より後にする
    expect(await codeOf(run(req({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-20" })))).toBe("failed-precondition");
    // 確定を防疫措置の完了（12/21）より後にする
    expect(await codeOf(run(req({ stage: "confirmed", newDate: "2025-12-22" })))).toBe("failed-precondition");
    expect(await getDoc(`cases/${CASE_ID}`)).toEqual(before);
    expect(await listIds("reviewQueue")).toEqual([]);
  });
  it("前後の段階と同じ日までは許す（疑いと確定が同じ日）", async () => {
    await seed();
    expect(await codeOf(run(req({ stage: "confirmed", newDate: "2025-12-18" })))).toBe("ok");
  });
  it("搬出制限の解除と移動制限の解除は比べない", async () => {
    await seed({
      stages: {
        confirmed: { date: "2025-12-01", time: null },
        control_done: { date: "2025-12-05", time: null },
        shipment_lifted: { date: "2025-12-10", time: null },
        movement_lifted: { date: "2025-12-12", time: null },
      },
    });
    expect(await codeOf(run(req({ stage: "shipment_lifted", expectedDate: "2025-12-10", newDate: "2025-12-15" })))).toBe("ok");
  });
});

describe("事例の状態", () => {
  it("事例がない、段階がない、再現は拒否する", async () => {
    expect(await codeOf(run(req()))).toBe("not-found");
    await seed();
    expect(await codeOf(run(req({ stage: "movement_lifted", expectedDate: "2025-12-19", newDate: "2025-12-20" })))).toBe("failed-precondition");
    await seed({ confirmState: "replay" });
    expect(await codeOf(run(req()))).toBe("failed-precondition");
  });
  it("確認中の事例は、確認中という理由だけで拒否する（段階も日付の検査も通る形で置く）", async () => {
    const rev = realCase({ id: "rev-d1", confirmState: "reviewing", stages: { confirmed: { date: "2025-12-19", time: null } } });
    await db.doc("cases/rev-d1").set(rev);
    let err: { code?: string; message?: string } = {};
    try {
      await run(req({ caseId: "rev-d1" }));
    } catch (e) {
      err = e as { code?: string; message?: string };
    }
    expect(err.code).toBe("failed-precondition"); // 書き込みの検査（RangeError）ではなく、確認中の検査で拒む
    expect(err.message).toContain("確認中の事例と再現の事例は、日付を直せません");
    expect(await getDoc("cases/rev-d1")).toEqual(rev);
    expect(await listIds("reviewQueue")).toEqual([]);
  });
  it("文書の id に使えない事例の指定（. と .. と __x__）は、素の例外にならず invalid-argument", async () => {
    await seed();
    for (const caseId of [".", "..", "__x__"]) expect(await codeOf(run(req({ caseId })))).toBe("invalid-argument");
  });
  it("元の日付が、いまの事例と違えば（古い画面）拒否する", async () => {
    const before = await seed();
    expect(await codeOf(run(req({ expectedDate: "2025-12-18" })))).toBe("failed-precondition");
    expect(await getDoc(`cases/${CASE_ID}`)).toEqual(before);
  });
});

describe("直す", () => {
  it("日付だけ変わり、時刻、ほかの段階、番号、id はそのまま。印は operator になる", async () => {
    const before = await seed({ confirmState: "national", nationalNo: 7 });
    const res = await run(req({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-17" }));
    expect(res.caseId).toBe(CASE_ID);
    const after = (await getDoc(`cases/${CASE_ID}`)) as Case;
    expect(after.stages).toEqual({ ...before.stages, suspected: { date: "2025-12-17", time: "09:30" } });
    expect(after).toMatchObject({ id: CASE_ID, nationalNo: 7, muniCode: "33203", confirmState: "operator", updatedAt: NOW_JST });
    expect(await listIds("cases")).toEqual([CASE_ID]);
  });
  it("記録が残る: 元の値、新しい値、理由、運営者、時刻。未解決の箱には出ない", async () => {
    await seed({ confirmState: "auto" });
    const { recordId } = await run(req({ reason: "  県の発表を見直したら 12/20 でした  " }));
    expect(await listIds("reviewQueue")).toEqual([recordId]);
    const rec = await getDoc(`reviewQueue/${recordId}`);
    expect(rec).toEqual({
      id: recordId,
      kind: "stage_correction",
      createdAt: NOW_JST,
      resolvedAt: NOW_JST,
      resolvedBy: "op1",
      resolvedAction: "correct_stage_date",
      caseId: CASE_ID,
      stage: "confirmed",
      reason: "県の発表を見直したら 12/20 でした",
      resolution: {
        before: { date: "2025-12-19", time: null, confirmState: "auto" },
        after: { date: "2025-12-20", time: null, confirmState: "operator" },
      },
    });
    const open = await db.collection("reviewQueue").where("resolvedAt", "==", null).get();
    expect(open.size).toBe(0);
  });
  it("続けて 2 回直すと、記録が 2 つ残る。画面が古ければ 2 回目は拒む", async () => {
    await seed();
    await run(req({ newDate: "2025-12-20" }));
    expect(await codeOf(run(req({ newDate: "2025-12-20" })))).toBe("failed-precondition"); // 画面が古い（元は 12/19 のまま）
    deps = { ...deps, now: () => new Date(NOW.getTime() + 1000) };
    await run(req({ expectedDate: "2025-12-20", newDate: "2025-12-19" }));
    expect((await listIds("reviewQueue")).length).toBe(2);
  });
});

describe("声かけ文の下書き（日付を保存した文）", () => {
  const putDraft = () => db.doc(`caseDrafts/${CASE_ID}`).set({ caseId: CASE_ID, workerMessage: "12月19日に確定しました", source: "claude", createdAt: NOW_JST });
  it("下書きの日付になる段階（確定）を直すと、下書きが消える（のこりは cases の書き込みの後で作り直される）", async () => {
    await seed();
    await putDraft();
    await run(req({ stage: "confirmed", newDate: "2025-12-20" }));
    expect(await getDoc(`caseDrafts/${CASE_ID}`)).toBeUndefined();
  });
  it("確定がなく疑いだけの事例は、疑いを直すと下書きが消える", async () => {
    await seed({ stages: { suspected: { date: "2025-12-18", time: null } } });
    await putDraft();
    await run(req({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-17" }));
    expect(await getDoc(`caseDrafts/${CASE_ID}`)).toBeUndefined();
  });
  it("下書きの日付に関わらない段階（確定があるときの疑い、防疫措置の完了）を直すときは、消さない", async () => {
    await seed();
    await putDraft();
    await run(req({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-17" }));
    await run(req({ stage: "control_done", expectedDate: "2025-12-21", newDate: "2025-12-22" }));
    expect(await getDoc(`caseDrafts/${CASE_ID}`)).toMatchObject({ workerMessage: "12月19日に確定しました" });
  });
  it("拒否された訂正では消さない", async () => {
    await seed();
    await putDraft();
    await codeOf(run(req({ newDate: "2025-12-17" }))); // 疑いより前の確定
    expect(await getDoc(`caseDrafts/${CASE_ID}`)).toBeDefined();
  });
});

describe("知らせと解除の見込み", () => {
  it("段階が増えないので、事例の出来事は出ない（メールは送られない）", async () => {
    const before = await seed({ confirmState: "auto" });
    await run(req({ stage: "suspected", expectedDate: "2025-12-18", newDate: "2025-12-17" }));
    await run(req({ stage: "confirmed", newDate: "2025-12-20" }));
    const after = (await getDoc(`cases/${CASE_ID}`)) as Case;
    expect(diffCaseEvents(before, after)).toEqual([]);
  });
  it("防疫措置の完了日を直すと、解除の見込みが計算し直される", async () => {
    const before = await seed({ stages: { confirmed: { date: "2025-12-10", time: null }, control_done: { date: "2025-12-20", time: null } } });
    const est0 = computeLiftEstimate(before, [before], geo);
    await run(req({ stage: "control_done", expectedDate: "2025-12-20", newDate: "2025-12-15" }));
    const after = (await getDoc(`cases/${CASE_ID}`)) as Case;
    const est1 = computeLiftEstimate(after, [after], geo);
    expect(est0.basisControlDone).toBe("2025-12-20");
    expect(est1.basisControlDone).toBe("2025-12-15");
    expect(est1.movement).not.toBe(est0.movement);
  });
});
