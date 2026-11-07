// 過去シーズンとの重ね合わせの文言（設計書 2026-11-06-data-explore E8〜E15）。
// texts.ts は別の作業と同時に直されることがあるので、重ね合わせの文はここに分けて置く。禁句は使わない
export const CMP_TEXT = {
  svgOne: "比べる 1 だけで発生",
  svgTwo: "比べる 2 だけで発生",
  svgBoth: "両方で発生",
  svgLatest: "選んだシーズンで発生（色は最後に発生したシーズン）",
  showAria: "地図の見せ方",
  showBoth: "重ねる",
  showOne: "1 だけ",
  showTwo: "2 だけ",
  legendAria: "重ね合わせの凡例",
  legendOneOnly: (n: number): string => `比べる 1 だけで発生（${n} 町）`,
  legendTwoOnly: (n: number): string => `比べる 2 だけで発生（${n} 町）`,
  legendBoth: (n: number): string => `両方で発生（${n} 町）`,
  legendOne: (n: number): string => `比べる 1 で発生（${n} 町）`,
  legendTwo: (n: number): string => `比べる 2 で発生（${n} 町）`,
  legendUnwatched: "確認できていない県",
  legendNote: "町の数は、発生のあった市区町村の数です。県名だけの発表は地図に塗れないので、数に入れていません。",
  currentSuspected: "今季は疑いを含みます",
  sameSeason: "同じシーズンを選んでいます。別のシーズンを選ぶと比べられます。",
  mapAria: (one: string, two: string): string => `発生状況の地図（比べる 1: ${one} と、比べる 2: ${two} の重ね合わせ）`,
  hint: "地図で町を押すと、2 つのシーズンのその町の発生が、地図の下に上下に並んで出ます。",
  // 3 つ以上の比べ（設計書 2026-11-06-data-explore E12）
  seasonsAria: "比べるシーズン（押して選ぶ。2 つなら重ねる、3 つ以上なら最後の発生の色）",
  /** シーズンのボタンの名前。短くして 1 行に多く並べる（例「4 年前（2022〜23）」） */
  seasonChip: (label: string, s: number): string => `${label}（${s}〜${String(s + 1).slice(2)}）`,
  seasonsHint: "シーズンを押して選びます。2 つなら重ねて、3 つ以上なら、町ごとに最後に発生したシーズンの色で塗ります。",
  legendLatest: (season: string, n: number): string => `${season}が最後（${n} 町）`,
  countNote: "町の中の「計◯回」は、選んだシーズン全体でその町で発生した回数（事例の数）です（2 回以上の町だけ。地図を拡大すると出ます）。",
  /** 町の中の札（作者 11/7「数字の意味を分かりやすく」） */
  countBadge: (n: number): string => `計 ${n} 回`,
  latestHint: "町ごとに、選んだシーズンのうち最後に発生したシーズンの色で塗っています。地図で町を押すと、選んだシーズンごとのその町の発生が並んで出ます。",
  latestAria: (n: number): string => `発生状況の地図（選んだ ${n} シーズンのうち、町ごとに最後に発生したシーズンの色）`,
  scopeAria: "地図の広さ",
  scopeNear: "選択地域付近",
  // 鶏舎の場所を決めた後（作者 11/7）。輪の中心が鶏舎だと分かるように
  scopeNearFarm: "鶏舎の付近",
  scopeJapan: "全国",
} as const;
