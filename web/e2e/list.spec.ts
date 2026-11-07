import type { Case, WatchStatus, WildBird } from "@hpai/shared/types";
import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";
import { goViaMenu } from "./helpers/frame";

// 確認状況と一覧（W-06）。画面の時計は 2026-11-04 09:00。見回りの checkedAt は 08:30（7 時間以内）なので、
// 失敗にした県以外は「確認できた」と数える。地理院タイルは外へ出さず、1 画素の PNG で答える。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const CHECKED_AT = "2026-11-04T08:30:00+09:00";
const watchOk = (): WatchStatus[] =>
  Array.from({ length: 47 }, (_, i) => ({
    prefCode: String(i + 1).padStart(2, "0"),
    checkedAt: CHECKED_AT,
    ok: true,
    lastOkAt: CHECKED_AT,
    failingSince: null,
  }));
/** 取得の失敗、TLS の失敗、200 で中身が別物のどれも、I-02 では同じ ok:false になる */
const watchWith33Failed = (): WatchStatus[] =>
  watchOk().map((w) => (w.prefCode === "33" ? { ...w, ok: false, lastOkAt: null, failingSince: "2026-11-04T01:00:00+09:00" } : w));

const reviewing: Case = {
  id: "rev-e2e",
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
  updatedAt: "2026-11-04T08:00:00+09:00",
};
const bird: WildBird = {
  id: "w-e2e",
  season: 2026,
  date: "2026-11-03",
  prefCode: "01",
  muniCode: "01100",
  muniName: "札幌市",
  species: "オオハクチョウ",
  test: "screening_positive",
  focusZone: { from: null, to: null },
  sourceUrl: "https://example.invalid/bird",
};

/**
 * 既定は "/"（地図まで待つ）。一覧と野鳥の一覧は /season、シーズンの切り替えは /compare へ移った
 * （設計書 2026-11-06-ui-frame 4 章）。地図のない画面は、一覧の開閉ボタンが描かれるまで待つ。
 */
async function open(page: Page, o: { watch: WatchStatus[]; cases?: Case[]; wildBirds?: WildBird[]; path?: string }) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  await installFixture(page, { now: "2026-11-04T09:00:00+09:00", cases: o.cases ?? [], wildBirds: o.wildBirds ?? [], watch: o.watch });
  await page.goto(o.path ?? "/");
  if (o.path !== undefined && o.path !== "/") {
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    return;
  }
  await page.waitForFunction(() => !!(window as unknown as { __hpaiMap?: { getLayer(id: string): unknown } }).__hpaiMap?.getLayer("case-confirmed"), undefined, {
    timeout: 20_000,
  });
}

test.describe("一覧", () => {
  test("『一覧』（/season）を押すと aria-expanded が true。今季の行と注記が 3 つ出る。1 年前の切り替えは /compare で『24 件』", async ({ page }) => {
    await open(page, { watch: watchOk(), cases: [reviewing], wildBirds: [bird], path: "/season" });
    const toggle = page.getByRole("button", { name: /一覧/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const t of ["疑いは、県の発表を見つけられた県だけ出ます", "環境省の野鳥監視重点区域は、防疫指針の区域とは別のものです", "監視強化区域は"]) {
      await expect(page.getByText(t)).toBeVisible();
    }
    // シーズンの切り替えは /compare。1 年前を選ぶと 24 件
    await page.goto("/compare");
    // 比べるシーズンのボタンにも「1 年前」があるので、下のシーズンの棒に絞って押す（設計書 2026-11-06-data-explore E12）
    await page.locator(".season-bar").getByRole("button", { name: /1 年前.*24 件/ }).click();
    await expect(page.locator(".season-bar").getByRole("button", { name: /1 年前/ })).toHaveAttribute("aria-pressed", "true");
  });

  // 1 年前を選んで 24 行を見る。シーズンの切り替えと、選んだシーズンの一覧は /compare にある（設計書 2026-11-06-ui-frame 4.4）。
  // 画面は行き先ごとに作り直すので、選んだシーズンは他の画面へ持ち越さない（/ はいつも今季）
  test("1 年前を /compare で選ぶと、そこの一覧が 24 行で、出典は maff.go.jp", async ({ page }) => {
    await open(page, { watch: watchOk(), cases: [reviewing], wildBirds: [bird], path: "/compare" });
    await page.locator(".season-bar").getByRole("button", { name: /1 年前.*24 件/ }).click();
    const toggle = page.getByRole("button", { name: /一覧/ });
    await toggle.click();
    const rows = page.getByRole("list", { name: "発生の一覧" }).getByRole("listitem");
    await expect(rows).toHaveCount(24);
    const hrefs = await rows.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).hostname));
    expect(hrefs.length).toBeGreaterThanOrEqual(24);
    expect(hrefs.every((h) => h.endsWith("maff.go.jp"))).toBe(true);
  });

  test("今季の一覧（/season）は、確認中の事例を県名と『確認中』とリンクだけで出し、野鳥は検査中と出す", async ({ page }) => {
    await open(page, { watch: watchOk(), cases: [reviewing], wildBirds: [bird], path: "/season" });
    await page.getByRole("button", { name: /一覧/ }).click();
    const row = page.getByRole("list", { name: "発生の一覧" }).getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("鳥取県");
    await expect(row).toContainText("確認中");
    await expect(row.locator("a")).toHaveAttribute("href", "https://example.invalid/review");
    await expect(page.getByRole("list", { name: "野鳥の一覧" })).toContainText("検査中");
  });
});

test.describe("確認状況", () => {
  test("33（岡山県）が ok:false: 文に『岡山県』、地図の pref-unwatched に 33、凡例に『確認できていない県』", async ({ page }) => {
    await open(page, { watch: watchWith33Failed() });
    await expect(page.getByTestId("watch-line")).toContainText("47 都道府県のうち 46 件を確認、1 件は確認できていません（岡山県）");
    await page.waitForFunction(
      () =>
        JSON.stringify((window as unknown as { __hpaiMap: { getFilter(id: string): unknown } }).__hpaiMap.getFilter("pref-unwatched")).includes('"33"'),
      undefined,
      { timeout: 10_000 },
    );
    await expect(page.getByRole("group", { name: "地図の見方" })).toContainText("確認できていない県");
  });

  test("全県が確認できていれば、確認の行を出さない（2026-11-06 作者の決定）", async ({ page }) => {
    await open(page, { watch: watchOk() });
    await expect(page.getByText("都道府県すべてを確認しました")).toHaveCount(0);
    await expect(page.getByTestId("watch-line")).toHaveCount(0);
  });

  test("地図の上に checkedAt の時点（8:30）が出る。now（9:00）ではない", async ({ page }) => {
    await open(page, { watch: watchOk() });
    await expect(page.locator(".as-of").first()).toHaveText("11 月 4 日 8:30 時点");
  });

  test("自分の町の県（岡山県）が未確認なら、町の 1 文に『この県は確認できていません』", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33214"));
    await open(page, { watch: watchWith33Failed() });
    // 幅 390px は、段階の文を地図の前の .town-lead に置く
    await expect(page.locator(".town-lead")).toContainText("この県のホームページを読み込めていません");
    await expect(page.locator(".town-lead")).not.toContainText("全国の動きをお知らせしています");
    await expect(page.locator(".town-banner")).not.toContainText("全国の動きをお知らせしています");
  });
});
