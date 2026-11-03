import { TEXT } from "./texts";
import type { WatchLineResult } from "./watchLine";

/**
 * 確認状況の 1 行（§9.7）。「47 都道府県のうち N 件を確認、M 件は確認できていません（県名）」。
 * 見回りの結果が届く前は、件数の文を出さない（0 件確認に見えても、読めていないだけ）。
 * いつ時点かは、ページ上部の AsOf が同じ checkedAt の最大を出す。
 */
export function WatchLine({ loaded, line }: { loaded: boolean; line: WatchLineResult }) {
  return (
    <p className="map-status watch-line" role="status" data-testid="watch-line">
      {loaded ? (
        <>
          {line.text}。{line.failedPrefCodes.length > 0 ? TEXT.watchFailedTail : null}
        </>
      ) : (
        TEXT.watchNotLoaded
      )}
    </p>
  );
}
