import type { Case } from "@hpai/shared/types";
import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";

// 市町村の案内 /area/{コード}（W-07）。登録なしで読める。Firebase の認証を呼ばず、農場の情報を載せない。
// 画面の時計は 2026-11-10。段階 1（同じ町）、2（隣町）、4（全国の動き）のすべてで、距離を見ていないことと
// 「どこでも感染のリスクがある」を出し、禁止語（区域の外です・安全・安心）を含まない。

const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-10T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-10T08:30:00+09:00",
  failingSince: null,
}));

const TSUYAMA_CASE: Case = {
  id: "e2e-area-1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: null,
  housing: null,
  headCount: 1000,
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
};

const FORBIDDEN = /区域の外です|安全|安心/u;

async function open(page: Page, code: string, cases: Case[]) {
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases, wildBirds: [], watch: WATCH_OK });
  await page.goto(`/area/${code}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("市町村の案内", () => {
  test("/area/33203 は Firebase の認証（identitytoolkit、securetoken）へ 1 件も要求しない", async ({ page }) => {
    const auth: string[] = [];
    page.on("request", (req) => {
      const host = new URL(req.url()).hostname;
      if (host.includes("identitytoolkit") || host.includes("securetoken")) auth.push(req.url());
    });
    await open(page, "33203", [TSUYAMA_CASE]);
    await expect(page.locator(".town-main")).toContainText("この町で発生しました");
    await page.waitForLoadState("networkidle");
    expect(auth).toEqual([]);
  });

  for (const [label, code, cases, expected] of [
    ["段階 1（同じ町）", "33203", [TSUYAMA_CASE], "この町で発生しました"],
    ["段階 2（隣町）", "33214", [TSUYAMA_CASE], "隣町で発生しました"],
    ["段階 4（全国の動き）", "33214", [] as Case[], "全国の動きをお知らせしています"],
  ] as const) {
    test(`${label}: 距離を見ていないことと riskAnywhere を出し、禁止語がない`, async ({ page }) => {
      await open(page, code, [...cases]);
      await expect(page.locator(".town-main")).toContainText(expected);
      const main = page.getByRole("main");
      await expect(main).toContainText("距離は見ていません");
      await expect(main).toContainText("どこでも感染のリスクがあります");
      expect(await main.innerText()).not.toMatch(FORBIDDEN);
      // 要点へのリンクが 7 つ
      await expect(main.locator('a[href^="/public#"]')).toHaveCount(7);
    });
  }

  test("区のコード（33101）と未知のコードは『この市町村は見つかりません』", async ({ page }) => {
    await open(page, "33101", []);
    await expect(page.getByText("この市町村は見つかりません")).toBeVisible();
  });

  test("『鶏を飼っていない方へ』の要点のリンクで、該当の節へ移る", async ({ page }) => {
    await open(page, "33214", []);
    await page.getByRole("link", { name: "埋却と地下水" }).click();
    await expect(page).toHaveURL(/\/public#burial$/u);
    await expect(page.locator("section#burial")).toBeInViewport();
  });
});
