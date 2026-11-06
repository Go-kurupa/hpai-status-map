import { expect, type Locator, type Page } from "@playwright/test";

// 画面の骨組みの作り直し（設計書 2026-11-06-ui-frame）。下のタブ（navigation 名「メイン」）をなくしたので、
// 「下のタブより上」と測っていた所は「画面の下端より上」を基準にする。

/** 画面の下端。下のタブの代わりに、`nav.y` の位置へ使う */
export const viewportBottom = (page: Page): { y: number } => ({ y: page.viewportSize()!.height });

/** 画面の下端の位置を数で（nav.y の代わり） */
export const bottomY = (page: Page): number => page.viewportSize()!.height;

/** 左のメニュー（PC）または全画面のメニュー（スマホは開いたとき）の nav */
export const menuNav = (page: Page): Locator => page.getByRole("navigation", { name: "メニュー" });

/** スマホの三本線 */
export const menuButton = (page: Page): Locator => page.getByRole("button", { name: "メニューを開く" });

/** メニューの 15 の行き先（設計書 3 章の表） */
export const MENU_ITEMS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "今季の発生と地図", path: "/" },
  { name: "自分の町の過去", path: "/town" },
  { name: "今季の一覧と数", path: "/season" },
  { name: "過去シーズンとの比べ", path: "/compare" },
  { name: "やること", path: "/todo" },
  { name: "記録", path: "/record/deaths" },
  { name: "農場と知らせの設定", path: "/settings/farm" },
  { name: "鶏を飼っていない方へ", path: "/public" },
  { name: "分かっていること", path: "/known" },
  { name: "全国の傾向", path: "/trends" },
  { name: "去年の再現", path: "/replay" },
  { name: "見本の農場", path: "/sample" },
  { name: "掲示用の貼り紙", path: "/poster" },
  { name: "試験の結果", path: "/results" },
  { name: "プライバシー", path: "/privacy" },
];

/**
 * メニューの項目を 1 つ押す。スマホ（三本線が見える幅）は三本線で全画面のメニューを開いてから押す（2 回）。
 * 「その他」は閉じていることがあるので、項目が見えなければ開く。
 */
export async function goViaMenu(page: Page, name: string): Promise<void> {
  const btn = menuButton(page);
  if (await btn.isVisible()) await btn.click();
  const nav = menuNav(page);
  await expect(nav).toBeVisible();
  const link = nav.getByRole("link", { name }).first();
  if (!(await link.isVisible())) await nav.locator("details.menu-more > summary").click();
  await link.click();
}
