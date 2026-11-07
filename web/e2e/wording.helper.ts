// 文言の試験の共通部品（X-20）。
//   expectNoForbiddenText(page): 画面に出ている文字（本文、入力欄の中身、aria-label などの属性）に
//     禁句と、過去の発生の NG の語（どちらも shared/src/wording.ts の findWordingViolations）（設計書 §11「過去の発生の文言」の右の列）がないことを確かめる。
//   「読み込んでいます」の画面を調べて素通りしないよう、各経路で必ず出る語（時点など）を先に待つ（waitForWord）。
// 試験の入口（window.__HPAI_FIXTURE__）は mode=e2e の build だけが読む。ここでは置くだけで、画面のコードは変えない。
import { normalizeForMatch } from "@hpai/shared/text";
import { findWordingViolations } from "@hpai/shared/wording";
import type { Case } from "@hpai/shared/types";
import type { Page } from "@playwright/test";
import { installFixture } from "./fixtures";

/** 画面から集めた文字の 1 まとまり。どこにあったかを示すために出どころの名前を付ける */
export interface CollectedText {
  from: string;
  text: string;
}

/**
 * 画面に出ている文字を集める。見えている本文（innerText）に加え、入力欄と textarea の中身
 * （声かけ文、報告文の下書きは value にある）、aria-label、title、alt、placeholder、タブの題。
 */
export async function collectVisibleText(page: Page): Promise<CollectedText[]> {
  return page.evaluate(() => {
    // 畳んだ中は innerText に入らないので、検査の前に全部開く
    document.querySelectorAll("details").forEach((d) => {
      d.open = true;
    });
    const out: Array<{ from: string; text: string }> = [];
    out.push({ from: "タブの題", text: document.title });
    out.push({ from: "本文", text: document.body.innerText });
    document.querySelectorAll("input, textarea, select").forEach((el, i) => {
      const v = (el as HTMLInputElement).value;
      if (typeof v === "string" && v !== "") out.push({ from: `入力欄 ${i}（${el.tagName.toLowerCase()}）`, text: v });
    });
    for (const attr of ["aria-label", "title", "alt", "placeholder"]) {
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        const v = el.getAttribute(attr);
        if (v) out.push({ from: `${attr} 属性`, text: v });
      });
    }
    return out;
  });
}

/** 画面に禁句と過去の発生の NG の語がないことを確かめる。見つけたら、どの語がどこにあったかを添えて落とす。 */
export async function expectNoForbiddenText(page: Page): Promise<void> {
  const found: string[] = [];
  for (const piece of await collectVisibleText(page)) {
    for (const word of findWordingViolations(piece.text)) {
      const at = normalizeForMatch(piece.text).indexOf(normalizeForMatch(word.split(" ")[0] ?? word));
      const around = at >= 0 ? normalizeForMatch(piece.text).slice(Math.max(0, at - 12), at + 20) : "";
      found.push(`「${word}」が ${piece.from} にあります${around ? `: …${around}…` : ""}`);
    }
  }
  if (found.length > 0) {
    throw new Error(`${page.url()} の画面に使ってはいけない語があります\n  ${found.join("\n  ")}`);
  }
}

/**
 * 経路ごとに必ず出る語（時点、確認日、印刷日、最後の記録）が画面に出るまで待つ。
 * 先に待たないと、「読み込んでいます」の画面を調べて禁句なしと誤って通る。
 */
export async function waitForWord(page: Page, word: string, timeoutMs = 20_000): Promise<void> {
  try {
    await page.waitForFunction((w) => document.body.innerText.includes(w), word, { timeout: timeoutMs });
  } catch {
    const head = (await page.evaluate(() => document.body.innerText)).replace(/\s+/gu, " ").slice(0, 160);
    throw new Error(`${page.url()} に「${word}」が出ません（画面の先頭: ${head}）`);
  }
}

// ── 画面の準備 ──

export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 画面の時計。冬のシーズン中 */
export const NOW = "2026-11-10T09:00:00+09:00";

/** 見回りがすべて成功した 47 県 */
export const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-10T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-10T08:30:00+09:00",
  failingSince: null,
}));

/** 津山市（33203）で今季、確定。移動制限の解除はまだ */
export const TSUYAMA_CASE: Case = {
  id: "e2e-wording-1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: null,
  housing: null,
  headCount: 1000,
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
};

/** 倉敷市の 3 次メッシュ（津山市とは隣り合わず、10km より離れている） */
export const KURASHIKI_MESH = "51337601";

/** 地理院タイルは外へ出さず、1 画素の PNG で答える。公開の画面の時計と事例は fixture で置く */
export async function prepare(page: Page, o: { cases?: Case[]; storage?: Record<string, string> } = {}): Promise<void> {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  await installFixture(page, { now: NOW, cases: o.cases ?? [], wildBirds: [], watch: WATCH_OK });
  if (o.storage) {
    await page.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, v);
    }, o.storage);
  }
}

/** 地図の入口で町を選ぶ（town.spec.ts と同じ操作） */
export async function chooseTown(page: Page, pref: string, muni: string): Promise<void> {
  await page.getByRole("button", { name: "地域を選択", exact: true }).click();
  await page.getByLabel("都道府県").selectOption(pref);
  await page.getByLabel("市町村").selectOption(muni);
  await page.getByRole("button", { name: "この地域にする" }).click();
}

/** 地図で比べるのシーズンのボタン（今季、1 年前、2 年前…）の題を、画面の並びのまま返す */
export async function seasonButtonLabels(page: Page): Promise<string[]> {
  return page.locator(".cmp-seasons button").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
}
