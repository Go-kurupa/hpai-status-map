// 環境省の野鳥の一覧（今季の PDF）を表として読み、wildBirds を国の一覧に合わせる（moeTable.ts、2026-11-07）。
// 作った文字の並びで向き（1 件が 1 列、1 件が 1 行）と欄の割り当てを、実物の PDF の控え（data/private/fixtures/moe、公開しない）で件数と中身を確かめる。
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { GeoStore } from "@hpai/shared/geo";
import type { WildBird } from "@hpai/shared/types";
import { loadGeoStore } from "../src/geo/loadGeo";
import { extractPdfItems } from "../src/watch/extract";
import { tableSync } from "../src/watch/moe";
import { asOfFromTitle, dateInSeason, parseMoeTable, rowToWildBird, sameEvent, syncWildBirdTable, tableBirdId, testOf, type PdfItem, type WildBirdIo } from "../src/watch/moeTable";
import { describeFixture } from "./helpers/fixtures";

const GEO_DIR = path.resolve(import.meta.dirname, "../../data/geo");
const FIX = path.resolve(import.meta.dirname, "../../data/private/fixtures/moe");
let geo: GeoStore;
beforeAll(async () => {
  geo = await loadGeoStore(GEO_DIR);
});

type Rec = Record<string, string>;
const COLUMN_ROWS: Array<[string, number, string]> = [
  ["野鳥国内", 47, "no"],
  ["回収日", 74, "date"],
  ["都道府県", 94, "pref"],
  ["市町村", 156, "muni"],
  ["検体の種類", 187, "sample"],
  ["種名", 243, "species"],
  ["結果", 363, "screening"],
  ["病原性", 516, "path"],
  ["最終判定", 621, "final"],
  ["指定日", 681, "from"],
  ["解除日", 750, "to"],
];

/** 1 件が 1 列の表（pdf.js の座標での実物の形）。項目名は左の列、件は右へ 25 ずつ並ぶ。y は下から上へ増える */
function columnTable(records: Rec[], labels = COLUMN_ROWS): PdfItem[] {
  const out: PdfItem[] = [{ page: 1, s: "遺伝子検査", x: 56, y: 490 }];
  for (const [label, y] of labels) out.push({ page: 1, s: label, x: 70, y });
  records.forEach((rec, i) => {
    const x = 99 + i * 25;
    for (const [, y, key] of COLUMN_ROWS) if (rec[key] !== undefined) out.push({ page: 1, s: rec[key]!, x: x + (key === "final" ? -8 : 0), y: y + (key === "final" ? 4 : 1) });
  });
  return out;
}

/** 1 件が 1 行の表（回転の違う版への備え）。項目名は上の行、件は下へ並ぶ */
function rowTable(records: Rec[]): PdfItem[] {
  const cols: Array<[string, number, string]> = [
    ["野鳥国内", 20, "no"],
    ["回収日", 60, "date"],
    ["都道府県", 100, "pref"],
    ["市町村", 160, "muni"],
    ["検体の種類", 210, "sample"],
    ["種名", 260, "species"],
    ["結果", 340, "screening"],
    ["病原性", 450, "path"],
    ["最終判定", 520, "final"],
    ["指定日", 600, "from"],
    ["解除日", 650, "to"],
  ];
  const out: PdfItem[] = [];
  for (const [label, x] of cols) out.push({ page: 1, s: label, x, y: 700 });
  records.forEach((rec, i) => {
    const y = 650 - i * 40;
    for (const [, x, key] of cols) if (rec[key] !== undefined) out.push({ page: 1, s: rec[key]!, x, y });
  });
  return out;
}

const KURIHARA = { no: "ー", date: "10/27", pref: "宮城県", muni: "栗原市", sample: "死亡野鳥", species: "マガン", screening: "簡易陽性", path: "陰性(高病原性でない、その他鳥インフルエンザウイルス)", final: "陰性(高病原性でない、その他鳥インフルエンザウイルス)", from: "10/27", to: "10/30解除" };
const AKITA = { no: "1例目", date: "11/2", pref: "秋田県", muni: "由利本荘市", sample: "死亡野鳥", species: "ハシブトガラス", screening: "ー", path: "H5亜型高病原性", final: "検査中", from: "11/6", to: "11/30予定" };
const WATER = { no: "3例目", date: "11/2", pref: "鹿児島県", muni: "出水市", sample: "環境試料（水）", species: "ー", screening: "ー", path: "H5亜型高病原性", final: "H5亜型高病原性", from: "11/6", to: "11/30予定" };

describe("parseMoeTable: 表の向きと欄", () => {
  it.each([
    ["1 件が 1 列", columnTable],
    ["1 件が 1 行", rowTable],
  ])("%s: 件ごとに欄を読む。「ー」は空、例目は数、並びは表の順", (_, make) => {
    const r = parseMoeTable(make([KURIHARA, AKITA, WATER]), 2026);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ nationalNo: null, collectedOn: "10/27", prefecture: "宮城県", municipality: "栗原市", species: "マガン", zoneTo: "10/30解除" });
    expect(r.rows[1]).toMatchObject({ nationalNo: 1, prefecture: "秋田県", municipality: "由利本荘市", screening: null, pathogenicity: "H5亜型高病原性", final: "検査中" });
    expect(r.rows[2]).toMatchObject({ nationalNo: 3, species: null, sample: "環境試料(水)" });
  });

  it("欄外の注記（件から離れた文字）は、近い件の値に混ぜない", () => {
    const items = [...columnTable([KURIHARA, AKITA, WATER]), { page: 1, s: "※赤字の箇所が11月6日に更新", x: 190, y: 48 }];
    const r = parseMoeTable(items, 2026);
    expect(r.ok && r.rows[2]!.nationalNo).toBe(3);
  });

  it.each([
    ["表が無い", [] as PdfItem[], "no_table"],
    ["メンテナンスの表示", [{ page: 1, s: "メンテナンス中です", x: 10, y: 10 }], "no_table"],
    ["件が 0", columnTable([]), "no_rows"],
    ["回収日が読み込めない", columnTable([{ ...AKITA, date: "調査中" }]), "row_unreadable"],
    ["暦にない回収日", columnTable([{ ...AKITA, date: "2/30" }]), "row_unreadable"],
    ["見たことのない言い方（低病原性）", columnTable([{ ...AKITA, path: "低病原性" }]), "unknown_result_wording"],
    ["番号があるのに確定でない", columnTable([{ ...AKITA, path: "検査中", screening: "簡易陽性" }]), "numbered_row_not_confirmed"],
    ["番号の欄が読み込めない", columnTable([{ ...AKITA, no: "1例目と重複" }]), "national_no_unreadable"],
    ["同じ番号が 2 件", columnTable([AKITA, { ...AKITA, pref: "北海道", muni: "音更町" }]), "duplicate_national_no"],
    ["「病原性」の項目名が無い（県名の値はある）", columnTable([AKITA], COLUMN_ROWS.filter(([l]) => l !== "病原性")), "labels_missing"],
  ])("%s → 失敗（黙って 0 件や一部だけにしない）", (_, items, reason) => {
    expect(parseMoeTable(items, 2026)).toEqual({ ok: false, reason });
  });
});

describe("検査の段階と日付と番号", () => {
  it("最終判定が決まっていればそれ、検査中なら遺伝子検査、どちらも未定で簡易陽性なら screening_positive、それ以外は載せない", () => {
    expect(testOf({ screening: "簡易陽性", pathogenicity: "陰性(高病原性でない、その他鳥インフルエンザウイルス)", final: "陰性(高病原性でない、その他鳥インフルエンザウイルス)" })).toBe("negative");
    expect(testOf({ screening: null, pathogenicity: "H5亜型高病原性", final: "検査中" })).toBe("hpai_confirmed");
    expect(testOf({ screening: null, pathogenicity: "陰性", final: "H5N1亜型高病原性" })).toBe("hpai_confirmed");
    expect(testOf({ screening: "簡易陽性", pathogenicity: "検査中", final: "検査中" })).toBe("screening_positive");
    expect(testOf({ screening: "簡易陰性", pathogenicity: "検査中", final: "検査中" })).toBeNull();
  });
  it("月日に季の年を補う（6〜12 月は季の年、1〜5 月は翌年）。暦にない日は null", () => {
    expect(dateInSeason("10/27", 2026)).toBe("2026-10-27");
    expect(dateInSeason("3/5", 2025)).toBe("2026-03-05");
    expect(dateInSeason("11/30予定", 2026)).toBe("2026-11-30");
    expect(dateInSeason(null, 2026)).toBeNull();
    expect(dateInSeason("13/1", 2026)).toBeNull();
    expect(dateInSeason("2/30", 2026)).toBeNull();
  });
  it("一覧の題の「令和8年11月6日現在」を日付にする", () => {
    expect(asOfFromTitle("令和８（2026）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年11月６日現在）")).toBe("2026-11-06");
    expect(asOfFromTitle("令和8(2026)年シーズンの野鳥における鳥インフルエンザ発生状況")).toBeNull();
  });
  it("番号は野鳥国内の例目。番号のない件は回収日・県・市町村・種から（同じ件なら同じ）", () => {
    expect(tableBirdId(2026, { nationalNo: 2, collectedOn: "11/2", prefecture: "北海道", municipality: "音更町", species: "オオハクチョウ" })).toBe("wb-moe-2026-2");
    const a = tableBirdId(2026, { nationalNo: null, collectedOn: "10/27", prefecture: "宮城県", municipality: "栗原市", species: "マガン" });
    expect(a).toMatch(/^wb-moe-2026-x[0-9a-f]{16}$/u);
    expect(tableBirdId(2026, { nationalNo: null, collectedOn: "10/27", prefecture: "宮城県", municipality: "栗原市", species: "マガン" })).toBe(a);
  });
  it("表の 1 件を wildBirds の形にする。市町村の番号を引き、区域の日付は解除済みだけ to に入れる。種名が無ければ検体の種類", () => {
    const r = parseMoeTable(columnTable([KURIHARA, AKITA, WATER]), 2026);
    if (!r.ok) throw new Error("読み込めない");
    const [k, a, w] = r.rows.map((row) => rowToWildBird(row, 2026, geo, "https://www.env.go.jp/content/000438579.pdf"));
    expect(k).toMatchObject({ test: "negative", date: "2026-10-27", prefCode: "04", muniName: "栗原市", focusZone: { from: "2026-10-27", to: "2026-10-30" } });
    expect(k!.muniCode).toMatch(/^04\d{3}$/u);
    expect(a).toMatchObject({ id: "wb-moe-2026-1", test: "hpai_confirmed", date: "2026-11-02", prefCode: "05", species: "ハシブトガラス", focusZone: { from: "2026-11-06", to: null } });
    expect(w).toMatchObject({ id: "wb-moe-2026-3", prefCode: "46", species: "環境試料(水)" });
  });
});

const bird = (o: Partial<WildBird>): WildBird => ({
  id: "x",
  season: 2026,
  date: "2026-10-27",
  prefCode: "04",
  muniCode: "04213",
  muniName: "栗原市",
  species: "マガン",
  test: "screening_positive",
  focusZone: { from: null, to: null },
  sourceUrl: "https://www.env.go.jp/press/111118_00070.html",
  ...o,
});

function fakeIo(initial: WildBird[]): WildBirdIo & { store: Map<string, WildBird>; writes: string[]; removes: string[] } {
  const store = new Map(initial.map((b) => [b.id, b]));
  const writes: string[] = [];
  const removes: string[] = [];
  return {
    store,
    writes,
    removes,
    listSeason: async (s) => [...store.values()].filter((b) => b.season === s),
    set: async (b) => {
      store.set(b.id, b);
      writes.push(b.id);
    },
    remove: async (id) => {
      store.delete(id);
      removes.push(id);
    },
  };
}

const AS_OF = "2026-11-06";

describe("syncWildBirdTable: 国の一覧に合わせる", () => {
  it("読み取りから作った同じ件（簡易陽性のまま残った栗原市）を消し、表の件（陰性）を書く。2 回目は何も書かない（並び順が違っても）", async () => {
    const old = bird({ id: "wb-96ce9d606ddb7d8357e82964" });
    const io = fakeIo([old]);
    const table = bird({ id: "wb-moe-2026-xabc", test: "negative", sourceUrl: "https://www.env.go.jp/content/000438579.pdf" });
    expect(await syncWildBirdTable([table], 2026, io, AS_OF)).toEqual({ ok: true, written: ["wb-moe-2026-xabc"], removed: ["wb-96ce9d606ddb7d8357e82964"], unchanged: 0 });
    expect([...io.store.keys()]).toEqual(["wb-moe-2026-xabc"]);
    // 保存側が項目の並び順を変えても、同じ中身なら書かない
    const stored = io.store.get("wb-moe-2026-xabc")!;
    io.store.set(stored.id, Object.fromEntries(Object.entries(stored).reverse()) as unknown as WildBird);
    expect(await syncWildBirdTable([table], 2026, io, AS_OF)).toEqual({ ok: true, written: [], removed: [], unchanged: 1 });
    expect(io.writes).toEqual(["wb-moe-2026-xabc"]);
  });

  it("一覧の時点が分からない、または読み取りの記録の日付が一覧の時点より後なら、読み取りの記録は消さない（表にまだ載っていない新しい件かもしれない）", async () => {
    const io1 = fakeIo([bird({ id: "r1" })]);
    await syncWildBirdTable([bird({ id: "wb-moe-2026-xabc", test: "negative" })], 2026, io1, null);
    expect(io1.removes).toEqual([]);
    const io2 = fakeIo([bird({ id: "r2", date: "2026-11-05", test: "hpai_confirmed" })]);
    await syncWildBirdTable([bird({ id: "wb-moe-2026-8", date: "2026-10-30", test: "hpai_confirmed" })], 2026, io2, "2026-11-04");
    expect(io2.removes).toEqual([]);
  });

  it("別の件（県、市町村、種が違う、種が空、日付が範囲外）と、ほかの季の記録は消さない。1 つの表の件に対して消すのは最も近い 1 件だけ", async () => {
    const keep = [
      bird({ id: "r1", prefCode: "05", muniName: "由利本荘市" }),
      bird({ id: "r2", species: "オオハクチョウ" }),
      bird({ id: "r3", species: null }),
      bird({ id: "r4", date: "2026-10-19" }),
      bird({ id: "r5", season: 2025, date: "2025-10-27" }),
      bird({ id: "near", date: "2026-10-28" }),
      bird({ id: "far", date: "2026-11-02" }),
    ];
    const io = fakeIo(keep);
    await syncWildBirdTable([bird({ id: "wb-moe-2026-xabc", test: "negative" })], 2026, io, AS_OF);
    expect(io.removes).toEqual(["near"]);
  });

  it("前に書いた番号のある件が今回の表に無ければ、何も書かずに失敗を返す", async () => {
    const io = fakeIo([bird({ id: "wb-moe-2026-9", test: "hpai_confirmed" }), bird({ id: "r1" })]);
    expect(await syncWildBirdTable([bird({ id: "wb-moe-2026-xabc", test: "negative" })], 2026, io, AS_OF)).toEqual({ ok: false, reason: "numbered_rows_disappeared", missing: ["wb-moe-2026-9"] });
    expect(io.writes).toEqual([]);
    expect(io.removes).toEqual([]);
  });

  it("番号のない件に後から番号がついたら、番号のない古い記録を消す（点を二重にしない、次の回も失敗にならない）", async () => {
    const hashId = tableBirdId(2026, { nationalNo: null, collectedOn: "11/10", prefecture: "宮城県", municipality: "栗原市", species: "マガン" });
    const io = fakeIo([bird({ id: hashId, date: "2026-11-10" })]);
    const numbered = bird({ id: "wb-moe-2026-5", date: "2026-11-10", test: "hpai_confirmed" });
    expect(await syncWildBirdTable([numbered], 2026, io, AS_OF)).toMatchObject({ ok: true, written: ["wb-moe-2026-5"], removed: [hashId] });
    expect(await syncWildBirdTable([numbered], 2026, io, AS_OF)).toMatchObject({ ok: true, written: [], removed: [] });
  });

  it("同じ件の見分け: 種が両方あって同じ、市町村は名前の芯、日付は回収日の 7 日前〜10 日後", () => {
    expect(sameEvent(bird({}), bird({ species: null }))).toBe(false);
    expect(sameEvent(bird({}), bird({ muniName: null }))).toBe(false);
    expect(sameEvent(bird({}), bird({ date: "2026-11-06" }))).toBe(true);
    expect(sameEvent(bird({}), bird({ date: "2026-11-07" }))).toBe(false);
    expect(sameEvent(bird({}), bird({ date: "2026-10-20" }))).toBe(true);
    expect(sameEvent(bird({}), bird({ date: "2026-10-19" }))).toBe(false);
  });
});

describeFixture("環境省の今季の PDF の実物（11/6 現在、10/30 現在）と前季", [path.join(FIX, "season-2026-1106.pdf"), path.join(FIX, "season.pdf"), path.join(FIX, "season-2025-final.pdf")], () => {
  const TITLE_1106 = "令和8(2026)年シーズンの野鳥における鳥インフルエンザ発生状況(令和8年11月6日現在)";
  it("11/6 現在: 栗原市は陰性、秋田・北海道・鹿児島（環境試料）は確定の 4 件", async () => {
    const r = parseMoeTable(await extractPdfItems(fs.readFileSync(path.join(FIX, "season-2026-1106.pdf"))), 2026);
    if (!r.ok) throw new Error(r.reason);
    const birds = r.rows.map((row) => rowToWildBird(row, 2026, geo, "u"));
    expect(birds.map((b) => [b?.id.replace(/x[0-9a-f]+$/u, "x"), b?.prefCode, b?.muniName, b?.species, b?.test, b?.date])).toEqual([
      ["wb-moe-2026-x", "04", "栗原市", "マガン", "negative", "2026-10-27"],
      ["wb-moe-2026-1", "05", "由利本荘市", "ハシブトガラス", "hpai_confirmed", "2026-11-02"],
      ["wb-moe-2026-2", "01", "音更町", "オオハクチョウ", "hpai_confirmed", "2026-11-02"],
      ["wb-moe-2026-3", "46", "出水市", "環境試料(水)", "hpai_confirmed", "2026-11-02"],
    ]);
    for (const b of birds) expect(b?.muniCode).toMatch(/^\d{5}$/u);
  });
  it("10/30 現在: 栗原市の 1 件（陰性）", async () => {
    const r = parseMoeTable(await extractPdfItems(fs.readFileSync(path.join(FIX, "season.pdf"))), 2026);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((x) => [x.municipality, testOf(x)])).toEqual([["栗原市", "negative"]]);
  });
  it("前季（9 ページ）: 例目 1〜171 がそろい、すべて確定。番号のない 4 件は陰性。月ごとの件数が原本と同じ", async () => {
    const r = parseMoeTable(await extractPdfItems(fs.readFileSync(path.join(FIX, "season-2025-final.pdf"))), 2025);
    if (!r.ok) throw new Error(r.reason);
    const numbered = r.rows.filter((x) => x.nationalNo !== null);
    expect(new Set(numbered.map((x) => x.nationalNo)).size).toBe(171);
    expect(numbered.every((x) => testOf(x) === "hpai_confirmed")).toBe(true);
    expect(r.rows.filter((x) => x.nationalNo === null).map((x) => testOf(x))).toEqual(["negative", "negative", "negative", "negative"]);
    const months: Record<string, number> = {};
    for (const x of numbered) months[x.collectedOn.split("/")[0]!] = (months[x.collectedOn.split("/")[0]!] ?? 0) + 1;
    expect(months).toEqual({ "10": 14, "11": 38, "12": 16, "1": 19, "2": 16, "3": 48, "4": 19, "5": 1 });
  });
  it("tableSync: 11/6 の PDF で栗原市の古い記録を消し 4 件を書く。2 回目は書かない。番号の件が消えた古い版や、表でない PDF は書かずに失敗", async () => {
    const io = fakeIo([bird({ id: "wb-96ce9d606ddb7d8357e82964" })]);
    const ctx = { source: { id: "moe1" } as never, deps: { now: () => new Date("2026-11-07T00:00:00Z"), geo } as never, allow: () => true };
    const link = { href: "https://www.env.go.jp/content/000438579.pdf", text: TITLE_1106, type: "season_pdf" as const };
    expect(await tableSync(io)(fs.readFileSync(path.join(FIX, "season-2026-1106.pdf")), link, ctx)).toBe(true);
    expect(io.removes).toEqual(["wb-96ce9d606ddb7d8357e82964"]);
    expect([...io.store.values()].map((b) => b.test).sort()).toEqual(["hpai_confirmed", "hpai_confirmed", "hpai_confirmed", "negative"]);
    const writes = io.writes.length;
    expect(await tableSync(io)(fs.readFileSync(path.join(FIX, "season-2026-1106.pdf")), link, ctx)).toBe(true);
    expect(io.writes.length).toBe(writes);
    // 1 件しかない古い版を読むと、前に書いた番号の件（1〜3 例目）が無い → 書かない
    expect(await tableSync(io)(fs.readFileSync(path.join(FIX, "season.pdf")), link, ctx)).toBe(false);
    expect(io.writes.length).toBe(writes);
    expect(await tableSync(fakeIo([]))(Buffer.from("%PDF-1.4 (文字層なし)"), link, ctx)).toBe(false);
  });
});
