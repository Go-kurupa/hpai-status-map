// 地図の出典。常に全文を出す（索引 Q16 の既定）。文は docs/data-sources.md の「地理院タイル」の節と同じにする。
// AttributionControl の customAttribution は HTML を受ける。リンクは別のタブで開き、元のページを渡さない。

const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

/** 淡色地図の縮尺 ZL5〜8 に要る出所の明示（地理院タイル一覧ページの指定の文） */
export const VMAP0_NOTICE =
  'Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.';

export const MAP_ATTRIBUTION: string[] = [
  `<a href="https://maps.gsi.go.jp/development/ichiran.html" ${NEW_TAB}>地理院タイル</a>に行政区域を追記して掲載`,
  VMAP0_NOTICE,
  `<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html" ${NEW_TAB}>国土数値情報（行政区域データ）（国土交通省）</a>をもとに作成。形を簡略化`,
];
