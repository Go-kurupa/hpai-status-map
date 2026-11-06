import type { Case, WatchStatus } from "@hpai/shared/types";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { distanceRingsOf } from "../src/geo/distanceRings";
import { installFixture } from "./fixtures";
import { bottomY, goViaMenu, menuButton, menuNav, viewportBottom } from "./helpers/frame";

test.describe("骨格", () => {
  test("幅 360px で横にはみ出さず、下のタブがない。三本線から開くメニューで『やること』に行く", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await installFixture(page, { now: "2025-12-21T09:00:00+09:00", cases: [], wildBirds: [], watch: [] });
    await page.goto("/");

    // 下のタブ（名前「メイン」）はない。メニューは閉じていて、三本線だけが見える
    await expect(page.getByRole("navigation", { name: "メイン" })).toHaveCount(0);
    await expect(menuNav(page)).toBeHidden();
    const burger = menuButton(page);
    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    // 設定は、スマホではメニューの中（農場と通知の設定）にある（2026-11-06 骨組みの作り直し）
    await expect(page.getByRole("banner").getByRole("link", { name: "設定" })).toBeHidden();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
    // 押せるものは高さ 48px 以上（三本線も）
    expect((await burger.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    const nav = menuNav(page);
    await expect(nav).toBeVisible();
    for (const link of await nav.getByRole("link").all()) {
      if (!(await link.isVisible())) continue;
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await nav.getByRole("link", { name: "やること" }).click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(page.getByRole("heading", { name: "やること" })).toBeVisible();
    await expect(menuNav(page)).toBeHidden();
  });

  test("PC（1280x860）は左に固定のメニューで、三本線も設定のリンクも出る。下のタブはない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await installFixture(page, { now: "2025-12-21T09:00:00+09:00", cases: [], wildBirds: [], watch: [] });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "メイン" })).toHaveCount(0);
    await expect(menuButton(page)).toBeHidden();
    await expect(menuNav(page)).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "設定" })).toBeVisible();
    await expect(menuNav(page).getByRole("link", { name: "今季の発生", exact: true })).toHaveAttribute("aria-current", "page");
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

  // 下のタブをなくしたので、画面の下端（ビューポートの高さ）より上に入ることを確かめる（設計書 2026-11-06-ui-frame 6 章 8）
  async function bottomAboveNav(page: Page, locator: Locator) {
    await expect(locator).toBeVisible();
    const box = (await locator.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewportBottom(page).y);
  }

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch });
  });

  // 開いた瞬間に、断り、数字、地図の全部（と地図の断り）が画面の下端より上に入る。地図は横幅いっぱい
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

  test("/sample/todo の『保存されない』の断りと、畳んだ仮の地点。帯は画面の高さの半分より上で終わり、中身がすぐ見える", async ({ page }) => {
    await page.goto("/sample/todo");
    await expect(page.locator(".sample-badge")).toHaveText("見本です（作り物のデータ）");
    await bottomAboveNav(page, page.locator(".sample-badge"));
    await expect(page.locator(".sample-note")).toHaveText("入れた記録は保存されません");
    await bottomAboveNav(page, page.locator(".sample-note"));
    // 再現の枠は題と時点だけ
    await expect(page.locator(".replay-band > *")).toHaveCount(2);
    await bottomAboveNav(page, page.locator(".replay-band .replay-title"));
    await bottomAboveNav(page, page.locator(".replay-band .replay-time"));
    // 帯（行き来の nav まで）は 370px より上で終わり、本文の見出しがその直後に見える
    const nav = page.getByRole("navigation", { name: "見本の画面" });
    const navBox = (await nav.boundingBox())!;
    expect(navBox.y + navBox.height).toBeLessThan(370);
    expect(navBox.height).toBeGreaterThanOrEqual(44);
    const h1 = page.getByRole("heading", { level: 1, name: "やること" });
    await bottomAboveNav(page, h1);
    expect((await h1.boundingBox())!.y).toBeLessThan(370);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    // 仮の地点と注記は「くわしく」の中。閉じていても DOM にあり、開くと読める
    const spot = page.getByText(/^仮の地点で見ています/);
    await expect(spot).toBeAttached();
    await expect(spot).toBeHidden();
    await page.locator(".sample-lead summary", { hasText: "くわしく" }).click();
    await expect(spot).toBeVisible();
    await expect(page.locator(".sample-lead details")).toContainText("架空の農場です。数字は作り物です");
    await expect(page.locator(".sample-lead details")).toContainText("サーバーにも、この端末の保存にも書かず");
    await expect(page.locator(".sample-lead details")).toContainText("去年の再現です");
    await expect(page.locator(".sample-lead .replay-notes li")).toHaveCount(4);
  });
});

test.describe("再現の最初の画面に地図の全部が入る", () => {
  const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  type MapHandle = { getLayer(id: string): unknown };

  async function openReplay(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.route("https://cyberjapandata.gsi.go.jp/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
    await page.goto("/replay");
    await waitMap(page);
  }
  const waitMap = (page: Page) => page.waitForFunction(() => !!(window as unknown as { __hpaiMap?: MapHandle }).__hpaiMap?.getLayer("case-suspected"), undefined, { timeout: 20_000 });
  const box = async (l: Locator) => (await l.boundingBox())!;
  // 下のタブの代わりに画面の下端を基準にする
  const tabs = async (page: Page) => viewportBottom(page);
  const canvasOf = (page: Page) => box(page.locator(".map-box .map-canvas"));

  async function goNational(page: Page) {
    await page.getByRole("button", { name: "全国の流れ" }).click();
    await expect(page.getByText("0 / 24")).toBeVisible();
    await waitMap(page);
    await expect(page.locator(".stat-row")).toBeVisible();
  }

  /** 最初の表示で確かめること（360x740） */
  async function firstView(page: Page, spotLine: string, ariaFolded: RegExp) {
    const band = await box(page.locator(".replay-band"));
    expect(band.height).toBeLessThanOrEqual(130);
    await expect(page.locator(".replay-banner")).toHaveText("去年の再現です");
    await expect(page.locator(".replay-spot")).toHaveText(spotLine);
    await expect(page.locator(".replay-time")).toBeVisible();

    const canvas = await canvasOf(page);
    const nav = await tabs(page);
    expect(nav.y).toBeGreaterThanOrEqual(690);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(nav.y);
    expect(canvas.height).toBeGreaterThanOrEqual(220);
    expect(canvas.width).toBeGreaterThanOrEqual(360 - 2 * 16);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // 地図の断りと輪の注記は地図のすぐ下で、画面の下端より上。地図の切り替えは地図に重ねず、その後ろ
    const disclaimer = await box(page.locator(".map-disclaimer"));
    const ringNote = await box(page.locator(".map-ring-note"));
    expect(disclaimer.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(disclaimer.y - (canvas.y + canvas.height)).toBeLessThanOrEqual(8);
    expect(ringNote.y).toBeGreaterThanOrEqual(disclaimer.y + disclaimer.height);
    expect(ringNote.y + ringNote.height).toBeLessThanOrEqual(nav.y);
    const mapScope = await box(page.getByRole("group", { name: "地図の見る場所" }));
    expect(mapScope.y).toBeGreaterThanOrEqual(ringNote.y + ringNote.height);

    // 切り替えと前へ・次へは地図の前の 1 行で、どれも 44px 以上。文字は折れない
    const buttons = [page.getByRole("button", { name: "12 月の 4 事例" }), page.getByRole("button", { name: "全国の流れ" }), page.getByRole("button", { name: "前へ" }), page.getByRole("button", { name: "次へ" })];
    const first = await box(buttons[0]!);
    for (const b of buttons) {
      const r = await box(b);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeLessThanOrEqual(48);
      expect(r.y).toBe(first.y);
      expect(r.y + r.height).toBeLessThanOrEqual(canvas.y);
    }

    // 今の出来事の 1 行は、地図のすぐ前
    const now = await box(page.locator(".replay-now"));
    expect(now.y + now.height).toBeLessThanOrEqual(canvas.y);
    expect(canvas.y - (now.y + now.height)).toBeLessThanOrEqual(12);

    // 日付の一覧は閉じていて、地図の下
    const listFold = page.locator("details.fold").filter({ has: page.locator('ol[aria-label="日付の一覧"]') });
    expect(await listFold.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    expect((await box(listFold)).y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect((await box(page.getByRole("group", { name: "見る場所", exact: true }))).y).toBeGreaterThanOrEqual(canvas.y + canvas.height);

    // 畳んだ注記は DOM にあり、「くわしく」で読める。押す場所は 44px 以上
    const fold = page.locator(".replay-band details");
    const folded = fold.getByText(ariaFolded);
    await expect(folded).toBeAttached();
    await expect(folded).toBeHidden();
    const summary = fold.locator("summary", { hasText: "くわしく" });
    expect((await box(summary)).height).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(folded).toBeVisible();
    await summary.click();
    await expect(folded).toBeHidden();
  }

  test("360x740 の 4 事例: 帯は 130px まで、地図の全部、1 行の操作、地図の前の今の出来事", async ({ page }) => {
    await openReplay(page, 360, 740);
    await firstView(page, "仮の地点で見ています。特定の農場を指すものではありません。", /4 事例だけ/);
  });

  test("360x740 の全国の流れ: 帯は 130px まで、地図の全部、1 行の操作。守る文は札の直前で、地図の下", async ({ page }) => {
    await openReplay(page, 360, 740);
    await goNational(page);
    await firstView(page, "作者の村の中心付近を仮の地点にしています。農場の場所を指すものではありません。", /関連農場は数えていません/);
    const canvas = await canvasOf(page);
    await expect(page.locator(".map-risk + .stat-row")).toHaveCount(1);
    expect((await box(page.locator(".map-risk"))).y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect((await box(page.locator(".stat-row"))).y).toBeGreaterThan((await box(page.locator(".map-risk"))).y);
  });

  // 倍率が町の塗りの閾値より下だと、発生が県のバッジになる。60 km の輪が入る広さでは町を塗る
  async function nearShowsTowns(page: Page) {
    const state = () =>
      page.evaluate(() => {
        const map = (window as unknown as { __hpaiMap: { getZoom(): number; getLayer(id: string): { minzoom?: number }; queryRenderedFeatures(q: undefined, o: { layers: string[] }): unknown[] } }).__hpaiMap;
        return {
          zoom: map.getZoom(),
          min: map.getLayer("case-confirmed").minzoom!,
          painted: map.queryRenderedFeatures(undefined, { layers: ["case-confirmed"] }).length,
          badges: [...document.querySelectorAll<HTMLElement>(".pref-badge")].filter((e) => !e.hidden).length,
        };
      });
    await expect.poll(async () => (await state()).painted, { timeout: 15_000 }).toBeGreaterThan(0);
    const near = await state();
    expect(near.zoom).toBeGreaterThanOrEqual(near.min);
    expect(near.badges).toBe(0);
    await expect(page.locator(".ring-label").filter({ hasText: "60" })).toBeVisible();
    await page.getByRole("button", { name: "全国", exact: true }).click();
    await expect.poll(async () => (await state()).zoom, { timeout: 15_000 }).toBeLessThan(near.min);
    await expect.poll(async () => (await state()).badges, { timeout: 15_000 }).toBeGreaterThan(0);
  }

  for (const [width, height] of [
    [360, 740],
    [360, 640],
  ] as const) {
    test(`${width}x${height} の全国の流れ: 自分の近くは 60 km の輪が入る広さで町を塗り、全国の広さは県のバッジのまま`, async ({ page }) => {
      await openReplay(page, width, height);
      await goNational(page);
      for (let i = 1; i <= 8; i++) await page.getByRole("button", { name: "次へ" }).click();
      await expect(page.getByText("8 / 24")).toBeVisible();
      await nearShowsTowns(page);
    });
  }

  for (const [name, total] of [
    ["4 事例", 14],
    ["全国の流れ", 24],
  ] as const) {
    test(`360x740 の${name}: 次へで最後まで進めても、地図は画面の下端より上にあり、次へが同じ場所にある`, async ({ page }) => {
      await openReplay(page, 360, 740);
      if (total === 24) await goNational(page);
      const next = page.getByRole("button", { name: "次へ" });
      const y = (await box(next)).y;
      for (let i = 1; i <= total; i++) {
        await next.click();
        await expect(page.getByText(`${i} / ${total}`)).toBeVisible();
        const canvas = await canvasOf(page);
        const nav = await tabs(page);
        expect(canvas.y + canvas.height, `${i} 番目の出来事`).toBeLessThanOrEqual(nav.y);
        expect((await box(next)).y).toBe(y);
      }
    });
  }

  test("1280x860: 4 事例も全国の流れも、地図の全部が最初の画面に入り、操作は地図の前の 1 行", async ({ page }) => {
    await openReplay(page, 1280, 860);
    const check = async () => {
      const canvas = await canvasOf(page);
      const nav = await tabs(page);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(nav.y);
      expect(canvas.height).toBeGreaterThanOrEqual(360);
      // 2026-11-06 骨組みの作り直し（設計書 2026-11-06-ui-frame）: 左のメニュー（幅 240px）の分、本文が狭くなった。実測 590.39px
      expect(canvas.width).toBeGreaterThan(560);
      const next = await box(page.getByRole("button", { name: "次へ" }));
      const switchOne = await box(page.getByRole("button", { name: "12 月の 4 事例" }));
      expect(next.y).toBe(switchOne.y);
      expect(next.y + next.height).toBeLessThanOrEqual(canvas.y);
      expect((await box(page.locator(".replay-now"))).y + (await box(page.locator(".replay-now"))).height).toBeLessThanOrEqual(canvas.y);
      expect((await box(page.locator(".replay-band"))).height).toBeLessThanOrEqual(130);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
      // 地図と同じ行の右の列に置く（日付の一覧は地図の下ではなく右）
      const listFold = await box(page.locator("details.fold").filter({ has: page.locator('ol[aria-label="日付の一覧"]') }));
      expect(listFold.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
    };
    await check();
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.getByText("1 / 14")).toBeVisible();
    await check();
    await goNational(page);
    await check();
    // 札は右の列の先頭で、最初の画面の中。未確認の県があれば、まとめの 1 文が先頭（2026-11-06 作者の決定）
    const stats = await box(page.locator(".stat-unchecked-wide, .map-risk, .stat-row").first());
    const canvas = await canvasOf(page);
    expect(stats.y).toBeLessThanOrEqual(canvas.y + 1);
    expect(stats.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
    const row = await box(page.locator(".stat-row"));
    expect(row.y + row.height).toBeLessThanOrEqual((await tabs(page)).y);
  });

  test("1280x860: 区域の文とメールの枠が、地図の隣の最初の画面に入る", async ({ page }) => {
    await openReplay(page, 1280, 860);
    const listFold = page.locator("details.fold").filter({ has: page.locator('ol[aria-label="日付の一覧"]') });
    await listFold.getByText("日付の一覧から選ぶ").click();
    await page.getByRole("button", { name: /12 月 19 日.*津山市.*疑い/ }).click();
    await listFold.getByText("日付の一覧から選ぶ").click();
    await page.evaluate(() => window.scrollTo(0, 0)); // 押すために動いた分を戻す
    const nav = await tabs(page);
    for (const l of [page.locator(".town-now").first(), page.getByRole("region", { name: "このときメールが届く" })]) {
      const r = await box(l);
      expect(r.y + r.height).toBeLessThanOrEqual(nav.y);
    }
  });
});

test.describe("幅 360px の最初の画面（360x740）に地図の全部が入る", () => {
  const NOW = "2026-11-10T09:00:00+09:00";
  const AT = "2026-11-10T08:30:00+09:00";
  // 津山市のあたりのマス目（試験の地点）
  const SPOT = { meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] as string[] };
  const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  const prefCodes = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0"));
  const watchFailing = (failing: readonly string[]): WatchStatus[] =>
    prefCodes.map((prefCode) => (failing.includes(prefCode) ? { prefCode, checkedAt: AT, ok: false, lastOkAt: null, failingSince: AT } : { prefCode, checkedAt: AT, ok: true, lastOkAt: AT, failingSince: null }));
  const makeCase = (id: string, prefCode: string, muniCode: string, muniName: string, date = "2026-11-02"): Case => ({
    id,
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode,
    muniCode,
    muniName,
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date, time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: `${date}T12:00:00+09:00`,
  });
  const SAME_TOWN = makeCase("e-same", "33", "33203", "津山市");
  const NEIGHBOR = makeCase("e-next", "31", "31201", "鳥取市"); // 津山市の隣で、地点から 10km より遠い
  const BAND = makeCase("e-band", "33", "33213", "赤磐市"); // 隣でなく、約 60km 以内
  const FAR = makeCase("e-far", "01", "01202", "函館市");
  const OK = watchFailing([]);
  const ONE = watchFailing(["33"]);
  const FIVE = watchFailing(["01", "02", "03", "33", "47"]);
  const ALL = watchFailing(prefCodes);

  interface MapState {
    name: string;
    spot?: boolean;
    frequent?: string[];
    /** 町だけを選んだ人 */
    town?: string;
    cases?: Case[];
    watch?: WatchStatus[];
    tone?: "lv1" | "lv2" | "lv3" | "lv4";
  }
  const STATES: MapState[] = [
    { name: "登録なし、0 件" },
    { name: "登録なし、発生あり", cases: [FAR] },
    { name: "登録なし、1 県が未確認", watch: ONE },
    { name: "登録なし、発生ありで 5 県が未確認", cases: [FAR], watch: FIVE },
    { name: "登録なし、全県未確認", watch: ALL },
    { name: "登録なし、見回りの結果が未着", watch: [] },
    { name: "登録あり、段階 4、0 件", spot: true, tone: "lv4" },
    { name: "登録あり、段階 4、発生あり", spot: true, cases: [FAR], tone: "lv4" },
    { name: "登録あり、段階 1", spot: true, cases: [SAME_TOWN], tone: "lv1" },
    { name: "登録あり、段階 2", spot: true, cases: [NEIGHBOR], tone: "lv2" },
    { name: "登録あり、段階 3", spot: true, cases: [BAND], tone: "lv3" },
    { name: "登録あり、1 県が未確認", spot: true, watch: watchFailing(["01"]), tone: "lv4" },
    { name: "登録あり、自分の県が未確認", spot: true, watch: ONE },
    { name: "登録あり、全県未確認", spot: true, watch: ALL },
    { name: "登録あり、自分の県を含む 5 県が未確認", spot: true, watch: FIVE },
    { name: "登録あり、段階 1、5 県が未確認で直近 14 日が 0 件（一番長い形）", spot: true, cases: [makeCase("e-old", "33", "33203", "津山市", "2026-10-01")], watch: FIVE, tone: "lv1" },
    { name: "登録した町あり、段階 3", spot: true, frequent: ["33213", "33214"], cases: [BAND], tone: "lv3" },
    { name: "登録した町あり、0 件", spot: true, frequent: ["33213", "33214"], tone: "lv4" },
    { name: "町だけ、同じ町で発生", town: "33203", cases: [SAME_TOWN], tone: "lv1" },
    { name: "町だけ、隣町で発生", town: "33203", cases: [NEIGHBOR], tone: "lv2" },
    { name: "町だけ、0 件", town: "33203", tone: "lv4" },
  ];

  async function openState(page: Page, s: MapState) {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.route("https://cyberjapandata.gsi.go.jp/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
    await installFixture(page, { now: NOW, cases: s.cases ?? [], wildBirds: [], watch: s.watch ?? OK });
    if (s.spot) await page.addInitScript((v) => window.localStorage.setItem("hpai.spot.v1", v), JSON.stringify({ ...SPOT, frequentMuniCodes: s.frequent ?? [] }));
    if (s.town) await page.addInitScript((v) => window.localStorage.setItem("hpai.town.v1", v), s.town);
    await page.goto("/");
    await expect(page.locator(".stat-row")).toBeVisible();
    await page.waitForFunction(() => !!(window as unknown as { __hpaiMap?: { getLayer(id: string): unknown } }).__hpaiMap?.getLayer("my-town"), undefined, { timeout: 20_000 });
    // 段階の文が読めるまで待つ（読み込み中の文で測らない）
    await expect(page.locator(".state-wait").filter({ hasText: "読み込んでいます" })).toHaveCount(0, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
  }

  /** DOM の順で地図より前にあり、見えている文字 */
  const textBeforeMap = (page: Page) =>
    page.evaluate(() => {
      const box = document.querySelector(".map-box")!;
      return [...document.querySelector(".map-page")!.children]
        .filter((e) => e.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((e) => (e as HTMLElement).innerText)
        .join("\n");
    });

  for (const [i, s] of STATES.entries()) {
    test(`${s.name}: 地図の全部が画面の下端より上に入り、高さが横幅の 85% 以上`, async ({ page }) => {
      await openState(page, s);
      const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
      const nav = viewportBottom(page); // 下のタブの代わりに画面の下端
      if (process.env.SHOTS_DIR) {
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${process.env.SHOTS_DIR}/${String(i + 1).padStart(2, "0")}-${s.name}.png` });
        // 地図より前の文字の行数（切り替えとボタンの行を除く）
        const lines = await page.evaluate(() => {
          const box = document.querySelector(".map-box")!;
          const rows = new Set<number>();
          for (const el of document.querySelector(".map-page")!.children) {
            if (!(el.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) || el.matches(".map-scope, .town-banner")) continue;
            const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            while (walk.nextNode()) {
              const r = document.createRange();
              r.selectNodeContents(walk.currentNode);
              for (const c of r.getClientRects()) if (c.width > 1 && c.height > 1) rows.add(Math.round(c.bottom / 8));
            }
          }
          return rows.size;
        });
        console.log(`MEASURE\t${s.name}\ttop=${Math.round(canvas.y)}\tbottom=${Math.round(canvas.y + canvas.height)}\th=${Math.round(canvas.height)}\tnav=${Math.round(nav.y)}\tlines=${lines}`);
      }
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(nav.y);
      expect(canvas.height).toBeGreaterThanOrEqual(280);
      expect(canvas.height).toBeGreaterThanOrEqual(canvas.width * 0.85);
      expect(canvas.width).toBeGreaterThanOrEqual(360 - 2 * 16);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      if (s.tone) await expect(page.locator("[data-tone]").first()).toHaveAttribute("data-tone", s.tone);

      const above = await textBeforeMap(page);
      expect(above).not.toContain("https://");
      expect(above).not.toMatch(/過去 \d+ シーズン/);
      expect(above).not.toContain("自分の町");
      expect(above).not.toContain("47 都道府県のうち");
      // 地図の断りは地図のすぐ下
      await expect(page.locator(".map-box + .map-disclaimer")).toBeVisible();
      // 輪は地点があればそこから、町だけなら町の中心から描く（設計書 2026-11-06-ui-frame 決定 6）。どちらでもなければ断りもない
      await expect(page.locator(".map-disclaimer + .map-ring-note")).toHaveCount(s.spot || s.town ? 1 : 0);
      // 確認の行は消さず、地図の下で読める
      const watchLine = page.getByTestId("watch-line");
      await expect(watchLine).toBeVisible();
      expect((await watchLine.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);

      // 守る文は数字の直前で、短いリンクの出典を持つ。文の全部を読める
      const risk = page.locator(".map-risk");
      if ((await risk.count()) > 0) {
        await expect(page.locator(".map-risk + .stat-row")).toHaveCount(1);
        await expect(risk).toHaveText("件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典）");
        await expect(risk.getByRole("link", { name: /出典/ })).toHaveAttribute("href", /^https:\/\/www\.maff\.go\.jp\//);
      }
    });
  }

  test("一部未確認: 断りは 1 回だけで、大きな数字に素の数を出さない。読めない県を地図の前に書き、県が多いときは数で書く", async ({ page }) => {
    await openState(page, { name: "1 県", spot: true, watch: ONE });
    const above = await textBeforeMap(page);
    expect(above).toContain("確認できた範囲の件数です。岡山県は確認できていません。地図の斜線の県は、発生がないとは言えません。");
    expect(above.match(/確認できた範囲/g)).toHaveLength(1);
    await expect(page.locator(".stat-row .stat-value b")).toHaveCount(0);
    const font = (l: Locator) => l.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(await font(page.locator(".stat-national .stat-value"))).toBeLessThanOrEqual(18);
    expect(await font(page.locator(".stat-national .stat-num"))).toBeLessThanOrEqual(18);
    // 断りは数字より前
    const note = (await page.locator(".stat-unchecked").boundingBox())!;
    const value = (await page.locator(".stat-national .stat-value").boundingBox())!;
    expect(note.y).toBeLessThan(value.y);
    // 札の DOM の文は今までどおり（断りの部分はスマホで隠し、上の 1 文で読む）
    await expect(page.locator(".stat-national .stat-value")).toHaveText("確認できた範囲では 0 件（1 県は確認できていません）");
  });

  test("5 県が未確認: 県の数で書く", async ({ page }) => {
    await openState(page, { name: "5 県", watch: FIVE });
    expect(await textBeforeMap(page)).toContain("確認できた範囲の件数です。5 県は確認できていません。地図の斜線の県は、発生がないとは言えません。");
  });

  test("全県未確認: 件数を見出しにせず、同じ文を繰り返さない", async ({ page }) => {
    await openState(page, { name: "全県", spot: true, watch: ALL });
    const above = await textBeforeMap(page);
    expect(above).toContain("47 県は確認できていません。地図の斜線の県は、発生がないとは言えません。");
    expect(above).not.toMatch(/\d+ 件/);
    expect(above.match(/まだ確認できていません/g)).toHaveLength(1);
    await expect(page.locator(".stat-row .stat-value b")).toHaveCount(0);
  });

  test("段階 ① の文は地図の前に 1 つだけ。事例の行と過去と町の名は地図の下で、畳まずに読める", async ({ page }) => {
    await openState(page, { name: "段階 1", spot: true, cases: [SAME_TOWN] });
    const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
    const lead = page.locator(".town-lead");
    await expect(lead).toHaveText("区域に入っている可能性があります。県の連絡を確かめてください");
    const leadBox = (await lead.boundingBox())!;
    expect(leadBox.y + leadBox.height).toBeLessThanOrEqual(canvas.y);
    const banner = page.locator(".town-banner");
    expect((await banner.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    await expect(banner.getByText("津山市で確定（11 月 2 日）")).toBeVisible();
    await expect(banner.locator(".town-past").first()).toBeVisible();
    await expect(banner.getByText("区域に入っている可能性があります")).toHaveCount(0);
  });

  test("自分の県が未確認（3 県以上で数で書くとき）: 町の文を地図の前に残す", async ({ page }) => {
    await openState(page, { name: "自分の県", spot: true, watch: FIVE });
    const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
    const lead = page.locator(".town-lead");
    await expect(lead).toHaveText("この県は、見回りで確認できていません。発生がないとは言えません");
    const box = (await lead.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y);
  });

  test("段階 ③ の文と、過去の札、関連農場の断り、登録した町は地図の下", async ({ page }) => {
    await openState(page, { name: "段階 3", spot: true, frequent: ["33213"], cases: [BAND] });
    const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
    await expect(page.locator(".town-lead")).toHaveCount(0);
    for (const text of [/過去 \d+ シーズン/, /関連農場は入れていません/, /登録した町の今季/, /約 \d+ km 先で発生しました/]) {
      const el = page.getByRole("main").getByText(text).first();
      await expect(el).toBeVisible();
      expect((await el.boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    }
  });

  test("登録ありの最初の表示は、約 60km の輪の全部と、そのラベルが地図の中に入る。線は太くしすぎない", async ({ page }) => {
    await openState(page, { name: "輪", spot: true });
    const outer = distanceRingsOf(SPOT.meshCode)!.features.at(-1)!.geometry.coordinates[0]!;
    const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
    await expect
      .poll(
        async () => {
          const pts = await page.evaluate((o) => {
            const m = (window as unknown as { __hpaiMap: { project(c: [number, number]): { x: number; y: number } } }).__hpaiMap;
            return o.map((c) => m.project(c as [number, number]));
          }, outer);
          return pts.every((p) => p.x >= 0 && p.x <= canvas.width && p.y >= 0 && p.y <= canvas.height);
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const label = page.locator(".ring-label", { hasText: "60" });
    await expect(label).toBeVisible();
    const box = (await label.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.height).toBeLessThanOrEqual(20);
    expect(await label.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14.4);
    const width = await page.evaluate(() => (window as unknown as { __hpaiMap: { getPaintProperty(l: string, p: string): number } }).__hpaiMap.getPaintProperty("distance-rings", "line-width"));
    expect(width).toBeLessThanOrEqual(2);
  });

  test("登録なし: 地図の隅の『全国』で、拡大の後に全国へ戻れる。登録ありは切り替えだけ", async ({ page }) => {
    await openState(page, { name: "全国" });
    const btn = page.locator(".map-box").getByRole("button", { name: "全国" });
    await expect(btn).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    const zoom = () => page.evaluate(() => (window as unknown as { __hpaiMap: { getZoom(): number } }).__hpaiMap.getZoom());
    const start = await zoom();
    await page.evaluate(() => (window as unknown as { __hpaiMap: { jumpTo(o: unknown): void } }).__hpaiMap.jumpTo({ center: [134, 35], zoom: 9 }));
    await btn.click();
    await expect.poll(zoom, { timeout: 10_000 }).toBeCloseTo(start, 1);
  });

  test("県のバッジを押すと、町が読める広さまで寄る（塗りの閾値には連動しない）", async ({ page }) => {
    await openState(page, { name: "全国", cases: [FAR] });
    const badge = page.locator(".pref-badge:visible").first();
    await expect(badge).toBeVisible();
    await badge.click();
    const zoom = () => page.evaluate(() => (window as unknown as { __hpaiMap: { getZoom(): number } }).__hpaiMap.getZoom());
    await expect.poll(zoom, { timeout: 15_000 }).toBeCloseTo(7.5, 1);
  });
  test("登録あり: 地図の隅に『全国』を重ねない", async ({ page }) => {
    await openState(page, { name: "登録あり", spot: true });
    await expect(page.locator(".map-box").getByRole("button", { name: "全国" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全国" })).toHaveCount(1);
  });
  test("登録あり: 地図に印のない発表（確認中の県、町の分からない発表）は、地図の下の端の 1 行に出し、地図の中に収める", async ({ page }) => {
    const unknownTown = (id: string, prefCode: string, reviewing: boolean): Case => ({
      id,
      season: 2026,
      nationalNo: null,
      prefNo: null,
      prefCode,
      muniCode: null,
      muniName: null,
      birdUse: null,
      housing: null,
      headCount: null,
      stages: reviewing ? {} : { confirmed: { date: "2026-11-03", time: null } },
      radiiKm: [],
      prefEstimates: { shipment: null, movement: null, surveillance: null },
      negation: "none",
      negatedAt: null,
      confirmState: reviewing ? "reviewing" : "auto",
      sourceUrls: ["https://example.invalid/x"],
      updatedAt: NOW,
    });
    await openState(page, { name: "印のない発表", spot: true, cases: [unknownTown("rev-28", "28", true), unknownTown("u-31", "31", false)] });
    const line = page.locator(".map-box .near-unmarked");
    await expect(line).toHaveText(/地図に印のない発表: 兵庫県 確認中、鳥取県 1 件（町名なし）/);
    const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
    const l = (await line.boundingBox())!;
    expect(l.y).toBeGreaterThanOrEqual(canvas.y);
    expect(l.y + l.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    expect(l.y + l.height).toBeLessThanOrEqual(bottomY(page));
    const japan = line.getByRole("button", { name: "全国で見る" });
    expect((await japan.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await japan.click();
    await expect(line).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全国", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("PC の幅（1280x860）で地図が最初の画面に入る", () => {
  const AT = "2026-11-04T08:30:00+09:00";
  const watch = Array.from({ length: 47 }, (_, i) => ({ prefCode: String(i + 1).padStart(2, "0"), checkedAt: AT, ok: true, lastOkAt: AT, failingSince: null }));
  const REVIEWING: Case = {
    id: "rev-pc",
    season: 2026,
    nationalNo: null,
    prefNo: null,
    prefCode: "31",
    muniCode: null,
    muniName: null,
    birdUse: null,
    housing: null,
    headCount: null,
    stages: {},
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "reviewing",
    sourceUrls: ["https://example.invalid/review"],
    updatedAt: AT,
  };

  for (const [name, spot] of [
    ["登録なし", null],
    ["登録あり", { meshCode: "53390000", muniCode: "13101", frequentMuniCodes: [] }],
  ] as const) {
    test(`${name}: 札は地図の上に 1 列で並び、切り替えは地図の真上に横いっぱい。札の順は設計書のとおり`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch });
      if (spot) await page.addInitScript((s) => localStorage.setItem("hpai.spot.v1", s), JSON.stringify(spot));
      await page.goto("/");
      const canvas = page.locator(".map-box .map-canvas");
      await expect(canvas).toBeVisible();
      await expect(page.locator(".stat-row")).toBeVisible();
      const cards = page.locator(".stat-row > .stat:visible");
      await expect(cards).toHaveCount(spot ? 4 : 3);
      await expect(cards.first().locator(".stat-title")).toContainText(spot ? "約 60 km 以内" : "発生した件数");
      const boxes = await Promise.all((await cards.all()).map(async (c) => (await c.boundingBox())!));
      const top = (await canvas.boundingBox())!.y;
      for (const b of boxes) {
        expect(b.y).toBe(boxes[0]!.y);
        expect(b.y + b.height).toBeLessThanOrEqual(top);
      }
      for (const card of await cards.all()) await expect(card.locator(".stat-when")).toBeVisible();
      // 全県を確認できた朝の行は断りではないので、右の列の先頭に上げない
      const ok = (await page.locator(".state-ok.watch-line").boundingBox())!;
      const disclaimer = (await page.locator(".map-disclaimer").boundingBox())!;
      expect(ok.y).toBeGreaterThan(disclaimer.y);
      if (spot) {
        // 切り替えは札の下、地図の真上に、2 列にまたがって置く（2026-11-06 作者の決定）
        const scope = (await page.locator(".map-scope").boundingBox())!;
        const map = (await canvas.boundingBox())!;
        expect(scope.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
        expect(scope.y + scope.height).toBeLessThanOrEqual(map.y);
        expect(scope.x).toBeLessThanOrEqual(map.x + 1);
        expect(scope.width).toBeGreaterThan(map.width);
        const near = (await page.getByRole("button", { name: "自分の近く" }).boundingBox())!;
        expect(near.height).toBeGreaterThanOrEqual(44);
      }
    });

    test(`${name}: 確認中の県と一部未確認があっても、断りは札のそばで最初の画面に見え、地図も収まる`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      const oneFailing = watch.map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: AT } : w));
      await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [REVIEWING], wildBirds: [], watch: oneFailing });
      if (spot) await page.addInitScript((s) => localStorage.setItem("hpai.spot.v1", s), JSON.stringify(spot));
      await page.goto("/");
      const canvas = page.locator(".map-box .map-canvas");
      await expect(canvas).toBeVisible();
      // 未確認の断りは札ごとに出さず、札の上の 1 文にまとめる（2026-11-06 作者の決定）
      await expect(page.locator(".stat-national .stat-qual").first()).toBeHidden();
      const unchecked = page.locator(".stat-unchecked-wide");
      await expect(unchecked).toHaveText("確認できた範囲の件数です。岡山県は確認できていません。");
      expect((await unchecked.boundingBox())!.y + (await unchecked.boundingBox())!.height).toBeLessThanOrEqual(
        (await page.locator(".stat-row").boundingBox())!.y,
      );
      await expect(page.locator(".map-page > .as-of")).toBeVisible();
      const row = (await page.locator(".stat-row").boundingBox())!;
      const wait = page.locator(".state-wait").filter({ hasText: "確認中の発表がある県" });
      await expect(wait).toBeVisible();
      const w = (await wait.boundingBox())!;
      // 札の 0 件だけが読まれないよう、札のすぐ下（見回りの行の次）で、画面の下端より上に入れる
      const nav = viewportBottom(page);
      expect(w.y).toBeGreaterThanOrEqual(row.y + row.height);
      // 切り替えのある登録ありは、切り替えの高さ（約 56px）だけ下がる（2026-11-06 作者の決定）
      expect(w.y).toBeLessThan(row.y + row.height + (spot ? 200 : 140));
      expect(w.y + w.height).toBeLessThanOrEqual(nav.y);
      // 札が伸びる分だけ、地図はふだんの 320px より少し下がる（実測 333px）。
      // 登録ありは切り替えを地図の真上に置くので、さらに約 56px 下がる（2026-11-06 作者の決定）
      const box = (await canvas.boundingBox())!;
      // 2026-11-06 骨組みの作り直し（設計書 2026-11-06-ui-frame）: 左のメニュー（幅 240px）の分、本文が狭く、札の文が 1 行増える。
      // 実測は登録ありで 431.94px（それまで 410px 未満）。登録なしは変わらず 350px 未満
      expect(box.y).toBeLessThan(spot ? 450 : 350);
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 180);
    });

    test(`${name}: 地図は右の列に伸ばされず、上端と高さが画面に収まる`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch });
      if (spot) await page.addInitScript((s) => localStorage.setItem("hpai.spot.v1", s), JSON.stringify(spot));
      await page.goto("/");
      const canvas = page.locator(".map-box .map-canvas");
      await expect(canvas).toBeVisible();
      await expect(page.locator(".stat-row")).toBeVisible();
      const box = (await canvas.boundingBox())!;
      const nav = viewportBottom(page);
      // 登録ありは切り替えを地図の真上に置くので、約 56px 下がる（実測 369.75px。2026-11-06 作者の決定）
      // 2026-11-06 骨組みの作り直し（設計書 2026-11-06-ui-frame）: 左のメニューの分、本文が狭くなる。登録ありの実測 396.94px（それまで 369.75px）
      expect(box.y).toBeLessThan(spot ? 410 : 320);
      expect(box.height).toBeLessThanOrEqual(640);
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 180);
    });
  }
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
