// 地図の出典。常に全文を出す。文は docs/data-sources.md の「地理院タイル」の節と、N03 の「出典（表示する文）」と同じにする。
// N03 の文は、CC BY 4.0 が求める加工の表示を含む（形の簡略化、政令市の区の統合、隣り合いの計算）。
// 出典は MapPage が地図の外に全文を出す（HTML を受ける）。リンクは別のタブで開き、元のページを渡さない。

const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

/** 淡色地図の縮尺 ZL5〜8 に要る出所の明示（地理院タイル一覧ページの指定の文） */
export const VMAP0_NOTICE =
  'Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.';

export const MAP_ATTRIBUTION: string[] = [
  `<a href="https://maps.gsi.go.jp/development/ichiran.html" ${NEW_TAB}>地理院タイル</a>に行政区域を追記して掲載`,
  VMAP0_NOTICE,
  `国土交通省 <a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html" ${NEW_TAB}>国土数値情報「行政区域データ N03 2026 年版」</a>をもとに、このサイトの作者が形の簡略化、政令市の区の統合、隣り合いの計算を行って作成`,
];
