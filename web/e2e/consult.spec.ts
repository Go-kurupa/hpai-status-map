import { expect, test } from "@playwright/test";
import { menuNav } from "./helpers/frame";
import { expectNoForbiddenText } from "./wording.helper";

// 対策の相談の画面（R3）。模擬環境（Auth、Firestore、Functions）が動いていること。実行の例:
//   npm run bundle -w functions && FUNCTIONS_DISCOVERY_TIMEOUT=120 browser-guard run -- npx firebase emulators:exec \
//     --only firestore,auth,functions --project demo-hpai "cd web && npx playwright test consult shell"
// 模擬環境には Claude の鍵がないので、関数の中の Claude の呼び出しは api_error になり、決まった文に倒れる。
// この試験は、本物の Claude を呼ばない（鍵を渡さない）。

const OUT_OF_SCOPE = "集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。";
const JUDGE_BANNER = "審査員の方向けの試しの画面です。1 日の回数に上限があり、相談は保存しません。";
const FOOTER = "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。";

test.describe("対策の相談", () => {
  test("審査員の入口を開けると、案内と話題のボタンと下の 1 行が出る。会員の確認は出ない", async ({ page }) => {
    await page.goto("/consult?judge=1&emulator=1");
    await expect(page.getByRole("heading", { level: 1, name: "鳥インフルの対策の相談" })).toBeVisible();
    await expect(page.getByText(JUDGE_BANNER)).toBeVisible();
    await expect(page.getByText("話題を選ぶか、聞きたいことを書いてください。")).toBeVisible();
    await expect(page.getByRole("group", { name: "話題" }).getByRole("button")).toHaveCount(7);
    await expect(page.getByText(FOOTER)).toBeVisible();
    await expect(page.getByRole("heading", { name: "招待コードを入れてください" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "聞く" })).toBeDisabled();
  });

  test("話題のボタンで聞くと、決まった文か通知が出て、画面は壊れない。足すボタンはない", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.goto("/consult?judge=1&emulator=1");
    await page.getByRole("button", { name: "長靴・服" }).click();
    // 鍵がないので api_error → 決まった文。予算や回数の通知になることもある
    const settled = page.getByText(
      new RegExp(`${OUT_OF_SCOPE}|いまは相談を受け付けていません。しばらくしてからお試しください。|今日の試しの回数を使い切りました。`),
    );
    await expect(settled.first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("button", { name: /対策項目に足/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "聞く" })).toBeVisible();
    await expect(page.getByText(FOOTER)).toBeVisible();
    await expectNoForbiddenText(page);
    expect(problems).toEqual([]);
  });

  test("会員でなければ /consult は会員の案内（ログインへ）になり、相談の欄は出ない", async ({ page }) => {
    await page.goto("/consult?emulator=1");
    // 未ログインは /login へ送られる
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("聞きたいこと")).toHaveCount(0);
  });

  test("スマホ幅（390）の相談の画面は、横にはみ出さない（聞いた後も）", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/consult?judge=1&emulator=1");
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByLabel("聞きたいこと").fill("平飼いで 500 羽。長靴の消毒はどうしたら？");
    await page.getByRole("button", { name: "聞く" }).click();
    await expect(page.getByTestId("consult-entry")).toBeVisible({ timeout: 120_000 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("会員の印があれば、メニューに対策の相談が出る（PC）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.addInitScript(() => localStorage.setItem("hpai.member.v1", "1"));
    await page.goto("/about");
    await expect(menuNav(page).getByRole("link", { name: "対策の相談" })).toHaveAttribute("href", "/consult");
  });

  test("このサイトについての審査員の入口から、相談の試しを開ける", async ({ page }) => {
    await page.goto("/about");
    await page.getByRole("link", { name: /対策の相談を試す/ }).click();
    await expect(page).toHaveURL(/\/consult\?judge=1/);
    await expect(page.getByText(JUDGE_BANNER)).toBeVisible();
  });
});
