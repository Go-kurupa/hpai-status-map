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
