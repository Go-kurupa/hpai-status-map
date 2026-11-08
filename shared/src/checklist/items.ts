// 確認リストの項目（設計書 §7）。決まりとしてコードで持ち、Claude に判断させない。
// 文と出典は、計画の表のとおり。条文を推測で足さない。
// 項目番号と条文の位置は ChecklistSource.note に持つ（title は出典の名前だけ）。
import type { ChecklistItem, ChecklistSource } from "../checklist";
import type { ChecklistClass } from "../types";

interface Source {
  title: string;
  url: string;
}

const STANDARD: Source = {
  title: "飼養衛生管理基準（家畜伝染病予防法施行規則 別表第二 三）",
  url: "https://laws.e-gov.go.jp/law/326M50010000035",
};
/** 番号の振り直し（2025-10-01）の注意。基準の項目には必ず添える */
export const STANDARD_NUMBER_NOTE = "2025-10-01 に番号が変わりました（施行 2026-10-01 の版で確認）。古い資料は別の番号です";

const GUIDELINE: Source = {
  title: "高病原性鳥インフルエンザ及び低病原性鳥インフルエンザに関する特定家畜伝染病防疫指針（令和 7 年 10 月 1 日一部変更）",
  url: "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/",
};
const REPORT: Source = {
  title: "国の疫学調査報告書（2025/26）",
  url: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf",
};
const OLD_CASE: Source = {
  title: "鳥インフルエンザ発生時の家きん卵早期出荷に向けての取り組み（和歌山県の家畜保健衛生所の報告）",
  url: "https://www.pref.wakayama.lg.jp/prefg/070400/d00209378_d/fil/24-6.pdf",
};

const OLD_CASE_NOTE = "平成 24 年度ごろの古い資料の事例です";

const std = (position: string, extra?: string): ChecklistSource => ({
  ...STANDARD,
  note: `${position}。${extra ? `${extra}。` : ""}${STANDARD_NUMBER_NOTE}`,
});
const guideline = (position: string): ChecklistSource => ({ ...GUIDELINE, note: position });
const report = (): ChecklistSource => ({ ...REPORT, note: null });

interface Row {
  id: string;
  class: ChecklistClass;
  text: string;
  source: ChecklistSource;
  /** 今日のやることと記録の画面の今日の項目に並べる、消毒の 6 項目（確認リストの「やった」は class で決める） */
  log?: true;
}

/** 表の順。rank は順に 10、20、… */
const ROWS: readonly Row[] = [
  { id: "always-17", class: "always", text: "衛生管理区域（消毒して入る範囲）の入口で、立ち入る人に手指の洗浄と消毒をしてもらう", source: std("項目 17"), log: true },
  { id: "always-18", class: "always", text: "衛生管理区域専用の衣服と靴を用意し、立ち入る人に着けてもらう", source: std("項目 18") },
  { id: "always-19", class: "always", text: "衛生管理区域に入る車両を、入口で消毒する", source: std("項目 19"), log: true },
  { id: "always-22", class: "always", text: "鶏舎に出入りするたびに、手指の洗浄と消毒をする", source: std("項目 22"), log: true },
  { id: "always-23", class: "always", text: "鶏舎ごとの専用の靴を用意し、履き替える", source: std("項目 23") },
  { id: "always-25", class: "always", text: "防鳥ネットなどを設け、鶏舎の屋根や壁とあわせて破損を定期的に確かめ、破損はすぐ直す", source: std("項目 25") },
  { id: "always-27", class: "always", text: "ねずみと、はえなどの害虫を駆除する", source: std("項目 27") },
  {
    id: "always-32",
    class: "always",
    text: "特定症状（告示で決められた、通報する症状）を見つけたら、直ちに家畜保健衛生所へ通報し、出荷と移動を止める",
    source: std("項目 32"),
  },
  {
    id: "always-33",
    class: "always",
    text: "それ以外の異状で死亡率の急な上昇などがあれば、直ちに獣医師か家保の指導を受け、確認されるまで出荷と移動をしない",
    source: std("項目 33"),
  },
  {
    id: "zone-daily",
    class: "if_in_zone",
    text: "毎日、その日の死亡羽数などを、区域が解除されるまで県へ報告する（監視強化区域の一部では省略できる場合があります）",
    source: guideline("第 9 の 1(5)、留意事項 48"),
  },
  { id: "zone-visitors", class: "if_in_zone", text: "鶏舎などへの、関係者以外の出入りを控える", source: guideline("留意事項 48") },
  { id: "zone-entry", class: "if_in_zone", text: "農場の関係者の入出場時の消毒を徹底する", source: guideline("留意事項 48"), log: true },
  {
    id: "zone-lime",
    class: "if_in_zone",
    text: "鶏舎の出入口、鶏舎の周り、衛生管理区域の外縁部を、消石灰などで消毒する",
    source: guideline("留意事項 48"),
    log: true,
  },
  { id: "zone-inside", class: "if_in_zone", text: "鶏舎の中を、このウイルスに効果のある消毒薬で消毒する", source: guideline("留意事項 48"), log: true },
  {
    id: "zone-abnormal",
    class: "if_in_zone",
    text: "次を見つけたら直ちに報告する: 同じ鶏舎で 1 日の死亡率が平均の 2 倍以上／鶏冠や肉垂のチアノーゼ、沈うつ、産卵率の低下など／5 羽以上のまとまった死亡やうずくまり",
    source: guideline("第 9 の 1(5)"),
  },
  {
    id: "good-visitor-clothes",
    class: "good_to_check",
    text: "外部事業者が衛生管理区域に入るときの専用の衣服や靴（国の報告書で、半数以上の農場で不備）",
    source: report(),
  },
  { id: "good-rats", class: "good_to_check", text: "ねずみの死体や痕跡（国の報告書で、半数以上の農場）", source: report() },
  { id: "good-walls", class: "good_to_check", text: "鶏舎の壁やネットの破損（国の報告書で、複数の農場）", source: report() },
  {
    id: "good-worker",
    class: "good_to_check",
    text: "働く人への声かけ: 発生地の近くに行かない、出勤前後の消毒や着替え",
    source: std("項目 3（周知）", "文は作者の経験から"),
  },
  { id: "good-pref", class: "good_to_check", text: "区域に入ったときの備え: 県からの連絡を確かめる", source: guideline("第 9 の 1") },
  { id: "good-plan", class: "good_to_check", text: "区域に入ったときの備え: 出荷先と移動の予定を書き出す", source: guideline("第 9 の 5") },
  {
    id: "good-egg",
    class: "good_to_check",
    text: "卵の出荷は、検査の結果を受けて県と国の協議で決まります",
    source: guideline("第 9 の 5(2)"),
  },
  {
    id: "good-broiler",
    class: "good_to_check",
    text: "肉用の鶏の食鳥処理場への出荷は、検査の結果を受けて県と国の協議で決まります",
    source: guideline("第 9 の 5(1)"),
  },
  {
    id: "good-records",
    class: "good_to_check",
    text: "区域に入ったときの備え: 出荷や導入の記録と伝票を残す（補償に要ることがあります）",
    source: { ...OLD_CASE, note: OLD_CASE_NOTE },
  },
];

export const CHECKLIST_ITEMS: readonly ChecklistItem[] = ROWS.map((r, n) => ({
  id: r.id,
  class: r.class,
  text: r.text,
  source: r.source,
  rank: (n + 1) * 10,
  disinfectionLoggable: r.log === true,
  doneLoggable: r.class === "always" || r.class === "if_in_zone",
}));
