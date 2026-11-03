import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";

test.describe("骨格", () => {
  test("幅 360px で横にはみ出さず、『やること』で /todo に行く", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await installFixture(page, { now: "2025-12-21T09:00:00+09:00", cases: [], wildBirds: [], watch: [] });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "メイン" });
    await expect(nav.getByRole("link")).toHaveText(["地図", "やること", "記録"]);
    await expect(page.getByRole("banner").getByRole("link", { name: "設定" })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    // 押せるものは高さ 48px 以上
    for (const link of await nav.getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }

    await nav.getByRole("link", { name: "やること" }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(page.getByRole("heading", { name: "やること" })).toBeVisible();
  });
});

test.describe("公開の画面に Firebase を載せない", () => {
  for (const path of ["/public", "/poster", "/known"]) {
    test(`${path} は Firebase の JS を読まず、Google への要求が 0 件`, async ({ page }) => {
      const googleRequests: string[] = [];
      page.on("request", (req) => {
        const host = new URL(req.url()).hostname;
        if (host.endsWith("googleapis.com") || host.endsWith("firebaseio.com")) googleRequests.push(req.url());
      });
      const reading: Array<Promise<void>> = [];
      const scripts: string[] = [];
      page.on("response", (res) => {
        if (res.request().resourceType() !== "script") return;
        reading.push(res.text().then((body) => void scripts.push(body)));
      });

      await page.goto(path);
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await Promise.all(reading);

      expect(scripts.length).toBeGreaterThan(0);
      expect(scripts.filter((body) => body.includes("FirebaseError"))).toHaveLength(0);
      expect(googleRequests).toEqual([]);
    });
  }
});
