import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chooseTown,
  expectNoForbiddenText,
  KURASHIKI_MESH,
  prepare,
  seasonButtonLabels,
  TSUYAMA_CASE,
  waitForWord,
} from "./wording.helper";

// 文言と時点の通し（X-20、設計書 §3.1、§15、§16「文言」）。
// 全ての経路で、画面に禁句（区域の外です、安全、安心）と、過去の発生の NG の語がないこと、
// 「いつ時点か」（時点、確認日、印刷日、最後の記録）が出ていること。
// 語が出るまで待ってから調べる（「読み込んでいます」の画面を調べて素通りしない）。
// 実行: web/ で `browser-guard run -- npx playwright test wording`

/** 1 つの経路につき 1 つの試験にして、1 つ落ちても残りの結果が見えるようにする */
const WORD_ROUTES: ReadonlyArray<{ word: string; paths: readonly string[] }> = [
  {
    word: "時点",
    paths: ["/area/33203", "/area/33214", "/area/01100", "/replay", "/replay/backstage", "/sample", "/sample/todo", "/results"],
  },
  { word: "確認日", paths: ["/public", "/privacy", "/login", "/known"] },
  { word: "印刷日", paths: ["/poster"] },
  { word: "最後の記録", paths: ["/sample/record", "/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection"] },
];

/** この画面は仮（「準備中です」）なら、巡回に入れない */
const PLACEHOLDER = "この画面は準備中です";

test.describe("全経路の文言と時点", () => {
  for (const { word, paths } of WORD_ROUTES) {
    for (const path of paths) {
      test(`${path}: 「${word}」が出て、禁句がない`, async ({ page }) => {
        await prepare(page, { cases: [TSUYAMA_CASE] });
        await page.goto(path);
        await waitForWord(page, word);
        await expectNoForbiddenText(page);
      });
    }
  }

  // /trends は X-27（落とす単位）。作られていて仮の画面でなくなったら、時点を確かめる
  test("/trends: 作られていれば、「時点」が出て、禁句がない（仮の画面は飛ばす）", async ({ page }) => {
    await prepare(page, { cases: [TSUYAMA_CASE] });
    await page.goto("/trends");
    // 経路の画面が読み込まれる（「読み込んでいます」が消える）のを待ってから、仮の画面かを見る
    await page.waitForFunction(() => document.body.innerText.trim().length > 0 && !document.body.innerText.includes("読み込んでいます"));
    const placeholder = await page.evaluate((t) => document.body.innerText.includes(t), PLACEHOLDER);
    test.skip(placeholder, "/trends はまだ仮の画面（準備中です）。X-27 で作ったときに巡回に入る");
    await waitForWord(page, "時点");
    await expectNoForbiddenText(page);
  });

  test("存在しない経路の画面にも禁句がない", async ({ page }) => {
    await prepare(page);
    await page.goto("/no-such-page");
    await waitForWord(page, "ページが見つかりません");
    await expectNoForbiddenText(page);
  });
});

// ── 地図の入口 ──
// ①②③④と、町を選んでいない状態の 5 つ。それぞれで今季、昨季、2 年前…と、6 シーズン前まで切り替えても禁句がない。

const REPLAY_DEFAULT_SPOT = JSON.parse(
  readFileSync(resolve(process.cwd(), "..", "data", "replay", "scenario.json"), "utf8"),
).defaultSpot as { meshCode: string; muniCode: string; frequentMuniCodes: string[] };

interface Level {
  name: string;
  /** 段階を示す 1 文（W-03 の画面の文）。fixture が意図した段階になっていることの確認 */
  sentence: string;
  setup: (page: Page) => Promise<void>;
  storage?: Record<string, string>;
}

const LEVELS: readonly Level[] = [
  {
    name: "①（区域に入っている可能性）",
    sentence: "区域に入っている可能性があります。県の連絡を確かめてください",
    storage: { "hpai.spot.v1": JSON.stringify(REPLAY_DEFAULT_SPOT) },
    setup: async () => {},
  },
  {
    name: "②（隣町で発生）",
    sentence: "隣町で発生しました",
    setup: async (page) => chooseTown(page, "33", "33214"),
  },
  {
    name: "③（行き来する町で発生）",
    sentence: "登録した町で発生しました",
    storage: { "hpai.spot.v1": JSON.stringify({ meshCode: KURASHIKI_MESH, muniCode: "33202", frequentMuniCodes: ["33203"] }) },
    setup: async () => {},
  },
  {
    name: "④（全国の動き）",
    sentence: "全国の動きをお知らせしています",
    setup: async (page) => chooseTown(page, "01", "01100"),
  },
  {
    name: "町を選んでいない",
    sentence: "町を選んでください",
    setup: async () => {},
  },
];

test.describe("地図の入口: 段階とシーズンの切り替え", () => {
  for (const level of LEVELS) {
    test(`${level.name}: 全てのシーズンに切り替えても、禁句がなく、時点が出る`, async ({ page }) => {
      await prepare(page, { cases: [TSUYAMA_CASE], storage: level.storage });
      await page.goto("/");
      await waitForWord(page, "時点");
      await level.setup(page);
      // fixture が意図した段階になっているか（違えば、別の段階を調べてしまう）
      await expect(page.getByText(level.sentence, { exact: false }).first()).toBeVisible();
      await expectNoForbiddenText(page);

      const labels = await seasonButtonLabels(page);
      expect(labels.length, "シーズンの切り替えのボタンの数").toBeGreaterThanOrEqual(6);
      const buttons = page.locator('section[aria-label="シーズンの切り替え"] button');
      for (let i = 0; i < labels.length; i++) {
        const label = (labels[i] ?? "").replace(/\s+/gu, " ");
        await buttons.nth(i).click();
        await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", "true");
        // 禁句は、どのシーズンでも落とす。時点は、全ての画面に出す決まり（§15）なので、出ないシーズンを全部数えてから落とす
        await expectNoForbiddenText(page).catch((e: Error) => {
          throw new Error(`${level.name} / ${label}: ${e.message}`);
        });
        const hasAsOf = await page.waitForFunction(() => document.body.innerText.includes("時点"), undefined, { timeout: 4_000 }).then(
          () => true,
          () => false,
        );
        expect.soft(hasAsOf, `${level.name} / ${label}: 「時点」が出ていない`).toBe(true);
      }
    });
  }
});

// ── 再現 ──
test.describe("再現: 全ての出来事の状態", () => {
  test("はじまりから最後まで 1 つずつ進めても、禁句がなく、時点が出る", async ({ page }) => {
    await prepare(page);
    await page.goto("/replay");
    await waitForWord(page, "時点");
    await expectNoForbiddenText(page);
    const next = page.getByRole("button", { name: "次へ" });
    let steps = 0;
    while (await next.isEnabled()) {
      await next.click();
      steps += 1;
      await waitForWord(page, "時点");
      await expectNoForbiddenText(page);
      if (steps > 40) throw new Error("再現が終わりません");
    }
    expect(steps).toBeGreaterThanOrEqual(14);
  });

  test("全国の流れも、はじまりから最後まで 1 つずつ進めて、禁句がなく、時点が出る", async ({ page }) => {
    await prepare(page);
    await page.goto("/replay");
    await waitForWord(page, "時点");
    await page.getByRole("button", { name: "全国の流れ" }).click();
    await expect(page.getByText("0 / 24")).toBeVisible();
    await expect(page.locator(".stat-row")).toBeVisible();
    await expectNoForbiddenText(page);
    const next = page.getByRole("button", { name: "次へ" });
    let steps = 0;
    while (await next.isEnabled()) {
      await next.click();
      steps += 1;
      await expect(page.getByText(`${steps} / 24`)).toBeVisible();
      // 帯の『再現の時点』はいつも出ているので、札の時点（再現の時計）が出るまで待つ
      await expect(page.locator(".stat .as-of")).toHaveText(/\d+ 月 \d+ 日 時点/);
      await expectNoForbiddenText(page);
      if (steps > 24) throw new Error("全国の流れが終わりません");
    }
    expect(steps).toBe(24);
  });
});
