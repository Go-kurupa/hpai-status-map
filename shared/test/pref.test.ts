import { describe, expect, it } from "vitest";
import { isPrefDomainHost, PREF_DOMAINS, PREFS, prefCodeOfName } from "../src/pref";

describe("PREFS", () => {
  it("47 都道府県が 01〜47 の順に並ぶ", () => {
    expect(PREFS).toHaveLength(47);
    expect(PREFS.map((p) => p.code)).toEqual(Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0")));
    expect(new Set(PREFS.map((p) => p.name)).size).toBe(47);
  });

  it("要所の名前", () => {
    const nameOf = (code: string) => PREFS.find((p) => p.code === code)?.name;
    expect(nameOf("01")).toBe("北海道");
    expect(nameOf("13")).toBe("東京都");
    expect(nameOf("26")).toBe("京都府");
    expect(nameOf("27")).toBe("大阪府");
    expect(nameOf("33")).toBe("岡山県");
    expect(nameOf("47")).toBe("沖縄県");
  });
});

describe("prefCodeOfName", () => {
  it("正式名と、都道府県を除いた名前のどちらも受ける", () => {
    expect(["岡山県", "岡山", "北海道", "京都府", "東北"].map(prefCodeOfName)).toEqual(["33", "33", "01", "26", null]);
  });

  it("京都と東京を取り違えない", () => {
    expect(prefCodeOfName("京都")).toBe("26");
    expect(prefCodeOfName("京都府")).toBe("26");
    expect(prefCodeOfName("東京")).toBe("13");
    expect(prefCodeOfName("東京都")).toBe("13");
    expect(prefCodeOfName("京")).toBeNull();
    expect(prefCodeOfName("大阪")).toBe("27");
  });

  it("部分一致や空は null", () => {
    expect(prefCodeOfName("")).toBeNull();
    expect(prefCodeOfName("北海")).toBeNull();
    expect(prefCodeOfName("岡山県津山市")).toBeNull();
    expect(prefCodeOfName("県")).toBeNull();
  });

  it("空白を除いて受ける", () => {
    expect(prefCodeOfName(" 岡山県\n")).toBe("33");
    expect(prefCodeOfName("岡　山")).toBe("33");
  });

  it("47 件すべてが正式名と短い名前の両方で自分のコードに戻る", () => {
    for (const p of PREFS) {
      expect(prefCodeOfName(p.name), p.name).toBe(p.code);
      if (p.name !== "北海道") expect(prefCodeOfName(p.name.slice(0, -1)), p.name).toBe(p.code);
    }
  });
});

describe("isPrefDomainHost", () => {
  it("県の公式ドメインは 47 件", () => {
    expect(PREF_DOMAINS.size).toBe(47);
  });

  it("名前そのものとその下のホストだけ通す", () => {
    for (const ok of ["pref.okayama.jp", "www.pref.okayama.jp", "www2.pref.fukui.lg.jp", "metro.tokyo.lg.jp", "PREF.OKAYAMA.JP"])
      expect(isPrefDomainHost(ok), ok).toBe(true);
    for (const ng of ["pref.attacker.jp", "www.pref.attacker.jp", "evilpref.okayama.jp", "pref.okayama.jp.evil.com", "okayama.jp", ""])
      expect(isPrefDomainHost(ng), ng).toBe(false);
  });
});
