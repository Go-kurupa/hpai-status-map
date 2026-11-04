// 照合の注記（VerifyIssue の detail）のうち、照合の外（比べ合わせ、舞台裏）でも見るもの。web から読み込んでも軽いように、ここには定数だけを置く。
/** 引用に県名がなく、取得元の県と読みの県の一致で都道府県を通した。 */
export const PREF_FROM_SOURCE = "prefecture_from_source";
/** 読みの県が空で、題と本文に他県の名前がなく、取得元の県で補った。 */
export const PREF_FILLED_FROM_SOURCE = "prefecture_filled_from_source";
