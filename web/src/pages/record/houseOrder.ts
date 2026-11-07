// 鶏舎を画面に出す順（名前の順。「2 号舎」は「10 号舎」より前）。
// 保存の側（listHouses）は順を決めないので、画面に出す前に並べる。死亡数の画面と、対策項目の今日のやることで使う。
export function byHouseName<T extends { name: string }>(houses: readonly T[]): T[] {
  return [...houses].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
}
