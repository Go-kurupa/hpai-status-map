import { AsOf, useFormatAsOf } from "../../ui/AsOf";
import { TEXT } from "./texts";
import type { WatchLineResult } from "./watchLineText";

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

/**
 * いつ時点か。確認できた県が 1 つもないときは、「時点」と出さず「最後に確認を試した」時刻だと分かる言い方にする
 * （失敗の行の checkedAt は最後に試した時刻で、確認できた時刻ではない）。時刻がなければ「確認できていません」。
 */
export function WatchAsOf({ loaded, line }: { loaded: boolean; line: WatchLineResult }) {
  const format = useFormatAsOf();
  if (!loaded || line.asOf === null || line.okCount > 0) return <AsOf iso={loaded ? line.asOf : null} />;
  const text = format(line.asOf);
  if (text === null) return null;
  return (
    <p className="as-of">
      {TEXT.watchAttemptOnly} {text.replace(/ 時点$/, "")} です
    </p>
  );
}
