// X-08: 見本の農場の記録の口。端末の中（このインスタンスの中）だけで動き、サーバーにも localStorage にも書かない。
import type { SampleFarmData } from "@hpai/shared/replay";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sampleJson from "../../../../data/replay/sample-farm.json";
import { SampleRecordStore } from "./SampleRecordStore";

const data = sampleJson as unknown as SampleFarmData;
const original = JSON.stringify(data);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("SampleRecordStore", () => {
  it("mode は sample。声かけ文の下書きは null、配信停止は false", async () => {
    const s = new SampleRecordStore(data);
    expect(s.mode).toBe("sample");
    expect(await s.getCaseDraft("replay-8")).toBeNull();
    expect(await s.isMailStopped()).toBe(false);
  });

  it("農場と鶏舎を返す。返したものを書き換えても中のデータは変わらない", async () => {
    const s = new SampleRecordStore(data);
    const farm = (await s.getFarm())!;
    expect(farm.id).toBe(data.farm.id);
    expect(farm.name).toContain("架空");
    farm.name = "書き換え";
    (await s.listHouses())[0]!.flockSize = 1;
    expect((await s.getFarm())!.name).toContain("架空");
    expect((await s.listHouses())[0]!.flockSize).toBe(5000);
  });

  it("listDeaths は日付の範囲（両端を含む）で絞り、日付の順に返す", async () => {
    const s = new SampleRecordStore(data);
    const rows = await s.listDeaths("2025-12-28", "2025-12-30");
    expect(rows.length).toBe(9); // 3 日 × 3 鶏舎
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
    expect(rows.every((r) => r.date >= "2025-12-28" && r.date <= "2025-12-30")).toBe(true);
    expect(await s.listDeaths("2026-01-01", "2026-01-31")).toEqual([]);
  });

  it("saveDeath は同じ日と鶏舎を置き換え、list に返る。数が増えない", async () => {
    const s = new SampleRecordStore(data);
    const before = (await s.listDeaths("2025-12-30", "2025-12-30")).length;
    await s.saveDeath({ date: "2025-12-30", houseId: "house-a", deaths: 3, flockSizeAt: 5000, exclusion: null });
    const rows = await s.listDeaths("2025-12-30", "2025-12-30");
    expect(rows.length).toBe(before);
    expect(rows.find((r) => r.houseId === "house-a")!.deaths).toBe(3);
    await s.saveDeath({ date: "2025-12-31", houseId: "house-a", deaths: 1, flockSizeAt: 5000, exclusion: null });
    expect((await s.listDeaths("2025-12-31", "2025-12-31")).map((r) => r.deaths)).toEqual([1]);
  });

  it("saveCheck は Firestore と同じ id（dis_日付_項目、self_月）。同じ id は置き換える", async () => {
    const s = new SampleRecordStore(data);
    await s.saveCheck({ kind: "disinfection", date: "2025-12-30", itemId: "always-17" });
    await s.saveCheck({ kind: "disinfection", date: "2025-12-30", itemId: "always-17" });
    const today = await s.listChecks("2025-12-30", "2025-12-30");
    expect(today).toEqual([{ id: "dis_2025-12-30_always-17", kind: "disinfection", date: "2025-12-30", itemId: "always-17" }]);
    const answers = { "17": "ok", "18": "ok", "19": "ok", "22": "ok", "23": "ok", "25": "ok", "27": "ok" } as const;
    await s.saveCheck({ kind: "self_inspection", date: "2025-12-30", month: "2025-12", answers });
    const self = (await s.listChecks("2025-12-01", "2025-12-31")).filter((c) => c.kind === "self_inspection");
    expect(self).toHaveLength(1);
    expect(self[0]).toMatchObject({ id: "self_2025-12", date: "2025-12-30" });
    expect(self[0]!.kind === "self_inspection" && self[0]!.answers["27"]).toBe("ok");
  });

  it("saveHouse は id がなければ作り、あれば置き換える。saveFarm は会員の欄を変えない", async () => {
    const s = new SampleRecordStore(data);
    await s.saveHouse({ name: "鶏舎D", birdType: "採卵鶏", flockSize: 100, empty: false });
    const houses = await s.listHouses();
    expect(houses).toHaveLength(4);
    const d = houses.find((h) => h.name === "鶏舎D")!;
    expect(d.id).toBeTruthy();
    expect(new Set(houses.map((h) => h.id)).size).toBe(4);
    await s.saveHouse({ ...d, flockSize: 200 });
    expect((await s.listHouses()).find((h) => h.id === d.id)!.flockSize).toBe(200);
    expect(await s.listHouses()).toHaveLength(4);

    await s.saveFarm({ kahoContact: "別の見本 00-0000-0000" });
    const farm = (await s.getFarm())!;
    expect(farm.kahoContact).toBe("別の見本 00-0000-0000");
    expect(farm.memberUids).toEqual([]);
  });

  it("新しいインスタンスは元に戻る。渡した元のデータも変わらない。localStorage には書かない", async () => {
    const s = new SampleRecordStore(data);
    await s.saveDeath({ date: "2025-12-30", houseId: "house-a", deaths: 0, flockSizeAt: 5000, exclusion: null });
    await s.saveCheck({ kind: "disinfection", date: "2025-12-30", itemId: "always-22" });
    await s.saveHouse({ name: "鶏舎D", birdType: "採卵鶏", flockSize: 100, empty: false });
    await s.saveFarm({ name: "架空の別名" });
    expect(JSON.stringify(data)).toBe(original);
    expect(localStorage.length).toBe(0);

    const fresh = new SampleRecordStore(data);
    expect((await fresh.listDeaths("2025-12-30", "2025-12-30")).find((r) => r.houseId === "house-a")!.deaths).toBe(10);
    expect(await fresh.listChecks("2025-12-30", "2025-12-30")).toEqual([]);
    expect(await fresh.listHouses()).toHaveLength(3);
    expect((await fresh.getFarm())!.name).toBe(data.farm.name);
  });

  it("ファイルのデータ（sample-farm.json）をそのまま渡せる", () => {
    const text = readFileSync(path.resolve(import.meta.dirname, "../../../../data/replay/sample-farm.json"), "utf8");
    expect(() => new SampleRecordStore(JSON.parse(text) as SampleFarmData)).not.toThrow();
  });
});
