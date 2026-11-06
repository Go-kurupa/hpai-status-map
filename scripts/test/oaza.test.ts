import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBuildOaza } from "../build-oaza";
import { buildOazaPref, parseCsvLine } from "../lib/oaza";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HEAD = '"都道府県コード","都道府県名","市区町村コード","市区町村名","大字町丁目コード","大字町丁目名","緯度","経度","原典資料コード","大字・字・丁目区分コード"';
const row = (code: string, muni: string, name: string, lat: string, lng: string) => `"33","岡山県","${code}","${muni}","${code}0001000","${name}","${lat}","${lng}","0","1"`;

describe("大字・町丁目の一覧を作る（scripts/lib/oaza.ts）", () => {
  it("引用符つきの CSV の 1 行を列に分ける。列の中の \"\" は引用符 1 つ", () => {
    expect(parseCsvLine('"33","岡山県","a,b","x""y"')).toEqual(["33", "岡山県", "a,b", 'x"y']);
  });

  it("市町村ごとに [名前, 緯度, 経度] を元の順で並べ、緯度経度は小数 4 桁に丸める", () => {
    const csv = [HEAD, row("33643", "英田郡西粟倉村", "大字筏津", "35.151143", "134.323660"), row("33643", "英田郡西粟倉村", "大字大茅", "35.223576", "134.368281")].join("\r\n");
    const { pref, unmatched } = buildOazaPref(csv, new Set(["33643"]));
    expect(pref).toEqual({ "33643": [["大字筏津", 35.1511, 134.3237], ["大字大茅", 35.2236, 134.3683]] });
    expect(unmatched).toEqual([]);
  });

  it("政令市の区は、地図の市のコードにまとめ、名前の頭に区の名前を付ける（区のコードから機械的に作らない）", () => {
    const csv = [HEAD, row("33101", "岡山市北区", "葵町", "34.669495", "133.899370"), row("33102", "岡山市中区", "赤坂本町", "34.67", "133.95")].join("\n");
    const { pref } = buildOazaPref(csv, new Set(["33100"]));
    expect(pref["33100"]!.map((r) => r[0])).toEqual(["北区 葵町", "中区 赤坂本町"]);
    // 川崎市の区（14131）を、横浜市（14100）にまとめない
    const kawasaki = `"14","神奈川県","14131","川崎市川崎区","141310001000","旭町一丁目","35.53","139.71","0","3"`;
    expect(Object.keys(buildOazaPref([HEAD, kawasaki].join("\n"), new Set(["14100", "14130"])).pref)).toEqual(["14130"]);
  });

  it("地図の市町村の一覧にない市町村は、一覧に入れず unmatched に返す。緯度経度が数でなければ投げる", () => {
    const csv = [HEAD, row("33999", "どこか町", "大字某", "35", "134")].join("\n");
    expect(buildOazaPref(csv, new Set(["33643"]))).toEqual({ pref: {}, unmatched: ["33999 どこか町"] });
    expect(() => buildOazaPref([HEAD, row("33643", "英田郡西粟倉村", "大字筏津", "x", "134")].join("\n"), new Set(["33643"]))).toThrow(/緯度経度/u);
  });
});

describe("data/oaza（作ったデータ）", () => {
  it("47 都道府県のファイルがあり、どの市町村のコードも地図の一覧にある。西粟倉村は 6 地区", () => {
    const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data/geo/muni-index.json"), "utf8")) as Record<string, { prefCode: string }>;
    let rows = 0;
    for (let i = 1; i <= 47; i++) {
      const code = String(i).padStart(2, "0");
      const pref = JSON.parse(fs.readFileSync(path.join(ROOT, `data/oaza/${code}.json`), "utf8")) as Record<string, [string, number, number][]>;
      for (const [muni, list] of Object.entries(pref)) {
        expect(index[muni]?.prefCode, muni).toBe(code);
        for (const [name, lat, lng] of list) {
          expect(name.length).toBeGreaterThan(0);
          expect(lat).toBeGreaterThan(20);
          expect(lat).toBeLessThan(46);
          expect(lng).toBeGreaterThan(122);
          expect(lng).toBeLessThan(154);
        }
        rows += list.length;
      }
    }
    expect(rows).toBeGreaterThan(150_000);
    const okayama = JSON.parse(fs.readFileSync(path.join(ROOT, "data/oaza/33.json"), "utf8")) as Record<string, [string, number, number][]>;
    expect(okayama["33643"]!.map((r) => r[0])).toEqual(["大字筏津", "大字大茅", "大字影石", "大字坂根", "大字知社", "大字長尾"]);
  });

  it("入力のフォルダがなければ終了コード 2", () => {
    const out: string[] = [];
    expect(runBuildOaza([], (s) => out.push(s))).toBe(2);
    expect(out.join("")).toMatch(/--input/u);
  });
});
