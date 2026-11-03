import type { Case, HistoryCase, WatchStatus, WildBird } from "@hpai/shared/types";
import type { Page } from "@playwright/test";

export interface FixtureInput {
  /** ISO 8601。公開の画面の時計 */
  now: string;
  cases: Case[];
  wildBirds: WildBird[];
  watch: WatchStatus[];
  /** なければ画面が /history/cases.json を読む */
  history?: HistoryCase[];
}

/**
 * ページの読み込みより前に window.__HPAI_FIXTURE__ を置く。
 * `vite build --mode e2e` の画面だけが読み、DataSource を fixture にする。
 */
export async function installFixture(page: Page, fixture: FixtureInput): Promise<void> {
  await page.addInitScript((f) => {
    (window as unknown as { __HPAI_FIXTURE__: unknown }).__HPAI_FIXTURE__ = f;
  }, fixture);
}
