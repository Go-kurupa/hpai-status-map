import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";

// 地図の入口（W-02）。本番と同じ build（mode=e2e）で、window.__hpaiMap から地図の状態を読む。
// 地理院タイルは外へ出さず、1 画素の PNG で答える（要求の形だけを確かめる）。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// 契約の 47 県（"01"〜"47"）。見回りがすべて成功した状態
const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-04T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-04T08:30:00+09:00",
  failingSince: null,
}));

type MapHandle = {
  getStyle(): { layers: Array<{ id: string; type: string; minzoom?: number }> };
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  querySourceFeatures(source: string): unknown[];
  queryRenderedFeatures(q: undefined, o: { layers: string[] }): unknown[];
  getFilter(id: string): unknown;
  getLayer(id: string): unknown;
  dragRotate: { isEnabled(): boolean };
  touchPitch: { isEnabled(): boolean };
  // maplibre 6.16 には isRotationDisabled が無い（d.ts と実装で確認）。disableRotation() が立てる内部の印と、回転の取り扱い部品の状態で確かめる
  touchZoomRotate: { _rotationDisabled: boolean; _touchRotate: { isEnabled(): boolean } };
  keyboard: { _rotationDisabled: boolean };
  getBearing(): number;
  getPitch(): number;
};
declare global {
  interface Window {
    __hpaiMap?: MapHandle;
  }
}

async function open(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 800 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
  await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  await page.goto("/");
  // 重ねる層まで入ったら準備ができている
  await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
}

test.describe("地図（入口）", () => {
  test("地図が読み込まれ、Worker の失敗がない", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    expect(errors.filter((t) => /Worker failed/i.test(t))).toEqual([]);
  });

  test("回転と傾きができず、circle の層がない", async ({ page }) => {
    await open(page);
    const state = await page.evaluate(() => {
      const m = window.__hpaiMap!;
      return {
        dragRotate: m.dragRotate.isEnabled(),
        touchPitch: m.touchPitch.isEnabled(),
        rotationDisabled: m.touchZoomRotate._rotationDisabled && !m.touchZoomRotate._touchRotate.isEnabled(),
        keyboardRotationDisabled: m.keyboard._rotationDisabled,
        circles: m.getStyle().layers.filter((l) => l.type === "circle").map((l) => l.id),
      };
    });
    expect(state).toEqual({ dragRotate: false, touchPitch: false, rotationDisabled: true, keyboardRotationDisabled: true, circles: [] });

    // 右ボタンのドラッグでも向きと傾きは変わらない
    const box = (await page.locator(".map-canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up({ button: "right" });
    expect(await page.evaluate(() => [window.__hpaiMap!.getBearing(), window.__hpaiMap!.getPitch()])).toEqual([0, 0]);
  });

  test("昨季を押すと『24 件』になり、case-confirmed に 33203 が入る。japan.topo.json の要求は 1 回", async ({ page }) => {
    const topoRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("japan.topo.json")) topoRequests.push(r.url());
    });
    await open(page);
    await page.getByRole("button", { name: /昨季/ }).click();
    await expect(page.getByRole("button", { name: /昨季/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /昨季.*24 件/ })).toBeVisible();
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("case-confirmed")).includes("33203"));
    await page.getByRole("button", { name: /今季/ }).click();
    await page.getByRole("button", { name: /昨季/ }).click();
    expect(topoRequests).toHaveLength(1);
  });

  test("case-* は minzoom 7 から（全国の倍率では県のバッジ）", async ({ page }) => {
    await open(page);
    const minzooms = await page.evaluate(() =>
      Object.fromEntries(
        window.__hpaiMap!
          .getStyle()
          .layers.filter((l) => l.id.startsWith("case-"))
          .map((l) => [l.id, l.minzoom]),
      ),
    );
    expect(minzooms).toEqual({ "case-suspected": 7, "case-confirmed": 7 });
  });

  test("幅 360px で、地理院タイルの要求の形と、出典の全文が見える", async ({ page }) => {
    const tiles: string[] = [];
    page.on("request", (r) => {
      if (/\/xyz\/pale\/\d+\/\d+\/\d+\.png$/.test(r.url())) tiles.push(r.url());
    });
    await open(page, 360);
    await page.waitForFunction(() => document.querySelector(".map-attribution") !== null);
    const attrib = page.locator(".map-attribution");
    await expect(attrib).toBeVisible();
    await expect(attrib).toContainText(/地理院タイル/);
    await expect(attrib).toContainText(/Vector Map Level 0/);
    await expect(attrib).toContainText(/国土数値情報/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((u) => u.startsWith("https://cyberjapandata.gsi.go.jp/xyz/pale/"))).toBe(true);
  });

  test("今季 0 件のとき riskAnywhere を出し、禁じた語がない", async ({ page }) => {
    await open(page);
    const main = page.getByRole("main");
    await expect(main.getByText(/どこでも感染のリスクがあります/)).toBeVisible();
    const text = await main.innerText();
    expect(text).not.toMatch(/区域の外です|安全|安心/);
  });

  test("地図の下のリンクで各ページに着く。タブは 3 つのまま", async ({ page }) => {
    await open(page);
    const nav = page.getByRole("navigation", { name: "メイン" });
    await expect(nav.getByRole("link")).toHaveCount(3);
    for (const [name, path] of [
      ["鶏を飼っていない方へ", "/public"],
      ["分かっていること", "/known"],
      ["去年の再現", "/replay"],
      ["試験の結果", "/results"],
      ["プライバシー", "/privacy"],
    ] as const) {
      await page.getByRole("navigation", { name: "ほかのページ" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(nav.getByRole("link")).toHaveCount(3);
      await page.goBack();
      await expect(page.getByRole("navigation", { name: "ほかのページ" })).toBeVisible();
    }
  });

  test("登録した町の札、野鳥の札、町の枠の周辺の表が 360px で横にはみ出さない", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(
      (s) => window.localStorage.setItem("hpai.spot.v1", JSON.stringify(s)),
      { meshCode: "52344080", muniCode: "33203", frequentMuniCodes: ["33202"] }, // 津山市のあたり（試験の地点）
    );
    await open(page);
    await expect(page.getByText("登録した町の今季")).toBeVisible();
    await expect(page.locator(".stat", { hasText: "登録した町の今季" })).toContainText("倉敷市");
    await expect(page.getByText("野鳥の陽性（今季）")).toBeVisible();
    const link = page.getByRole("link", { name: "定点の水鳥の数を見る" });
    await expect(link).toHaveAttribute("href", "/trends");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator(".nearby-past summary").click();
    const table = page.getByRole("table", { name: "周辺の町の過去の発生" });
    await expect(table).toBeVisible();
    await expect(table.locator('td[data-label="距離"]').first()).toContainText("この町");
    await expect(page.getByText("農場のマス目から町の境までの距離")).toBeVisible();
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
    const smallest = await page.locator(".nearby-past").evaluate((b) => Math.min(...[...b.querySelectorAll("p,th,td,summary")].map((c) => parseFloat(getComputedStyle(c).fontSize))));
    expect(smallest).toBeGreaterThanOrEqual(14);
  });

  test.describe("距離の輪", () => {
    const RING_NOTE = "輪は距離の目安で、発表の区域ではありません。";
    // 津山市のあたりのマス目（試験の地点）
    const spot = { meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] as string[] };

    test("地点がなければ輪も、ラベルも、断りも、約 60km の札もない", async ({ page }) => {
      await open(page);
      await expect(page.locator(".stat-row")).toBeVisible();
      await expect(page.getByText(RING_NOTE)).toHaveCount(0);
      await expect(page.locator(".ring-label")).toHaveCount(0);
      await expect(page.getByText(/約 60 km 以内/)).toHaveCount(0);
      expect(await page.evaluate(() => window.__hpaiMap!.getLayer("distance-rings") !== undefined)).toBe(true);
      expect(await page.evaluate(() => window.__hpaiMap!.queryRenderedFeatures(undefined, { layers: ["distance-rings"] }).length)).toBe(0);
    });

    test("地点があれば、点線の輪が描かれ、寄せるとラベルが出る。ラベルは地図の操作を止めない", async ({ page }) => {
      await page.addInitScript((s) => window.localStorage.setItem("hpai.spot.v1", JSON.stringify(s)), spot);
      await open(page);
      await expect(page.getByText(RING_NOTE)).toBeVisible();
      await expect(page.getByText(/農場から約 60 km 以内/).last()).toBeVisible();
      await page.evaluate(() => window.__hpaiMap!.jumpTo({ center: [134.0, 35.07], zoom: 8 }));
      await expect
        .poll(() => page.evaluate(() => window.__hpaiMap!.queryRenderedFeatures(undefined, { layers: ["distance-rings"] }).length), { timeout: 10_000 })
        .toBeGreaterThan(0);
      for (const text of ["約 10 km", "約 30 km", "約 60 km"]) {
        const label = page.locator(".ring-label", { hasText: text });
        await expect(label).toBeVisible();
        expect(await label.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
        expect(parseFloat(await label.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
      }
      await page.evaluate(() => window.__hpaiMap!.jumpTo({ center: [134.0, 35.07], zoom: 4 }));
      await expect(page.locator(".ring-label", { hasText: "約 10 km" })).toBeHidden();
    });
  });
});
