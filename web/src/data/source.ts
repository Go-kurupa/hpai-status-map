import { createFixtureDataSource, type HpaiFixture } from "./fixture";
import { createLiveDataSource } from "./live";
import type { DataSource } from "./types";

/** MODE==="e2e" かつ window.__HPAI_FIXTURE__ があれば fixture、他は live。 */
export function createDataSource(): DataSource {
  // この分岐の外に fixture の名前を書かない（本番の build から文字ごと消えること）
  if (import.meta.env.MODE === "e2e") {
    const fx = (window as unknown as { __HPAI_FIXTURE__?: HpaiFixture }).__HPAI_FIXTURE__;
    if (fx) return createFixtureDataSource(fx);
  }
  return createLiveDataSource();
}
