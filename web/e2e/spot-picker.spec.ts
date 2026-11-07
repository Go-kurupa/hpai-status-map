import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";

// 鶏舎の場所を決める（約 1km のマス目）。「地図で場所を合わせる」を押すと、選んだ町へ地図が寄り、中央の十字で決める。
// 2026-11-06: PC 幅で地図の箱が 2px に縮み、地図が真っ白で十字が左端に寄っていた（作者の報告）。

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

type MapHandle = {
  getLayer(id: string): unknown;
  isMoving(): boolean;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getCanvas(): HTMLCanvasElement;
  queryRenderedFeatures(p: [number, number], o: { layers: string[] }): { properties?: Record<string, unknown> }[];
};
/** 試験用に window へ出している地図（map.spec.ts の宣言と重ねないよう、ここでは型を当てて読む） */
type WithMap = { __hpaiMap?: MapHandle };

async function openWithTown(page: Page, width: number, height: number, town: string) {
  await page.setViewportSize({ width, height });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (r) => r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
  await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch: [] });
  await page.addInitScript((code) => window.localStorage.setItem("hpai.town.v1", code), town);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as WithMap).__hpaiMap?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
}

/** 地図が止まり、中央の十字の下の町の塗りが描かれるまで待って、その町のコードを返す */
async function townUnderCrosshair(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as WithMap).__hpaiMap!.isMoving()), { timeout: 15_000 }).toBe(false);
  let codes: unknown[] = [];
  await expect
    .poll(
      async () => {
        codes = await page.evaluate(() => {
          const m = (window as unknown as WithMap).__hpaiMap!;
          const cross = document.querySelector(".crosshair")!.getBoundingClientRect();
          const canvas = m.getCanvas().getBoundingClientRect();
          const x = cross.x + cross.width / 2 - canvas.x;
          const y = cross.y + cross.height / 2 - canvas.y;
          return m.queryRenderedFeatures([x, y], { layers: ["muni-fill"] }).map((f) => f.properties?.["c"]);
        });
        return codes.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  return codes;
}

const CASES = [
  { w: 1280, h: 860, town: "33643", name: "西粟倉村" },
  { w: 1280, h: 860, town: "33214", name: "真庭市" },
  { w: 390, h: 800, town: "33643", name: "西粟倉村" },
  { w: 390, h: 800, town: "33214", name: "真庭市" },
  // 町の外枠の四角の中心が町の外に出る町（十字が広島市・和気町に乗っていた。2026-11-06 の点検）
  { w: 1280, h: 860, town: "34213", name: "廿日市市" },
  { w: 390, h: 800, town: "33213", name: "赤磐市" },
];

test.describe("鶏舎の場所を決める", () => {
  for (const c of CASES) {
    test(`${c.w}px、${c.name}: 鶏舎の場所の欄は選択地域の行のすぐ下。押すと十字は地図の中央、十字と［ここに決める］が同じ画面に入り、十字の下は選んだ町。そのまま決めると町の名前で確かめられる`, async ({ page }) => {
      await openWithTown(page, c.w, c.h, c.town);
      // 鶏舎の場所の欄は町の欄の中、選択地域の行のすぐ下（2026-11-07 作者の決定 A）。ページの下に別の欄はない
      await expect(page.locator(".town-banner .town-name-row + .spot-picker")).toBeVisible();
      await expect(page.locator(".spot-picker")).toHaveCount(1);
      await page.getByRole("button", { name: "地図で場所を合わせる" }).click();

      // 地図の箱は、PC は左の列の幅いっぱい（2px に縮まない）、スマホは横いっぱい。地図の絵も箱と同じ幅
      const sizes = await page.evaluate(() => {
        const box = document.querySelector(".map-box")!.getBoundingClientRect();
        const parent = document.querySelector(".map-page")!.getBoundingClientRect();
        const canvas = document.querySelector(".map-box .map-canvas")!.getBoundingClientRect();
        const cross = document.querySelector(".crosshair")!.getBoundingClientRect();
        return { box: box.width, parent: parent.width, canvas: canvas.width, canvasMid: canvas.x + canvas.width / 2, crossMid: cross.x + cross.width / 2 };
      });
      expect(sizes.box).toBeGreaterThanOrEqual(c.w >= 1024 ? sizes.parent * 0.55 : sizes.parent - 2);
      // 十字と［ここに決める］を、スクロールせずに同じ画面で見られる
      await expect(page.locator(".crosshair")).toBeInViewport();
      await expect(page.getByRole("button", { name: "ここに決める" })).toBeInViewport();
      expect(Math.abs(sizes.canvas - sizes.box)).toBeLessThanOrEqual(2);
      expect(Math.abs(sizes.crossMid - sizes.canvasMid)).toBeLessThanOrEqual(2);

      // 寄った先で、十字の下が選んだ町（隣の町で保存しない）
      expect(await townUnderCrosshair(page)).toEqual([c.town]);

      // そのまま決めると、町の名前で確かめる文が出る（拡大が足りないと「もう少し地図を拡大して…」になる）
      await page.getByRole("button", { name: "ここに決める" }).click();
      await expect(page.locator(".spot-picker strong")).toHaveText(new RegExp(c.name));
      await expect(page.locator(".spot-picker")).toContainText("の上です");
    });
  }
});

// 地区（大字）で地図を寄せる（2026-11-06 作者の決定）。国土交通省「大字・町丁目位置参照情報」の目安の点
test.describe("鶏舎の場所を決める: 地区（大字）で地図を寄せる", () => {
  for (const [w, h] of [[1280, 860], [390, 800]] as const) {
    test(`${w}px、西粟倉村: 大字影石を選ぶと、地図がその目安の点へ寄り、十字の下は西粟倉村。そのまま決められる`, async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await openWithTown(page, w, h, "33643");
      await page.getByRole("button", { name: "地図で場所を合わせる" }).click();
      const select = page.getByLabel("地区（大字）で地図を寄せる");
      await expect(select).toBeVisible({ timeout: 15_000 });
      await expect(select.locator("option")).toHaveText(["選んでください", "大字筏津", "大字大茅", "大字影石", "大字坂根", "大字知社", "大字長尾"]);
      await select.selectOption({ label: "大字影石" });
      await expect.poll(() => page.evaluate(() => (window as unknown as WithMap).__hpaiMap!.isMoving()), { timeout: 15_000 }).toBe(false);
      const at = await page.evaluate(() => {
        const m = (window as unknown as WithMap).__hpaiMap!;
        return { ...m.getCenter(), zoom: m.getZoom() };
      });
      // 大字影石の目安の点（35.187, 134.3223）。拡大は 13 以上
      expect(Math.abs(at.lat - 35.187)).toBeLessThan(0.002);
      expect(Math.abs(at.lng - 134.3223)).toBeLessThan(0.002);
      expect(at.zoom).toBeGreaterThanOrEqual(13);
      expect(await townUnderCrosshair(page)).toEqual(["33643"]);
      await page.getByRole("button", { name: "ここに決める" }).click();
      await expect(page.locator(".spot-picker strong")).toHaveText(/西粟倉村/u);
      // 読むのは同梱の県のファイルだけ。地区の名前や位置を外へ送らない
      expect(requests.filter((u) => /oaza/u.test(u))).toEqual([expect.stringMatching(/\/oaza\/33\.json$/u)]);
      expect(requests.some((u) => u.includes(encodeURIComponent("影石")) || u.includes("影石"))).toBe(false);
    });
  }
});
