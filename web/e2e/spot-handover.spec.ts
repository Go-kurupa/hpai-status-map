import { expect, test } from "@playwright/test";
import { latestSignInLink, seedInvite } from "./helpers/seedInvite";

// 場所は 1 回選べば済む（作者 11/7）。発生状況の画面で決めた鶏舎の場所を、会員になった後の農場の設定で
// 1 回押すだけで農場の地点にし、ページを読み込み直さずに発生状況の画面が農場の場所で見える通し。
// 模擬環境（Auth、Firestore、Functions）が動いていること。実行の例（リポジトリの根から）:
//   npm run build && firebase emulators:exec --only auth,firestore,functions --project demo-hpai \
//     "cd web && browser-guard run -- npx playwright test spot-handover"
// 場所は津山市（33203）の約 1km のマス目。端末の中の値を直接置く（十字の操作は spot-picker.spec.ts が確かめる）。

const EMAIL = "spot-handover@example.test";
const DEVICE = { meshCode: "52344080", muniCode: "33203", frequentMuniCodes: [] };

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("発生状況で決めた場所を、農場の設定で 1 回押すだけで農場の地点にし、読み込み直さずに地図に出る", async ({ browser }) => {
  const code = await seedInvite();

  // 文脈 A でリンクを送る（farm-profile.spec.ts と同じ）
  const a = await browser.newContext();
  const pageA = await a.newPage();
  await pageA.goto(`/join/${code}?emulator=1`);
  await pageA.getByLabel("メールアドレス").fill(EMAIL);
  await pageA.getByRole("button", { name: "ログインのリンクを送る" }).click();
  await expect(pageA.getByText(/メールを送りました/)).toBeVisible();
  const link = await latestSignInLink(EMAIL);
  await a.close();

  const b = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await b.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  const page = await b.newPage();

  // 1) 会員になる前、発生状況の画面で場所を決めた状態（端末の中だけ）。農場の設定への案内が出る
  await page.goto("/?emulator=1");
  await page.evaluate((d) => {
    localStorage.setItem("hpai.spot.v1", JSON.stringify(d));
    localStorage.setItem("hpai.town.v1", d.muniCode);
  }, DEVICE);
  await page.reload();
  await expect(page.getByText("通知を受けたいときは、この場所を農場の設定でそのまま使えます。")).toBeVisible();
  await expect(page.getByRole("link", { name: "この場所で農場を登録する" })).toHaveAttribute("href", "/settings/farm");

  // 2) 会員になって農場の設定へ。引き継ぎの欄に町とマス目が出る
  await page.goto(link);
  await page.getByLabel("ログインに使うメールアドレス").fill(EMAIL);
  await page.getByRole("button", { name: "つづける" }).click();
  await expect(page).toHaveURL(/\/settings\/farm/, { timeout: 20_000 });
  await expect(page.getByText("発生状況の画面で決めた場所があります")).toBeVisible();
  await expect(page.getByText("岡山県 津山市の約 1km のマス目")).toBeVisible();
  // 別の場所を選ぶ欄も、その町を選んだ状態で開く
  await expect(page.getByLabel("市町村", { exact: true })).toHaveValue("33203");

  // 3) 1 回押すだけで保存する
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
  await page.getByRole("button", { name: "この場所を農場の地点にする" }).click();
  await expect(page.getByText(/登録した地点: 津山市/)).toBeVisible();
  await expect(page.getByText("発生状況の画面で決めた場所があります")).toHaveCount(0);

  // 4) 画面の上の名前（発生状況の画面へのリンク）で戻る（読み込み直さない）。農場の場所で見ている
  await page.getByRole("link", { name: "鳥インフル発生状況マップ" }).click();
  await expect(page.getByText("登録した農場の場所で見ています")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  // 会員の農場で見ている間は、端末の場所の案内を出さない（変えるのは農場の設定）
  await expect(page.getByRole("link", { name: "この場所で農場を登録する" })).toHaveCount(0);

  await b.close();
});
