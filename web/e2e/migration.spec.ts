import { expect, test } from "@playwright/test";
import { expectNoForbiddenText, prepare, waitForWord } from "./wording.helper";

// /trends の「渡り鳥の飛来（季節の参考）」。本番と同じ build が配る data/migration/summary.json（実データ）を読む。
// 集計がまだ無い環境では、「まだ作られていません」の枠だけが出るので、断りと時点は確かめない。
test.describe("渡り鳥の飛来（季節の参考）", () => {
  test("幅 360px で横にはみ出さず、断りと時点が出て、禁句がない", async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/trends");
    await waitForWord(page, "渡り鳥の飛来（季節の参考）");
    await page.waitForFunction(() => !document.body.innerText.includes("読み込んでいます"));

    const body = await page.evaluate(() => document.body.innerText);
    test.skip(body.includes("まだ作られていません"), "集計（data/migration/summary.json）がまだ無い");

    for (const s of ["農場の危険度や警報ではありません", "年によって大きく揺れます", "感染の情報は含みません", "数日から 2 週間ほどかかります", "最も新しい調査日", "データの取得日", "環境省「渡り鳥の飛来状況」", "加工"]) {
      expect(body, s).toContain(s);
    }
    await expectNoForbiddenText(page);

    // 横にはみ出さない（ページ全体と、この枠の中のどの要素も）
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const overflowing = await page.evaluate(() => {
      const root = document.querySelector("section.migration");
      if (!root) return ["section.migration がありません"];
      const out: string[] = [];
      for (const el of root.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > 360.5) out.push(`${el.tagName}.${(el as HTMLElement).className} 右端 ${Math.round(r.right)}`);
      }
      return out;
    });
    expect(overflowing).toEqual([]);

    // 地図の部品（WebGL）に頼らない
    expect(await page.locator("section.migration canvas").count()).toBe(0);
    await expect(page.locator("section.migration a[href^='https://www.env.go.jp/']").first()).toBeVisible();
  });
});
