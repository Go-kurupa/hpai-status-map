import { expect, test, type Page } from "@playwright/test";

// /trends の作り直し（設計書 2026-11-06-trends-redesign、案 C）。本番と同じ build が配る data/trends/insights.json（実データの集計）を読む。
// TRENDS_SHOT_DIR を渡したときだけ、画面の写しを残す（確認用。リポジトリには入れない）。
const shot = async (page: Page, name: string) => {
  const dir = process.env.TRENDS_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("全国の傾向（作り直し）", () => {
  test("PC の幅: 要点に割合があり、押した項目の詳しい欄が右に出る", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/trends");
    const points = page.locator("section.tr-points");
    await expect(points).toContainText(/のうち、ねずみの痕跡があったと書かれていたのは \d+ 件（約 \d+ 割）/u);
    await expect(points).toContainText("発生していない農場との比べはありません");
    // 段階 2 の抽出の集計が入っていれば「どう気づいたか」の枠が出る
    if (await page.getByRole("heading", { name: "発生農場はどう気づいたか" }).count()) {
      await expect(page.locator("section.tr-noticing")).toContainText(/まとまった死亡・急な大量死\s*\d+ 件/u);
    }
    const side = page.getByRole("complementary", { name: "くわしく" });
    await expect(side.getByRole("heading", { name: "ねずみの痕跡" })).toBeVisible();
    await shot(page, "trends-pc");
    await page.getByRole("button", { name: /壁やネットの破損/u }).click();
    await expect(side.getByRole("heading", { name: "壁やネットの破損" })).toBeVisible();
    await page.getByRole("button", { name: "2025/26" }).click();
    await expect(page.getByRole("button", { name: /ねずみの痕跡/u })).toContainText(/（\d+ 件中）/u);
    expect(await noSideScroll(page)).toBe(true);
  });

  test("スマホの幅（360px）: 横にはみ出さず、押した帯のすぐ下に詳しい欄が開く", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/trends");
    await expect(page.locator("section.tr-points")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "くわしく" })).toHaveCount(0);
    // はじめに開いている詳しい欄（ねずみ）も含め、どの要素も 360px を超えない
    const wide = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".trends *"))
        // 横に流す枠（シーズンのボタンの列、表の枠）の中は、枠の中で流れるだけなので数えない
        .filter((el) => !el.closest(".tr-chips, .table-scroll") && el.getBoundingClientRect().right > 360.5)
        .map((el) => `${el.tagName}.${el.className} 右端 ${Math.round(el.getBoundingClientRect().right)}`)
        .slice(0, 10),
    );
    expect(wide).toEqual([]);
    const wall = page.getByRole("button", { name: /壁やネットの破損/u });
    await wall.click();
    await expect(wall).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("li.tr-row-open").getByRole("heading", { name: "壁やネットの破損" })).toBeVisible();
    await expect(page.locator("svg.migration-range").first()).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, "trends-360");
  });
});
