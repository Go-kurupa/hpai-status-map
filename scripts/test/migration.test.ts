import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  excelSerialToIsoDate,
  extractSurveys,
  firstCrossing,
  isWaterbirdSpecies,
  latestSurvey,
  median,
  nearestSurvey,
  normalizeSpeciesName,
  parseIndexLinks,
  parseXlsx,
  readZipEntry,
  shiftYear,
  summarizeArrival,
  summarizeSite,
  type Cell,
  type Survey,
} from "../lib/migration";

// ── 試験用の作り物の xlsx（実在の調査ではない）。CRC は読まないので 0 のまま ──

function zip(entries: Record<string, string>, method: 0 | 8): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, "utf8");
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nm = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nm.length, 26);
    parts.push(local, nm, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const colLetter = (i: number): string => String.fromCharCode(65 + i);
const esc = (s: string): string => s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;");

/** 表 → xlsx。文字は共有文字列（半分）と inlineStr（残り）の両方で書いて、どちらも読めることを確かめる */
function xlsx(grid: Cell[][], method: 0 | 8 = 8): Buffer {
  const shared: string[] = [];
  let sheet = "";
  grid.forEach((row, r) => {
    let cells = "";
    row.forEach((c, i) => {
      if (c === null) return;
      const ref = `${colLetter(i)}${r + 1}`;
      if (typeof c === "number") cells += `<c r="${ref}"><v>${c}</v></c>`;
      else if ((r + i) % 2 === 0) {
        shared.push(c);
        cells += `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
      } else cells += `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`;
    });
    sheet += `<row r="${r + 1}">${cells}</row>`;
  });
  const sst = shared.map((s) => `<si><t>${esc(s)}</t><rPh sb="0" eb="1"><t>ふりがな</t></rPh></si>`).join("");
  return zip(
    {
      "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>`,
      "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${sst}</sst>`,
    },
    method,
  );
}

// 2026-10-05 = 46300 など。2026-10-14 のシリアル値を数式で出す
const serial = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + 25569;

function fixtureGrid(): Cell[][] {
  return [
    ["調査地点名", "試験沼", "試験沼", "試験沼", "試験沼"],
    ["調査年月日", serial("2026-09-28"), serial("2026-10-05"), "2026/10/14", "ひらがな"],
    ["飛来状況", "はじめて見た", "少し増えた", "沢山いた", "読まない"],
    ["マガン 【1】", 12, 1500, 40_000, 7],
    ["(亜種)オオハクチョウ 【1】", null, null, 30, 1],
    ["コガモ", null, 8, 200, null],
    ["ガン類", null, null, 500, null],
    ["ハジロカイツブリ", null, 3, 3, null],
    ["カワウ", null, 9, 9, null],
    ["合計", null, 1, 1, null],
  ];
}

describe("xlsx を読む", () => {
  it.each([0, 8] as const)("zip の圧縮方式 %s の中のシートを、文字（共有・直書き）と数で読む", (method) => {
    const grid = parseXlsx(xlsx(fixtureGrid(), method));
    expect(grid[0]?.slice(0, 2)).toEqual(["調査地点名", "試験沼"]);
    expect(grid[1]?.[1]).toBe(serial("2026-09-28"));
    expect(grid[1]?.[3]).toBe("2026/10/14");
    expect(grid[3]?.[2]).toBe(1500);
    // ふりがな（rPh）は文字に混ぜない
    expect(grid[3]?.[0]).toBe("マガン 【1】");
  });

  it("zip でないもの、シートのないものは例外にする（黙って空にしない）", () => {
    expect(() => parseXlsx(Buffer.from("<html>not found</html>"))).toThrow(/zip/u);
    expect(() => parseXlsx(zip({ "other.txt": "x" }, 0))).toThrow(/シート/u);
    expect(readZipEntry(zip({ "a.txt": "x" }, 0), "b.txt")).toBeNull();
  });
});

describe("調査の回を取り出す", () => {
  const x = extractSurveys(parseXlsx(xlsx(fixtureGrid())));

  it("日付はシリアル値と文字の両方を読み、読めない列は数えて飛ばす", () => {
    expect(x.siteName).toBe("試験沼");
    expect(x.surveys.map((s) => s.date)).toEqual(["2026-09-28", "2026-10-05", "2026-10-14"]);
    expect(x.skippedColumns).toBe(1);
  });

  it("水鳥の合計は、ガン・ハクチョウ・カモの種だけ。科レベルの行、カモ以外、合計の行は入れない", () => {
    expect(x.surveys.map((s) => s.total)).toEqual([12, 1508, 40_230]);
    // 種名は亜種と優先度の印を除く
    expect(x.surveys[2]?.species["オオハクチョウ"]).toBe(30);
    // 水鳥でない行の数も、飛来の早さのために種の表には残る
    expect(x.surveys[1]?.species["ハジロカイツブリ"]).toBe(3);
  });

  it("数が 1 つも書かれていない回は、0 ではなく「記録なし」(null)", () => {
    const grid = fixtureGrid();
    grid[1]!.push(serial("2026-10-20"));
    const y = extractSurveys(parseXlsx(xlsx(grid)));
    const last = y.surveys.at(-1)!;
    expect(last.date).toBe("2026-10-20");
    expect(last.total).toBeNull();
    expect(latestSurvey(y.surveys)?.date).toBe("2026-10-14");
  });

  it("「調査年月日」の行がなければ例外（原本の形が変わった）", () => {
    expect(() => extractSurveys([["a", "b"]])).toThrow(/調査年月日/u);
  });
});

describe("種名と水鳥の判定", () => {
  it("亜種と優先度の印を除く", () => {
    expect(normalizeSpeciesName("(亜種)オオヒシクイ 【1】")).toBe("オオヒシクイ");
    expect(normalizeSpeciesName("（亜種）コハクチョウ【１】")).toBe("コハクチョウ");
  });
  it.each(["マガン", "ヒシクイ", "オオハクチョウ", "コガモ", "キンクロハジロ", "カワアイサ", "オシドリ", "ツクシガモ", "ヒドリガモ"])("%s は水鳥", (n) => {
    expect(isWaterbirdSpecies(n)).toBe(true);
  });
  it.each(["ガン類", "ハクチョウ類", "カモ類", "ハジロカイツブリ", "ハジロコチドリ", "ハジロクロハラアジサシ", "カワウ", "オオバン", "ユリカモメ", "ナベヅル"])("%s は水鳥の合計に入れない", (n) => {
    expect(isWaterbirdSpecies(n)).toBe(false);
  });
});

describe("日付と統計", () => {
  it("Excel のシリアル値", () => {
    expect(excelSerialToIsoDate(46_300)).toBe(`2026-10-${String(5)}`.replace("10-5", "10-05"));
    expect(excelSerialToIsoDate(5)).toBeNull();
    expect(excelSerialToIsoDate(Number.NaN)).toBeNull();
  });
  it("年の差し替え（うるう日は 28 日に寄せる）", () => {
    expect(shiftYear("2026-10-14", -5)).toBe("2021-10-14");
    expect(shiftYear("2024-02-29", 1)).toBe("2025-02-28");
  });
  it("中央値（偶数個は真ん中 2 つの平均を四捨五入）", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(3);
    expect(median([1, 2])).toBe(2);
    expect(() => median([])).toThrow();
  });
});

const sv = (date: string, total: number | null, species: Record<string, number> = {}): Survey => ({ date, total, species });

describe("近い回と今季の最新", () => {
  const list = [sv("2021-10-01", 100), sv("2021-10-11", 200), sv("2021-10-20", null), sv("2021-11-05", 900)];
  it("前後 7 日以内で最も近い回。同じ近さなら早い方。記録のない回と範囲外は選ばない", () => {
    expect(nearestSurvey(list, "2021-10-14")?.date).toBe("2021-10-11");
    expect(nearestSurvey(list, "2021-10-06")?.date).toBe("2021-10-01");
    expect(nearestSurvey(list, "2021-10-20")).toBeNull();
    expect(nearestSurvey(list, "2021-10-18")?.date).toBe("2021-10-11");
    expect(nearestSurvey(list, "2021-10-28")).toBeNull();
  });
});

describe("地点の集計", () => {
  const past = (rows: Array<[number, string, number]>): Map<number, Survey[]> => new Map(rows.map(([s, d, t]) => [s, [sv(d, t)]]));
  const base = { id: 110, name: "試験沼", fetchedAt: "2026-11-04" };

  it("今季の最新の回と、過去 5 季の同じ時期の中央値・最小・最大を並べる（比は出さない）", () => {
    const site = summarizeSite(
      { ...base, current: [sv("2026-10-05", 10), sv("2026-10-14", 41_860)], past: past([[2021, "2021-10-13", 12_801], [2022, "2022-10-12", 26_124], [2023, "2023-10-11", 36_459], [2024, "2024-10-14", 49_778], [2025, "2025-10-15", 63_962]]) },
      2026,
      [2021, 2022, 2023, 2024, 2025],
    );
    expect(site).toMatchObject({ id: 110, latestDate: "2026-10-14", latestTotal: 41_860, fetchedAt: "2026-11-04" });
    expect(site?.baseline).toMatchObject({ n: 5, median: 36_459, min: 12_801, max: 63_962 });
    expect(site?.baseline?.seasons.map((s) => s.season)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(Object.keys(site!)).not.toContain("ratio");
  });

  it("比べられる過去が 3 シーズン未満なら baseline は null（少ない数で中央値を出さない）", () => {
    const site = summarizeSite({ ...base, current: [sv("2026-10-14", 5)], past: past([[2023, "2023-10-11", 1], [2024, "2024-10-14", 2]]) }, 2026, [2021, 2022, 2023, 2024, 2025]);
    expect(site?.baseline).toBeNull();
    expect(site?.latestTotal).toBe(5);
  });

  it("今季に数の記録が 1 回もなければ載せない（null）", () => {
    expect(summarizeSite({ ...base, current: [sv("2026-10-14", null)], past: new Map() }, 2026, [2025])).toBeNull();
  });

  it("目標の日が範囲の外の過去は数えない", () => {
    const site = summarizeSite(
      { ...base, current: [sv("2026-10-14", 5)], past: new Map([[2025, [sv("2025-11-20", 9)]], [2024, [sv("2024-10-14", 1)]], [2023, [sv("2023-10-14", 2)]], [2022, [sv("2022-10-14", 3)]]]) },
      2026,
      [2022, 2023, 2024, 2025],
    );
    expect(site?.baseline?.n).toBe(3);
    expect(site?.baseline?.seasons.map((s) => s.season)).toEqual([2022, 2023, 2024]);
  });
});

describe("飛来の早さ", () => {
  const season = [sv("2025-09-20", 0, { マガン: 0 }), sv("2025-10-02", 1, { マガン: 1200 }), sv("2025-10-15", 3, { マガン: 5000 })];
  it("しきい値以上を初めて記録した回。最初の回で既に超えていれば印を付ける", () => {
    expect(firstCrossing(season, "マガン", 1000)).toEqual({ date: "2025-10-02", atFirstSurvey: false });
    expect(firstCrossing([sv("2025-09-10", 2000, { マガン: 2000 })], "マガン", 1000)).toEqual({ date: "2025-09-10", atFirstSurvey: true });
    expect(firstCrossing(season, "マガン", 10_000)).toBeNull();
    expect(firstCrossing(season, "オオハクチョウ", 1)).toBeNull();
  });
  it("数の記録がない回は、超えなかった回として扱わず飛ばす", () => {
    expect(firstCrossing([sv("2025-09-20", null), sv("2025-10-02", 3, { マガン: 1200 })], "マガン", 1000)).toEqual({ date: "2025-10-02", atFirstSurvey: true });
  });
  it("秋の到着だけ見る: 翌年の春の調査（12 月末より後）は混ぜない", () => {
    const spring = [sv("2025-10-02", 1, { マガン: 10 }), sv("2026-03-25", 1, { マガン: 5000 })];
    expect(firstCrossing(spring, "マガン", 1000)).toEqual({ date: "2026-03-25", atFirstSurvey: false });
    const a = summarizeArrival(
      { siteId: 110, siteName: "試験沼", currentSeason: 2026, current: [sv("2026-10-14", 5, { マガン: 300 })], past: new Map([[2025, spring]]) },
      { siteId: 110, species: "マガン", threshold: 1000 },
      [2025],
    );
    expect(a?.past).toEqual([{ season: 2025, date: null, atFirstSurvey: false }]);
  });

  it("今季はまだ超えていなければ currentDate は null で、最新の調査日を持つ。過去の記録のないシーズンは飛ばす", () => {
    const a = summarizeArrival(
      { siteId: 110, siteName: "試験沼", currentSeason: 2026, current: [sv("2026-10-14", 5, { マガン: 300 })], past: new Map([[2025, season], [2024, [sv("2024-10-01", null)]]]) },
      { siteId: 110, species: "マガン", threshold: 1000 },
      [2024, 2025],
    );
    expect(a).toMatchObject({ currentDate: null, latestSurveyDate: "2026-10-14", threshold: 1000 });
    expect(a?.past).toEqual([{ season: 2025, date: "2025-10-02", atFirstSurvey: false }]);
  });
});

describe("入口のページ", () => {
  it("リンクと名前を取り出す。番号のかっこと &nbsp; を除き、同じ番号は 1 つ。</a> が抜けたページも読める", () => {
    const html = `
      <td>&nbsp;<a href="site_csv/10.xlsx">(1)クッチャロ湖</a></td>
      <td><a href="site_csv/65.xls">(6-1)厚岸・別寒辺牛・霧多布（別寒辺牛川下流・厚岸湖）</a></td>
      <td><a href="site_csv/1010.xlsx">(24)大野川河口</td>
      <td><a href="site_csv/1091.xlsx">(32)倉敷市岡田大池&nbsp;</a></td>
      <td><a href="site_csv/10.xlsx">(1)クッチャロ湖（再掲）</a></td>
      <a href="bunpu/kogamo.png">x</a>`;
    expect(parseIndexLinks(html)).toEqual([
      { id: 10, ext: "xlsx", label: "クッチャロ湖" },
      { id: 65, ext: "xls", label: "厚岸・別寒辺牛・霧多布(別寒辺牛川下流・厚岸湖)" },
      { id: 1010, ext: "xlsx", label: "大野川河口" },
      { id: 1091, ext: "xlsx", label: "倉敷市岡田大池" },
    ]);
  });
});
