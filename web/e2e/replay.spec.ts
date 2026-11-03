import { expect, test, type Page, type Request } from "@playwright/test";

// 去年 12 月の再現（X-02）。本番と同じ build（mode=e2e）で、/replay を開いて 12/19 の夜から 1/21 まで進める。
// 地理院タイルは外へ出さず、1 画素の PNG で答える。審査員の操作で Firestore も Claude も呼ばないことを、全要求で確かめる。
// 回さずに書いている（ブラウザ試験は本体が回す）。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";

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

const item = (page: Page, re: RegExp) => page.getByRole("list", { name: "日付の一覧" }).getByRole("button", { name: re });
const filterHas = (page: Page, layer: string, code: string) =>
  page.waitForFunction(([l, c]) => JSON.stringify((window as unknown as W).__hpaiMap!.getFilter(l!)).includes(c!), [layer, code], { timeout: 10_000 });

test.describe("去年の再現（/replay）", () => {
  test("12/19 の夜に『区域に入っている可能性があります』が出て、1/21 で消える。メールは『このとき届く』と出すだけで送らない", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await open(page);

    // はじまり: 帯と説明。まだ何も出ていない
    await expect(page.getByText("去年の再現です").first()).toBeVisible();
    await expect(page.getByText("仮の地点で見ています", { exact: false })).toBeVisible();
    await expect(page.getByText(/4 事例だけ/)).toBeVisible();
    await expect(page.getByText(/説明のための例/)).toBeVisible();
    await expect(page.getByText(ZONE)).toHaveCount(0);

    // 12/19（津山市の疑い。時刻の記載がないのでその日の終わり = 夜）
    await item(page, /12 月 19 日.*津山市.*疑い/).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("再現の時点: 12 月 19 日（時刻の記載なし）")).toBeVisible();
    await filterHas(page, "case-suspected", "33203");
    const mail = page.getByRole("region", { name: "このときメールが届く" });
    await expect(mail).toBeVisible();
    await expect(mail.getByText("津山市で疑いの発表がありました。県の連絡が正です")).toBeVisible();
    await expect(page.getByText(/実際には送りません/).first()).toBeVisible();

    // 12/20 確定、1/10 搬出制限の解除のあとも、移動制限が続く間は①のまま
    await item(page, /12 月 20 日.*津山市.*確定/).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await filterHas(page, "case-confirmed", "33203");
    await item(page, /1 月 10 日.*津山市.*搬出制限の解除/).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("搬出制限は解除されました")).toBeVisible();

    // 1/21 津山市の移動制限の解除で、区域の文は消える（隣町になる）
    await item(page, /1 月 21 日.*津山市.*移動制限の解除/).click();
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
    await expect(page.getByText("1 / 11")).toBeVisible();
    await expect(page.getByRole("button", { name: "前へ" })).toBeEnabled();
    await filterHas(page, "case-confirmed", "31202");
    await page.getByRole("button", { name: /はじまり/ }).click();
    await expect(page.getByText("0 / 11")).toBeVisible();
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
    await item(page, /12 月 2 日.*米子市.*確定/).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await expect(page.getByText("仮の地点で見ています", { exact: false })).toHaveCount(0);
    await item(page, /12 月 28 日.*米子市.*移動制限の解除/).click();
    await expect(page.getByText(ZONE)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"))).toBe(mine);
  });
});
