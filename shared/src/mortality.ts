// 死亡率 2 倍の計算（設計書 §8）。告示の定義をプログラムで計算するだけで、Claude は使わない。
// 診断はしない。時計は中で呼ばず、当日は引数で受ける。
import { addDays } from "./dates";
import type { DeathRecord, ExclusionKind, IsoDate } from "./types";

/** 告示の「対象期間」の日数（当日を含む通算）。 */
const WINDOW_DAYS = 21;
/** 浮動小数点の誤差。ちょうど 2 倍の例（過去 19 羽、当日 40 羽）を当たりにする。 */
const EPSILON = 1e-12;

/** 除外の種類の集合。これ以外（"foo"、""、undefined）は黙って飛ばさず invalid_input にする。 */
const EXCLUSION_KINDS: ReadonlySet<unknown> = new Set<ExclusionKind>([
  "disease",
  "equipment",
  "temperature",
  "disaster",
  "empty",
  "other",
]);

/**
 * 1 つの鶏舎の 1 日分。呼ぶ側が houseId で分けてから渡す（鶏舎を混ぜて同じ日が 2 件あれば invalid_input）。
 * 型を外れた実行時の値（除外の種類が 6 つ以外、日付の形が違うなど）は invalid_input になる。
 */
export interface MortalityDay {
  date: IsoDate;
  deaths: number;
  flockSize: number;
  exclusion: ExclusionKind | null;
}

export type MortalityResult =
  | { status: "insufficient"; validDays: number; needed: 21 }
  | { status: "today_excluded"; kind: ExclusionKind }
  | { status: "no_record" }
  // 計算に使えない入力の日。NaN、負の数、小数、羽数を超える値、羽数そのものの誤り、同じ日が 2 件、
  // 除外の種類が 6 つ以外、日付の形が違う（その場合は入力の文字列がそのまま入る）。黙って当たらない扱いにしない
  | { status: "invalid_input"; dates: IsoDate[] }
  | {
      status: "evaluated";
      todayRate: number;
      averageRate: number;
      hit: boolean;
      /** 平均に使った 21 日。当日が先頭、最も古い日が末尾 */
      windowDates: IsoDate[];
      /** 窓の範囲にあって記録がなかった日（索引 Q2: 飛ばして遡った）。新しい順 */
      skippedMissingDates: IsoDate[];
    };

function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  try {
    addDays(value, 0);
    return true;
  } catch {
    return false;
  }
}

function isExclusionOk(value: unknown): boolean {
  return value === null || EXCLUSION_KINDS.has(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** 羽数 0 以上の整数、死亡数 0 以上の整数、死亡数は羽数以下。羽数 0 の判定より先にこれを通す。 */
function isValidDay(d: MortalityDay): boolean {
  return isCount(d.flockSize) && isCount(d.deaths) && d.deaths <= d.flockSize;
}

/**
 * 当日から新しい順に、除外の日と空舎（羽数 0）の日を飛ばして 21 日分を集める（索引 Q1: 当日を含め、
 * 日別の率の平均。索引 Q2: 記録のない日も飛ばす）。判定は「当日の死亡が 1 羽以上で、当日の率が平均の 2 倍以上」。
 * 窓の中か当日に誤った値があれば invalid_input を返し、当たらない扱いにしない。
 */
export function computeMortality(days: readonly MortalityDay[], today: IsoDate): MortalityResult {
  addDays(today, 0); // 当日の形式が違えば RangeError

  const byDate = new Map<IsoDate, MortalityDay[]>();
  const malformedDates: IsoDate[] = [];
  for (const d of days) {
    if (!isIsoDate(d.date)) {
      malformedDates.push(String(d.date));
      continue;
    }
    if (d.date > today) continue;
    const list = byDate.get(d.date);
    if (list) list.push(d);
    else byDate.set(d.date, [d]);
  }

  // 形の不正な日付は、どの日の記録か分からない。当日のつもりかもしれないので、先に返す
  if (malformedDates.length > 0) return { status: "invalid_input", dates: malformedDates };

  const todayRecords = byDate.get(today);
  const todayDay = todayRecords?.[0];
  if (!todayRecords || !todayDay) return { status: "no_record" };
  if (todayRecords.length > 1) return { status: "invalid_input", dates: [today] };
  if (!isExclusionOk(todayDay.exclusion)) return { status: "invalid_input", dates: [today] };
  if (todayDay.exclusion !== null) return { status: "today_excluded", kind: todayDay.exclusion };
  if (isValidDay(todayDay) && todayDay.flockSize === 0) return { status: "today_excluded", kind: "empty" };

  const sortedDates = [...byDate.keys()].sort().reverse();
  const window: MortalityDay[] = [];
  const invalidDates: IsoDate[] = [];
  for (const date of sortedDates) {
    const records = byDate.get(date) ?? [];
    const d = records[0];
    if (!d || records.length > 1) {
      invalidDates.push(date);
      continue;
    }
    if (!isExclusionOk(d.exclusion)) {
      invalidDates.push(date); // 知らない種類を除外として黙って飛ばさない
      continue;
    }
    if (d.exclusion !== null) continue; // 特段の事情の日。値は計算に使わない
    if (!isValidDay(d)) {
      invalidDates.push(date); // 羽数 0 の判定より先に検証する（NaN を空舎として黙って飛ばさない）
      continue;
    }
    if (d.flockSize === 0) continue; // 空舎の日
    window.push(d);
    if (window.length === WINDOW_DAYS) break;
  }

  if (invalidDates.length > 0) return { status: "invalid_input", dates: invalidDates };
  if (window.length < WINDOW_DAYS) return { status: "insufficient", validDays: window.length, needed: WINDOW_DAYS };

  const rates = window.map((d) => d.deaths / d.flockSize);
  const todayRate = rates[0] ?? Number.NaN; // 窓は 21 日そろっているので起きない
  const averageRate = rates.reduce((sum, r) => sum + r, 0) / WINDOW_DAYS;
  const hit = todayDay.deaths > 0 && todayRate >= 2 * averageRate - EPSILON;

  const windowDates = window.map((d) => d.date);
  const oldest = windowDates[windowDates.length - 1] ?? today;
  const skippedMissingDates: IsoDate[] = [];
  for (let date = today; date >= oldest; date = addDays(date, -1)) {
    if (!byDate.has(date)) skippedMissingDates.push(date);
  }

  return { status: "evaluated", todayRate, averageRate, hit, windowDates, skippedMissingDates };
}

/**
 * 記録から計算の入力へ。flockSizeAt と除外の種類を写し、日付順（古い順）にする。入力は書き換えない。
 * 除外が null でなく kind も読めない記録（文字列のまま保存されたなど）は、null に直さず undefined のまま
 * 渡し、computeMortality が invalid_input にする。鶏舎で分けるのは呼ぶ側。
 */
export function toMortalityDays(records: readonly DeathRecord[]): MortalityDay[] {
  return records
    .map((r) => ({
      date: r.date,
      deaths: r.deaths,
      flockSize: r.flockSizeAt,
      exclusion: r.exclusion === null ? null : (r.exclusion?.kind as ExclusionKind),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const MORTALITY_TEXT = {
  insufficient: "まだ計算できません",
  invalidInput: "入力を確かめてください",
  hit: "設備の故障など明らかな理由がなければ、直ちに家畜保健衛生所へ通報してください（基準 項目 32）",
  symptoms:
    "5 羽以上のまとまった死亡やうずくまり、鶏冠や肉垂のチアノーゼ、沈うつ、産卵率の低下など、数字に出ない症状も確かめてください",
  exceptions:
    "指針の留意事項 16 は、明らかに別の事情の例として、概ね 100 羽未満で平均 0 羽のときに 1 羽が死亡して症状がない場合、ひなの死亡、誘導換羽を挙げています。この場合も、翌日に基準に当たれば届け出るよう指導するとされています。この画面は例に当たるかを判定しません",
  definition:
    "告示の定義: 同じ鶏舎で、1 日の死亡率が対象期間の平均の 2 倍以上。対象期間は当日から遡って 21 日間で、特段の事情の日と空舎の日を除いた通算 21 日間です",
  reading: "この計算は当日を平均に含め、日ごとの率を平均しています。読み方に迷うときは家畜保健衛生所へ確かめてください",
} as const;
