import { expect, test, type Page, type Request } from "@playwright/test";

// 去年 12 月の再現（X-02）。本番と同じ build（mode=e2e）で、/replay を開いて 12/19 の夜から 1/21 まで進める。
// 地理院タイルは外へ出さず、1 画素の PNG で答える。審査員の操作で Firestore も Claude も呼ばないことを、全要求で確かめる。
// 回さずに書いている（ブラウザ試験は本体が回す）。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";
// 全国の流れの最初の事例（2025-10-22、水曜）の週
const FIRST_WEEK = "10 月 20 日の週";

// map.spec.ts が Window.__hpaiMap を宣言しているので、ここでは型の別名で受ける（宣言を重ねない）
type MapHandle = { getFilter(id: string): unknown; getLayer(id: string): unknown };
type W = { __hpaiMap?: MapHandle };

async function open(page: Page, storage?: Record<string, string>) {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  if (storage) {
    await page.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, v);
    }, storage);
  }
  await page.goto("/replay");
  await page.waitForFunction(() => !!(window as unknown as W).__hpaiMap?.getLayer("case-suspected"), undefined, { timeout: 20_000 });
}

/** 日付の一覧は畳んである。閉じていたら『日付の一覧から選ぶ』を押して開いてから、ボタンを返す */
async function openList(page: Page) {
  const fold = page.locator("details.fold").filter({ has: page.locator('ol[aria-label="日付の一覧"]') });
  if (!(await fold.evaluate((el) => (el as HTMLDetailsElement).open))) await fold.getByText("日付の一覧から選ぶ").click();
}
/** 帯の「くわしく」を開く。畳んだ文は閉じている間も DOM にあり、見えないことを先に確かめる */
async function openBandFold(page: Page, folded: string | RegExp) {
  const fold = page.locator(".replay-band details");
  const text = fold.getByText(folded);
  await expect(text).toBeAttached();
  await expect(text).toBeHidden();
  await fold.locator("summary", { hasText: "くわしく" }).click();
  await expect(text).toBeVisible();
  await fold.locator("summary").click();
  await expect(text).toBeHidden();
}
const item = async (page: Page, re: RegExp) => {
  await openList(page);
  return page.getByRole("list", { name: "日付の一覧" }).getByRole("button", { name: re });
};
const filterHas = (page: Page, layer: string, code: string) =>
  page.waitForFunction(([l, c]) => JSON.stringify((window as unknown as W).__hpaiMap!.getFilter(l!)).includes(c!), [layer, code], { timeout: 10_000 });

test.describe("全国の流れ（/replay の切り替え）", () => {
  const statText = (page: Page, title: string) => page.locator(".stat").filter({ has: page.locator(".stat-title", { hasText: title }) });

  async function openNational(page: Page) {
    await open(page);
    await page.getByRole("button", { name: "全国の流れ" }).click();
    await expect(page.getByText("0 / 24")).toBeVisible();
    await expect(page.getByRole("button", { name: "全国の流れ" })).toHaveAttribute("aria-pressed", "true");
    await page.waitForFunction(() => !!(window as unknown as W).__hpaiMap?.getLayer("case-suspected"), undefined, { timeout: 20_000 });
  }

  test("週ごとの棒は再現の時点の週までを描き、進めると増える。4 事例の流れでは出さない", async ({ page }) => {
    await open(page);
    await expect(page.locator(".season-charts")).toHaveCount(0);
    await page.getByRole("button", { name: "全国の流れ" }).click();
    await expect(page.getByText("0 / 24")).toBeVisible();
    await expect(page.getByRole("list", { name: "週ごとの全国の発生の棒" })).toHaveCount(0);
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.getByText("1 / 24")).toBeVisible();
    const weeks = page.getByRole("list", { name: "週ごとの全国の発生の棒" });
    await expect(weeks.getByRole("listitem")).toHaveCount(1);
    await expect(page.locator(".week-axis")).toContainText(FIRST_WEEK);
    await expect(page.locator(".season-charts")).toContainText("出典: 国の事例一覧");
  });

  test("進めると件数の札が増え、町が輪の中に入ると農場（仮の地点）からの距離が出る。帯、仮の地点、時点は残る", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await openNational(page);
    await expect(page.getByText("去年の再現です").first()).toBeVisible();
    await expect(page.getByText("作者の村の中心付近を仮の地点にしています。農場の場所を指すものではありません。", { exact: true })).toBeVisible();
    await openBandFold(page, /^仮の地点で見ています（作者の農場がある村の中心付近に置いた約 1km のマス目で/);
    await expect(page.getByText(/4 事例だけ/)).toHaveCount(0);
    await expect(page.getByText("輪は距離の目安で、発表の区域ではありません。")).toBeVisible();
    // 輪が見える広さで始まる（全国の広さでは輪のラベルが出ない）
    await expect(page.locator(".ring-label").filter({ hasText: "60" })).toBeVisible();

    await (await item(page, /12 月 2 日.*米子市/)).click();
    await expect(statText(page, "発生した件数")).toContainText("6 件");
    await expect(statText(page, "約 60 km 以内")).toContainText("今季 確認できた範囲では 0 件");
    await expect(page.locator(".replay-now")).toHaveText("12 月 2 日 米子市 確定");
    await expect(page.locator(".stat .as-of")).toHaveText("12 月 2 日 時点");
    await filterHas(page, "case-confirmed", "31202");

    await (await item(page, /12 月 16 日.*姫路市/)).click();
    await expect(statText(page, "発生した件数")).toContainText("7 件");
    await expect(statText(page, "約 60 km 以内")).toContainText("今季 確認できた範囲では 1 件");
    await expect(page.locator(".replay-now")).toHaveText("12 月 16 日 姫路市 確定。農場（仮の地点）から約 28 km");
    await expect(page.getByText("約 28 km 先で発生しました", { exact: true })).toBeVisible();
    await expect(page.getByText("再現の時点: 12 月 16 日（時刻の記載なし）")).toBeVisible();
    await expect(page.locator(".stat .as-of")).toHaveText("12 月 16 日 時点");
    await filterHas(page, "case-confirmed", "28201");

    // 津山市は輪の中に入るが、段階 ① にはしない
    await (await item(page, /12 月 20 日.*津山市/)).click();
    await expect(page.getByText("約 16 km 先で発生しました", { exact: true })).toBeVisible();
    await expect(page.getByText(ZONE)).toHaveCount(0);
    await expect(statText(page, "約 60 km 以内")).toContainText("今季 確認できた範囲では 2 件");

    // 再現では Firestore にも Claude にも出ない
    const urls = requests.map((r) => r.url());
    expect(urls.filter((u) => u.includes("firestore") || u.includes("api.anthropic.com"))).toEqual([]);
  });

  test("4 事例に戻すと、札が消えて 4 事例の注記が戻る", async ({ page }) => {
    await openNational(page);
    await expect(page.locator(".stat-row")).toBeVisible();
    await page.getByRole("button", { name: "12 月の 4 事例" }).click();
    await expect(page.getByText("0 / 14")).toBeVisible();
    await expect(page.locator(".stat-row")).toHaveCount(0);
    await openBandFold(page, /4 事例だけ/);
  });

  test("360px で横にはみ出さない。切り替えのボタンは 44px 以上", async ({ page }) => {
    await openNational(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await (await item(page, /12 月 16 日.*姫路市/)).click();
    await expect(page.locator(".replay-now")).toContainText("約 28 km");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const box = await page.getByRole("button", { name: "全国の流れ" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("去年の再現（/replay）", () => {
  test("12/19 の夜に『区域に入っている可能性があります』が出て、1/21 で消える。メールは『このとき届く』と出すだけで送らない", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await open(page);

    // はじまり: 帯と説明。まだ何も出ていない
    await expect(page.getByText("去年の再現です").first()).toBeVisible();
    await expect(page.getByText("仮の地点で見ています", { exact: false })).toBeVisible();
    await openBandFold(page, /4 事例だけ/);
    await openBandFold(page, /説明のための例/);
    await expect(page.getByText(ZONE)).toHaveCount(0);

    // 12/19（津山市の疑い。時刻の記載がないのでその日の終わり = 夜）
    await (await item(page, /12 月 19 日.*津山市.*疑い/)).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("再現の時点: 12 月 19 日（時刻の記載なし）")).toBeVisible();
    // 時刻の記載がないので、地図の時点は日付だけ。内部の 23:59:59 は DOM にも出さない。地図の h1 『今季』は隠し、再現の見出しを出す
    await expect(page.locator(".replay-scope .as-of").first()).toHaveText("12 月 19 日 時点");
    expect(await page.evaluate(() => document.body.textContent ?? "")).not.toMatch(/23:59/);
    await expect(page.getByRole("heading", { level: 1, name: /去年の再現/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /今季/ })).toHaveCount(0);
    await filterHas(page, "case-suspected", "33203");
    const mail = page.getByRole("region", { name: "このときメールが届く" });
    await expect(mail).toBeVisible();
    await expect(mail.getByText("津山市で疑いの発表がありました。県の連絡が正です")).toBeVisible();
    await expect(mail.getByText(/実際には送りません/)).toBeVisible();
    await openBandFold(page, /メールは実際には送りません/);

    // 12/20 確定、1/10 搬出制限の解除のあとも、移動制限が続く間は①のまま
    await (await item(page, /12 月 20 日.*津山市.*確定/)).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.locator(".replay-scope .as-of").first()).toHaveText("12 月 20 日 9:00 時点"); // 09:00 は出典に時刻がある
    await filterHas(page, "case-confirmed", "33203");
    await (await item(page, /1 月 10 日.*津山市.*搬出制限の解除/)).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("搬出制限は解除されました")).toBeVisible();

    // 1/21 津山市の移動制限の解除で、区域の文は消える（隣町になる）
    await (await item(page, /1 月 21 日.*津山市.*移動制限の解除/)).click();
    await expect(page.getByText(ZONE)).toHaveCount(0);
    await expect(page.getByText("隣町で発生しました", { exact: true })).toBeVisible();

    // 通信: 本物のデータの口（Firestore）にも Claude にも出ない
    const urls = requests.map((r) => r.url());
    expect(urls.filter((u) => u.includes("firestore.googleapis.com"))).toEqual([]);
    expect(urls.filter((u) => u.includes("api.anthropic.com"))).toEqual([]);
    expect(urls.filter((u) => u.includes("google.firestore.v1"))).toEqual([]);
  });

  test("前へ・次へで 1 つずつ進める。はじまりに戻ると地図の事例が 0 件になる", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.getByText("1 / 14")).toBeVisible();
    await expect(page.getByRole("button", { name: "前へ" })).toBeEnabled();
    await filterHas(page, "case-confirmed", "31202");
    await (await item(page, /はじまり/)).click();
    await expect(page.getByText("0 / 14")).toBeVisible();
    await expect(page.getByRole("button", { name: "前へ" })).toBeDisabled();
  });

  test("端末に地点がなければ『自分の町で見る』は押せない。あれば切り替えられ、端末の地点は変わらない", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "自分の町で見る" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "もし区域の近くの農場なら" })).toHaveAttribute("aria-pressed", "true");
  });

  test("端末の地点（米子市）で見ると、米子市の確定で区域の文が出る。localStorage の hpai.spot.v1 は変わらない", async ({ page }) => {
    const mine = JSON.stringify({ meshCode: "53331228", muniCode: "31202", frequentMuniCodes: [] });
    await open(page, { "hpai.spot.v1": mine });
    await page.getByRole("button", { name: "自分の町で見る" }).click();
    await (await item(page, /12 月 2 日.*米子市.*確定/)).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("仮の地点で見ています", { exact: false })).toHaveCount(0);
    await (await item(page, /12 月 28 日.*米子市.*移動制限の解除/)).click();
    await expect(page.getByText(ZONE)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"))).toBe(mine);
  });
});
