// 環境省の入口のリンクの選び方（I-12）。取得はしない。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBody, extractHtml } from "../src/watch/extract";
import { allowMoe, moeHandlers, selectMoeLinks } from "../src/watch/moe";
import { describeFixture } from "./helpers/fixtures";

const H = "https://www.env.go.jp";
const PDF_2026 = { href: `${H}/content/000438579.pdf`, text: "令和８（2026）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年10月30日現在）" };
const PRESS_NEG = { href: `${H}/press/111118_00083.html`, text: "野鳥における高病原性鳥インフルエンザ発生状況について（陰性確定、宮城県栗原市）" };
const PRESS_SUSPECT = { href: `${H}/press/111118_00070.html`, text: "野鳥における高病原性鳥インフルエンザ発生状況について （疑い事例、宮城県栗原市）" };
const NOT_PICKED = [
  { href: `${H}/content/000401155.pdf`, text: "2024-2025年シーズンのサーベイランスの結果・発生状況[PDF4.60MB]" },
  { href: `${H}/content/900490557.pdf`, text: "「死亡した野鳥を見つけたら」 [PDF 447KB]" },
  { href: `${H}/press/111118_00065.html`, text: "韓国での高病原性鳥インフルエンザ（H5亜型）の確認に伴う野鳥サーベイランスの対応レベルの引き上げについて" },
  { href: `${H}/content/000436973.pdf`, text: "韓国での高病原性鳥インフルエンザ（H5亜型）の確認に伴う野鳥サーベイランスの対応レベルの引き上げについて（令和８年10月21日）" },
];

describe("selectMoeLinks", () => {
  it("今季の PDF は season_pdf、野鳥の発生状況の報道発表は press。それ以外は選ばない", () => {
    const got = selectMoeLinks([...NOT_PICKED, PDF_2026, PRESS_NEG, PRESS_SUSPECT], 2026);
    expect(got).toEqual([
      { ...PDF_2026, type: "season_pdf" },
      { ...PRESS_NEG, type: "press" },
      { ...PRESS_SUSPECT, type: "press" },
    ]);
  });
  it("選ぶものがなければ空", () => {
    expect(selectMoeLinks(NOT_PICKED, 2026)).toEqual([]);
    expect(selectMoeLinks([], 2026)).toEqual([]);
  });
  it("季は題の（2026）で決める。ほかの季の PDF は今季ではない", () => {
    const prev = { href: `${H}/content/000300000.pdf`, text: "令和７（2025）年シーズンの野鳥における鳥インフルエンザ発生状況（令和８年5月31日現在）" };
    expect(selectMoeLinks([prev, PDF_2026], 2026).map((l) => l.href)).toEqual([PDF_2026.href]);
    expect(selectMoeLinks([prev, PDF_2026], 2025).map((l) => l.href)).toEqual([prev.href]);
  });
  it("PDF でなければ season_pdf にしない（今季の題の HTML、.pdf の語を含む別の経路）", () => {
    const html = { href: `${H}/nature/dobutsu/bird_flu/kokunai_2026.html`, text: PDF_2026.text };
    expect(selectMoeLinks([html], 2026)).toEqual([]);
  });
  it("URL が変わっても今季の題なら選ぶ。クエリ付きの .pdf も PDF", () => {
    const moved = { href: `${H}/content/000999999.pdf?v=2#page=1`, text: PDF_2026.text };
    expect(selectMoeLinks([moved], 2026)).toEqual([{ ...moved, type: "season_pdf" }]);
  });
  it("全角の数字と括弧、空白の違いを吸収する", () => {
    const full = { href: `${H}/content/1.pdf`, text: "令和８ （２０２６） 年シーズンの野鳥における 鳥インフルエンザ発生状況" };
    expect(selectMoeLinks([full], 2026).map((l) => l.type)).toEqual(["season_pdf"]);
  });
  it("リンクの文が空のものは選ばない", () => {
    expect(selectMoeLinks([{ href: `${H}/content/1.pdf`, text: "" }], 2026)).toEqual([]);
  });
});

describe("allowMoe: 環境省の https だけ", () => {
  it("www.env.go.jp の https は通し、http、別のホスト、サブドメイン違いは通さない", () => {
    expect(allowMoe(new URL(`${H}/content/1.pdf`))).toBe(true);
    expect(allowMoe(new URL("http://www.env.go.jp/a"))).toBe(false);
    expect(allowMoe(new URL("https://env.go.jp/a"))).toBe(false);
    expect(allowMoe(new URL("https://www.env.go.jp.example.com/a"))).toBe(false);
    expect(allowMoe(new URL("https://www.maff.go.jp/a"))).toBe(false);
  });
});

describe("moeHandlers", () => {
  it("moe の入口に checkMoe をつなぐ", () => {
    expect(Object.keys(moeHandlers)).toEqual(["moe"]);
    expect(typeof moeHandlers.moe).toBe("function");
  });
});

// 実物の控え（data/private/fixtures/moe/、公開しない）。取得は scripts/fetch-moe-fixtures.ts
const FIX = path.resolve(import.meta.dirname, "../../data/private/fixtures/moe");
describeFixture("環境省の入口の実物の控え", [path.join(FIX, "index.html")], () => {
  it("実物の入口から、今季の PDF が 1 本、野鳥の発生状況の報道発表だけが press で選ばれる（2026）", () => {
    const entrance = "https://www.env.go.jp/nature/dobutsu/bird_flu/";
    const page = extractHtml(decodeBody(fs.readFileSync(path.join(FIX, "index.html")), "text/html"), entrance);
    const got = selectMoeLinks(page.links, 2026);
    expect(got.filter((l) => l.type === "season_pdf").map((l) => l.href)).toEqual([PDF_2026.href]);
    const press = got.filter((l) => l.type === "press");
    expect(press.length).toBeGreaterThanOrEqual(1);
    for (const p of press) expect(p.text.replace(/\s/g, "")).toContain("野鳥における高病原性鳥インフルエンザ発生状況について");
    expect(got.map((l) => l.href)).not.toContain(`${H}/press/111118_00065.html`); // 韓国での確認に伴う対応レベル
  });
});
