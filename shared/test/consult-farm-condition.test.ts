// 相談に付ける農場の条件（飼育目的と飼い方）。登録からの組み立て、送られてきた形の検査、質問の文との食い違いの見つけ方。
import { describe, expect, it } from "vitest";
import {
  conditionLabel,
  conditionOfFarm,
  findFarmConflicts,
  parseFarmCondition,
  registeredLabel,
} from "../src/consult/farmCondition";

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
