// 前季（2025 シーズン）の国の報道発表の控えで、検知と定型文の読み取りを確かめる（設計書 §16 検知）。
// 控えは scripts/fetch-maff-fixtures.ts が data/private/fixtures/maff/ に置く（公開しない）。
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { classifyMaffTitle, filterMaffItems, isMaffOutbreakTitle, parseMaffFarm, parseMaffLift, parseMaffPress } from "@hpai/shared/read/maff";
import { normalizeForMatch } from "@hpai/shared/text";
import type { HistoryCase } from "@hpai/shared/types";
import { decodeBody, extractHtml } from "../src/watch/extract";
import { describeFixture } from "./helpers/fixtures";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/private/fixtures/maff");
const MONTHS = ["2510", "2511", "2512", "2601", "2602", "2603", "2604"];
const LIST_FILES = MONTHS.map((m) => path.join(DIR, `arc-${m}.html`));
const CASES_JSON = path.join(ROOT, "data/history/cases.json");

function readPage(file: string, url: string) {
  return extractHtml(decodeBody(fs.readFileSync(file), "text/html"), url);
}

describeFixture("国の月別一覧 2510〜2604 の 7 ページ（控え）", [...LIST_FILES, CASES_JSON], () => {
  const links = MONTHS.flatMap((m) => readPage(path.join(DIR, `arc-${m}.html`), `https://www.maff.go.jp/j/press/arc/${m}.html`).links);
  const hpaiLinks = links.filter((l) => normalizeForMatch(l.text).includes("高病原性鳥インフルエンザ"));
  const items = filterMaffItems(links);
  const pageOf = (url: string) => readPage(path.join(DIR, path.basename(new URL(url).pathname)), url);
  const prev = (JSON.parse(fs.readFileSync(CASES_JSON, "utf8")) as HistoryCase[]).filter((h) => h.season === 2025 && !h.related);

  it("題に高病原性鳥インフルエンザを含む 70 題を、確認 24、解除 21、それ以外 25 に分ける", () => {
    expect(hpaiLinks).toHaveLength(70);
    const kinds = hpaiLinks.map((l) => isMaffOutbreakTitle(l.text));
    expect(kinds.filter((k) => k === "confirmed")).toHaveLength(24);
    expect(kinds.filter((k) => k === "movement_lifted")).toHaveLength(21);
    expect(kinds.filter((k) => k === null)).toHaveLength(25);
  });

  it("確認にも解除にも当たらない 25 題の分類（unclassified の件数と題を見える形にする）", () => {
    const rest = hpaiLinks.filter((l) => isMaffOutbreakTitle(l.text) === null);
    const unclassified = rest.filter((l) => classifyMaffTitle(l.text) === "unclassified");
    // 前季の実物では 0 件（遺伝子解析、野鳥、輸入停止、輸出再開などは語で外れる）。増えたら毎シーズン箱が雑音で埋まる
    expect(unclassified.map((l) => l.text)).toEqual([]);
  });

  it("filterMaffItems は確認と解除の 45 本だけを返し、他の題（遺伝子解析、野鳥、輸入停止、輸出再開）を含まない", () => {
    expect(items).toHaveLength(45);
    expect(items.filter((i) => i.type === "confirmed")).toHaveLength(24);
    expect(items.filter((i) => i.type === "movement_lifted")).toHaveLength(21);
    expect(items.every((i) => new URL(i.url).hostname === "www.maff.go.jp")).toBe(true);
  });

  it("前季 24 事例すべての都道府県、市町村、N、日付が、過去の資料（cases.json）と一致する", () => {
    expect(prev).toHaveLength(24);
    const parsed = items
      .filter((i) => i.type === "confirmed")
      .map((i) => ({ url: i.url, p: parseMaffPress(pageOf(i.url).text) }));
    expect(parsed.filter((x) => x.p === null).map((x) => x.url)).toEqual([]);
    for (const h of prev) {
      const hit = parsed.find((x) => x.p!.nationalNo === h.no);
      expect(hit, `国内${h.no}例目の発表が見つからない`).toBeDefined();
      expect(hit!.p).toEqual({
        prefCode: h.prefCode,
        muniName: normalizeForMatch(h.muniNameThen),
        nationalNo: h.no,
        date: h.date,
      });
    }
  });

  it("251201 は見出しの日付が 12/2（経緯の 12/1 ではない）、金ケ崎町は金ヶ崎町と正規化で一致する", () => {
    const yonago = items.find((i) => i.url.endsWith("/251201.html"))!;
    expect(parseMaffPress(pageOf(yonago.url).text)?.date).toBe("2025-12-02");
    const kanegasaki = items.find((i) => i.url.endsWith("/260221.html"))!;
    expect(parseMaffPress(pageOf(kanegasaki.url).text)?.muniName).toBe(normalizeForMatch("金ヶ崎町"));
  });

  it("羽数と用途が cases.json と一致する（関連農場の行を混ぜない）", () => {
    for (const i of items.filter((x) => x.type === "confirmed")) {
      const text = pageOf(i.url).text;
      const no = parseMaffPress(text)!.nationalNo;
      const h = prev.find((x) => x.no === no)!;
      expect(parseMaffFarm(text), `国内${no}例目`).toEqual({ headCount: h.headCount, birdUse: h.birdUse });
    }
  });

  it("解除 21 本がすべて読め、251210 は [3,4]、260318 は [18,19]、県と市町村は前季の事例と一致する", () => {
    const lifts = items.filter((i) => i.type === "movement_lifted").map((i) => ({ url: i.url, l: parseMaffLift(pageOf(i.url).text) }));
    expect(lifts.filter((x) => x.l === null).map((x) => x.url)).toEqual([]);
    expect(lifts.find((x) => x.url.endsWith("/251210.html"))!.l!.nationalNos).toEqual([3, 4]);
    expect(lifts.find((x) => x.url.endsWith("/260318.html"))!.l!.nationalNos).toEqual([18, 19]);
    const covered = new Set(lifts.flatMap((x) => x.l!.nationalNos));
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => n !== 24));
    for (const { l } of lifts) {
      for (const no of l!.nationalNos) {
        const h = prev.find((x) => x.no === no)!;
        expect(l!.prefCode).toBe(h.prefCode);
        expect(l!.muniName).toBe(normalizeForMatch(h.muniNameThen));
        expect(l!.date >= h.date).toBe(true);
      }
    }
  });

  it("津山の解除は 2026-01-21、防疫措置の完了 2025-12-30、搬出制限の解除 2026-01-10。白老は解除した日 2025-11-24（見出しは 11/25）", () => {
    const tsuyama = items.find((i) => i.url.endsWith("/260121_1.html"))!;
    expect(parseMaffLift(pageOf(tsuyama.url).text)).toMatchObject({ date: "2026-01-21", controlDone: "2025-12-30", shipmentLifted: "2026-01-10" });
    const shiraoi = items.find((i) => i.url.endsWith("/251125.html"))!;
    expect(parseMaffLift(pageOf(shiraoi.url).text)).toMatchObject({ date: "2025-11-24" });
  });

  it("原本の年の書き間違い（嵐山 260127_2 の防疫措置の完了日）は null にして、他の日付は取る", () => {
    const arashiyama = items.find((i) => i.url.endsWith("/260127_2.html"))!;
    expect(parseMaffLift(pageOf(arashiyama.url).text)).toMatchObject({ muniName: "嵐山町", controlDone: null, shipmentLifted: "2026-01-17" });
  });
});

// 主の入口（報道発表の index.html）の実物。発生のない時期の控えなので、確認と解除の題は 0 本。
// 実物の作りのまま 1 本のリンクを確認の題に差し替え、同じ作りで拾えることを確かめる。
const PRESS_INDEX = path.join(DIR, "press-index.html");
const PRESS_BASE = "https://www.maff.go.jp/j/press/index.html";
describeFixture("報道発表の index.html（控え）", [PRESS_INDEX], () => {
  const raw = decodeBody(fs.readFileSync(PRESS_INDEX), "text/html");

  it("リンクは全文の題つきの個別の発表で、確認と解除の題は（発生のない時期なので）0 本", () => {
    const { links } = extractHtml(raw, PRESS_BASE);
    const releases = links.filter((l) => /\/j\/press\/.+\/\d{6}(_\d+)?\.html$/.test(l.href));
    expect(releases.length).toBeGreaterThanOrEqual(15);
    expect(releases.every((l) => l.href.startsWith("https://") && l.text.length > 5)).toBe(true);
    expect(filterMaffItems(links)).toEqual([]);
  });

  it("実物と同じ作りのリンクを確認の題に差し替えると、絶対 URL で拾える", () => {
    const $ = cheerio.load(raw);
    const a = $('a[href*="/j/press/"][href$=".html"]').filter((_, el) => /\d{6}\.html$/.test($(el).attr("href") ?? "")).first();
    a.attr("href", "/j/press/syouan/douei/251220.html").text("岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について");
    const items = filterMaffItems(extractHtml($.html(), PRESS_BASE).links);
    expect(items).toEqual([
      {
        url: "https://www.maff.go.jp/j/press/syouan/douei/251220.html",
        title: "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について",
        type: "confirmed",
      },
    ]);
  });
});
