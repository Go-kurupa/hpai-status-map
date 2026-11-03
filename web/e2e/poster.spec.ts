import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";

// 貼り紙 /poster（W-07）。A4（794x1123 px = 96dpi）の 1 枚に収まり、印刷ではタブと説明が消える。
// 大きさは poster.css の変数（--poster-h、--poster-sub、--poster-body）。収まらないときは、まず --poster-sub を下げる。

test.describe("貼り紙", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 794, height: 1123 });
    await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [], wildBirds: [], watch: [] });
    await page.goto("/poster");
    await expect(page.getByTestId("poster-sheet")).toBeVisible();
  });

  test("印刷では、骨格のタブと説明が消え、高さが A4（1123px）以内で、@page が A4", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "メイン" })).toBeHidden();
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "印刷する" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1123);

    const pageRule = await page.evaluate(() => {
      for (const sheet of [...document.styleSheets]) {
        for (const rule of [...sheet.cssRules]) {
          if (rule instanceof CSSPageRule) return rule.cssText;
        }
      }
      return null;
    });
    expect(pageRule).toContain("A4");
  });

  test("見出しは 2 行以内で、横にはみ出さない", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    const heading = page.getByTestId("poster-heading");
    const box = await heading.boundingBox();
    const fontPx = await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const lineHeightPx = await heading.evaluate((el) => {
      const lh = getComputedStyle(el).lineHeight;
      return lh === "normal" ? parseFloat(getComputedStyle(el).fontSize) * 1.2 : parseFloat(lh);
    });
    expect(fontPx).toBeGreaterThan(0);
    // ruby の分の高さを除いて、2 行分（行の高さ × 2）に収まる
    expect(box!.height).toBeLessThanOrEqual(lineHeightPx * 2 + fontPx * 0.8);
    const overflow = await heading.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // 貼り紙の枠の中に収まる
    const sheet = await page.getByTestId("poster-sheet").boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width + 1);
  });

  test("本文の各行は、貼り紙の幅からはみ出さない", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    const sheetWidth = (await page.getByTestId("poster-sheet").boundingBox())!.width;
    for (const line of await page.getByTestId("poster-line").all()) {
      const box = (await line.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(sheetWidth);
      expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
  });

  test("A4 で PDF にすると 1 ページ（emulateMedia の print は @page の余白が効かないので、実際の印刷に近い確認）", async ({ page }) => {
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/gu) ?? [];
    expect(pages).toHaveLength(1);
  });

  test("印刷日と QR が、貼り紙の中にある", async ({ page }) => {
    await expect(page.getByTestId("poster-sheet")).toContainText("印刷日 2026 年 11 月 10 日");
    await expect(page.getByTestId("poster-qr").locator("svg")).toBeVisible();
    await expect(page.getByTestId("poster-qr")).toHaveAttribute("data-url", /\/public$/u);
  });
});
