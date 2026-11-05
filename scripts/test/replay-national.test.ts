// 全国の流れのシナリオ（shared/src/replay.ts の nationalFlowScenario）の検査。公開してよい data/ だけを読む。
import { createGeoStore, distanceToMuniKm } from "@hpai/shared/geo";
import { DISTANCE_BAND_KM, prefsToLoad, relationToCase } from "@hpai/shared/level";
import { casesAt, eventStage, nationalFlowScenario, replayNowAt, watchAt, type ReplayScenario } from "@hpai/shared/replay";
import type { HistoryCase } from "@hpai/shared/types";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const base = read("data/replay/scenario.json") as ReplayScenario;
const history = read("data/history/cases.json") as HistoryCase[];
const flow = nationalFlowScenario(history, base);

describe("全国の流れのシナリオ", () => {
  it("2025 シーズンの関連農場を除く 24 件を、日付の昇順に 1 からの連番で並べる", () => {
    expect(flow.events).toHaveLength(24);
    expect(flow.events.map((e) => e.order)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const dates = flow.events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(flow.events.map((e) => e.caseAfter.id)).size).toBe(24);
    const expected = history.filter((h) => h.season === 2025 && !h.related);
    expect(flow.events.map((e) => e.caseAfter.nationalNo).sort((a, b) => a! - b!)).toEqual(expected.map((h) => h.no).sort((a, b) => a - b));
  });

  it("時刻と下書きは null。事例は再現の印を持ち、段階は確定だけ。半径を作らない", () => {
    for (const e of flow.events) {
      expect(e.time).toBeNull();
      expect(e.noticePreview).toBeNull();
      expect(e.backstageId).toBeNull();
      expect(e.caseAfter.confirmState).toBe("replay");
      expect(e.caseAfter.radiiKm).toEqual([]);
      expect(eventStage(e)).toBe("confirmed");
      expect(new URL(e.sourceUrl).protocol).toBe("https:");
      expect(e.caseAfter.sourceUrls).toEqual([e.sourceUrl]);
    }
  });

  it("仮の地点と見回りの例は 4 事例と同じものを使う。作っていない野鳥は入れない", () => {
    expect(flow.id).not.toBe(base.id);
    expect(flow.defaultSpot).toEqual(base.defaultSpot);
    expect(flow.watchStatus).toEqual(base.watchStatus);
    expect(flow.wildBirds).toEqual([]);
    expect(flow.title).toContain("24 件");
  });

  it("事例は進めるほど増え、時計はその日の終わり。はじまりは最初の発生の前の日で、どの時点も 2025 シーズンの中", () => {
    for (let o = 0; o <= 24; o++) expect(casesAt(flow, o)).toHaveLength(o);
    expect(replayNowAt(flow, 0).toISOString()).toBe("2025-10-21T14:59:59.000Z");
    expect(replayNowAt(flow, 24).toISOString()).toBe("2026-04-22T14:59:59.000Z");
    expect(watchAt(flow, 7).filter((w) => w.ok).every((w) => w.checkedAt === watchAt(flow, 7)[0]!.checkedAt)).toBe(true);
  });

  it("元の配列を書き換えない。2025 シーズンがなければ投げる（空の流れを作らない）", () => {
    const rows: HistoryCase[] = history.filter((h) => h.season === 2025 && !h.related).reverse();
    const before = JSON.stringify(rows);
    expect(nationalFlowScenario(rows, base).events.map((e) => e.date)).toEqual(flow.events.map((e) => e.date));
    expect(JSON.stringify(rows)).toBe(before);
    expect(() => nationalFlowScenario(history.filter((h) => h.season !== 2025), base)).toThrow(RangeError);
  });

  it("半径が空でも段階が崩れない: 仮の地点から姫路は距離の帯（③）、津山は基準の 10km で ①、それより遠い発生は帯に入らない", async () => {
    const geo = createGeoStore({
      index: read("data/geo/muni-index.json") as Parameters<typeof createGeoStore>[0]["index"],
      adjacency: read("data/geo/adjacency.json") as Parameters<typeof createGeoStore>[0]["adjacency"],
      loadPrefTopo: async (p) => read(`data/geo/pref/${p}.topo.json`),
    });
    const cases = casesAt(flow, 24);
    await geo.ensurePrefs(prefsToLoad(cases));
    const by = (name: string) => cases.filter((c) => c.muniName === name);
    for (const c of by("姫路市")) expect(relationToCase(flow.defaultSpot, c, geo).reason?.kind).toBe("distance_band");
    expect(relationToCase(flow.defaultSpot, by("津山市")[0]!, geo).level).toBe(1);
    expect(relationToCase(flow.defaultSpot, by("米子市")[0]!, geo).level).toBe(4);
    const inBand = cases.filter((c) => distanceToMuniKm(flow.defaultSpot.meshCode, c.muniCode!, geo) <= DISTANCE_BAND_KM).map((c) => c.muniName);
    expect(inBand).toEqual(["姫路市", "津山市", "姫路市"]);
  });
});
