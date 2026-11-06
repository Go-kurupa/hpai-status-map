import { describe, expect, it } from "vitest";
import { OUT_OF_SCOPE_TEXT, isOutOfScopeQuestion } from "../src/consult/scope";

describe("範囲外の問いの見分け", () => {
  it("決まった文は指示書と一字も違わない", () => {
    expect(OUT_OF_SCOPE_TEXT).toBe("集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。");
  });

  it("健康の問いは範囲外", () => {
    expect(isOutOfScopeQuestion("人にうつりますか")).toBe(true);
    expect(isOutOfScopeQuestion("ヒトにも感染する？")).toBe(true);
    expect(isOutOfScopeQuestion("従業員の健康への影響は？")).toBe(true);
    expect(isOutOfScopeQuestion("人へ感染しますか")).toBe(true);
    expect(isOutOfScopeQuestion("人間にも感染する？")).toBe(true);
    expect(isOutOfScopeQuestion("人の健康への影響は？")).toBe(true);
    expect(isOutOfScopeQuestion("病院に行くべきですか")).toBe(true);
    expect(isOutOfScopeQuestion("卵を食べても大丈夫？")).toBe(true);
    expect(isOutOfScopeQuestion("肉を食べても平気？")).toBe(true);
  });

  it("区域の問いは範囲外", () => {
    expect(isOutOfScopeQuestion("うちは制限区域に入りますか")).toBe(true);
    expect(isOutOfScopeQuestion("搬出制限はいつまで？")).toBe(true);
    expect(isOutOfScopeQuestion("移動制限の範囲は？")).toBe(true);
  });

  it("診断の問いは範囲外", () => {
    expect(isOutOfScopeQuestion("鶏が元気がないのは鳥インフルですか")).toBe(true);
    expect(isOutOfScopeQuestion("この症状は何ですか")).toBe(true);
    expect(isOutOfScopeQuestion("鳥インフルエンザですか")).toBe(true);
    expect(isOutOfScopeQuestion("鳥インフルかもしれない")).toBe(true);
    expect(isOutOfScopeQuestion("鶏が死んでいるのが急に増えた")).toBe(true);
    expect(isOutOfScopeQuestion("ぐったりしている")).toBe(true);
    expect(isOutOfScopeQuestion("陽性ですか")).toBe(true);
  });

  it("全角や空白が混じっても見分ける", () => {
    expect(isOutOfScopeQuestion("人 に うつりますか")).toBe(true);
  });

  it("対策の問いは範囲内", () => {
    expect(isOutOfScopeQuestion("防鳥ネットの網目は何 cm？")).toBe(false);
    expect(isOutOfScopeQuestion("長靴の消毒はどうすればいい？")).toBe(false);
  });

  it("単独のうつる、感染するは健康の問いとみなさない", () => {
    expect(isOutOfScopeQuestion("鶏舎にウイルスがうつる経路は？")).toBe(false);
    expect(isOutOfScopeQuestion("鶏舎の間で感染する経路は？")).toBe(false);
  });

  it("人や健康や死んだ、が出てくるだけの対策の問いは範囲内", () => {
    expect(isOutOfScopeQuestion("外部の人に長靴を貸してよい？")).toBe(false);
    expect(isOutOfScopeQuestion("業者の人に消毒をお願いするには")).toBe(false);
    expect(isOutOfScopeQuestion("鶏の健康管理の基本は？")).toBe(false);
    expect(isOutOfScopeQuestion("死んだ鶏の処理・消毒は？")).toBe(false);
  });
});
