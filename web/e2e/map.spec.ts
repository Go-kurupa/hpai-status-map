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
    /** 過去シーズンとの比べが 2 枚の地図だったころの 2 枚目の名前。今は 1 枚に重ねるので使わない */
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
    // 比べるシーズンのボタンにも「昨季」があるので、下のシーズンの棒に絞って押す（設計書 2026-11-06-data-explore E12）
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.locator(".season-bar").getByRole("button", { name: /昨季/ })).toBeVisible();
    await page.locator(".season-bar").getByRole("button", { name: /昨季/ }).click();
    await expect(page.locator(".season-bar").getByRole("button", { name: /昨季/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".season-bar").getByRole("button", { name: /昨季.*24 件/ })).toBeVisible();
    await page.locator(".season-bar").getByRole("button", { name: /今季/ }).click();
    await expect(page.locator(".season-bar").getByRole("button", { name: /今季/ })).toHaveAttribute("aria-pressed", "true");
  });

  // 比べの地図の塗り。/compare は初め昨季と今季を 1 枚に重ねる（設計書 2026-11-06-data-explore E8）。比べる 2 は今季（試験の今季は 0 件）なので、
  // 昨季の町は「比べる 1 だけ」の層に入る。下のシーズンの棒は一覧と月の件数のシーズンを選ぶだけで、地図の比べには触らない（11/7 の横断レビュー）。
  // 画面は行き先ごとに作り直すので、/ へ戻ると今季に戻る（設計書 2026-11-06-ui-frame 4.1）
  test("/compare は初め昨季と今季を重ね、cmp-one に 33203 が入る。下の棒を押しても地図の比べは替わらない。/ へ戻ると今季。japan.topo.json の要求は 1 回", async ({ page }) => {
    const topoRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("japan.topo.json")) topoRequests.push(r.url());
    });
    await open(page, 390, "/compare");
    await page.locator(".season-bar").getByRole("button", { name: /昨季.*24 件/ }).click();
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("cmp-one"), undefined, { timeout: 20_000 });
    const has = (layer: string) => page.waitForFunction((l) => JSON.stringify(window.__hpaiMap!.getFilter(l)).includes("33203"), layer);
    await has("cmp-one");
    // 重ねている間は、発生の塗り（case-confirmed）を使わない
    expect(JSON.stringify(await page.evaluate(() => window.__hpaiMap!.getFilter("case-confirmed")))).not.toContain("33203");
    // 下の棒で今季を押すと、棒の印は今季に移るが、比べるシーズン（昨季と今季）と地図の塗りはそのまま
    await page.locator(".season-bar").getByRole("button", { name: /今季/ }).click();
    await expect(page.locator(".season-bar").getByRole("button", { name: /今季/ })).toHaveAttribute("aria-pressed", "true");
    const seasons = page.getByRole("group", { name: /^比べるシーズン/ });
    await expect(seasons.getByRole("button", { name: /2025〜/ })).toHaveAttribute("aria-pressed", "true");
    await expect(seasons.getByRole("button", { name: /2026〜/ })).toHaveAttribute("aria-pressed", "true");
    await has("cmp-one");
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

  test("メニューの 8 の行き先で各ページに着き、下のタブも地図の下のリンクの列もない（スマホは三本線から）", async ({ page }) => {
    await open(page);
    // 下のタブ（メイン）は出さない。地図の下には、次の画面へのリンクだけ。ほかのページへのリンクの列（ほかのページ）は / から消えた
    await expect(page.getByRole("navigation", { name: "メイン" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "ほかのページ" })).toHaveCount(0);
    const next = page.getByRole("navigation", { name: "次の画面" });
    await expect(next.getByRole("link")).toHaveText(["選択地域の過去を見る", "今季の一覧と数を見る", "過去シーズンと比べる"]);
    for (const [name, path] of [
      ["選択地域の過去を見る", "/town"],
      ["今季の一覧と数を見る", "/season"],
      ["過去シーズンと比べる", "/compare"],
    ] as const) {
      await next.getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await page.goBack();
      await expect(next).toBeVisible();
    }

    expect(MENU_ITEMS).toHaveLength(8); // 設計書 2026-11-06-ui-frame 3 章（決定 8〜16。会員でない人）
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

  test("PC（1280px）は左のメニューで 8 の行き先へ 1 回で行ける。今いる項目に aria-current が付く。今季の中の切り替えは題と同じ行", async ({ page }) => {
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
    test("町だけ選んだ人は、町の中心から輪が描かれ、選択地域付近は約 60 km の輪の全体が入る。断りは町の中心の文", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33643"));
      await open(page, 1280);
      await expect(page.getByText("※ 輪は自治体の中心からの距離の目安で、発表の区域ではありません。")).toBeVisible();
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

  // 設計書 2026-11-06-data-explore E8、E15: 過去シーズンとの比べは 1 枚の地図に「／」「＼」「×」で重ねる。広さのボタンは 1 段で、地方へ寄せる
  const centerIn = (page: Page, box: [number, number, number, number]) =>
    expect
      .poll(
        () =>
          page.evaluate((b) => {
            const m = window.__hpaiMap!;
            const c = m.getCenter();
            return !m.isMoving() && c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
          }, box),
        { timeout: 15_000 },
      )
      .toBe(true);
  const CHUGOKU: [number, number, number, number] = [131.0, 33.8, 134.5, 35.7];

  test("PC: /compare は 1 枚の地図に昨季と今季を重ね、［中国］で中国地方へ寄せる。町を押すと 2 つのシーズンが 1 つの欄に上下に並ぶ", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33203"));
    await open(page, 1280, "/compare");
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("cmp-one"), undefined, { timeout: 20_000 });
    // シーズンはボタンで選ぶ（設計書 2026-11-06-data-explore E12）。初めは昨季と今季
    const seasons = page.getByRole("group", { name: /^比べるシーズン/ });
    const seasonBtn = (y: number) => seasons.getByRole("button", { name: new RegExp(`${y}〜`) });
    await expect(seasonBtn(2025)).toHaveAttribute("aria-pressed", "true");
    await expect(seasonBtn(2026)).toHaveAttribute("aria-pressed", "true");
    // 地図は 1 枚だけ
    await expect(page.locator(".cmp-overlay .map-canvas")).toHaveCount(1);
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("cmp-one")).includes("33203"));
    // 今季の代わりに 4 年前（2022）にすると、2 だけ（＼）と両方（×）の層にも町が入り、凡例の町の数も 0 でない
    await seasonBtn(2022).click();
    await seasonBtn(2026).click();
    await page.waitForFunction(() => ["cmp-two", "cmp-both"].every((l) => /"\d{5}"/.test(JSON.stringify(window.__hpaiMap!.getFilter(l)))));
    await expect(page.getByRole("list", { name: "重ね合わせの凡例" })).toContainText(/両方で発生（[1-9]\d* 町）/);
    // 3 つ目（2024）を足すと、最後の発生の色の層に町が入り、重ね合わせの層は空になる
    await seasonBtn(2024).click();
    await page.waitForFunction(() => /"\d{5}"/.test(JSON.stringify(window.__hpaiMap!.getFilter("cmp-latest"))) && !/"\d{5}"/.test(JSON.stringify(window.__hpaiMap!.getFilter("cmp-one"))));
    await expect(page.getByRole("list", { name: "重ね合わせの凡例" })).toContainText(/が最後（[1-9]\d* 町）/);
    // 2 つ以上のシーズンで発生した町には、寄ると数字の札が出る（作者 11/7）。全国の広さでは出さない
    await expect(page.locator(".cmp-count-badge:not([hidden])")).toHaveCount(0);
    await page.evaluate(() => window.__hpaiMap!.jumpTo({ center: [134.0, 35.07], zoom: 9 }));
    await expect.poll(() => page.locator(".cmp-count-badge:not([hidden])").count()).toBeGreaterThan(0);
    // 元の 2 つ（昨季と今季）に戻す
    await seasonBtn(2022).click();
    await seasonBtn(2024).click();
    await seasonBtn(2026).click();
    await expect(seasonBtn(2025)).toHaveAttribute("aria-pressed", "true");
    await expect(seasonBtn(2026)).toHaveAttribute("aria-pressed", "true");
    // 右上の見方の切り替えは、広さのボタンに重ならない（11/6 本番で重なっていた）
    const tabs = (await page.locator(".map-page > .section-tabs").boundingBox())!;
    const scope = page.getByRole("group", { name: "地図の広さ" });
    expect(tabs.y + tabs.height).toBeLessThanOrEqual((await scope.boundingBox())!.y);
    // 地方のボタンで寄せる。押された印は最後に押した 1 つ
    await expect.poll(() => page.evaluate(() => window.__hpaiMap!.isMoving()), { timeout: 15_000 }).toBe(false);
    await scope.getByRole("button", { name: "中国" }).click();
    await expect(scope.getByRole("button", { name: "中国" })).toHaveAttribute("aria-pressed", "true");
    await expect(scope.getByRole("button", { name: "選択地域付近" })).toHaveAttribute("aria-pressed", "false");
    await centerIn(page, CHUGOKU);
    // 津山市を押す
    await page.evaluate(() => window.__hpaiMap!.jumpTo({ center: [134.0, 35.07], zoom: 9 }));
    await expect
      .poll(() => page.evaluate(() => { const m = window.__hpaiMap!; const r = m.getCanvas().getBoundingClientRect(); return m.queryRenderedFeatures([r.width / 2, r.height / 2], { layers: ["muni-fill"] }).map((f) => f.properties?.["c"]); }), { timeout: 15_000 })
      .toEqual(["33203"]);
    const box = (await page.locator(".cmp-overlay .map-canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const panel = page.locator(".compare-cases");
    await expect(panel.getByRole("heading", { level: 2, name: "津山市" })).toBeFocused();
    // 押した町を赤い線で囲む（作者 11/7）
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("picked-line")).includes("33203"));
    await expect(panel.getByRole("heading", { level: 3 })).toHaveText(["比べる 1（2025 年 6 月〜2026 年 5 月）", "比べる 2（2026 年 6 月〜2027 年 5 月）"]);
  });

  test("スマホ: 条件で見るの「地図で中国を見る」から開くと、選択地域があっても中国地方に寄せる。見せ方を「1 だけ」にすると、比べる 1 の町が cmp-one に入る", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "01100"));
    await open(page, 390, "/explore");
    await page.getByRole("group", { name: "地方" }).getByRole("button", { name: /^中国/ }).click();
    await page.getByRole("link", { name: "地図で中国を見る" }).click();
    await expect(page).toHaveURL(/\/compare\?region=chugoku$/);
    await page.waitForFunction(() => !!window.__hpaiMap?.getLayer("cmp-one"), undefined, { timeout: 20_000 });
    await expect(page.getByRole("group", { name: "地図の広さ" }).getByRole("button", { name: "中国" })).toHaveAttribute("aria-pressed", "true");
    await centerIn(page, CHUGOKU);
    await page.getByRole("group", { name: "地図の見せ方" }).getByRole("button", { name: "1 だけ" }).click();
    await page.waitForFunction(() => JSON.stringify(window.__hpaiMap!.getFilter("cmp-one")).includes("33203") && !JSON.stringify(window.__hpaiMap!.getFilter("cmp-both")).includes("33203"));
  });

  // 設計書 2026-11-06-ui-frame 決定 4: 地図で町を押すと、その町の今季と過去の事例が右の列（スマホは地図の下）に出る
  test.describe("押した町の事例", () => {
    test("PC: 地図の真ん中（自分の町）を押すと右の列の先頭に欄が出て、題へ移る。過去の記録の近くの町のボタンを押すと過去の事例が出て、戻るとそのボタンへ戻る", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33643"));
      await open(page, 1280);
      const panel = page.locator(".town-cases");
      // 近くの自治体のボタンは、選択地域の欄の「過去の記録」にある（2026-11-06 作者の決定。同じ町が 2 か所に並ばないように）
      const pick = page.locator(".town-past .town-cases-picks").getByRole("button", { name: /^美作市 \d+ 件$/ });
      await expect(pick).toBeVisible({ timeout: 20_000 });
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
      await panel.getByRole("button", { name: "選択地域に戻る" }).click();
      await expect(panel).toHaveCount(0);
      await pick.click();
      await expect(panel.getByRole("heading", { level: 2, name: "美作市" })).toBeFocused();
      await expect(panel.getByText("2020 年 12 月 11 日")).toBeVisible();
      await expect(panel.getByRole("link", { name: "資料を開く" }).first()).toHaveAttribute("rel", /noopener/);
      // 戻ると、開いた元の美作市のボタンへフォーカスが戻る
      await panel.getByRole("button", { name: "選択地域に戻る" }).click();
      await expect(pick).toBeFocused();
    });

    test("欄は今季の発生の地図だけ。過去の発生（/compare）と選択地域のまわり（/town）には出ない", async ({ page }) => {
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
