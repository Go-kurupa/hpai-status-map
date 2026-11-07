import { expect, test } from "@playwright/test";

// 本番と同じ DataSource（live）で、模擬環境（Firestore エミュレータ）につなぐ。fixture は使わない。
// 実行: web/ で
//   browser-guard run -- npx firebase emulators:exec --only firestore,auth --project demo-hpai "npx playwright test e2e/live-smoke.spec.ts"
// 地理院タイルは外へ出さず、1 画素の PNG で答える。

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const EMULATOR = process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080";

type FieldValue = { stringValue: string } | { integerValue: string } | { nullValue: null } | { arrayValue: { values?: FieldValue[] } } | { mapValue: { fields: Record<string, FieldValue> } };
function toValue(v: unknown): FieldValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toValue(x)])) } };
}

/** 今のシーズン（日本時間の 6 月 1 日から翌年 5 月 31 日まで） */
function currentSeason(): number {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.getUTCMonth() + 1 >= 6 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
}

test.describe("模擬環境（live の DataSource）", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
    );
  });

  test("cases/x を書くと、/?emulator=1 の case-confirmed に届く", async ({ page, request }) => {
    const season = currentSeason();
    const doc = {
      season,
      nationalNo: null,
      prefNo: null,
      prefCode: "33",
      muniCode: "33203",
      muniName: "津山市",
      birdUse: null,
      housing: null,
      headCount: 1000,
      stages: { confirmed: { date: `${season}-12-20`, time: null } },
      radiiKm: [],
      prefEstimates: { shipment: null, movement: null, surveillance: null },
      negation: "none",
      negatedAt: null,
      confirmState: "auto",
      sourceUrls: [],
      updatedAt: `${season}-12-20T12:00:00+09:00`,
    };
    // Authorization: Bearer owner はエミュレータの管理者（ルールを通らない）
    const res = await request.patch(`http://${EMULATOR}/v1/projects/demo-hpai/databases/(default)/documents/cases/x`, {
      headers: { Authorization: "Bearer owner" },
      data: { fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, toValue(v)])) },
    });
    expect(res.ok(), await res.text()).toBe(true);

    await page.goto("/?emulator=1");
    await page.waitForFunction(
      () => {
        const m = (window as unknown as { __hpaiMap?: { getFilter(id: string): unknown } }).__hpaiMap;
        if (!m) return false;
        try {
          return JSON.stringify(m.getFilter("case-confirmed") ?? null).includes("33203");
        } catch {
          // 層がまだ無いとき maplibre は例外を投げる。まだ届いていないので、待ち続ける
          return false;
        }
      },
      undefined,
      { timeout: 30_000 },
    );
  });

  test("Firestore の通信を止めると、15 秒後も『0 件』や段階の文を出さず『読み込んでいます』のまま（§2）", async ({ page }) => {
    await page.route(/google\.firestore\.v1/, (route) => route.abort());
    // 町を選んである人の画面（選んでいないと『町を選んでください』になるため）
    await page.addInitScript(() => window.localStorage.setItem("hpai.town.v1", "33214"));
    await page.goto("/?emulator=1");
    await page.waitForTimeout(15_000);
    const main = page.getByRole("main");
    await expect(main.getByText(/読み込んでいます。読めるまで/)).toBeVisible();
    // 次の 2 つは、読めないときの正しい表示で、今季の発生の件数や段階の文ではない。除く前に、文そのものを決まった形で確かめる。
    // ・確認状況の 1 行: 「0 件を確認」は確認できた県の数。設計どおりの文と完全に一致すること（「発生なし」「0 件（発生）」などの別の文が混ざれば落ちる）
    await expect(page.getByTestId("watch-line")).toHaveText(
      /^47 都道府県のうち 0 県を確認、47 県は確認できていません。地図の斜線の県は、発生がないとは言えません。$/u,
    );
    // ・過去の記録の行: 「過去の記録」で始まり「（記録）」で終わる 1 文（同梱の過去データ由来。色なし）。今季の文が紛れ込めば落ちる
    await expect(page.locator(".town-past > p").first()).toHaveText(/^過去の記録 .+（記録）$/u);
    // ・過去のシーズンとの比べ: 過去の実績の「0 件」（例: 2020/21 は 11 月 4 日まで 0 件）は正しい表示。今季の行は件数ではなく「まだ読めていません」であること
    await expect(page.locator(".season-compare")).toContainText(/今季（[0-9/]+）は .+までに まだ読めていません/u);
    await page.addStyleTag({ content: '.town-past, [data-testid="watch-line"], .season-compare { display: none !important; }' });
    const text = await main.innerText();
    expect(text).not.toMatch(/(^|[^0-9])0 件/);
    for (const sentence of ["全国の動きをお知らせしています", "隣町で発生しました", "区域に入っている可能性があります"]) {
      expect(text).not.toContain(sentence);
    }
    await expect(page.locator("[data-tone]")).toHaveCount(0);
  });
});
