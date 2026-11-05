import type { Case, WatchStatus } from "@hpai/shared/types";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { distanceRingsOf } from "../src/geo/distanceRings";
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
    test(`${s.name}: 地図の全部が下のタブより上に入り、高さが横幅の 85% 以上`, async ({ page }) => {
      await openState(page, s);
      const canvas = (await page.locator(".map-box .map-canvas").boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "メイン" }).boundingBox())!;
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
      await expect(page.locator(".map-disclaimer + .map-ring-note")).toHaveCount(s.spot ? 1 : 0);
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

  test("登録あり: 地図の隅に『全国』を重ねない", async ({ page }) => {
    await openState(page, { name: "登録あり", spot: true });
    await expect(page.locator(".map-box").getByRole("button", { name: "全国" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全国" })).toHaveCount(1);
  });
});

test.describe("PC の幅（1280x860）で地図が最初の画面に入る", () => {
  const AT = "2026-11-04T08:30:00+09:00";
  const watch = Array.from({ length: 47 }, (_, i) => ({ prefCode: String(i + 1).padStart(2, "0"), checkedAt: AT, ok: true, lastOkAt: AT, failingSince: null }));

  for (const [name, spot] of [
    ["登録なし", null],
    ["登録あり", { meshCode: "53390000", muniCode: "13101", frequentMuniCodes: [] }],
  ] as const) {
    test(`${name}: 地図は右の列に伸ばされず、上端と高さが画面に収まる`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: [], wildBirds: [], watch });
      if (spot) await page.addInitScript((s) => localStorage.setItem("hpai.spot.v1", s), JSON.stringify(spot));
      await page.goto("/");
      const canvas = page.locator(".map-box .map-canvas");
      await expect(canvas).toBeVisible();
      await expect(page.locator(".stat-row")).toBeVisible();
      const box = (await canvas.boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "メイン" }).boundingBox())!;
      expect(box.y).toBeLessThan(320);
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
