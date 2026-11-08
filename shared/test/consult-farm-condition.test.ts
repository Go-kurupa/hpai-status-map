// 相談に付ける農場の条件（飼育目的と飼い方、町、近くの発生、鶏舎ごとの羽数）。登録からの組み立て、送られてきた形の検査、質問の文との食い違いの見つけ方。
import { describe, expect, it } from "vitest";
import {
  CONSULT_BIRD_TYPES,
  CONSULT_MAX_FLOCK,
  CONSULT_MAX_HOUSES,
  conditionLabel,
  conditionOfFarm,
  farmNumberTexts,
  farmPromptRow,
  findFarmConflicts,
  houseLabel,
  housesOfFarm,
  nearbyLabel,
  parseFarmCondition,
  parseStoredFarm,
  registeredLabel,
  SCALE_LABEL,
  townNameOf,
} from "../src/consult/farmCondition";
import { validateAsk } from "../src/consult/validate";

describe("conditionOfFarm（登録から条件を作る。推測で埋めない）", () => {
  it("両方が登録されていれば両方", () => {
    expect(conditionOfFarm({ production: "layer", rearing: "floor" })).toEqual({ production: "layer", rearing: "floor" });
  });

  it("片方だけなら、その片方だけ（もう片方の項目は作らない）", () => {
    expect(conditionOfFarm({ production: "broiler", rearing: null })).toEqual({ production: "broiler" });
    expect(conditionOfFarm({ production: null, rearing: "cage" })).toEqual({ rearing: "cage" });
  });

  it("どちらも未登録なら null。飼い方の項目がない古い農場も未登録として扱う", () => {
    expect(conditionOfFarm({ production: null, rearing: null })).toBeNull();
    expect(conditionOfFarm({ production: null })).toBeNull();
    // 古い農場: rearing がない。production だけを使い、飼い方は埋めない
    expect(conditionOfFarm({ production: "layer" })).toEqual({ production: "layer" });
  });
});

describe("表示の文", () => {
  it("conditionLabel は登録された分だけを「・」でつなぐ（国の事例一覧と同じ語）", () => {
    expect(conditionLabel({ production: "layer", rearing: "floor" })).toBe("採卵鶏・平飼い");
    expect(conditionLabel({ production: "broiler", rearing: "cage" })).toBe("肉用鶏・ケージ飼い");
    expect(conditionLabel({ production: "layer" })).toBe("採卵鶏");
    expect(conditionLabel({ rearing: "cage" })).toBe("ケージ飼い");
  });

  it("registeredLabel は未登録の側を「未登録」と書く（推測で埋めない）", () => {
    expect(registeredLabel({ production: "layer", rearing: "floor" })).toBe("採卵鶏・平飼い");
    expect(registeredLabel({ production: "layer", rearing: null })).toBe("採卵鶏・飼い方は未登録");
    expect(registeredLabel({ production: null, rearing: "cage" })).toBe("飼育目的は未登録・ケージ飼い");
    expect(registeredLabel({ production: null })).toBe("未登録");
  });
});

describe("parseFarmCondition（関数に送られてきた形の検査）", () => {
  it("項目なし・null は条件なし", () => {
    expect(parseFarmCondition(undefined)).toEqual({ ok: true, value: null });
    expect(parseFarmCondition(null)).toEqual({ ok: true, value: null });
  });

  it("列挙の値だけを通し、null の項目は落とす", () => {
    expect(parseFarmCondition({ production: "layer", rearing: "floor" })).toEqual({ ok: true, value: { production: "layer", rearing: "floor" } });
    expect(parseFarmCondition({ production: "broiler" })).toEqual({ ok: true, value: { production: "broiler" } });
    expect(parseFarmCondition({ production: null, rearing: "cage" })).toEqual({ ok: true, value: { rearing: "cage" } });
  });

  it("列挙の外、型の違い、余計な項目、空の条件、配列や文字は拒む", () => {
    const bad: unknown[] = [
      { production: "duck" },
      { rearing: "free_range" },
      { rearing: "open" },
      { production: 1 },
      { rearing: true },
      { production: "layer", housing: "open" },
      { production: "layer", name: "A 農場" },
      {},
      { production: null, rearing: null },
      [],
      ["layer"],
      "layer",
      1,
    ];
    for (const v of bad) expect(parseFarmCondition(v), JSON.stringify(v)).toEqual({ ok: false });
  });
});

describe("findFarmConflicts（質問の文と登録の食い違い）", () => {
  it("登録はケージ飼いなのに質問に「平飼い」", () => {
    expect(findFarmConflicts("平飼いで長靴は？", { rearing: "cage" })).toEqual([{ field: "rearing", inQuestion: "平飼い", registered: "ケージ飼い" }]);
  });

  it("登録は平飼いなのに質問に「ケージ」（「ケージフリー」は食い違いにしない）", () => {
    expect(findFarmConflicts("ケージ飼いの鶏舎の網は？", { rearing: "floor" })).toEqual([{ field: "rearing", inQuestion: "ケージ飼い", registered: "平飼い" }]);
    expect(findFarmConflicts("ケージフリーにした鶏舎の網は？", { rearing: "floor" })).toEqual([]);
    // 「パッケージ」の中の「ケージ」は飼い方ではない
    expect(findFarmConflicts("消毒薬のパッケージの希釈は？", { rearing: "floor" })).toEqual([]);
    expect(findFarmConflicts("パッケージにあるケージ飼い用の網は？", { rearing: "floor" })).toHaveLength(1);
  });

  it("登録は肉用なのに質問に「採卵」「卵」", () => {
    const want = [{ field: "production", inQuestion: "採卵", registered: "肉用鶏" }];
    expect(findFarmConflicts("採卵の鶏舎で気をつけることは？", { production: "broiler" })).toEqual(want);
    expect(findFarmConflicts("卵の出荷のときの消毒は？", { production: "broiler" })).toEqual(want);
    expect(findFarmConflicts("鶏卵を出すときの消毒は？", { production: "broiler" })).toEqual(want);
  });

  it("登録は肉用で、質問の「種卵」「卵殻」だけでは食い違いにしない（肉用の種鶏も卵を扱う）", () => {
    expect(findFarmConflicts("種卵の消毒はどうする？", { production: "broiler" })).toEqual([]);
    expect(findFarmConflicts("卵殻が落ちていたら？", { production: "broiler" })).toEqual([]);
  });
  it("登録は採卵なのに質問に「肉用」「ブロイラー」", () => {
    const want = [{ field: "production", inQuestion: "肉用", registered: "採卵鶏" }];
    expect(findFarmConflicts("肉用の出荷は？", { production: "layer" })).toEqual(want);
    expect(findFarmConflicts("ブロイラーの出荷は？", { production: "layer" })).toEqual(want);
  });

  it("全角・半角の違いがあっても見つける（ｹｰｼﾞ）", () => {
    expect(findFarmConflicts("ｹｰｼﾞの網は？", { rearing: "floor" })).toHaveLength(1);
  });

  it("両方が食い違えば両方。登録と同じ語や、登録のない側の語は食い違いにしない", () => {
    expect(findFarmConflicts("平飼いの採卵で長靴は？", { production: "broiler", rearing: "cage" }).map((c) => c.field).sort()).toEqual(["production", "rearing"]);
    expect(findFarmConflicts("平飼いの採卵で長靴は？", { production: "layer", rearing: "floor" })).toEqual([]);
    // 飼い方が未登録なら、質問の「平飼い」とは比べない
    expect(findFarmConflicts("平飼いで長靴は？", { production: "layer" })).toEqual([]);
    expect(findFarmConflicts("長靴は何足？", { production: "broiler", rearing: "cage" })).toEqual([]);
  });
});

describe("町・近くの発生・鶏舎ごとの羽数（2026-11-08 豪さんの決定。羽数の幅は送らない）", () => {
  const house = (flockSize: unknown, empty: unknown = false, birdType: unknown = "採卵鶏") => ({ birdType, flockSize, empty });
  const H1 = { birdType: "採卵鶏", flockSize: 1200, empty: false } as const;
  const H2 = { birdType: "採卵鶏", flockSize: 800, empty: false } as const;
  const H3 = { birdType: "採卵鶏", flockSize: 0, empty: true } as const;
  const NEAR = { casesWithin60km: 2, zone: "possible" } as const;

  it("鳥の種類は農場の設定と同じ 6 語", () => {
    expect([...CONSULT_BIRD_TYPES]).toEqual(["採卵鶏", "肉用鶏", "種鶏", "あひる", "うずら", "その他"]);
  });

  it("housesOfFarm: 一覧の順に、名前と id を落として鳥の種類・羽数・空舎だけにする", () => {
    expect(housesOfFarm([{ id: "house-1", name: "1 号舎", ...H1 }, { id: "house-3", name: "3 号舎", ...H3 }])).toEqual([H1, H3]);
  });

  it("housesOfFarm: 0 件、30 件を超える、1 つでも読めない鶏舎があれば送らない（null。読めた分だけで少なく見せない）", () => {
    expect(housesOfFarm([])).toBeNull();
    expect(housesOfFarm(Array.from({ length: CONSULT_MAX_HOUSES }, () => H1))).toHaveLength(30);
    expect(housesOfFarm(Array.from({ length: CONSULT_MAX_HOUSES + 1 }, () => H1))).toBeNull();
    for (const bad of [house(-1), house(1.5), house("1200"), house(1_000_001), house(Number.NaN), house(100, "no"), house(100, false, "ダチョウ"), null]) {
      expect(housesOfFarm([H1, bad]), JSON.stringify(bad)).toBeNull();
    }
    expect(housesOfFarm([house(CONSULT_MAX_FLOCK)])).toEqual([{ birdType: "採卵鶏", flockSize: 1_000_000, empty: false }]);
  });

  it("conditionOfFarm: 町のコード（5 桁だけ）、近くの発生、鶏舎は、飼育目的か飼い方があるときだけ足す。null は入れない", () => {
    expect(conditionOfFarm({ production: "layer", rearing: "floor", muniCode: "33643" }, { houses: [H1, H3], nearby: NEAR })).toEqual({
      production: "layer",
      rearing: "floor",
      muniCode: "33643",
      nearby: NEAR,
      houses: [H1, H3],
    });
    expect(conditionOfFarm({ production: "layer", rearing: null, muniCode: "33643" }, { houses: null, nearby: null })).toEqual({ production: "layer", muniCode: "33643" });
    expect(conditionOfFarm({ production: "layer", muniCode: "3364" })).toEqual({ production: "layer" });
    expect(conditionOfFarm({ production: null, rearing: null, muniCode: "33643" }, { houses: [H1], nearby: NEAR })).toBeNull();
  });

  it("parseFarmCondition: 新しい項目を通す（null の項目は落とす）", () => {
    const full = { production: "layer", rearing: "floor", muniCode: "33643", nearby: NEAR, houses: [H1, H2, H3] };
    expect(parseFarmCondition(full)).toEqual({ ok: true, value: full });
    expect(parseFarmCondition({ production: "layer", muniCode: null, nearby: null, houses: null })).toEqual({ ok: true, value: { production: "layer" } });
    expect(parseFarmCondition({ rearing: "cage", nearby: { casesWithin60km: 0, zone: "none" } })).toEqual({ ok: true, value: { rearing: "cage", nearby: { casesWithin60km: 0, zone: "none" } } });
    expect(parseFarmCondition({ rearing: "cage", nearby: { casesWithin60km: 999, zone: "none" } }).ok).toBe(true);
    expect(parseFarmCondition({ rearing: "cage", houses: Array.from({ length: 30 }, () => H1) }).ok).toBe(true);
  });

  it("parseFarmCondition: 知らない項目、形の違い、範囲の外は拒む", () => {
    const bad: unknown[] = [
      // 市町村コードは 5 桁の文字だけ。町の名前、マス目、緯度経度、農場名、羽数の幅は受けない
      { production: "layer", muniCode: "3364" },
      { production: "layer", muniCode: "336430" },
      { production: "layer", muniCode: 33643 },
      { production: "layer", muniCode: "33643", town: "岡山県西粟倉村" },
      { production: "layer", meshCode: "53340678" },
      { production: "layer", lat: 35.2, lng: 134.3 },
      { production: "layer", name: "A 農場" },
      { production: "layer", scale: "over3000" },
      // 近くの発生: 件数は 0〜999 の整数、区域は列挙、項目は 2 つだけ
      { production: "layer", nearby: { casesWithin60km: -1, zone: "none" } },
      { production: "layer", nearby: { casesWithin60km: 1000, zone: "none" } },
      { production: "layer", nearby: { casesWithin60km: 1.5, zone: "none" } },
      { production: "layer", nearby: { casesWithin60km: "2", zone: "none" } },
      { production: "layer", nearby: { casesWithin60km: 2, zone: "inside" } },
      { production: "layer", nearby: { casesWithin60km: 2 } },
      { production: "layer", nearby: { casesWithin60km: 2, zone: "none", level: 1 } },
      { production: "layer", nearby: [2, "none"] },
      // 鶏舎: 1〜30 件、鳥の種類は列挙、羽数は 0〜1,000,000 の整数、名前などの項目は受けない
      { production: "layer", houses: [] },
      { production: "layer", houses: Array.from({ length: 31 }, () => H1) },
      { production: "layer", houses: [{ ...H1, name: "1 号舎" }] },
      { production: "layer", houses: [{ ...H1, id: "house-1" }] },
      { production: "layer", houses: [{ ...H1, birdType: "ダチョウ" }] },
      { production: "layer", houses: [{ ...H1, flockSize: 1_000_001 }] },
      { production: "layer", houses: [{ ...H1, flockSize: -1 }] },
      { production: "layer", houses: [{ ...H1, flockSize: 12.5 }] },
      { production: "layer", houses: [{ birdType: "採卵鶏", flockSize: 100 }] },
      { production: "layer", houses: H1 },
      // 飼育目的も飼い方もない条件は、町や鶏舎があっても拒む
      { muniCode: "33643", houses: [H1] },
    ];
    for (const v of bad) expect(parseFarmCondition(v), JSON.stringify(v)).toEqual({ ok: false });
  });

  it("townNameOf: 索引から「県名＋市町村名」。索引にないコードは null", () => {
    const index = { "33643": { name: "西粟倉村", prefCode: "33" }, "13101": { name: "千代田区", prefCode: "13" } };
    expect(townNameOf(index, "33643")).toBe("岡山県西粟倉村");
    expect(townNameOf(index, "13101")).toBe("東京都千代田区");
    expect(townNameOf(index, "99999")).toBeNull();
    expect(townNameOf(index, "toString")).toBeNull();
  });

  it("表示の語: 近くの発生、鶏舎（番号。空舎は羽数を出さない）、条件の全体", () => {
    expect(nearbyLabel(NEAR)).toBe("約 60 km 以内の今季の発生 2 件（区域に入っている可能性あり）");
    expect(nearbyLabel({ casesWithin60km: 0, zone: "none" })).toBe("約 60 km 以内の今季の発生 0 件（区域に入っている可能性は見つかっていない）");
    expect(houseLabel(H1, 0)).toBe("鶏舎 1: 採卵鶏 1,200 羽");
    expect(houseLabel(H3, 2)).toBe("鶏舎 3: 採卵鶏 空舎");
    expect(conditionLabel({ production: "layer", rearing: "floor", muniCode: "33643", town: "岡山県西粟倉村", nearby: NEAR, houses: [H1, H2, H3] })).toBe(
      "採卵鶏・平飼い・岡山県西粟倉村・約 60 km 以内の今季の発生 2 件（区域に入っている可能性あり）・鶏舎 1: 採卵鶏 1,200 羽、鶏舎 2: 採卵鶏 800 羽、鶏舎 3: 採卵鶏 空舎",
    );
    // 古い記録（羽数の幅）も読める
    expect(conditionLabel({ production: "layer", rearing: "floor", scale: "1000to3000" })).toBe("採卵鶏・平飼い・1,000〜2,999 羽");
    expect(SCALE_LABEL.over3000).toBe("3,000 羽以上");
  });

  it("farmPromptRow: Claude に渡す行。町の名前・件数と区域の語・鶏舎の番号つきの語。コードと名前のない項目は入れない", () => {
    const row = farmPromptRow({ production: "layer", rearing: "floor", muniCode: "33643", town: "岡山県西粟倉村", nearby: NEAR, houses: [H1, H3] });
    expect(row).toEqual({
      production: "採卵鶏",
      rearing: "平飼い",
      town: "岡山県西粟倉村",
      nearby: { casesWithin60km: "約 60 km 以内の今季の発生 2 件", zone: "区域に入っている可能性あり" },
      houses: ["鶏舎 1: 採卵鶏 1,200 羽", "鶏舎 2: 採卵鶏 空舎"],
    });
    expect(JSON.stringify(row)).not.toContain("33643");
    // 古い記録の幅は渡さない
    expect(farmPromptRow({ production: "layer", scale: "over3000" })).toEqual({ production: "採卵鶏" });
  });

  it("farmNumberTexts: 答えの数字の検査に足すのは、渡したものだけ（鶏舎の番号は棟数まで、飼育中の羽数と合計、件数と約 60 km）", () => {
    expect(farmNumberTexts({ production: "layer", town: "岡山県西粟倉村", nearby: NEAR, houses: [H1, H2, H3] })).toEqual(["1", "2", "3", "1200", "800", "2000", "60"]);
    expect(farmNumberTexts({ production: "layer", houses: [H1] })).toEqual(["1", "1200"]);
    expect(farmNumberTexts({ production: "layer", town: "岡山県西粟倉村" })).toEqual([]);
  });

  it("答えの数字の検査（validateAsk）: 鶏舎 2 棟の条件なら「鶏舎 2」「1,200 羽」は通り、「鶏舎 3」「21 日」「200 羽」は落ちる", () => {
    const card = { id: "c1", origin: "o", action: "長靴を替える", appliesTo: "すべての農場", evidence: "recommendation" as const, evidenceNote: "", quote: "鶏舎ごとに長靴を替える", sourceId: "s1", locator: "", caveats: [], conditionTags: [], approved: true };
    const extra = ["長靴は？", ...farmNumberTexts({ production: "layer", houses: [H1, H2] })];
    const check = (answer: string) => validateAsk({ answer, cardIds: ["c1"], outOfScope: false }, ["c1"], [card], 5, extra);
    expect(check("鶏舎 2 の 1,200 羽も、鶏舎ごとに長靴を替えます。").outOfScope).toBe(false);
    expect(check("鶏舎 1 と鶏舎 2、合計 2,000 羽で長靴を替えます。").outOfScope).toBe(false);
    for (const bad of ["鶏舎 3 でも長靴を替えます。", "21 日ごとに長靴を替えます。", "200 羽ごとに長靴を替えます。", "3 割の農場で長靴を替えます。"]) {
      expect(check(bad).failures, bad).toContainEqual(expect.stringMatching(/^unknown_number:/u));
    }
  });

  it("parseStoredFarm: 記録の条件。送る形に、関数が足した町の名前と、古い記録の幅を許す。それ以外は拒む", () => {
    const used = { production: "layer", rearing: "floor", muniCode: "33643", town: "岡山県西粟倉村", nearby: NEAR, houses: [H1] };
    expect(parseStoredFarm(used)).toEqual(used);
    expect(parseStoredFarm({ production: "layer", rearing: "floor", scale: "1000to3000" })).toEqual({ production: "layer", rearing: "floor", scale: "1000to3000" });
    expect(parseStoredFarm({ production: "layer" })).toEqual({ production: "layer" });
    for (const v of [{ production: "layer", town: "" }, { production: "layer", town: 1 }, { production: "layer", scale: "huge" }, { production: "layer", meshCode: "53340678" }, { town: "岡山県西粟倉村" }, {}, null, "x"]) {
      expect(parseStoredFarm(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("findFarmConflicts は羽数・町・近くの発生を見ない（質問の数字と鶏舎の羽数を突き合わせない）", () => {
    expect(findFarmConflicts("うちは 300 羽の平飼いです。網は？", { rearing: "floor", houses: [{ birdType: "採卵鶏", flockSize: 5000, empty: false }] })).toEqual([]);
    expect(findFarmConflicts("近くで 5 件出ています。網は？", { production: "layer", nearby: { casesWithin60km: 0, zone: "none" } })).toEqual([]);
  });
});
