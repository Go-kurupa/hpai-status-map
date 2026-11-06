// 大字・町丁目の目安の点（国土交通省「大字・町丁目位置参照情報」）を、県ごと・市町村ごとの一覧にする。
// 場所合わせで、選んだ地区の目安の点へ地図を寄せるためだけに使う（端末の中だけで引き、何も送らない）。
import { DESIGNATED_CITIES } from "./designated-cities";

/** 1 地区: [名前, 緯度, 経度]。緯度経度は小数 4 桁（約 10m）に丸める */
export type OazaRow = [name: string, lat: number, lng: number];
/** 県ごとのファイルの中身: 市町村コード → 地区の一覧（元の順） */
export type OazaPref = Record<string, OazaRow[]>;

/** 引用符で囲まれた CSV の 1 行を列に分ける（列の中に "" で引用符が入る形にも対応） */
export function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cols.push(cur);
      cur = "";
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * 1 県分の CSV（文字列。見出しの行つき）を、地図の市町村コードごとの一覧にする。
 * 政令市の区は市にまとめ、地区の名前の頭に区の名前を付ける（例「北区 青江一丁目」）。
 * 地図の市町村の一覧（known）にない市町村は unmatched に返し、一覧には入れない。
 */
export function buildOazaPref(csv: string, known: ReadonlySet<string>): { pref: OazaPref; unmatched: string[] } {
  const lines = csv.split(/\r?\n/u).filter((l) => l.trim() !== "");
  const head = parseCsvLine(lines[0] ?? "");
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`列がありません: ${name}`);
    return i;
  };
  const [cPref, cCode, cMuni, cName, cLat, cLng] = ["都道府県名", "市区町村コード", "市区町村名", "大字町丁目名", "緯度", "経度"].map(col) as [number, number, number, number, number, number];
  const pref: OazaPref = {};
  const unmatched = new Set<string>();
  for (const line of lines.slice(1)) {
    const r = parseCsvLine(line);
    const lat = Number(r[cLat]);
    const lng = Number(r[cLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`緯度経度が数ではありません: ${line}`);
    let code = r[cCode]!;
    let name = r[cName]!;
    if (!known.has(code)) {
      const city = Object.entries(DESIGNATED_CITIES).find(([k]) => k.startsWith(r[cPref]!) && r[cMuni]!.startsWith(k.slice(r[cPref]!.length)));
      if (city && known.has(city[1])) {
        const ward = r[cMuni]!.slice(city[0].length - r[cPref]!.length);
        code = city[1];
        name = ward ? `${ward} ${name}` : name;
      } else {
        unmatched.add(`${r[cCode]} ${r[cMuni]}`);
        continue;
      }
    }
    (pref[code] ??= []).push([name, round4(lat), round4(lng)]);
  }
  return { pref, unmatched: [...unmatched].sort() };
}
