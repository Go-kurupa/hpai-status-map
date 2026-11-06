import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";
import { goViaMenu, MENU_ITEMS, menuButton, menuNav } from "./helpers/frame";

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
  queryRenderedFeatures(q: [number, number], o: { layers: string[] }): Array<{ properties?: Record<string, unknown> }>;
  getCanvas(): HTMLCanvasElement;
  getFilter(id: string): unknown;
  getLayer(id: string): unknown;
  dragRotate: { isEnabled(): boolean };
  touchPitch: { isEnabled(): boolean };
  // maplibre 6.16 には isRotationDisabled が無い（d.ts と実装で確認）。disableRotation() が立てる内部の印と、回転の取り扱い部品の状態で確かめる
  touchZoomRotate: { _rotationDisabled: boolean; _touchRotate: { isEnabled(): boolean } };
  keyboard: { _rotationDisabled: boolean };
  getBearing(): number;
  getPitch(): number;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  isMoving(): boolean;
};
declare global {
  interface Window {
    __hpaiMap?: MapHandle;
    /** 過去シーズンとの比べの 2 枚目（比べる 2） */
    __hpaiMap2?: MapHandle;
  }
}

/**
 * path が "/" のときは地図まで待つ。地図は "/"（と再現・見本）にだけある。
 * 一覧・棒・月の表は /season、シーズンの切り替えと比べは /compare、町の文の全部は /town（設計書 2026-11-06-ui-frame 4 章）。
 * 地図のない画面は、題が出て札の行が描かれるまで待つ。
 */
async function open(page: Page, width = 390, path = "/", height = 800) {
  await page.setViewportSize({ width, height });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
  await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch: WATCH_OK });
  await page.goto(path);
  if (path !== "/") {
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    return;
  }
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

  test("昨季を押すと『24 件』になる。シーズンの切り替えは /compare にあり、/ にはない", async ({ page }) => {
    // シーズンの切り替えは「過去シーズンとの比べ」（/compare）へ移った（設計書 2026-11-06-ui-frame 4.4）。/ には出さない
    await open(page);
    await expect(page.getByRole("button", { name: /昨季/ })).toHaveCount(0);
    await goViaMenu(page, "過去シーズンとの比べ");
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.getByRole("button", { name: /昨季/ })).toBeVisible();
    await page.getByRole("button", { name: /昨季/ }).click();
    await expect(page.getByRole("button", { name: /昨季/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /昨季.*24 件/ })).toBeVisible();
    await page.getByRole("button", { name: /今季/ }).click();
    await expect(page.getByRole("button", { name: /今季/ })).toHaveAttribute("aria-pressed", "true");
  });

  // 昨季を選んだときの地図の塗り。/compare には段階 3 の 2 枚の地図ができるまで、選んだシーズンの地図が 1 枚ある。
  // 画面は行き先ごとに作り直すので、/ へ戻ると今季に戻る（設計書 2026-11-06-ui-frame 4.1、4.4）
  test("昨季を /compare で選ぶと、そこの地図の case-confirmed に 33203 が入る。/ へ戻ると今季。japan.topo.json の要求は 1 回", async ({ page }) => {
    const topoRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("japan.topo.json")) topoRequests.push(r.url());
    });
    await open(page, 390, "/compare");
    await page.getByRole("button", { name: /昨季.*24 件/ }).click();
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("case-confirmed")).includes("33203"));
    await page.getByRole("button", { name: /今季/ }).click();
    await page.getByRole("button", { name: /昨季/ }).click();
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("case-confirmed")).includes("33203"));
    expect(topoRequests).toHaveLength(1);
    // / へ戻ると今季（題が「今季の発生状況」）。選んだシーズンを持ち越さない
    await goViaMenu(page, "今季の発生と地図");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("今季の発生状況");
  });

  test("case-* は minzoom 6 から（全国の倍率では県のバッジ）", async ({ page }) => {
    await open(page);
    const minzooms = await page.evaluate(() =>
      Object.fromEntries(
        window.__hpaiMap!
          .getStyle()
          .layers.filter((l) => l.id.startsWith("case-"))
          .map((l) => [l.id, l.minzoom]),
      ),
    );
    expect(minzooms).toEqual({ "case-suspected": 6, "case-confirmed": 6 });
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

  test("メニューの 10 の行き先で各ページに着き、下のタブも地図の下のリンクの列もない（スマホは三本線から）", async ({ page }) => {
    await open(page);
    // 下のタブ（メイン）は出さない。地図の下には、次の画面へのリンクだけ。ほかのページへのリンクの列（ほかのページ）は / から消えた
    await expect(page.getByRole("navigation", { name: "メイン" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "ほかのページ" })).toHaveCount(0);
    const next = page.getByRole("navigation", { name: "次の画面" });
    await expect(next.getByRole("link")).toHaveText(["自分の町の過去を見る", "今季の一覧と数を見る", "過去シーズンと比べる"]);
    for (const [name, path] of [
      ["自分の町の過去を見る", "/town"],
      ["今季の一覧と数を見る", "/season"],
      ["過去シーズンと比べる", "/compare"],
    ] as const) {
      await next.getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await page.goBack();
      await expect(next).toBeVisible();
    }

    expect(MENU_ITEMS).toHaveLength(10); // 設計書 2026-11-06-ui-frame 3 章（決定 8〜14）
    const burger = menuButton(page);
    expect(await burger.isVisible()).toBe(true); // 390px はスマホ（三本線）
    for (const { name, path } of MENU_ITEMS) {
      const from = path === "/about" ? "/known" : "/about"; // どの項目も「今いる所」と違う画面から押す
      await page.goto(from);
      await goViaMenu(page, name);
      await expect(page, name).toHaveURL(new RegExp(`${path === "/" ? "/$" : `${path}$`}`));
      await expect(menuNav(page)).toBeHidden(); // 押すと閉じる
      await page.goBack();
      await expect(page, `${name} から戻る`).toHaveURL(new RegExp(`${from}$`)); // 戻る操作で元の画面
    }
  });

  test("PC（1280px）は左のメニューで 10 の行き先へ 1 回で行ける。今いる項目に aria-current が付く。今季の中の切り替えは題と同じ行", async ({ page }) => {
    await open(page, 1280);
    await expect(menuButton(page)).toBeHidden();
    const nav = menuNav(page);
    await expect(nav).toBeVisible();
    for (const { name, path } of MENU_ITEMS) {
      await page.goto(path === "/about" ? "/known" : "/about");
      await goViaMenu(page, name);
      await expect(page, name).toHaveURL(new RegExp(`${path === "/" ? "/$" : `${path}$`}`));
      await expect(nav.getByRole("link", { name }).first()).toHaveAttribute("aria-current", "page");
    }
    // 今季の発生の中の見方（地図／一覧と数）。題と同じ行の右に置き、地図を押し下げない（設計書 2026-11-06-ui-frame 決定 9）
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "今季の発生の見方" });
    await expect(tabs.getByRole("link", { name: "地図", exact: true })).toHaveAttribute("aria-current", "page");
    const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    // 題の文字そのものの右端（h1 の箱は行いっぱいなので、文字の範囲で測る）
    const textRight = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().right;
    });
    const t = (await tabs.boundingBox())!;
    expect(t.y).toBeLessThan(h1.y + h1.height);
    expect(t.x).toBeGreaterThan(textRight);
    await tabs.getByRole("link", { name: "一覧と数" }).click();
    await expect(page).toHaveURL(/\/season$/);
    await expect(nav.getByRole("link", { name: "今季の発生" })).toHaveAttribute("aria-current", "page");
  });

  test("スマホのメニューは、開くと中へフォーカスが移り、Escape で閉じて三本線へ戻る。画面が替わると題へフォーカスが移る", async ({ page }) => {
    await open(page);
    const burger = menuButton(page);
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "メニューを閉じる" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuNav(page)).toBeHidden();
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await expect(burger).toBeFocused();
    // 閉じるボタンでも閉じ、三本線へ戻る
    await burger.click();
    await page.getByRole("button", { name: "メニューを閉じる" }).click();
    await expect(menuNav(page)).toBeHidden();
    await expect(burger).toBeFocused();
    // 項目を押して画面が替わると、フォーカスは新しい画面の題（h1）へ
    await goViaMenu(page, "全国の傾向");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("登録した町の札、野鳥の札、町の枠の周辺の表が 360px で横にはみ出さない（札は /、野鳥の札は /season、周辺の表は /town）", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(
      (s) => window.localStorage.setItem("hpai.spot.v1", JSON.stringify(s)),
      { meshCode: "52344080", muniCode: "33203", frequentMuniCodes: ["33202"] }, // 津山市のあたり（試験の地点）
    );
    const noOverflow = async () => {
      const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(widths.doc).toBeLessThanOrEqual(widths.win);
    };
    // / : 数字の欄の登録した町の札
    await open(page);
    await expect(page.getByText("登録した町の今季")).toBeVisible();
    await expect(page.locator(".stat", { hasText: "登録した町の今季" })).toContainText("倉敷市");
    await noOverflow();
    // /season : 野鳥の札と、定点の水鳥へのリンク（43px 以下にしない）
    await page.goto("/season");
    await expect(page.getByText("野鳥の陽性（今季）")).toBeVisible();
    const link = page.getByRole("link", { name: "定点の水鳥の数を見る" });
    await expect(link).toHaveAttribute("href", "/trends");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noOverflow();
    // /town : 町の枠の周辺の表（過去 6 シーズン）
    await page.goto("/town");
    await page.locator(".nearby-past summary").click();
    const table = page.getByRole("table", { name: "周辺の町の過去の発生" });
    await expect(table).toBeVisible();
    await expect(table.locator('td[data-label="距離"]').first()).toContainText("この町");
    await expect(page.getByText("農場のマス目から町の境までの距離")).toBeVisible();
    await noOverflow();
    const smallest = await page.locator(".nearby-past").evaluate((b) => Math.min(...[...b.querySelectorAll("p,th,td,summary")].map((c) => parseFloat(getComputedStyle(c).fontSize))));
    expect(smallest).toBeGreaterThanOrEqual(14);
  });

  test.describe("県ごとと週ごとの棒", () => {
    const NOW = "2027-05-25T09:00:00+09:00";
    // シーズンの終わり（週がいちばん多い）で、1 週に 12 件、名前の長い県、未確認の県がある状態
    const at = (date: string, prefCode: string, id: string) => ({
      id,
      season: 2026,
      nationalNo: null,
      prefNo: null,
      prefCode,
      muniCode: null,
      muniName: null,
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
    const cases = [
      ...Array.from({ length: 12 }, (_, i) => at("2027-01-06", "14", `k${i}`)),
      ...Array.from({ length: 9 }, (_, i) => at("2027-01-13", "46", `s${i}`)),
      ...Array.from({ length: 34 }, (_, i) => at(`2026-${10 + (i % 3)}-${String(1 + (i % 28)).padStart(2, "0")}`, "01", `h${i}`)),
    ] as unknown as Parameters<typeof installFixture>[1]["cases"];
    const watch = WATCH_OK.map((w) => {
      const base = { ...w, checkedAt: "2027-05-25T08:30:00+09:00", lastOkAt: "2027-05-25T08:30:00+09:00" };
      return w.prefCode === "23" ? { ...base, ok: false, failingSince: "2027-05-24T08:30:00+09:00" } : base;
    });
    const openCharts = async (page: Page, width: number) => {
      await page.setViewportSize({ width, height: 800 });
      await page.route("https://cyberjapandata.gsi.go.jp/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }));
      await installFixture(page, { now: NOW, cases, wildBirds: [], watch });
      await page.goto("/season"); // 県ごと・週ごとの棒は /season へ移った（設計書 2026-11-06-ui-frame 4.3）
      await expect(page.locator(".season-charts")).toBeVisible({ timeout: 20_000 });
    };

    test("幅 360px で 35 週を描いても横にはみ出さず、目盛りの数字は 14px を下回らない。棒を押すと詳細が画面の中に出る", async ({ page }) => {
      await openCharts(page, 360);
      const weeks = page.getByRole("list", { name: "週ごとの全国の発生の棒" });
      await expect(weeks.locator("> li")).toHaveCount(35);
      await expect(page.locator(".pref-bar-row").first()).toContainText("北海道");
      await expect(page.locator(".pref-bar-row", { hasText: "神奈川県" })).toContainText("12 件");
      await expect(page.locator(".season-charts")).toContainText("愛知県は確認できていません。");
      await expect(page.locator(".season-charts")).toContainText("9 月 28 日の週");
      await expect(page.locator(".season-charts")).toContainText("5 月 24 日の週");
      // 縦軸の目盛り。棒の上に数字は置かない（2026-11-06 作者の決定）
      await expect(page.getByRole("list", { name: "縦軸の目盛り（件）" }).locator("> li").first()).toHaveText("0");
      await expect(page.locator(".week-count")).toHaveCount(0);
      // 一番多い週の棒を押すと、件数と県の詳細が画面の中に出る
      const tallest = await weeks.evaluate((ol) => {
        const items = [...ol.children] as HTMLElement[];
        let best = -1;
        let at = 0;
        items.forEach((li, i) => {
          const r = Number(li.querySelector<HTMLElement>(".week-bar-fill")?.style.getPropertyValue("--r") ?? 0);
          if (r > best) [best, at] = [r, i];
        });
        return at;
      });
      await weeks.locator("> li").nth(tallest).scrollIntoViewIfNeeded();
      const bar = (await weeks.locator("> li").nth(tallest).boundingBox())!;
      await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height - 4);
      const tip = page.locator(".week-tip");
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(" 件");
      await expect(tip).toContainText("県");
      const t = (await tip.boundingBox())!;
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(360);
      const m = await page.evaluate(() => {
        const texts = [...document.querySelectorAll<HTMLElement>(".season-charts p, .season-charts li, .week-ticks span, .week-tip")];
        return {
          doc: document.documentElement.scrollWidth,
          smallest: Math.min(...texts.map((x) => parseFloat(getComputedStyle(x).fontSize))),
        };
      });
      expect(m.doc).toBeLessThanOrEqual(360);
      expect(m.smallest).toBeGreaterThanOrEqual(14);
      expect(await page.locator(".season-charts").innerText()).not.toMatch(/区域の外です|安全|安心|問題ありません/);
    });

    test("幅 1280px で 2 つの棒が横に並ぶ", async ({ page }) => {
      await openCharts(page, 1280);
      const pref = (await page.locator(".pref-bars").boundingBox())!;
      const week = (await page.locator(".week-bars").boundingBox())!;
      expect(week.x).toBeGreaterThan(pref.x + pref.width - 1);
      expect(Math.abs(week.y - pref.y)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    });

    test("今季 0 件で全県確認なら枠を出さない（/ にも /season にも）", async ({ page }) => {
      await open(page, 360);
      await expect(page.getByText(/どこでも感染のリスクがあります/)).toBeVisible();
      await expect(page.locator(".season-charts")).toHaveCount(0);
      // /season は、野鳥の札（今季の数字）が描かれてから調べる
      await page.goto("/season");
      await expect(page.getByText("野鳥の陽性（今季）")).toBeVisible();
      await expect(page.locator(".season-charts")).toHaveCount(0);
    });
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

    // 設計書 2026-11-06-ui-frame 決定 6: 地点がなく町だけ選んだ人も、町の中心から輪を描く
    test("町だけ選んだ人は、町の中心から輪が描かれ、自分の近くは約 60 km の輪の全体が入る。断りは町の中心の文", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33643"));
      await open(page, 1280);
      await expect(page.getByText("輪は町の中心からの距離の目安で、発表の区域ではありません。")).toBeVisible();
      await expect(page.getByText(RING_NOTE)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.__hpaiMap!.queryRenderedFeatures(undefined, { layers: ["distance-rings"] }).length), { timeout: 10_000 })
        .toBeGreaterThan(0);
      const canvas = (await page.locator(".map-canvas").boundingBox())!;
      const label = (await page.locator(".ring-label", { hasText: "約 60 km" }).boundingBox())!;
      expect(label.y).toBeGreaterThanOrEqual(canvas.y);
      expect(label.y + label.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    });
  });

  // 設計書 2026-11-06-ui-frame 4.4、決定 5: 過去シーズンとの比べは 2 枚の地図。片方を動かすともう片方も同じ場所へ動く
  test("PC: /compare は比べる 1（昨季）と比べる 2（今季）の地図が左右に並び、1 枚目をドラッグすると 2 枚目も同じ中心と倍率へ動く。町を押すと 2 つのシーズンの欄", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33203"));
    await open(page, 1280, "/compare");
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("case-confirmed") && !!window.__hpaiMap2?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
    await expect(page.getByLabel("比べる 1", { exact: true })).toHaveValue("2025");
    await expect(page.getByLabel("比べる 2", { exact: true })).toHaveValue("2026");
    const [a, b] = await page.locator(".compare-side .map-canvas").all();
    const boxA = (await a!.boundingBox())!;
    const boxB = (await b!.boundingBox())!;
    expect(boxB.x).toBeGreaterThan(boxA.x + boxA.width);
    expect(Math.abs(boxB.y - boxA.y)).toBeLessThanOrEqual(1);
    // 初めの広さへ動き終わってから動かす
    await expect.poll(() => page.evaluate(() => window.__hpaiMap!.isMoving() || window.__hpaiMap2!.isMoving()), { timeout: 15_000 }).toBe(false);
    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxA.x + boxA.width / 2 + 120, boxA.y + boxA.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    // 2 枚の中心と倍率を 1 回の読み取りで比べる（惰性で動いている間も、止まった後も同じ）
    const same = () =>
      page.evaluate(() => {
        const at = (m: MapHandle) => [m.getCenter().lng.toFixed(4), m.getCenter().lat.toFixed(4), m.getZoom().toFixed(2)].join();
        return !window.__hpaiMap!.isMoving() && at(window.__hpaiMap!) === at(window.__hpaiMap2!);
      });
    await expect.poll(same, { timeout: 10_000 }).toBe(true);
    // 2 枚目を動かすと 1 枚目もついてくる
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxB.x + boxB.width / 2 - 100, boxB.y + boxB.height / 2 - 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(same, { timeout: 10_000 }).toBe(true);
    // 2 枚目の津山市を押す（2 枚目のどこを押しても欄は同じ町の 2 つのシーズン）
    await page.evaluate(() => window.__hpaiMap2!.jumpTo({ center: [134.0, 35.07], zoom: 9 }));
    await expect
      .poll(() => page.evaluate(() => { const m = window.__hpaiMap2!; const r = m.getCanvas().getBoundingClientRect(); return m.queryRenderedFeatures([r.width / 2, r.height / 2], { layers: ["muni-fill"] }).map((f) => f.properties?.["c"]); }), { timeout: 15_000 })
      .toEqual(["33203"]);
    await page.mouse.click(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
    const panel = page.locator(".compare-cases");
    await expect(panel.getByRole("heading", { level: 2, name: "津山市" })).toBeFocused();
    await expect(panel.getByRole("heading", { level: 3 })).toHaveText(["比べる 1（2025 年 6 月〜2026 年 5 月）", "比べる 2（2026 年 6 月〜2027 年 5 月）"]);
  });

  // スマホは 2 枚目を画面に入ってから作る。作ったときに古い広さの指定を当て直して、1 枚目で動かした位置を消さない
  test("スマホ: /compare の 2 枚目は下へ送ってから作られ、1 枚目で動かした位置に合わせる（1 枚目の位置は変わらない）", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33203"));
    // 2 枚目は 200px 手前から読み込むので、高さを低くして初めは範囲の外に置く
    await open(page, 390, "/compare", 500);
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__hpaiMap!.isMoving()), { timeout: 15_000 }).toBe(false);
    expect(await page.evaluate(() => !!window.__hpaiMap2)).toBe(false);
    // 1 枚目を九州へ
    await page.evaluate(() => window.__hpaiMap!.jumpTo({ center: [130.7, 32.8], zoom: 7 }));
    await page.locator(".compare-side").nth(1).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!window.__hpaiMap2?.getLayer("case-confirmed"), undefined, { timeout: 20_000 });
    await page.waitForTimeout(800);
    const at = await page.evaluate(() => [window.__hpaiMap!, window.__hpaiMap2!].map((m) => [m.getCenter().lng.toFixed(2), m.getCenter().lat.toFixed(2), m.getZoom().toFixed(1)].join()));
    expect(at[0]).toBe("130.70,32.80,7.0");
    expect(at[1]).toBe(at[0]);
  });

  // 設計書 2026-11-06-ui-frame 決定 4: 地図で町を押すと、その町の今季と過去の事例が右の列（スマホは地図の下）に出る
  test.describe("押した町の事例", () => {
    test("PC: 地図の真ん中（自分の町）を押すと右の列の先頭に欄が出て、題へ移る。戻ると近くの町のボタン、押すと過去の事例が出る", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33643"));
      await open(page, 1280);
      const panel = page.locator(".town-cases");
      await expect(panel.getByRole("button", { name: "美作市" })).toBeVisible({ timeout: 20_000 });
      // 輪の広さへ動いている最中に押すと動きが止まり、町の塗りのない広さに残る。真ん中に自分の町の塗りが描かれてから押す
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const m = window.__hpaiMap!;
              const r = m.getCanvas().getBoundingClientRect();
              return m.queryRenderedFeatures([r.width / 2, r.height / 2], { layers: ["muni-fill"] }).map((f) => f.properties?.["c"]);
            }),
          { timeout: 15_000 },
        )
        .toEqual(["33643"]);
      const c = (await page.locator(".map-canvas").boundingBox())!;
      await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
      const heading = panel.getByRole("heading", { level: 2, name: "西粟倉村" });
      await expect(heading).toBeFocused();
      await expect(panel.getByText(/時点で、発生記録はありません。/)).toBeVisible();
      // 右の列の先頭で、地図の上端と並ぶ
      const canvas = (await page.locator(".map-canvas").boundingBox())!;
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThan(canvas.x + canvas.width);
      expect(Math.abs(box.y - canvas.y)).toBeLessThanOrEqual(2);
      await panel.getByRole("button", { name: "自分の町に戻る" }).click();
      await panel.getByRole("button", { name: "美作市" }).click();
      await expect(panel.getByRole("heading", { level: 2, name: "美作市" })).toBeFocused();
      await expect(panel.getByText("2020 年 12 月 11 日")).toBeVisible();
      await expect(panel.getByRole("link", { name: "資料を開く" }).first()).toHaveAttribute("rel", /noopener/);
    });

    test("欄は今季の発生の地図だけ。過去の発生（/compare）と自分の町のまわり（/town）には出ない", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33643"));
      for (const path of ["/compare", "/town"]) {
        await open(page, 1280, path);
        // 欄（近くの町のボタン）は国の事例一覧が届いてから出る。届く前に数えると空振りするので、通信が落ち着くまで待つ
        await page.waitForLoadState("networkidle");
        await expect(page.locator(".town-cases")).toHaveCount(0);
      }
    });
  });
});
