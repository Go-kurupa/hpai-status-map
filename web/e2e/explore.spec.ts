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

test("メニューから条件で見るを開き、中国地方の問いで 19 件と事例の一覧が出る", async ({ page }) => {
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  await page.goto("/");
  await goViaMenu(page, "条件で見る");
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
