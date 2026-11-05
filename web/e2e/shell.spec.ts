import { expect, test, type Locator, type Page } from "@playwright/test";
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

test.describe("幅 360px の最初の画面（360x740）に守る文が入る", () => {
  const AT = "2026-11-04T08:30:00+09:00";
  const watch = Array.from({ length: 47 }, (_, i) => ({
    prefCode: String(i + 1).padStart(2, "0"),
    checkedAt: AT,
    ok: true,
    lastOkAt: AT,
    failingSince: null,
  }));

  async function bottomAboveNav(page: Page, locator: Locator) {
    await expect(locator).toBeVisible();
    const box = (await locator.boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "メイン" }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  }

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch });
  });

  // 開いた瞬間に、断り、数字、地図の全部（と地図の断り）が下のタブより上に入る。地図は横幅いっぱい
  async function firstScreen(page: Page) {
    await expect(page.locator(".stat-row")).toBeVisible();
    await bottomAboveNav(page, page.locator(".map-risk"));
    await bottomAboveNav(page, page.locator(".stat-row .stat-value").first());
    const canvas = page.locator(".map-box .map-canvas");
    await bottomAboveNav(page, canvas);
    await bottomAboveNav(page, page.locator(".map-disclaimer"));
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(360 - 2 * 16);
    expect(box.height).toBeGreaterThanOrEqual(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }

  test("/ 登録なし: 断り、数字、地図が入る。切り替えは出さず、案内とボタンを 1 行に並べ、ボタンの文字は折れない", async ({ page }) => {
    await page.goto("/");
    await firstScreen(page);
    await expect(page.getByRole("group", { name: "地図の見る場所" })).toHaveCount(0);
    const text = (await page.locator(".town-prompt-text").boundingBox())!;
    const btn = page.getByRole("button", { name: "町を選ぶ" });
    const box = (await btn.boundingBox())!;
    await bottomAboveNav(page, btn);
    expect(box.y).toBeLessThan(text.y + text.height);
    expect(box.x).toBeGreaterThanOrEqual(text.x + text.width);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // 文字が 2 行に折れると、1 行の高さの 2 倍近くになる
    expect(await btn.evaluate((e) => e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) * 1.5 + 20)).toBe(true);
  });

  test("/ 登録あり: 断り、数字、切り替え、地図が入る。段階 ④ の文は地図の下", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.spot.v1", JSON.stringify({ meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] })));
    await page.goto("/");
    await firstScreen(page);
    await bottomAboveNav(page, page.locator(".map-ring-note"));
    const near = page.getByRole("button", { name: "自分の近く" });
    await bottomAboveNav(page, near);
    await expect(near).toHaveAttribute("aria-pressed", "true");
    expect((await near.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const canvas = (await page.locator(".map-canvas").boundingBox())!;
    expect((await page.locator(".town-banner").boundingBox())!.y).toBeGreaterThan(canvas.y + canvas.height);
    await page.getByRole("button", { name: "全国" }).click();
    await expect(near).toHaveAttribute("aria-pressed", "false");
  });

  test("/ 登録なしで一部の県が未確認: 数字は文の大きさで、確認できていないと書き、地図も入る", async ({ page }) => {
    await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch: watch.map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: AT } : w)) });
    await page.goto("/");
    const value = page.locator(".stat-row .stat-value").first();
    await expect(value).toHaveText("確認できた範囲では 0 件（1 県は確認できていません）");
    expect(parseFloat(await value.evaluate((e) => getComputedStyle(e).fontSize))).toBeLessThanOrEqual(18);
    await bottomAboveNav(page, value);
    await bottomAboveNav(page, page.locator(".map-box .map-canvas"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test("/sample/todo の『保存されない』の断りと仮の地点", async ({ page }) => {
    await page.goto("/sample/todo");
    await bottomAboveNav(page, page.locator(".sample-note").first());
    await bottomAboveNav(page, page.getByText(/^仮の地点で見ています/).first());
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
