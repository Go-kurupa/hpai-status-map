import type { Case } from "@hpai/shared/types";
import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";

// 自分の町の 1 文（W-03）。実データ（data/history/cases.json）と、今季（2026）の事例 1 件で確かめる。
// 公開の画面の時計は 2026-11-10。地理院タイルは外へ出さず、1 画素の PNG で答える。
// 位置は端末の中（localStorage）にだけ置く。緯度経度は保存せず、通信にも出ない（設計書 §12、§16）。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-10T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-10T08:30:00+09:00",
  failingSince: null,
}));

/** 津山市（33203）で今季、確定。移動制限の解除はまだ */
const TSUYAMA_CASE: Case = {
  id: "e2e-1",
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

// 倉敷市の 3 次メッシュ（津山市とは隣り合わず、10km より離れている）
const KURASHIKI_MESH = "51337601";
// 津山駅の近く（津山市の中）。公開されている駅の位置で、農場の位置ではない
const TSUYAMA_STATION: [number, number] = [134.004, 35.069];

type MapHandle = {
  getFilter(id: string): unknown;
  getLayer(id: string): unknown;
  getStyle(): { sources: Record<string, unknown> };
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  getCenter(): { lng: number; lat: number };
  isMoving(): boolean;
};
// map.spec.ts が Window.__hpaiMap を宣言しているので、ここでは型の別名で受ける（宣言を重ねない）
type W = { __hpaiMap?: MapHandle };

async function open(page: Page, o: { storage?: Record<string, string> } = {}) {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [TSUYAMA_CASE], wildBirds: [], watch: WATCH_OK });
  if (o.storage) {
    await page.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, v);
    }, o.storage);
  }
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as W).__hpaiMap?.getLayer("my-town"), undefined, { timeout: 20_000 });
}

const filterHas = (page: Page, layer: string, code: string) =>
  page.waitForFunction(([l, c]) => JSON.stringify((window as unknown as W).__hpaiMap!.getFilter(l!)).includes(c!), [layer, code], { timeout: 10_000 });

/**
 * 十字を津山駅の近くに合わせる。「地図で場所を合わせる」を押すと、地図が自分の町へ動く（アニメーション）ので、
 * その動きが終わった後でも中心が合っているまで、寄せ直す。
 */
async function aimAtStation(page: Page) {
  await expect(page.locator(".crosshair")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async ([lng, lat]) => {
          const m = (window as unknown as W).__hpaiMap!;
          m.jumpTo({ center: [lng!, lat!], zoom: 11 });
          await new Promise((r) => setTimeout(r, 400));
          const c = m.getCenter();
          return !m.isMoving() && Math.abs(c.lng - lng!) < 0.001 && Math.abs(c.lat - lat!) < 0.001;
        }, TSUYAMA_STATION),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function chooseTown(page: Page, pref: string, muni: string) {
  await page.getByRole("button", { name: "町を選ぶ", exact: true }).click();
  await page.getByLabel("都道府県").selectOption(pref);
  await page.getByLabel("市町村").selectOption(muni);
  await page.getByRole("button", { name: "この町にする" }).click();
}

test.describe("自分の町の 1 文", () => {
  test("真庭市（33214）を選ぶと、隣の津山市の事例で『隣町で発生しました』。過去は『昨季に隣町で発生しました（記録）』。地図に自分の町と隣の縁", async ({ page }) => {
    await open(page);
    await expect(page.getByText("町を選んでください")).toBeVisible();
    await chooseTown(page, "33", "33214");
    await expect(page.getByText("隣町で発生しました", { exact: true })).toBeVisible();
    await expect(page.getByText("昨季に隣町で発生しました（記録）")).toBeVisible();
    await filterHas(page, "my-town", "33214");
    await filterHas(page, "near-line", "33203");
    await expect(page.locator("[data-tone]")).toHaveAttribute("data-tone", "lv2");
    await expect(page.getByRole("link", { name: /この町のくわしい状況/ })).toHaveAttribute("href", "/area/33214");
  });

  test("地点を指定すると『区域に入っている可能性があります』（①）。シーズンを変えても色は lv1 のまま", async ({ page }) => {
    await open(page);
    await chooseTown(page, "33", "33203");
    await expect(page.getByText("全国の動きをお知らせしています")).toHaveCount(0);
    await page.getByRole("button", { name: "地図で場所を合わせる" }).click();
    await aimAtStation(page);
    await page.getByRole("button", { name: "ここに決める" }).click();
    await expect(page.getByText(/津山市.*の上です/)).toBeVisible(); // 町の名前で確かめてから保存する
    await page.getByRole("button", { name: "決める", exact: true }).click();
    await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();
    await expect(page.locator("[data-tone]")).toHaveAttribute("data-tone", "lv1");

    await page.getByRole("button", { name: /昨季/ }).click();
    await expect(page.getByRole("button", { name: /昨季/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-tone]")).toHaveAttribute("data-tone", "lv1");
    await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();
  });

  test("行き来する町（登録した町）の事例で『登録した町で発生しました』（③）", async ({ page }) => {
    await open(page, {
      storage: { "hpai.spot.v1": JSON.stringify({ meshCode: KURASHIKI_MESH, muniCode: "33202", frequentMuniCodes: ["33203"] }) },
    });
    await expect(page.getByText("登録した町で発生しました")).toBeVisible();
    await expect(page.locator("[data-tone]")).toHaveAttribute("data-tone", "lv3");
  });

  test("指定の前後の全要求に緯度経度がなく、Google への通信（Firestore の書き込みを含む）が 0 件。再読み込みで残る。地点の source がない", async ({ page }) => {
    const seen: Array<{ url: string; body: string }> = [];
    const google: string[] = [];
    page.on("request", (r) => {
      seen.push({ url: r.url(), body: r.postData() ?? "" });
      const host = new URL(r.url()).hostname;
      if (host.endsWith("googleapis.com") || host.endsWith("firebaseio.com")) google.push(r.url());
    });
    await open(page);
    await chooseTown(page, "33", "33203");
    await page.getByRole("button", { name: "地図で場所を合わせる" }).click();
    await aimAtStation(page);
    await page.getByRole("button", { name: "ここに決める" }).click();
    await page.getByRole("button", { name: "決める", exact: true }).click();
    await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();

    // 端末の中には、3 つのキーだけ
    const saved = await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"));
    expect(Object.keys(JSON.parse(saved!)).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
    expect(saved).not.toMatch(/lat|lng|longitude/i);

    // 通信に緯度経度が出ない（キー名も、小数の組も）
    const pair = /-?\d{2}\.\d{3,}\s*[,%2C]+\s*-?\d{2,3}\.\d{3,}/;
    for (const r of seen) {
      expect(r.url, r.url).not.toMatch(/[?&](lat|lng|latitude|longitude)=/i);
      expect(r.url, r.url).not.toMatch(pair);
      expect(r.body).not.toMatch(/"?(lat|lng|latitude|longitude)"?\s*[:=]/i);
      expect(r.body).not.toMatch(pair);
    }
    expect(google).toEqual([]);

    // 地図の source に、地点の source はない
    const sources = await page.evaluate(() => Object.keys((window as unknown as W).__hpaiMap!.getStyle().sources));
    expect(sources.filter((s) => /spot|farm|point|mine|my/i.test(s))).toEqual([]);

    // 再読み込みで残る
    await page.reload();
    await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"))).toBe(saved);
  });
});
