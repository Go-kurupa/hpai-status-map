// 再現のデータ（data/replay/scenario.json）の検査（設計書 §17、X-02）。公開してよい data/ と docs/ だけを読む。
// 距離を使う前に、必ず geo.ensurePrefs で県の形を読む（契約 3.2）。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import { toJstIso } from "@hpai/shared/dates";
import { computeLevel, relationWithoutBand, summarizeWatch } from "@hpai/shared/level";
import { latLngToMesh3 } from "@hpai/shared/mesh";
import { PREFS } from "@hpai/shared/pref";
import { currentSeason } from "@hpai/shared/season";
import {
  casesAt,
  eventStage,
  NO_TIME_LABEL,
  noticeTextFor,
  REPLAY_SEASON,
  replayNowAt,
  timeLabel,
  virtualNow,
  watchAt,
  type ReplayScenario,
} from "@hpai/shared/replay";
import type { Case, CaseStage } from "@hpai/shared/types";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { loadScriptGeoStore } from "../lib/geoStore";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "replay", "scenario.json"), "utf8")) as ReplayScenario;
const sourcesDoc = fs.readFileSync(path.join(ROOT, "docs", "replay-sources.md"), "utf8");

let geo: GeoStore;
beforeAll(async () => {
  geo = await loadScriptGeoStore();
  await geo.ensurePrefs(["31", "28", "26", "33"]); // 距離の前に、鳥取・兵庫・京都・岡山の形を読む
});

const events = scenario.events;
const lastOf = (muni: string): Case => {
  const list = events.filter((e) => e.caseAfter.muniCode === muni);
  return list[list.length - 1]!.caseAfter;
};
const dateOfEvent = (order: number) => events[order - 1]!.date;
const orderOn = (date: string, time: string | null = null) => events.find((e) => e.date === date && e.time === time)!.order;

function* strings(v: unknown, keyPath = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [keyPath, v];
  else if (Array.isArray(v)) for (const [i, x] of v.entries()) yield* strings(x, `${keyPath}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, `${keyPath}.${k}`);
}
function* keys(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keys(x);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keys(x);
    }
}

describe("scenario.json の事例（国内 6、7、8、9 例目）", () => {
  it("id は 2025-12。事例は 4 件だけで、確定の日は 米子 12/2、姫路 12/16、津山 12/20、亀岡 12/24", () => {
    expect(scenario.id).toBe("2025-12");
    const ids = new Set(events.map((e) => e.caseAfter.id));
    expect(ids.size).toBe(4);
    const expected = [
      { muni: "31202", name: "米子市", pref: "31", no: 6, confirmed: "2025-12-02" },
      { muni: "28201", name: "姫路市", pref: "28", no: 7, confirmed: "2025-12-16" },
      { muni: "33203", name: "津山市", pref: "33", no: 8, confirmed: "2025-12-20" },
      { muni: "26206", name: "亀岡市", pref: "26", no: 9, confirmed: "2025-12-24" },
    ];
    for (const x of expected) {
      const c = lastOf(x.muni);
      expect(c.muniName).toBe(x.name);
      expect(c.prefCode).toBe(x.pref);
      expect(c.nationalNo).toBe(x.no);
      expect(c.stages.confirmed?.date).toBe(x.confirmed);
    }
  });

  it("津山は 疑い 12/19、確定 12/20、防疫措置の完了 12/30、搬出制限の解除 1/10、移動制限の解除 1/21", () => {
    const c = lastOf("33203");
    expect(c.stages.suspected?.date).toBe("2025-12-19");
    expect(c.stages.confirmed?.date).toBe("2025-12-20");
    expect(c.stages.control_done?.date).toBe("2025-12-30");
    expect(c.stages.shipment_lifted?.date).toBe("2026-01-10");
    expect(c.stages.movement_lifted?.date).toBe("2026-01-21");
  });

  it("season は 2025、confirmState は replay、否定はない。どの caseAfter も同じ", () => {
    for (const e of events) {
      expect(e.caseAfter.season).toBe(2025);
      expect(e.caseAfter.confirmState).toBe("replay");
      expect(e.caseAfter.negation).toBe("none");
    }
  });

  it("order は 1 からの連番で、日付の昇順（同じ日は時刻の順）。time が null の出来事が 1 つ以上ある", () => {
    expect(events.map((e) => e.order)).toEqual(events.map((_, i) => i + 1));
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.date >= events[i - 1]!.date).toBe(true);
      expect(virtualNow(events[i]!).getTime()).toBeGreaterThanOrEqual(virtualNow(events[i - 1]!).getTime());
    }
    expect(events.some((e) => e.time === null)).toBe(true);
  });

  it("時刻は、その出来事の出典が書いている時だけ入れる（津山の疑いは時刻なし、確定は 09:00、搬出制限の解除は 15:00）", () => {
    const tsuyama = events.filter((e) => e.caseAfter.muniCode === "33203");
    const byStage = (s: CaseStage) => tsuyama.find((e) => eventStage(e) === s)!;
    expect(byStage("suspected").time).toBeNull();
    expect(byStage("confirmed").time).toBe("09:00");
    expect(byStage("control_done").time).toBe("15:10");
    expect(byStage("shipment_lifted").time).toBe("15:00");
    expect(byStage("movement_lifted").time).toBe("00:00");
    // 国の発表（12/2、12/16、12/24）は時刻を書いていないので時刻を作らない
    for (const m of ["31202", "28201", "26206"]) {
      const e = events.find((x) => x.caseAfter.muniCode === m && eventStage(x) === "confirmed")!;
      expect(e.time, m).toBeNull();
    }
  });

  it("各事例の caseAfter は、前の出来事の段階を引き継ぐ（消えない）。出典も増えるだけ", () => {
    const byCase = new Map<string, typeof events>();
    for (const e of events) byCase.set(e.caseAfter.id, [...(byCase.get(e.caseAfter.id) ?? []), e]);
    for (const list of byCase.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!.caseAfter;
        const cur = list[i]!.caseAfter;
        for (const k of Object.keys(prev.stages) as CaseStage[]) expect(cur.stages[k]).toEqual(prev.stages[k]);
        for (const u of prev.sourceUrls) expect(cur.sourceUrls).toContain(u);
      }
    }
  });

  it("出来事の段階を取り出せる（eventStage）。津山は疑い→確定→完了→搬出解除→移動解除", () => {
    const stages = events.filter((e) => e.caseAfter.muniCode === "33203").map((e) => eventStage(e));
    expect(stages).toEqual(["suspected", "confirmed", "control_done", "shipment_lifted", "movement_lifted"]);
    for (const e of events) expect(eventStage(e), `order ${e.order}`).not.toBeNull();
  });

  it("県の見込みは、津山の防疫措置の完了（12/30）から出る。それより前の出来事には入れない", () => {
    const tsuyama = events.filter((e) => e.caseAfter.muniCode === "33203");
    for (const e of tsuyama) {
      const stage = eventStage(e);
      if (stage === "suspected" || stage === "confirmed") expect(e.caseAfter.prefEstimates).toEqual({ shipment: null, movement: null, surveillance: null });
      else expect(e.caseAfter.prefEstimates).toEqual({ shipment: "2026-01-10", movement: "2026-01-21", surveillance: null });
    }
  });
});

describe("解除は、解除の日に独立の出来事として現れる（制限を実際より長く見せない）", () => {
  it("4 事例とも、搬出制限の解除と移動制限の解除が、それぞれの日の出来事になっている", () => {
    for (const m of ["31202", "28201", "33203", "26206"]) {
      for (const stage of ["shipment_lifted", "movement_lifted"] as const) {
        const own = events.filter((e) => e.caseAfter.muniCode === m);
        const first = own.find((e) => e.caseAfter.stages[stage] !== undefined);
        expect(first, `${m} ${stage}`).toBeDefined();
        expect(eventStage(first!), `${m} ${stage}`).toBe(stage);
        expect(first!.date, `${m} ${stage}`).toBe(first!.caseAfter.stages[stage]!.date);
      }
    }
  });

  it("搬出制限の解除の日と時刻は、国の事例一覧のとおり（米子 12/17 17:00、姫路 1/1 12:00、津山 1/10 15:00、亀岡 1/10 09:00）", () => {
    const at = (m: string) => lastOf(m).stages.shipment_lifted;
    expect(at("31202")).toEqual({ date: "2025-12-17", time: "17:00" });
    expect(at("28201")).toEqual({ date: "2026-01-01", time: "12:00" });
    expect(at("33203")).toEqual({ date: "2026-01-10", time: "15:00" });
    expect(at("26206")).toEqual({ date: "2026-01-10", time: "09:00" });
  });

  it("米子の地点は、12/17 の搬出制限の解除で shipmentLifted が true になっても、12/28 までは level 1", () => {
    const [lng, lat] = geo.index["31202"]!.center;
    const spot = { meshCode: latLngToMesh3(lat, lng), muniCode: "31202", frequentMuniCodes: [] };
    const orderOf = (stage: CaseStage) => events.find((e) => e.caseAfter.muniCode === "31202" && eventStage(e) === stage)!.order;
    const before = computeLevel(spot, casesAt(scenario, orderOf("shipment_lifted") - 1), 2025, geo);
    const mid = computeLevel(spot, casesAt(scenario, orderOf("shipment_lifted")), 2025, geo);
    const after = computeLevel(spot, casesAt(scenario, orderOf("movement_lifted")), 2025, geo);
    expect([before.level, before.shipmentLifted]).toEqual([1, false]);
    expect([mid.level, mid.shipmentLifted]).toEqual([1, true]);
    expect(after.level).toBe(1 + 1); // 同じ町は、移動制限の解除の後 2
  });
});

describe("時刻の記載がない出来事に、出典のない時刻を持たせない", () => {
  it("updatedAt は、時刻があればその時刻、なければ T00:00:00（過去の記録と同じ書き方）。23:59:59 はデータに残らない", () => {
    for (const e of events) {
      expect(e.caseAfter.updatedAt, `order ${e.order}`).toBe(`${e.date}T${e.time ?? "00:00"}:00+09:00`);
    }
    expect(JSON.stringify(scenario)).not.toContain("23:59");
  });
});

describe("既定の地点（仮の地点）", () => {
  it("muniCode は 33622（勝央町）。meshCode は 33622 の center を latLngToMesh3 に通した値", () => {
    expect(scenario.defaultSpot.muniCode).toBe("33622");
    const [lng, lat] = geo.index["33622"]!.center;
    expect(scenario.defaultSpot.meshCode).toBe(latLngToMesh3(lat, lng));
    expect(scenario.defaultSpot.frequentMuniCodes).toEqual([]);
  });

  it("津山市の範囲から 5km 以内", async () => {
    const { distanceToMuniKm } = await import("@hpai/shared/geo");
    expect(distanceToMuniKm(scenario.defaultSpot.meshCode, "33203", geo)).toBeLessThanOrEqual(5);
  });

  it("12/19 から 1/20 までは level 1（within_radius）。1/21 以降は level 1 でない（隣の町の 2）。12/16 の姫路市（約 40km 先）から 12/18 までは距離の帯の 3。それより前は 4", () => {
    const first = orderOn("2025-12-19");
    const band = events.find((e) => e.caseAfter.muniCode === "28201")!.order;
    const lift = events.find((e) => e.caseAfter.muniCode === "33203" && eventStage(e) === "movement_lifted")!.order;
    for (let o = 0; o <= events.length; o++) {
      const r = computeLevel(scenario.defaultSpot, casesAt(scenario, o), 2025, geo);
      if (o < band) {
        expect(r.level, `order ${o}`).toBe(4);
      } else if (o < first) {
        expect(r.level, `order ${o}`).toBe(3);
        expect(r.reasons[0]!.kind, `order ${o}`).toBe("distance_band");
      } else if (o < lift) {
        expect(r.level, `order ${o}`).toBe(1);
        expect(r.reasons[0]!.kind, `order ${o}`).toBe("within_radius");
      } else {
        expect(r.level, `order ${o}`).not.toBe(1);
        expect(r.level, `order ${o}`).toBe(2);
        expect(r.reasons[0]!.kind, `order ${o}`).toBe("adjacent");
      }
    }
  });

  it("津山の搬出制限の解除（1/10）のあとも、移動制限が続く間は level 1（搬出が先に解けても距離を縮めない）", () => {
    const o = events.find((e) => e.caseAfter.muniCode === "33203" && eventStage(e) === "shipment_lifted")!.order;
    const r = computeLevel(scenario.defaultSpot, casesAt(scenario, o), 2025, geo);
    expect(r.level).toBe(1);
    expect(r.shipmentLifted).toBe(true);
  });
});

describe("出典と文章", () => {
  it("quote のキーがない。農場名、住所のキーもない", () => {
    const all = new Set(keys(scenario));
    expect(all.has("quote")).toBe(false);
    for (const k of all) expect(k, k).not.toMatch(/farm|address|住所|農場名|quote/i);
  });

  it("出典は https。姫路は maff.go.jp か city.himeji.lg.jp だけ（caseAfter.sourceUrls も）", () => {
    for (const e of events) {
      const urls = [e.sourceUrl, ...e.caseAfter.sourceUrls];
      for (const u of urls) {
        expect(u.startsWith("https://"), u).toBe(true);
        if (e.caseAfter.muniCode === "28201") {
          const host = new URL(u).hostname;
          expect(host === "maff.go.jp" || host.endsWith(".maff.go.jp") || host === "city.himeji.lg.jp" || host.endsWith(".city.himeji.lg.jp"), u).toBe(true);
        }
      }
      expect(e.caseAfter.sourceUrls).toContain(e.sourceUrl);
    }
  });

  it("県や国の文章を写していない（URL 以外の文字列はどれも 60 字以内）。禁句がない", () => {
    for (const [p, s] of strings(scenario)) {
      if (!s.startsWith("https://")) expect(s.length, `${p}: ${s}`).toBeLessThanOrEqual(60);
      expect(findForbiddenPhrases(s), `${p}: ${s}`).toEqual([]);
    }
  });

  it("docs/replay-sources.md に、すべての出典 URL と確かめた日、姫路の例外がある", () => {
    const urls = new Set(events.flatMap((e) => [e.sourceUrl, ...e.caseAfter.sourceUrls]));
    for (const u of urls) expect(sourcesDoc, u).toContain(u);
    expect(sourcesDoc).toMatch(/確かめた日/);
    expect(sourcesDoc).toContain("2026-11-03");
    expect(sourcesDoc).toContain("姫路");
    expect(sourcesDoc).toMatch(/兵庫県のページ|兵庫県の専用ページ/);
    expect(sourcesDoc).toMatch(/例外/);
  });

  it("野鳥はない（4 事例の再現）", () => {
    expect(scenario.wildBirds).toEqual([]);
  });
});

describe("メールの下書き（noticePreview）", () => {
  it("段階 ④（この地点に関係ない事例）と、メールに語のない出来事（防疫措置の完了）は null。他は prefContactIsAuthority を含む", () => {
    for (const e of events) {
      const rel = relationWithoutBand(scenario.defaultSpot, e.caseAfter, geo); // 帯はメールに入れない
      const stage = eventStage(e)!;
      const text = noticeTextFor(e.caseAfter.muniName!, stage);
      if (rel.level === 4 || text === null) {
        expect(e.noticePreview, `order ${e.order}`).toBeNull();
      } else {
        expect(e.noticePreview, `order ${e.order}`).not.toBeNull();
        expect(e.noticePreview!.level).toBe(rel.level);
        expect(e.noticePreview!.text).toBe(text);
        expect(e.noticePreview!.text).toContain(FIXED_TEXT.prefContactIsAuthority);
      }
    }
  });

  it("文の形は『津山市で疑いの発表がありました。正式な情報は県の連絡です』。語は 疑い／確定／搬出制限の解除／移動制限の解除", () => {
    expect(noticeTextFor("津山市", "suspected")).toBe("津山市で疑いの発表がありました。正式な情報は県の連絡です");
    expect(noticeTextFor("津山市", "confirmed")).toBe("津山市で確定の発表がありました。正式な情報は県の連絡です");
    expect(noticeTextFor("津山市", "shipment_lifted")).toBe("津山市で搬出制限の解除の発表がありました。正式な情報は県の連絡です");
    expect(noticeTextFor("津山市", "movement_lifted")).toBe("津山市で移動制限の解除の発表がありました。正式な情報は県の連絡です");
    expect(noticeTextFor("津山市", "control_done")).toBeNull();
  });

  it("津山の疑いは level 1 で、メールの下書きがある。米子、姫路、亀岡の確定は null", () => {
    const suspected = events.find((e) => eventStage(e) === "suspected")!;
    expect(suspected.noticePreview?.level).toBe(1);
    for (const m of ["31202", "28201", "26206"]) {
      const e = events.find((x) => x.caseAfter.muniCode === m && eventStage(x) === "confirmed")!;
      expect(e.noticePreview, m).toBeNull();
    }
  });
});

describe("見回りの状況（説明のための例）", () => {
  it("47 件で、確認できていないのは 23（愛知県）だけ", () => {
    expect(scenario.watchStatus).toHaveLength(47);
    expect(new Set(scenario.watchStatus.map((w) => w.prefCode)).size).toBe(47);
    for (const p of PREFS) expect(scenario.watchStatus.some((w) => w.prefCode === p.code)).toBe(true);
    expect(scenario.watchStatus.filter((w) => !w.ok).map((w) => w.prefCode)).toEqual(["23"]);
  });

  it("どの時点でも、確認できていない県は 23 だけ（ok の時刻は再生の時刻に合わせる）", () => {
    for (let o = 0; o <= events.length; o++) {
      const now = replayNowAt(scenario, o);
      expect(summarizeWatch(watchAt(scenario, o), now).failedPrefCodes, `order ${o}`).toEqual(["23"]);
      // 画面の『時点』は確認の時刻の最も新しいもの。再生の時刻と食い違わせない
      expect(new Set(watchAt(scenario, o).map((w) => w.checkedAt))).toEqual(new Set([toJstIso(now)]));
    }
  });
});

describe("時計と事例の取り出し（shared/src/replay.ts）", () => {
  it("virtualNow: 時刻があればその時刻（JST）、なければその日の 23:59:59 JST", () => {
    const e = { order: 1, date: "2025-12-20", time: "09:00" } as Parameters<typeof virtualNow>[0];
    expect(virtualNow(e).toISOString()).toBe("2025-12-20T00:00:00.000Z");
    const n = { ...e, time: null };
    expect(virtualNow(n).toISOString()).toBe("2025-12-20T14:59:59.000Z");
  });

  it("timeLabel: 時刻なしは『時刻の記載なし』、あれば時刻", () => {
    expect(NO_TIME_LABEL).toBe("時刻の記載なし");
    expect(timeLabel({ time: null })).toBe("時刻の記載なし");
    expect(timeLabel({ time: "15:10" })).toBe("15:10");
  });

  it("casesAt: order 0 は 0 件。order が進むと事例ごとの最新の caseAfter。範囲の外は RangeError", () => {
    expect(casesAt(scenario, 0)).toEqual([]);
    const o = orderOn("2025-12-20", "09:00");
    const at = casesAt(scenario, o);
    expect(at.map((c) => c.id).sort()).toHaveLength(3);
    const tsuyama = at.find((c) => c.muniCode === "33203")!;
    expect(tsuyama.stages.confirmed?.date).toBe("2025-12-20");
    expect(tsuyama.stages.control_done).toBeUndefined();
    expect(casesAt(scenario, events.length)).toHaveLength(4);
    expect(() => casesAt(scenario, -1)).toThrow(RangeError);
    expect(() => casesAt(scenario, events.length + 1)).toThrow(RangeError);
    expect(() => casesAt(scenario, 1.5)).toThrow(RangeError);
  });

  it("replayNowAt: order 0 でも 2025 シーズンの中（最初の出来事の前の日の 23:59:59）", () => {
    const t = replayNowAt(scenario, 0);
    expect(currentSeason(t)).toBe(REPLAY_SEASON);
    expect(t.getTime()).toBeLessThan(virtualNow(events[0]!).getTime());
    expect(replayNowAt(scenario, 3).getTime()).toBe(virtualNow(events[2]!).getTime());
    expect(dateOfEvent(1)).toBe("2025-12-02");
  });
});
