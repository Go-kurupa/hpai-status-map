import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import { chooseTown, expectNoForbiddenText, prepare, TSUYAMA_CASE, waitForWord } from "./wording.helper";

// デモの筋の通し（X-20、設計書 §17「デモの筋」）。場面 2〜7 を、登録なしで、画面の操作で確かめる。
// 場面 1（導入の語り）と場面 8（開発の語り）は語りのみで、画面の試験はない。
// 試験名の先頭の「場面 N」は、docs/demo-script.md（X-26）が指す名前なので変えない。
// 実行: web/ で `browser-guard run -- npx playwright test demo-walkthrough`

type MapHandle = { getFilter(id: string): unknown; getLayer(id: string): unknown };
type W = { __hpaiMap?: MapHandle };

const ZONE = "区域に入っている可能性があります。県の連絡を確かめてください";

/**
 * 場面 7 が確かめるのは、実測の結果だ。舞台裏の事前の読み取り（data/replay/backstage.json）か、読み取りの試験の結果
 * （evals/results/summary.json）のどちらかが未実測の間は確かめられない（測ると有料の API を呼ぶ）。
 */
const BACKSTAGE_STATUS = (JSON.parse(readFileSync(resolve(process.cwd(), "..", "data", "replay", "backstage.json"), "utf8")) as { status: string }).status;
const EVAL_SUMMARY_MEASURED = existsSync(resolve(process.cwd(), "..", "evals", "results", "summary.json"));
const SCENE7_UNMEASURED = BACKSTAGE_STATUS === "unmeasured" || !EVAL_SUMMARY_MEASURED;

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** window.print を数える。実際の印刷の窓は開かない */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
}

const filterHas = (page: Page, layer: string, code: string) =>
  page.waitForFunction(([l, c]) => JSON.stringify((window as unknown as W).__hpaiMap!.getFilter(l!)).includes(c!), [layer, code], { timeout: 10_000 });

async function openReplay(page: Page) {
  await prepare(page);
  await page.goto("/replay");
  await page.waitForFunction(() => !!(window as unknown as W).__hpaiMap?.getLayer("case-suspected"), undefined, { timeout: 20_000 });
}
const replayItem = (page: Page, re: RegExp) => page.getByRole("list", { name: "日付の一覧" }).getByRole("button", { name: re });

test.describe("デモの筋", () => {
  test("場面 2: 過去の 1 文が段階の色なしで出て、6 シーズンの件数が合い、12/19 の夜に津山に疑いが出る", async ({ page }) => {
    await prepare(page, { cases: [TSUYAMA_CASE] });
    await page.goto("/");
    await waitForWord(page, "時点");
    await chooseTown(page, "33", "33214");

    // 今季の 1 文は段階の色（data-tone）を持ち、過去の行は事実だけで色を持たない
    await expect(page.getByText("隣町で発生しました", { exact: true })).toBeVisible();
    const past = page.locator(".town-past");
    await expect(past).toContainText("（記録）");
    await expect(past).toContainText("隣町で発生しました");
    expect(await past.evaluate((el) => el.closest("[data-tone]") === null && el.querySelector("[data-tone]") === null)).toBe(true);
    await expect(page.locator(".town-now")).toHaveAttribute("data-tone", "lv2");

    // 過去 6 シーズンの件数（古い順に 52、25、84、11、51、24。合わせて 247 事例）
    const counts = await page.locator(".season-bar-count").allTextContents();
    const numbers = counts.map((t) => Number(/(\d+) 件/u.exec(t)?.[1] ?? NaN));
    const pastSix = numbers.slice(1).reverse(); // 先頭は今季。昨季から古い方へ並ぶので、逆にして古い順
    expect(pastSix).toEqual([52, 25, 84, 11, 51, 24]);
    expect(pastSix.reduce((a, b) => a + b, 0)).toBe(247);

    // 再現を 12/19 の夜に進めると、津山の疑いが地図に出る
    await openReplay(page);
    await replayItem(page, /12 月 19 日.*津山市.*疑い/).click();
    await expect(page.getByText(ZONE)).toBeVisible();
    await filterHas(page, "case-suspected", "33203");
    await expectNoForbiddenText(page);
  });

  test("場面 3: 『もし区域の近くの農場なら』で ① になり、3 つの分類が分かれて見える", async ({ page }) => {
    await openReplay(page);
    await expect(page.getByRole("button", { name: "もし区域の近くの農場なら" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("仮の地点で見ています", { exact: false })).toBeVisible();
    await replayItem(page, /12 月 20 日.*津山市.*確定/).click();
    await expect(page.getByText(ZONE)).toBeVisible();

    // 見本の農場のやること（再現の仮の地点と同じ地点）。① なので求められることが最初から開く
    await page.goto("/sample/todo");
    await waitForWord(page, "時点");
    await expect(page.getByText(ZONE).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "いつも求められていること" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "区域に入っていれば求められること" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^確かめておくとよいこと/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^確かめておくとよいこと/ })).toContainText("義務ではありません");
    await expect(page.getByText("区域に入っているかは県の連絡が正です")).toBeVisible();
    await expectNoForbiddenText(page);
  });

  test("場面 4: 声かけ文をコピーでき、防疫措置の完了で解除の見込みが出る", async ({ page }) => {
    await prepare(page);
    await page.goto("/sample/todo");
    await waitForWord(page, "声かけ文");

    // 解除の見込み: 防疫措置が完了している（12/30）ので、『未定』ではなく日付が出る
    const lift = page.getByRole("region", { name: "解除の見込み" });
    await expect(lift).toBeVisible();
    await expect(lift).not.toContainText("未定です");
    await expect(lift).toContainText("移動制限");
    await expect(lift).toContainText("県の連絡が正です");
    await expect(lift).toContainText(/1\s*月\s*21\s*日/u);

    // 声かけ文: 読んで直し、コピーできる
    const box = page.getByLabel("声かけ文（直せます）");
    await expect(box).toBeVisible();
    const text = await box.inputValue();
    expect(text).toContain("津山市");
    await page.getByRole("button", { name: "コピー" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "コピーしました" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await expectNoForbiddenText(page);
  });

  test("場面 5: 報告文を作れて、基準に当たる例で通報を促す", async ({ page }) => {
    await prepare(page);
    await page.goto("/sample/record/deaths");
    await page.getByLabel("鶏舎", { exact: true }).selectOption("house-a");
    await page.getByLabel("死亡数", { exact: true }).fill("10");
    await page.getByRole("button", { name: "記録する" }).click();
    const result = page.getByRole("region", { name: "計算の結果" });
    await expect(result).toContainText("基準に当たる可能性があります");
    await expect(result).toContainText("直ちに家保へ通報してください");
    await expect(result).toContainText("迷うときは家保へ確かめてください");
    await expectNoForbiddenText(page);

    // 週の報告文: 作ってコピーできる（送るのは人）
    const weekly = page.getByLabel("週の報告文の下書き");
    await expect(weekly).toContainText("架空の見本農場");
    await weekly.locator("xpath=ancestor::div[contains(@class,'copy-box')]").getByRole("button", { name: "コピー" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await weekly.inputValue());

    // 自己点検の報告文
    await page.goto("/sample/record/self-check");
    const report = page.getByLabel("自己点検の報告文");
    await expect(report).toContainText("農場名: 架空の見本農場");
    await expect(page.getByRole("button", { name: /送信|送る/ })).toHaveCount(0);
    await expectNoForbiddenText(page);
  });

  test("場面 6: /public の各文に出典と確認日があり、/poster を印刷できる", async ({ page }) => {
    await stubPrint(page);
    await prepare(page);
    await page.goto("/public");
    await waitForWord(page, "確認日");
    const statements = page.locator('[data-role="official"]');
    const n = await statements.count();
    expect(n).toBeGreaterThan(10);
    const bad = await statements.evaluateAll((els) =>
      els.flatMap((el, i) => {
        const src = el.querySelector(".source-line")?.textContent ?? "";
        return /出典:/u.test(src) && /確認日 \d{4}-\d{2}-\d{2}/u.test(src) && el.querySelector("a[href^='https://']") ? [] : [i];
      }),
    );
    expect(bad, "出典か確認日がない文の番号").toEqual([]);
    await expectNoForbiddenText(page);

    await page.goto("/poster");
    await waitForWord(page, "印刷日");
    await page.getByRole("button", { name: "印刷する" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    await expectNoForbiddenText(page);
  });

  test("場面 7: 入れ替えた値が落ち、/results に数字が出る", async ({ page }) => {
    // 舞台裏と読み取りの試験の両方が測定済みになったら、この skip は外れて自動で効く
    test.skip(SCENE7_UNMEASURED, "有料の実測の前は確かめられない。X-26 の提出の確認表で、skip でないことを確かめる");
    await prepare(page);
    await page.goto("/replay/backstage");
    await waitForWord(page, "入れ替えた値");
    const swapped = page.locator("section", { has: page.getByRole("heading", { name: "入れ替えた値" }) });
    // 落ちた例の表示が空でも、/results の確認まで続ける（両方の結果を一度に見るため soft）
    await expect.soft(swapped, "入れ替えた値の節に、落ちた例がある").toContainText("に入れ替えると");
    await expect.soft(swapped, "入れ替えた値の節が、未計測の表示ではない").not.toContainText("まだ実物の文書を読んでいません");

    await page.goto("/results");
    await waitForWord(page, "試験の結果");
    const body = await page.evaluate(() => document.body.innerText);
    // 測った数字が出る（未実測だけの画面は、数字を見せられていない）
    expect(body).not.toMatch(/試験はまだ実行していません/u);
    expect(body).toMatch(/\d+(?:\.\d+)?\s*%|\d+\s*件/u);
    await expectNoForbiddenText(page);
  });

  test("登録なしで全場面に入れる: ログインへ移らず、認証の通信もない", async ({ page }) => {
    const auth: string[] = [];
    page.on("request", (req: Request) => {
      const host = new URL(req.url()).hostname;
      if (host.includes("identitytoolkit") || host.includes("securetoken")) auth.push(req.url());
    });
    await prepare(page, { cases: [TSUYAMA_CASE] });
    for (const path of ["/", "/area/33214", "/replay", "/sample/todo", "/sample/record/deaths", "/public", "/poster", "/replay/backstage", "/results"]) {
      await page.goto(path);
      await page.waitForFunction(() => document.body.innerText.trim().length > 20);
      const url = new URL(page.url());
      expect(url.pathname, `${path} の移動先`).toBe(path);
    }
    await page.waitForLoadState("networkidle");
    expect(auth).toEqual([]);
  });
});
