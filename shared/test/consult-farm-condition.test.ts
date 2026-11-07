// 相談に付ける農場の条件（飼育目的と飼い方）。登録からの組み立て、送られてきた形の検査、質問の文との食い違いの見つけ方。
import { describe, expect, it } from "vitest";
import {
  conditionLabel,
  conditionOfFarm,
  findFarmConflicts,
  parseFarmCondition,
  registeredLabel,
  scaleOfHouses,
  SCALE_LABEL,
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

describe("羽数の幅（scale。空舎を除く鶏舎の飼養羽数の合計から作る。正確な羽数は送らない）", () => {
  const h = (flockSize: unknown, empty: unknown = false) => ({ flockSize, empty });

  it("境目: 1,000 未満は under1000、1,000 以上 3,000 未満は 1000to3000、3,000 以上は over3000（ちょうど 1,000 と 3,000 は上の幅）", () => {
    expect(scaleOfHouses([h(1)])).toBe("under1000");
    expect(scaleOfHouses([h(999)])).toBe("under1000");
    expect(scaleOfHouses([h(1000)])).toBe("1000to3000");
    expect(scaleOfHouses([h(2999)])).toBe("1000to3000");
    expect(scaleOfHouses([h(3000)])).toBe("over3000");
    expect(scaleOfHouses([h(430000)])).toBe("over3000");
  });

  it("合計で決める（鶏舎ごとではない）。空舎は除く", () => {
    expect(scaleOfHouses([h(600), h(400)])).toBe("1000to3000");
    expect(scaleOfHouses([h(1200), h(700)])).toBe("1000to3000");
    expect(scaleOfHouses([h(2000), h(1000)])).toBe("over3000");
    // 空舎（0 羽）は数えない
    expect(scaleOfHouses([h(900), h(0, true)])).toBe("under1000");
    // 空舎に羽数が残っていても数えない（空舎は合計に入れない）
    expect(scaleOfHouses([h(900), h(5000, true)])).toBe("under1000");
  });

  it("鶏舎が 0 件、全部空舎のときは幅を作らない（null）", () => {
    expect(scaleOfHouses([])).toBeNull();
    expect(scaleOfHouses([h(0, true)])).toBeNull();
    expect(scaleOfHouses([h(0, true), h(0, true)])).toBeNull();
  });

  it("空舎でない鶏舎の羽数が 1 つでも読めなければ、読めた分だけで作らない（null。少なく見積もった推測にしない）", () => {
    for (const bad of [h(undefined), h(null), h("1200"), h(-1), h(1.5), h(Number.NaN), h(Number.POSITIVE_INFINITY), h(0)]) {
      expect(scaleOfHouses([h(5000), bad]), JSON.stringify(bad)).toBeNull();
    }
    // 空舎かどうかが読めない鶏舎も同じ
    expect(scaleOfHouses([h(5000), h(100, "no")])).toBeNull();
    expect(scaleOfHouses([h(5000), { flockSize: 100 }])).toBeNull();
    expect(scaleOfHouses([h(5000), null])).toBeNull();
  });

  it("表示の語", () => {
    expect(SCALE_LABEL).toEqual({ under1000: "1,000 羽未満", "1000to3000": "1,000〜2,999 羽", over3000: "3,000 羽以上" });
  });

  it("conditionOfFarm: 幅は飼育目的か飼い方の登録に足す任意の項目。どちらも未登録なら幅だけの条件は作らない", () => {
    expect(conditionOfFarm({ production: "layer", rearing: "floor" }, "1000to3000")).toEqual({ production: "layer", rearing: "floor", scale: "1000to3000" });
    expect(conditionOfFarm({ production: "broiler", rearing: null }, "over3000")).toEqual({ production: "broiler", scale: "over3000" });
    expect(conditionOfFarm({ production: "layer", rearing: "floor" }, null)).toEqual({ production: "layer", rearing: "floor" });
    expect(conditionOfFarm({ production: null, rearing: null }, "under1000")).toBeNull();
    expect(conditionOfFarm({ production: null }, "under1000")).toBeNull();
  });

  it("conditionLabel と registeredLabel は幅を最後に足す。幅がなければ今までどおり（「未登録」とは書かない）", () => {
    expect(conditionLabel({ production: "layer", rearing: "floor", scale: "1000to3000" })).toBe("採卵鶏・平飼い・1,000〜2,999 羽");
    expect(conditionLabel({ production: "broiler", scale: "over3000" })).toBe("肉用鶏・3,000 羽以上");
    expect(registeredLabel({ production: "layer", rearing: "floor" }, "under1000")).toBe("採卵鶏・平飼い・1,000 羽未満");
    expect(registeredLabel({ production: "layer", rearing: null }, "1000to3000")).toBe("採卵鶏・飼い方は未登録・1,000〜2,999 羽");
    expect(registeredLabel({ production: "layer", rearing: "floor" }, null)).toBe("採卵鶏・平飼い");
    // 飼育目的も飼い方もなければ、幅があっても「未登録」（幅だけの条件は作らない）
    expect(registeredLabel({ production: null, rearing: null }, "over3000")).toBe("未登録");
  });

  it("parseFarmCondition: scale は列挙だけを通す。列挙の外・型の違い・正確な羽数は拒む。幅だけの条件も拒む", () => {
    expect(parseFarmCondition({ production: "layer", rearing: "floor", scale: "1000to3000" })).toEqual({ ok: true, value: { production: "layer", rearing: "floor", scale: "1000to3000" } });
    expect(parseFarmCondition({ rearing: "cage", scale: "under1000" })).toEqual({ ok: true, value: { rearing: "cage", scale: "under1000" } });
    expect(parseFarmCondition({ production: "layer", scale: null })).toEqual({ ok: true, value: { production: "layer" } });
    const bad: unknown[] = [
      { production: "layer", scale: "huge" },
      { production: "layer", scale: "1,000 羽未満" },
      { production: "layer", scale: 1900 },
      { production: "layer", scale: "1900" },
      { production: "layer", flockSize: 1900 },
      { production: "layer", scale: "1000to3000", flockSize: 1900 },
      { scale: "over3000" },
      { production: null, rearing: null, scale: "under1000" },
    ];
    for (const v of bad) expect(parseFarmCondition(v), JSON.stringify(v)).toEqual({ ok: false });
  });

  it("findFarmConflicts は羽数を見ない（質問の数字と幅を突き合わせない）", () => {
    expect(findFarmConflicts("うちは 300 羽の平飼いです。網は？", { rearing: "floor", scale: "over3000" })).toEqual([]);
    expect(findFarmConflicts("5 万羽の鶏舎の網は？", { production: "layer", scale: "under1000" })).toEqual([]);
  });
});
