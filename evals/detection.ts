// 検知の数え方（I-06、設計書 §16 検知）。I-01 の国の判定（題の分類と定型文の読み取り）を、控えに当てて数える。Claude は使わない。
//
// 控え: data/private/fixtures/maff/（scripts/fetch-maff-fixtures.ts が置く）。月別一覧 7 ページ（令和7年10月〜令和8年4月）と、題で絞った確認の発表。
// 控えがなければ null を返す。呼ぶ側は 0 と書かず、summary の unmeasured に入れる。
import fs from "node:fs";
import path from "node:path";
import { filterMaffItems, isMaffOutbreakTitle, parseMaffPress } from "@hpai/shared/read/maff";
import { normalizeForMatch } from "@hpai/shared/text";
import type { HistoryCase } from "@hpai/shared/types";
import { decodeBody, extractHtml } from "../functions/src/watch/extract";

export const MONTHS = ["2510", "2511", "2512", "2601", "2602", "2603", "2604"] as const;
/** 前季（2025 シーズン）の発生。cases.json の related:false の数。 */
export const PREV_SEASON_COUNT = 24;
/** 月別一覧 7 ページの、題に「高病原性鳥インフルエンザ」を含む 70 題の分類の数: 確認、解除、それ以外。 */
export const TITLE_SPLIT = { confirmed: 24, movement_lifted: 21, other: 25 } as const;
export const TITLE_COUNT = TITLE_SPLIT.confirmed + TITLE_SPLIT.movement_lifted + TITLE_SPLIT.other;

function readPage(file: string, url: string) {
  return extractHtml(decodeBody(fs.readFileSync(file), "text/html"), url);
}

/**
 * prevSeason: 前季の確認の発表のうち、都道府県、市町村、国内の番号、日付が cases.json と一致した数。
 * titles: 題の分類が上の数（確認 24、解除 21、それ以外 25）の枠に入った題の数。全部合えば 70。
 * 控え（月別一覧、確認の発表）か cases.json がなければ null。
 */
export async function measureDetection(fixtureDir: string, historyPath: string): Promise<{ prevSeason: number; titles: number } | null> {
  const listFiles = MONTHS.map((m) => path.join(fixtureDir, `arc-${m}.html`));
  if (!listFiles.every((f) => fs.existsSync(f)) || !fs.existsSync(historyPath)) return null;

  const links = MONTHS.flatMap((m, i) => readPage(listFiles[i]!, `https://www.maff.go.jp/j/press/arc/${m}.html`).links);
  const hpai = links.filter((l) => normalizeForMatch(l.text).includes("高病原性鳥インフルエンザ"));
  const kinds = hpai.map((l) => isMaffOutbreakTitle(l.text));
  const actual = {
    confirmed: kinds.filter((k) => k === "confirmed").length,
    movement_lifted: kinds.filter((k) => k === "movement_lifted").length,
    other: kinds.filter((k) => k === null).length,
  };
  const titles = Math.min(actual.confirmed, TITLE_SPLIT.confirmed) + Math.min(actual.movement_lifted, TITLE_SPLIT.movement_lifted) + Math.min(actual.other, TITLE_SPLIT.other);

  const prev = (JSON.parse(fs.readFileSync(historyPath, "utf8")) as HistoryCase[]).filter((h) => h.season === 2025 && !h.related);
  const confirmed = filterMaffItems(links).filter((i) => i.type === "confirmed");
  const files = confirmed.map((i) => ({ item: i, file: path.join(fixtureDir, path.basename(new URL(i.url).pathname)) }));
  if (!files.every((f) => fs.existsSync(f.file))) return null;
  let prevSeason = 0;
  for (const h of prev) {
    const hit = files.some(({ item, file }) => {
      const p = parseMaffPress(readPage(file, item.url).text);
      return p !== null && p.nationalNo === h.no && p.prefCode === h.prefCode && p.muniName === normalizeForMatch(h.muniNameThen) && p.date === h.date;
    });
    if (hit) prevSeason += 1;
  }
  return { prevSeason, titles };
}
