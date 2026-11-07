import { expect, test } from "@playwright/test";
import { menuNav } from "./helpers/frame";
import { expectNoForbiddenText } from "./wording.helper";

// AIに対策を相談の画面（R3、2026-11-07 チャットの形）。模擬環境（Auth、Firestore、Functions）が動いていること。実行の例:
//   npm run bundle -w functions && FUNCTIONS_DISCOVERY_TIMEOUT=120 browser-guard run -- npx firebase emulators:exec \
//     --only firestore,auth,functions --project demo-hpai "cd web && npx playwright test consult shell"
// 模擬環境には Claude の鍵がないので、関数の中の Claude の呼び出しは失敗し、「答えを作れませんでした」（unavailable）が出る。
// この試験は、本物の Claude を呼ばない（鍵を渡さない）。

const UNAVAILABLE = "答えを作れませんでした。時間をおいて、もう一度お試しください。";
const OUT_OF_SCOPE = "集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。";
const PROCESSED = "カードの対策・効く条件・注意書きは、資料を要約・加工したものです。引用は原文のままです。";
const JUDGE_BANNER = "審査員の方向けの試しの画面です。1 日の回数に上限があり、相談は保存しません。";
const FOOTER = "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。";

test.describe("AIに対策を相談", () => {
  test("審査員の入口を開けると、案内と最初の吹き出しと話題のボタンと下の 1 行が出る。会員の確認は出ない", async ({ page }) => {
    await page.goto("/consult?judge=1&emulator=1");
    await expect(page.getByRole("heading", { level: 1, name: "AIに対策を相談" })).toBeVisible();
    await expect(page.getByText(JUDGE_BANNER)).toBeVisible();
    await expect(page.getByText("鳥インフルの対策について、公的な資料と論文から答えます。何から見直しますか？")).toBeVisible();
    await expect(page.getByRole("group", { name: "話題" }).getByRole("button")).toHaveCount(7);
    await expect(page.getByText(PROCESSED)).toBeVisible();
    await expect(page.getByText(/^農場の名前や場所は書かないでください。/)).toBeVisible();
    await expect(page.getByText(FOOTER)).toBeVisible();
    await expect(page.getByRole("heading", { name: "招待コードを入れてください" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送る" })).toBeDisabled();
    // パソコンの幅（e2e の既定 1280）では、これまでの相談が左にいつも出る（切り替えのボタンは出さない）
    await expect(page.getByRole("heading", { level: 2, name: "これまでの相談" })).toBeVisible();
    await expect(page.getByRole("button", { name: "これまでの相談" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "新しい相談" })).toBeVisible();
  });

  test("話題のボタンで聞くと、鍵がないので「答えを作れませんでした」が出て、画面は壊れない。決まった文は出ない。足すボタンはない", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.goto("/consult?judge=1&emulator=1");
    await page.getByRole("button", { name: "長靴・服" }).click();
    // 鍵がないので Claude の呼び出しは失敗する → unavailable の文（決まった文ではない）
    await expect(page.getByText(UNAVAILABLE)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(OUT_OF_SCOPE)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /対策項目に追加/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送る" })).toBeVisible();
    await expect(page.getByText(FOOTER)).toBeVisible();
    await expectNoForbiddenText(page);
    // 聞いた問いは、左の「これまでの相談」に出る（審査員の入口は保存しない）
    await expect(page.getByRole("button", { name: /^長靴・服\s*1 往復/ })).toBeVisible();
    await expect(page.getByText("ページを離れると消えます。保存しません。")).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hpai.consult.history")))).toEqual([]);
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
    await page.getByRole("button", { name: "送る" }).click();
    await expect(page.getByTestId("consult-entry")).toBeVisible({ timeout: 120_000 });
    expect(await overflow()).toBeLessThanOrEqual(0);
    // 入力欄は画面の下に留まる
    const box = await page.getByLabel("聞きたいこと").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.getByRole("button", { name: "これまでの相談" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("会員の印があれば、メニューに「AIに対策を相談」が出る（PC）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.addInitScript(() => localStorage.setItem("hpai.member.v1", "1"));
    await page.goto("/about");
    await expect(menuNav(page).getByRole("link", { name: "AIに対策を相談" })).toHaveAttribute("href", "/consult");
  });

  // 審査員の入口はサイトの中にリンクを置かない（README と提出フォームだけで案内する。2026-11-07 作者の決定）
  test("相談の試しは URL を直に開くと使え、このサイトについてにはリンクがない", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator('a[href*="judge=1"]')).toHaveCount(0);
    await page.goto("/consult?judge=1");
    await expect(page.getByText(JUDGE_BANNER)).toBeVisible();
  });
});
