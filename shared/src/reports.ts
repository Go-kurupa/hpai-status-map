// 報告文と CSV の組み立て（設計書 §8）。文を作るだけで、送らず、保存しない。
// 県の様式そのものは入れない。様式の項目に合わせた下書きで、県によって違う。
import { addDays } from "./dates";
import { formatJaDate } from "./jaDate";
import type { CheckRecord, DeathRecord, ExclusionKind, House, IsoDate, SelfCheckItemNo } from "./types";

type HouseWithId = House & { id: string };

/** 基準の項目番号つきの 7 項目（番号は家畜伝染病予防法施行規則 別表第二 三の現行版で確認済み） */
export const SELF_CHECK_ITEMS: ReadonlyArray<{ no: SelfCheckItemNo; label: string }> = [
  { no: "17", label: "衛生管理区域に立ち入る者の手指消毒等" },
  { no: "18", label: "衛生管理区域専用の衣服及び靴の設置並びに使用" },
  { no: "19", label: "衛生管理区域に立ち入る車両の消毒等" },
  { no: "22", label: "家きん舎に立ち入る者の手指消毒等" },
  { no: "23", label: "家きん舎ごとの専用の靴の設置及び使用" },
  { no: "25", label: "野生動物の侵入防止のためのネット等の設置、点検及び修繕" },
  { no: "27", label: "ねずみ及び害虫の駆除" },
];

/** 索引 Q12 の既定（A: 地域が出ない書き方） */
export const SELF_CHECK_SOURCE_NOTE = "ある家畜保健衛生所の様式の例です。項目と期限は県や家畜保健衛生所で違います";

/**
 * 消毒・対策の記録の項目 id を言葉にする。確認リストで「やった」を出す項目（いつも求められていることと、
 * 区域に入っていれば求められることの全項目）に名前を持つ。知らない id は呼ぶ側でそのまま使う
 */
export const DISINFECTION_LABELS: Readonly<Record<string, string>> = {
  "always-17": "入口の手指消毒",
  "always-18": "区域専用の衣服と靴",
  "always-19": "車両の消毒",
  "always-22": "鶏舎の手指消毒",
  "always-23": "鶏舎ごとの靴の履き替え",
  "always-25": "防鳥ネットの点検と修繕",
  "always-27": "ねずみと害虫の駆除",
  "always-32": "特定症状の確認",
  "always-33": "異状の確認",
  "zone-daily": "死亡羽数の毎日の報告",
  "zone-visitors": "関係者以外の出入りの制限",
  "zone-entry": "入出場時の消毒",
  "zone-lime": "消石灰の消毒",
  "zone-inside": "鶏舎内の消毒",
  "zone-abnormal": "区域の異状の即時報告",
};

export const EXCLUSION_LABELS: Readonly<Record<ExclusionKind, string>> = {
  disease: "病気",
  equipment: "設備の故障",
  temperature: "急な気温変化",
  disaster: "災害",
  empty: "空舎",
  other: "その他",
};

const UNFILLED = "未記入";
const NO_INPUT = "未入力";

/** "2026-11" → "2026年11月"。形が違えばそのまま返す */
function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${m[1]}年${Number(m[2])}月` : month;
}

function jaDateWithYear(d: IsoDate): string {
  return `${d.slice(0, 4)}年${formatJaDate(d)}`;
}

function mark(a: "ok" | "ng" | null | undefined): string {
  return a === "ok" ? "○" : a === "ng" ? "×" : UNFILLED;
}

export function buildSelfCheckReport(i: {
  farmName: string;
  month: string;
  answers: Record<SelfCheckItemNo, "ok" | "ng" | null>;
}): string {
  const name = i.farmName.trim();
  return [
    "自己点検の報告",
    `農場名: ${name === "" ? UNFILLED : name}`,
    `対象の月: ${monthLabel(i.month)}`,
    ...SELF_CHECK_ITEMS.map((it) => `${it.no} ${it.label}: ${mark(i.answers[it.no])}`),
  ].join("\n");
}

function noteOrUnfilled(s: string): string {
  const t = s.trim();
  return t === "" ? UNFILLED : t;
}

/**
 * 週の報告文。鶏舎ごとの記録を鳥の種類で集める。入力者は出さない（記録が持たない）。
 * 飼養羽数は空舎を除いた合計。日別は記録のない日が「未入力」で、合計は入力のある日だけ。
 * extras は保存しない（この文を作るためだけに受ける）。
 */
export function buildWeeklyDeathReport(i: {
  farmName: string;
  weekStart: IsoDate;
  houses: ReadonlyArray<HouseWithId>;
  records: readonly DeathRecord[];
  extras: { culledShipped: number | null; introduced: number | null; healthNote: string; mortalityNote: string };
}): string {
  const days = Array.from({ length: 7 }, (_, n) => addDays(i.weekStart, n));
  const name = i.farmName.trim();

  const typeOrder: string[] = [];
  for (const h of i.houses) if (!typeOrder.includes(h.birdType)) typeOrder.push(h.birdType);

  const lines: string[] = [
    "死亡羽数の週報告（下書き）",
    `農場名: ${name === "" ? UNFILLED : name}`,
    `対象の週: ${jaDateWithYear(days[0] as IsoDate)}〜${jaDateWithYear(days[6] as IsoDate)}`,
    "",
  ];

  for (const type of typeOrder) {
    const inType = i.houses.filter((h) => h.birdType === type);
    const ids = new Set(inType.map((h) => h.id));
    const flock = inType.filter((h) => !h.empty).reduce((sum, h) => sum + h.flockSize, 0);
    lines.push(`鳥の種類: ${type === "" ? UNFILLED : type}`, `飼養羽数: ${flock}`, "日別の死亡羽数");
    let total = 0;
    let any = false;
    for (const day of days) {
      const rows = i.records.filter((r) => r.date === day && ids.has(r.houseId));
      if (rows.length === 0) {
        lines.push(`${formatJaDate(day)}: ${NO_INPUT}`);
        continue;
      }
      const sum = rows.reduce((s, r) => s + r.deaths, 0);
      total += sum;
      any = true;
      lines.push(`${formatJaDate(day)}: ${sum}`);
    }
    lines.push(`合計: ${any ? total : NO_INPUT}`, "");
  }

  const n = (v: number | null) => (v === null ? UNFILLED : String(v));
  lines.push(
    `廃鶏出荷羽数: ${n(i.extras.culledShipped)}`,
    `導入羽数: ${n(i.extras.introduced)}`,
    `健康状態の特記事項（産卵率の推移など）: ${noteOrUnfilled(i.extras.healthNote)}`,
    `死亡率の変動や偏りの特記事項: ${noteOrUnfilled(i.extras.mortalityNote)}`,
  );
  return lines.join("\n");
}

// ---- CSV ----

/** 表計算ソフトが式として実行しうる先頭の文字。前に ' を足す */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number): string {
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function deathsToCsv(records: readonly DeathRecord[], houses: ReadonlyArray<HouseWithId>): string {
  const byId = new Map(houses.map((h) => [h.id, h]));
  const sorted = [...records].sort((a, b) =>
    a.date === b.date ? (a.houseId < b.houseId ? -1 : a.houseId > b.houseId ? 1 : 0) : a.date < b.date ? -1 : 1,
  );
  return toCsv(
    ["日付", "鶏舎", "鳥の種類", "飼養羽数", "死亡羽数", "除外の理由", "メモ"],
    sorted.map((r) => {
      const h = byId.get(r.houseId);
      return [
        r.date,
        h?.name ?? r.houseId,
        h?.birdType ?? "",
        r.flockSizeAt,
        r.deaths,
        r.exclusion ? (EXCLUSION_LABELS[r.exclusion.kind] ?? r.exclusion.kind) : "",
        r.exclusion?.note ?? "",
      ];
    }),
  );
}

export function checksToCsv(checks: readonly CheckRecord[]): string {
  const sorted = [...checks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rows: Array<Array<string | number>> = [];
  for (const c of sorted) {
    if (c.kind === "disinfection") {
      rows.push([c.date, "消毒・対策", DISINFECTION_LABELS[c.itemId] ?? c.itemId, "実施"]);
    } else {
      for (const it of SELF_CHECK_ITEMS) {
        rows.push([c.date, "自己点検", `${it.no} ${it.label}（${monthLabel(c.month)}分）`, mark(c.answers[it.no])]);
      }
    }
  }
  return toCsv(["日付", "種類", "項目", "結果"], rows);
}
