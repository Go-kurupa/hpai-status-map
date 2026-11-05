import fs from "node:fs";
import path from "node:path";
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

// /trends の環境省の経路図。静的な枠で、集計の有無に左右されない。配信される画像が data/ の元と同じことも確かめる。
test.describe("渡りの経路（環境省の図）", () => {
  const FILES = ["zu1.jpg", "zu2.jpg", "zu3.jpg", "zu4.jpg", "zu5.png"];

  test("幅 360px で横にはみ出さず、14px 以上で、画像と断りが出て、禁句がない", async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/trends");
    await waitForWord(page, "渡りの経路（環境省の図）");

    const root = page.locator("section.migration-routes");
    const text = await root.innerText();
    for (const s of ["過去の追跡をまとめた図で、今飛んでいる位置ではありません。", "追跡できた個体の数は限られます。", "農場の危険度や、これから飛ぶ経路を示すものではありません。", "環境省「渡り鳥の飛来経路について」", "wataridori_hiraikeiro.html", "図1．オナガガモの飛来経路", "秋の渡り開始８月～10月頃"]) {
      expect(text, s).toContain(s);
    }
    await expectNoForbiddenText(page);

    // 遅延読み込みなので、順に見える位置へ出してから読めたか確かめる
    const imgs = root.locator("img");
    await expect(imgs).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await imgs.nth(i).scrollIntoViewIfNeeded();
      await expect.poll(() => imgs.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(800);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const report = await root.evaluate((sec) => {
      const wide: string[] = [];
      const small: string[] = [];
      const lowLinks: string[] = [];
      for (const el of sec.querySelectorAll<HTMLElement>("*")) {
        if (el.getBoundingClientRect().right > 360.5) wide.push(el.tagName);
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        if (hasText && parseFloat(getComputedStyle(el).fontSize) < 14) small.push(el.tagName);
        if (el.classList.contains("tap-link") && el.getBoundingClientRect().height < 44) lowLinks.push(el.textContent ?? "");
      }
      return { wide, small, lowLinks };
    });
    expect(report).toEqual({ wide: [], small: [], lowLinks: [] });
  });

  test("画像は data/ の元と同じ大きさで配信される（index.html に化けない）", async ({ request }) => {
    for (const f of FILES) {
      const res = await request.get(`/migration/routes/${f}`);
      expect(res.status(), f).toBe(200);
      expect(res.headers()["content-type"], f).toMatch(/^image\//u);
      const original = fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "data", "migration", "routes", f));
      expect((await res.body()).equals(original), f).toBe(true);
    }
  });

  test("読み込みに失敗した分岐でも出る", async ({ page }) => {
    await prepare(page);
    await page.route("**/trends/summary.json", (r) => r.fulfill({ status: 500, body: "" }));
    await page.goto("/trends");
    await waitForWord(page, "集計を読み込めませんでした");
    await expect(page.locator("section.migration-routes img")).toHaveCount(5);
  });
});
