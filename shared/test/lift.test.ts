import { describe, expect, it } from "vitest";
import { MOVEMENT_DAYS, SURVEILLANCE_DAYS, computeLiftEstimate, liftDate } from "../src/lift";
import type { Case } from "../src/types";
import { makeGeo } from "./fixtures/geo";

const geo = makeGeo([
  { code: "33203", name: "津山市", neighbors: ["33204"] },
  { code: "33204", name: "玉野市" },
  { code: "33999", name: "遠い町" },
]);

function mkCase(o: Partial<Case> & { id: string }): Case {
  return {
    season: 2025,
    nationalNo: null,
    prefNo: null,
    prefCode: "33",
    muniCode: "33203",
    muniName: "津山市",
    birdUse: null,
    housing: null,
    headCount: null,
    stages: { confirmed: { date: "2025-12-20", time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: ["https://example.invalid/a"],
    updatedAt: "2025-12-20T12:00:00+09:00",
    ...o,
  };
}
const done = (date: string) => ({ confirmed: { date: "2025-12-20", time: null }, control_done: { date, time: null } });

describe("liftDate", () => {
  it("完了の次の日から数える（日数 + 1）", () => {
    expect(MOVEMENT_DAYS).toBe(21);
    expect(SURVEILLANCE_DAYS).toBe(28);
    expect(liftDate("2025-12-30", 21)).toBe("2026-01-21");
    expect(liftDate("2025-12-21", 21)).toBe("2026-01-12");
    expect(liftDate("2026-01-11", 21)).toBe("2026-02-02");
    expect(liftDate("2025-12-30", 28)).toBe("2026-01-28");
  });
});

describe("computeLiftEstimate", () => {
  it("防疫措置の完了前は未定。搬出の文は『検査の結果を受けて県が解除します』", () => {
    const a = mkCase({ id: "a" });
    expect(computeLiftEstimate(a, [a], geo)).toEqual({
      status: "undetermined",
      movement: null,
      surveillance: null,
      basisControlDone: null,
      extendedByChain: false,
      shipmentText: "検査の結果を受けて県が解除します",
    });
  });

  it("完了 12/30 なら移動制限 1/21、監視強化 1/28（見込み）", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-30") });
    expect(computeLiftEstimate(a, [a], geo)).toEqual({
      status: "calculated",
      movement: "2026-01-21",
      surveillance: "2026-01-28",
      basisControlDone: "2025-12-30",
      extendedByChain: false,
      shipmentText: "検査の結果を受けて県が解除します",
    });
  });

  it("隣の町の事例（B 12/30）が遅いと A（12/21）も 1/21、1/28 になり、続発で延びうると出す", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-21") });
    const b = mkCase({ id: "b", muniCode: "33204", muniName: "玉野市", stages: done("2025-12-30") });
    const est = computeLiftEstimate(a, [a, b], geo);
    expect(est).toMatchObject({ status: "calculated", movement: "2026-01-21", surveillance: "2026-01-28", basisControlDone: "2025-12-30", extendedByChain: true });
    // B から見ても同じ（全発生農場が基準）
    expect(computeLiftEstimate(b, [a, b], geo).movement).toBe("2026-01-21");
  });

  it("同じ町の別の事例も連鎖に入る", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-21") });
    const a2 = mkCase({ id: "a2", stages: done("2025-12-25") });
    expect(computeLiftEstimate(a, [a, a2], geo)).toMatchObject({ movement: "2026-01-16", extendedByChain: true });
  });

  it("隣に防疫措置の完了がなければ未定。続発の注意は出す", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-21") });
    const b = mkCase({ id: "b", muniCode: "33204", muniName: "玉野市" });
    expect(computeLiftEstimate(a, [a, b], geo)).toMatchObject({
      status: "undetermined",
      movement: null,
      surveillance: null,
      basisControlDone: null,
      extendedByChain: true,
    });
  });

  it("遠い町、否定された事例、確認中、解除済み、別シーズンの隣は見ない", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-21") });
    const others = [
      mkCase({ id: "far", muniCode: "33999", stages: done("2026-01-05") }),
      mkCase({ id: "neg", muniCode: "33204", negation: "negated", stages: done("2026-01-05") }),
      mkCase({ id: "rev", muniCode: "33204", confirmState: "reviewing", stages: done("2026-01-05") }),
      mkCase({ id: "lifted", muniCode: "33204", stages: { ...done("2026-01-05"), movement_lifted: { date: "2026-01-20", time: null } } }),
      mkCase({ id: "old", muniCode: "33204", season: 2024, stages: done("2026-01-05") }),
      mkCase({ id: "nomuni", muniCode: null, muniName: null, stages: done("2026-01-05") }),
    ];
    expect(computeLiftEstimate(a, [a, ...others], geo)).toMatchObject({
      status: "calculated",
      movement: "2026-01-12",
      basisControlDone: "2025-12-21",
      extendedByChain: false,
    });
  });

  it("否定の候補（candidate）は数える側に倒す（疑いの隣が続いていれば延びうる）", () => {
    const a = mkCase({ id: "a", stages: done("2025-12-21") });
    const b = mkCase({ id: "b", muniCode: "33204", negation: "candidate", stages: done("2025-12-30") });
    expect(computeLiftEstimate(a, [a, b], geo)).toMatchObject({ movement: "2026-01-21", extendedByChain: true });
  });

  it("県が移動制限の見込みを発表していれば、そのまま示す（published）。監視強化は計算", () => {
    const a = mkCase({
      id: "a",
      stages: done("2025-12-21"),
      prefEstimates: { shipment: null, movement: "2026-01-15", surveillance: null },
    });
    expect(computeLiftEstimate(a, [a], geo)).toMatchObject({
      status: "published",
      movement: "2026-01-15",
      surveillance: "2026-01-19",
      basisControlDone: "2025-12-21", // 監視強化は完了日から計算した
      extendedByChain: false,
    });
  });

  it("県の発表があっても防疫措置の完了がなければ監視強化は null。県が監視強化も発表していればそれを優先する", () => {
    const only = mkCase({ id: "a", prefEstimates: { shipment: null, movement: "2026-01-15", surveillance: null } });
    expect(computeLiftEstimate(only, [only], geo)).toMatchObject({ status: "published", movement: "2026-01-15", surveillance: null, basisControlDone: null });
    const both = mkCase({ id: "b", stages: done("2025-12-21"), prefEstimates: { shipment: null, movement: "2026-01-15", surveillance: "2026-01-20" } });
    expect(computeLiftEstimate(both, [both], geo)).toMatchObject({ surveillance: "2026-01-20", basisControlDone: null });
  });

  it("移動制限が解除された事例は lifted。見込みの日付は出さず、搬出の文は『解除されました』", () => {
    const a = mkCase({ id: "a", stages: { ...done("2025-12-21"), shipment_lifted: { date: "2026-01-05", time: null }, movement_lifted: { date: "2026-01-12", time: null } } });
    expect(computeLiftEstimate(a, [a], geo)).toEqual({
      status: "lifted",
      movement: null,
      surveillance: null,
      basisControlDone: null,
      extendedByChain: false,
      shipmentText: "搬出制限は解除されました",
    });
  });

  it("搬出制限だけ解除された段階では、移動制限は計算のまま。搬出の文だけ変わる", () => {
    const a = mkCase({ id: "a", stages: { ...done("2025-12-21"), shipment_lifted: { date: "2026-01-05", time: null } } });
    expect(computeLiftEstimate(a, [a], geo)).toMatchObject({ status: "calculated", movement: "2026-01-12", shipmentText: "搬出制限は解除されました" });
  });
});
