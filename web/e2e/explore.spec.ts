import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";
import { goViaMenu } from "./helpers/frame";

// 条件で見る過去の発生（設計書 2026-11-06-data-explore）。過去は実データ（data/history/cases.json）、今季の事例は 0 件。
const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-10T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-10T08:30:00+09:00",
  failingSince: null,
}));

test("メニューから数で見るを開き、中国地方の問いで 19 件と事例の一覧が出る", async ({ page }) => {
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  await page.goto("/");
  await goViaMenu(page, "数で見る");
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByRole("group", { name: "よく聞かれる問い" }).getByRole("button", { name: "中国地方の過去は？" }).click();
  await expect(page.locator(".explore-answer")).toContainText("19 件");
  await expect(page.locator(".explore-cases tbody tr")).toHaveCount(19);
  await expect(page.locator(".explore-cases tbody tr").first().getByRole("link", { name: "資料" })).toHaveAttribute("href", /^https:\/\//);
  await expect(page.getByRole("link", { name: "地図で中国を見る" })).toHaveAttribute("href", "/compare?region=chugoku");
});

test("月の行を押すとその月の事例に絞れ、もう一度押すと戻る", async ({ page }) => {
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  await page.goto("/explore");
  const months = page.getByRole("group", { name: "月ごとの件数（押すとその月に絞ります）" });
  await expect(months.getByRole("button")).toHaveCount(12);
  const dec = months.getByRole("button", { name: /^12 月/ });
  await dec.click();
  await expect(dec).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".explore-answer")).toContainText("12 月");
  await expect(page.locator(".explore-answer")).toContainText("72 件");
  await expect(page.locator(".explore-cases tbody tr")).toHaveCount(72);
  await expect(page.getByRole("group", { name: "用途" }).getByRole("button", { name: "採卵鶏 49 件" })).toBeVisible();
  await dec.click();
  await expect(page.locator(".explore-answer")).toContainText("247 件");
});

// 本番を出し直した後、前から開いていた画面が古い部品のファイルを読みに行って失敗しても、1 回だけ読み込み直して開ける（作者 11/7「条件で見るでクラッシュ」）
test("数で見るの部品の読み込みに 1 回失敗しても、読み込み直して開ける", async ({ page }) => {
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  let failed = false;
  await page.route(/\/assets\/ExplorePage-[^/]*\.js$/, (r) => {
    if (failed) return r.continue();
    failed = true;
    return r.fulfill({ status: 404, body: "not found" });
  });
  await page.goto("/compare");
  await page.getByRole("navigation", { name: "過去の発生の見方" }).getByRole("link", { name: "数で見る" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("数で見る過去の発生", { timeout: 20_000 });
  expect(failed).toBe(true);
});

