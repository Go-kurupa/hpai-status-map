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

/** 会員でない人のメニューの 8 の行き先（設計書 2026-11-06-ui-frame 3 章、決定 8〜16。記録と設定は会員の印があるときだけ） */
export const MENU_ITEMS: ReadonlyArray<{ name: string; path: string }> = [
  { name: "今季の発生", path: "/" },
  { name: "過去の発生", path: "/compare" },
  { name: "発生傾向", path: "/trends" },
  { name: "対策項目", path: "/todo" },
  { name: "会員のログイン", path: "/login" },
  { name: "分かっていること", path: "/known" },
  { name: "鶏を飼っていない方へ", path: "/public" },
  { name: "このサイトについて", path: "/about" },
];

/** 今季の発生・過去の発生の中の見方（メニューの項目と、中の切り替えの名前） */
const VIEWS: Readonly<Record<string, { menu: string; tabs?: string; tab?: string; link?: string }>> = {
  今季の発生と地図: { menu: "今季の発生", tabs: "今季の発生の見方", tab: "地図" },
  今季の一覧と数: { menu: "今季の発生", tabs: "今季の発生の見方", tab: "一覧と数" },
  // 2026-11-07 作者の決定 案 A で名前を変えた（旧「全国とシーズン」「条件で見る」）
  地図で比べる: { menu: "過去の発生", tabs: "過去の発生の見方", tab: "地図で比べる" },
  数で見る: { menu: "過去の発生", tabs: "過去の発生の見方", tab: "数で見る" },
  // 切り替えには並べない（作者 11/7）。最初の画面の「選択地域の過去を見る」のリンクから開く
  選択地域の過去: { menu: "今季の発生", link: "選択地域の過去を見る" },
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
  if (view?.link) await page.getByRole("link", { name: view.link, exact: true }).first().click();
  else if (view?.tabs && view.tab) await page.getByRole("navigation", { name: view.tabs }).getByRole("link", { name: view.tab, exact: true }).click();
}
