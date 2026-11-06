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

/** メニューの 11 の行き先（設計書 2026-11-06-ui-frame 3 章、決定 8〜13） */
export const MENU_ITEMS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "今季の発生", path: "/" },
  { name: "過去の発生", path: "/compare" },
  { name: "全国の傾向", path: "/trends" },
  { name: "やること", path: "/todo" },
  { name: "記録", path: "/record/deaths" },
  { name: "農場と知らせの設定", path: "/settings/farm" },
  { name: "掲示用の貼り紙", path: "/poster" },
  { name: "見本で試す", path: "/sample" },
  { name: "分かっていること", path: "/known" },
  { name: "鶏を飼っていない方へ", path: "/public" },
  { name: "このサイトについて", path: "/about" },
];

/** 今季の発生・過去の発生の中の見方（メニューの項目と、中の切り替えの名前） */
const VIEWS: Readonly<Record<string, { menu: string; tabs: string; tab: string }>> = {
  今季の発生と地図: { menu: "今季の発生", tabs: "今季の発生の見方", tab: "地図" },
  今季の一覧と数: { menu: "今季の発生", tabs: "今季の発生の見方", tab: "一覧と数" },
  過去シーズンとの比べ: { menu: "過去の発生", tabs: "過去の発生の見方", tab: "全国とシーズン" },
  自分の町の過去: { menu: "過去の発生", tabs: "過去の発生の見方", tab: "自分の町のまわり" },
  去年の再現: { menu: "過去の発生", tabs: "過去の発生の見方", tab: "去年をたどる（再現）" },
};

/**
 * メニューの項目を 1 つ押す。スマホ（三本線が見える幅）は三本線で全画面のメニューを開いてから押す（2 回）。
 * 今季・過去の中の見方の名前（例: 「今季の一覧と数」）を渡したときは、メニューの項目を押してから中の切り替えを押す。
 */
export async function goViaMenu(page: Page, name: string): Promise<void> {
  const view = VIEWS[name];
  const btn = menuButton(page);
  if (await btn.isVisible()) await btn.click();
  const nav = menuNav(page);
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: view ? view.menu : name }).first().click();
  if (view) await page.getByRole("navigation", { name: view.tabs }).getByRole("link", { name: view.tab, exact: true }).click();
}
