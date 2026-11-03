// 見本の農場のデータ（data/replay/sample-farm.json）の検査（設計書 §17、X-08）。公開してよい data/ だけを読む。
// 作り物のデータで、実在の農場名・人名・住所・電話番号を持たない。数字は索引 Q1 のどの読みでも結果が変わらない値にする。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, diffDays, jstDateOf } from "@hpai/shared/dates";
import type { GeoStore } from "@hpai/shared/geo";
import { computeLevel } from "@hpai/shared/level";
import { computeLiftEstimate } from "@hpai/shared/lift";
import { computeMortality, toMortalityDays, type MortalityDay } from "@hpai/shared/mortality";
import { casesAt, eventStage, lastOrderOn, replayNowAt, type ReplayScenario, type SampleFarmData } from "@hpai/shared/replay";
import { currentSeason } from "@hpai/shared/season";
import type { DeathRecord } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { loadScriptGeoStore } from "../lib/geoStore";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const raw = fs.readFileSync(path.join(ROOT, "data", "replay", "sample-farm.json"), "utf8");
const sample = JSON.parse(raw) as SampleFarmData;
const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "replay", "scenario.json"), "utf8")) as ReplayScenario;

let geo: GeoStore;
beforeAll(async () => {
  geo = await loadScriptGeoStore();
  await geo.ensurePrefs(["31", "28", "26", "33"]);
});

const recordsOf = (houseId: string): DeathRecord[] => sample.deaths.filter((d) => d.houseId === houseId);
const mortalityOf = (houseId: string) => computeMortality(toMortalityDays(recordsOf(houseId)), sample.today);

/** 索引 Q1 の 4 つの読み（当日を含める／含めない × 日別の率の平均／合計÷羽数日）で、当たるかを返す */
function hitUnderEveryReading(days: readonly MortalityDay[], today: string): boolean[] {
  const valid = days.filter((d) => d.exclusion === null && d.flockSize > 0).sort((a, b) => (a.date < b.date ? 1 : -1));
  const todayDay = valid.find((d) => d.date === today)!;
  const out: boolean[] = [];
  for (const includeToday of [true, false]) {
    const past = valid.filter((d) => d.date < today).slice(0, includeToday ? 20 : 21);
    const window = includeToday ? [todayDay, ...past] : past;
    const todayRate = todayDay.deaths / todayDay.flockSize;
    const dailyMean = window.reduce((s, d) => s + d.deaths / d.flockSize, 0) / window.length;
    const pooled = window.reduce((s, d) => s + d.deaths, 0) / window.reduce((s, d) => s + d.flockSize, 0);
    out.push(todayRate >= 2 * dailyMean - 1e-12, todayRate >= 2 * pooled - 1e-12);
  }
  return out;
}

describe("見本の農場: 農場と鶏舎", () => {
  it("農場名に『架空』、家保の連絡先は 00-0000-0000、会員はいない", () => {
    expect(sample.farm.name).toContain("架空");
    expect(sample.farm.kahoContact).toContain("00-0000-0000");
    expect(sample.farm.memberUids).toEqual([]);
    expect(sample.farm.unsubscribedUids).toEqual([]);
  });

  it("地点は再現の既定の地点（defaultSpot）と同じ", () => {
    expect(sample.farm.meshCode).toBe(scenario.defaultSpot.meshCode);
    expect(sample.farm.muniCode).toBe(scenario.defaultSpot.muniCode);
    expect(sample.farm.frequentMuniCodes).toEqual(scenario.defaultSpot.frequentMuniCodes);
    expect(sample.farm.prefCode).toBe(scenario.defaultSpot.muniCode.slice(0, 2));
  });

  it("鶏舎は A（5000 羽）、B、C の順。A が先頭（記録の画面が最初に選ぶ）で、どれも空舎ではない", () => {
    expect(sample.houses.map((h) => h.name)).toEqual(["鶏舎A", "鶏舎B", "鶏舎C"]);
    expect(sample.houses[0]!.flockSize).toBe(5000);
    expect(sample.houses.every((h) => !h.empty && h.flockSize > 0)).toBe(true);
    expect(new Set(sample.houses.map((h) => h.id)).size).toBe(3);
  });

  it("自己点検の期限は見本の月に入っている（『期限を設定してください』の案内が出ない）", () => {
    expect(sample.farm.selfCheckDue[sample.today.slice(0, 7)]).toBeTruthy();
  });

  it("実在の連絡先に見える電話番号、メールアドレス、URL を持たない。禁止語がない", () => {
    const phones = raw.match(/0[0-9]{1,4}-[0-9]{1,4}-[0-9]{3,4}/g) ?? [];
    expect(phones.every((p) => p === "00-0000-0000")).toBe(true);
    expect(raw).not.toMatch(/@[A-Za-z0-9-]+\./);
    expect(raw).not.toMatch(/https?:/);
    expect(findForbiddenPhrases(raw)).toEqual([]);
  });
});

describe("見本の農場: 死亡数（索引 Q1 のどの読みでも結果が変わらない）", () => {
  it("A は毎日 2 羽を 30 日、当日 10 羽で、evaluated かつ当たる", () => {
    const a = recordsOf("house-a");
    const past = a.filter((d) => d.date < sample.today);
    expect(past).toHaveLength(30);
    expect(past.every((d) => d.deaths === 2 && d.flockSizeAt === 5000 && d.exclusion === null)).toBe(true);
    expect(a.find((d) => d.date === sample.today)!.deaths).toBe(10);
    const r = mortalityOf("house-a");
    expect(r.status).toBe("evaluated");
    expect(r.status === "evaluated" && r.hit).toBe(true);
    expect(hitUnderEveryReading(toMortalityDays(a), sample.today)).toEqual([true, true, true, true]);
  });

  it("B は毎日 2 羽で当たらない。設備の故障の日（除外）が窓の中にあり、4 つの読みのどれでも当たらない", () => {
    const b = recordsOf("house-b");
    const r = mortalityOf("house-b");
    expect(r.status).toBe("evaluated");
    expect(r.status === "evaluated" && r.hit).toBe(false);
    const excluded = b.filter((d) => d.exclusion?.kind === "equipment");
    expect(excluded).toHaveLength(1);
    expect(r.status === "evaluated" && r.windowDates).not.toContain(excluded[0]!.date);
    expect(excluded[0]!.date >= addDays(sample.today, -20)).toBe(true); // 窓の中の日
    expect(hitUnderEveryReading(toMortalityDays(b), sample.today)).toEqual([false, false, false, false]);
  });

  it("C は使える日が 21 日に満たず insufficient。空舎（empty）の日がある", () => {
    const r = mortalityOf("house-c");
    expect(r.status).toBe("insufficient");
    expect(r.status === "insufficient" && r.validDays).toBeLessThan(21);
    const empties = sample.deaths.filter((d) => d.exclusion?.kind === "empty");
    expect(empties.length).toBeGreaterThan(0);
    expect(empties.every((d) => d.deaths === 0 && d.flockSizeAt === 0)).toBe(true);
  });

  it("記録は日付と鶏舎が重ならず、羽数を超える死亡数がなく、見本の今日より後の日がない", () => {
    const keys = sample.deaths.map((d) => `${d.date}_${d.houseId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const houseIds = new Set(sample.houses.map((h) => h.id));
    for (const d of sample.deaths) {
      expect(houseIds.has(d.houseId)).toBe(true);
      expect(Number.isInteger(d.deaths) && d.deaths >= 0 && d.deaths <= d.flockSizeAt).toBe(true);
      expect(d.date <= sample.today).toBe(true);
      expect(diffDays(sample.today, d.date)).toBeLessThanOrEqual(120);
    }
  });

  it("鶏舎ごとに飼養羽数が一定（空舎の日を除く）。羽数の変更で率が動かない", () => {
    for (const h of sample.houses) {
      const sizes = new Set(recordsOf(h.id).filter((d) => d.flockSizeAt > 0).map((d) => d.flockSizeAt));
      expect([...sizes]).toEqual([h.flockSize]);
    }
  });
});

describe("見本の農場: 点検と消毒の記録", () => {
  it("消毒は消毒の項目の id、自己点検は 7 項目で、id は Firestore と同じ書き方（dis_日付_項目、self_月）", () => {
    for (const c of sample.checks) {
      if (c.kind === "disinfection") expect(c.id).toBe(`dis_${c.date}_${c.itemId}`);
      else {
        expect(c.id).toBe(`self_${c.month}`);
        expect(Object.keys(c.answers).sort()).toEqual(["17", "18", "19", "22", "23", "25", "27"]);
        expect(c.date.startsWith(c.month)).toBe(true);
      }
      expect(c.date <= sample.today).toBe(true);
    }
    expect(sample.checks.some((c) => c.kind === "self_inspection" && c.month === sample.today.slice(0, 7))).toBe(true);
  });

  it("見本の今日には消毒の記録がない（『やった』を押して試せる）", () => {
    expect(sample.checks.filter((c) => c.kind === "disinfection" && c.date === sample.today)).toEqual([]);
  });
});

describe("見本の農場: 再現の時計との合わせ方", () => {
  it("lastOrderOn: 日付以前の最後の出来事。出来事の前は 0", () => {
    expect(lastOrderOn(scenario, "2025-11-01")).toBe(0);
    expect(lastOrderOn(scenario, "2025-12-02")).toBe(1);
    expect(lastOrderOn(scenario, "2025-12-19")).toBe(4);
    expect(lastOrderOn(scenario, "2026-01-21")).toBe(scenario.events.length);
    expect(lastOrderOn(scenario, "2099-01-01")).toBe(scenario.events.length);
  });

  const order = () => lastOrderOn(scenario, sample.today);
  const tsuyama = (stage: string) => scenario.events.find((e) => e.caseAfter.muniCode === "33203" && eventStage(e) === stage)!;

  it("見本の今日は、津山市の防疫措置の完了（12/30）から移動制限の解除（1/21）の前の間にある", () => {
    expect(order()).toBeGreaterThanOrEqual(tsuyama("control_done").order);
    expect(order()).toBeLessThan(tsuyama("movement_lifted").order);
  });

  it("その order の再現の時計の日付が見本の今日と同じ（画面の今日が食い違わない）", () => {
    expect(jstDateOf(replayNowAt(scenario, order()))).toBe(sample.today);
  });

  it("その時点で、この農場の地点は段階 ① で、移動制限の解除の見込みは 2026-01-21", () => {
    const cases = casesAt(scenario, order());
    const level = computeLevel(sample.farm, cases, currentSeason(replayNowAt(scenario, order())), geo);
    expect(level.level).toBe(1);
    const target = cases.find((c) => c.muniCode === "33203")!;
    const lift = computeLiftEstimate(target, cases, geo);
    expect(["published", "calculated"]).toContain(lift.status); // 再現のデータが県の見込みの日を持つときは published
    expect(lift.movement).toBe("2026-01-21");
  });
});
