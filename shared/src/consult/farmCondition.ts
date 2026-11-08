// 相談に付ける農場の条件。画面（表示・送る前の食い違いの確認・記録の読み込み）と関数（入力の検査・Claude への行）と評価（scripts/consult/eval.ts）が同じものを使う。
// 条件は本人が農場の設定に登録し、相談のたびに「登録した農場の情報で相談する」を選んだときだけ送る。登録のない側は推測で埋めない。
// 2026-11-08 豪さんの決定: 飼育目的・飼い方に加えて、町（市町村コード。名前は関数が索引から引く）、近くの発生の状況
// （約 60 km 以内の今季の件数と、区域に入っている可能性）、鶏舎ごとの鳥の種類と飼養羽数と空舎かどうかを送る。
// 約 1km のマス目、緯度経度、農場の名前、鶏舎の名前、鶏舎の造り（housing）、記録は送らない。羽数の幅（scale）は送らない（古い記録の表示だけ）。
import { DISTANCE_BAND_KM } from "../level";
import { PREFS } from "../pref";
import type { FarmRearing, MuniCode, PrefCode, Production } from "../types";
import type { ConsultBirdType, ConsultFarmCondition, ConsultFarmUsed, ConsultHouse, ConsultNearby, ConsultZone, FlockScale } from "./types";

export const PRODUCTION_VALUES = ["layer", "broiler"] as const satisfies readonly Production[];
export const REARING_VALUES = ["cage", "floor"] as const satisfies readonly FarmRearing[];
/** 鳥の種類。農場の設定の鶏舎の一覧（web/src/pages/settings/houseForm.ts の BIRD_TYPES）と同じ語・同じ並び */
export const CONSULT_BIRD_TYPES = ["採卵鶏", "肉用鶏", "種鶏", "あひる", "うずら", "その他"] as const satisfies readonly ConsultBirdType[];
export const ZONE_VALUES = ["possible", "none"] as const satisfies readonly ConsultZone[];
/** 古い記録の羽数の幅（表示だけ） */
export const SCALE_VALUES = ["under1000", "1000to3000", "over3000"] as const satisfies readonly FlockScale[];

/** 送れる鶏舎の数 */
export const CONSULT_MAX_HOUSES = 30;
/** 送れる 1 つの鶏舎の飼養羽数の上限 */
export const CONSULT_MAX_FLOCK = 1_000_000;
/** 送れる近くの発生の件数の上限 */
export const CONSULT_MAX_NEARBY = 999;
/** 記録に残す町の名前の長さの上限（文字の数） */
const TOWN_MAX = 40;

/** 条件の表示の語（国の事例一覧 data/history/cases.json の語と同じ）。Claude にもこの語で渡す */
export const CONDITION_PRODUCTION_LABEL: Record<Production, string> = { layer: "採卵鶏", broiler: "肉用鶏" };
export const REARING_LABEL: Record<FarmRearing, string> = { cage: "ケージ飼い", floor: "平飼い" };
/** 区域に入っている可能性の表示の語。Claude にもこの語で渡す。none は「ない」と請け合わず、計算で見つかっていないと書く */
export const ZONE_LABEL: Record<ConsultZone, string> = { possible: "区域に入っている可能性あり", none: "区域に入っている可能性は見つかっていない" };
/** 古い記録の羽数の幅の表示の語。ちょうど 3,000 羽は「3,000 羽以上」 */
export const SCALE_LABEL: Record<FlockScale, string> = { under1000: "1,000 羽未満", "1000to3000": "1,000〜2,999 羽", over3000: "3,000 羽以上" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isIn = <T extends string>(values: readonly T[], v: unknown): v is T => typeof v === "string" && (values as readonly string[]).includes(v);
const isIntIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const MUNI_CODE = /^\d{5}$/u;

/** 1200 → "1,200" */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** 鶏舎 1 つの検査。strict（送られてきた形）は余計な項目（名前など）を拒む。登録から作るときは必要な項目だけを拾う */
function houseOf(h: unknown, strict: boolean): ConsultHouse | null {
  if (!isRecord(h)) return null;
  if (strict && Object.keys(h).some((k) => k !== "birdType" && k !== "flockSize" && k !== "empty")) return null;
  const { birdType, flockSize, empty } = h;
  if (!isIn(CONSULT_BIRD_TYPES, birdType) || !isIntIn(flockSize, 0, CONSULT_MAX_FLOCK) || typeof empty !== "boolean") return null;
  return { birdType, flockSize, empty };
}

/**
 * 登録した鶏舎の一覧から、送る鶏舎を作る（名前は落とす。並びは一覧の順で、番号はこの順）。
 * 鶏舎が 0 件、30 件を超える、1 つでも読めない（鳥の種類が一覧の外、羽数が 0〜1,000,000 の整数でない、空舎かどうかが読めない）ときは null
 * （読めた分だけを送ると、農場の羽数を少なく見せた推測になるので送らない）。
 */
export function housesOfFarm(houses: readonly unknown[]): ConsultHouse[] | null {
  if (houses.length === 0 || houses.length > CONSULT_MAX_HOUSES) return null;
  const out: ConsultHouse[] = [];
  for (const h of houses) {
    const x = houseOf(h, false);
    if (!x) return null;
    out.push(x);
  }
  return out;
}

/**
 * 農場の登録から条件を作る。飼育目的も飼い方も未登録なら null（町や鶏舎だけの条件は作らない）。飼い方の項目がない古い農場は、飼い方を未登録として扱う。
 * muniCode は 5 桁のときだけ入れる。houses（housesOfFarm の結果）と nearby（画面が対策項目と同じ計算で出したもの）は、null なら入れない。
 */
export function conditionOfFarm(
  farm: { production: Production | null; rearing?: FarmRearing | null; muniCode?: MuniCode | null },
  extra: { houses?: readonly ConsultHouse[] | null; nearby?: ConsultNearby | null } = {},
): ConsultFarmCondition | null {
  if (!farm.production && !farm.rearing) return null;
  return {
    ...(farm.production ? { production: farm.production } : {}),
    ...(farm.rearing ? { rearing: farm.rearing } : {}),
    ...(typeof farm.muniCode === "string" && MUNI_CODE.test(farm.muniCode) ? { muniCode: farm.muniCode } : {}),
    ...(extra.nearby ? { nearby: { casesWithin60km: extra.nearby.casesWithin60km, zone: extra.nearby.zone } } : {}),
    ...(extra.houses && extra.houses.length > 0 ? { houses: extra.houses.map((h) => ({ birdType: h.birdType, flockSize: h.flockSize, empty: h.empty })) } : {}),
  };
}

const CONDITION_KEYS: ReadonlySet<string> = new Set(["production", "rearing", "muniCode", "nearby", "houses"]);

/**
 * 送られてきた条件の検査。項目なし・null は条件なし。null の項目は落とす。
 * 拒む（{ ok: false }）もの: 列挙の外の値、型の違い、知らない項目（housing、農場名、マス目、町の名前、羽数の幅など）、空の条件、
 * 飼育目的も飼い方もない条件、5 桁でない市町村コード、件数が 0〜999 の整数でない・区域の可能性が列挙の外・余計な項目のある nearby、
 * 0 件か 30 件を超える鶏舎、鳥の種類が一覧の外・羽数が 0〜1,000,000 の整数でない・余計な項目（名前など）のある鶏舎。
 */
export function parseFarmCondition(raw: unknown): { ok: true; value: ConsultFarmCondition | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isRecord(raw)) return { ok: false };
  if (Object.keys(raw).some((k) => !CONDITION_KEYS.has(k))) return { ok: false };
  const p = raw["production"] ?? null;
  const r = raw["rearing"] ?? null;
  const m = raw["muniCode"] ?? null;
  const n = raw["nearby"] ?? null;
  const hs = raw["houses"] ?? null;
  if (p !== null && !isIn(PRODUCTION_VALUES, p)) return { ok: false };
  if (r !== null && !isIn(REARING_VALUES, r)) return { ok: false };
  if (p === null && r === null) return { ok: false };
  if (m !== null && (typeof m !== "string" || !MUNI_CODE.test(m))) return { ok: false };
  let nearby: ConsultNearby | null = null;
  if (n !== null) {
    if (!isRecord(n) || Object.keys(n).some((k) => k !== "casesWithin60km" && k !== "zone")) return { ok: false };
    const count = n["casesWithin60km"];
    const zone = n["zone"];
    if (!isIntIn(count, 0, CONSULT_MAX_NEARBY) || !isIn(ZONE_VALUES, zone)) return { ok: false };
    nearby = { casesWithin60km: count, zone };
  }
  let houses: ConsultHouse[] | null = null;
  if (hs !== null) {
    if (!Array.isArray(hs) || hs.length === 0 || hs.length > CONSULT_MAX_HOUSES) return { ok: false };
    houses = [];
    for (const h of hs) {
      const x = houseOf(h, true);
      if (!x) return { ok: false };
      houses.push(x);
    }
  }
  const value: ConsultFarmCondition = {
    ...(p !== null ? { production: p } : {}),
    ...(r !== null ? { rearing: r } : {}),
    ...(m !== null ? { muniCode: m } : {}),
    ...(nearby ? { nearby } : {}),
    ...(houses ? { houses } : {}),
  };
  return { ok: true, value };
}

/**
 * 記録に残った「今回使った条件」の検査（画面の記録の読み込み）。送る形（parseFarmCondition）に、関数が足した町の名前（town）と、
 * 2026-11-08 より前の記録の羽数の幅（scale）を許す。それ以外は parseFarmCondition と同じに拒む。通らなければ null。
 */
export function parseStoredFarm(raw: unknown): ConsultFarmUsed | null {
  if (!isRecord(raw)) return null;
  const { town, scale, ...rest } = raw;
  if (town !== undefined && (typeof town !== "string" || town === "" || Array.from(town).length > TOWN_MAX)) return null;
  if (scale !== undefined && !isIn(SCALE_VALUES, scale)) return null;
  const r = parseFarmCondition(rest);
  if (!r.ok || r.value === null) return null;
  return { ...r.value, ...(town !== undefined ? { town } : {}), ...(scale !== undefined ? { scale } : {}) };
}

/** 地理の索引（data/geo/muni-index.json）の 1 行のうち、町の名前に使う分 */
export type MuniNameIndex = Readonly<Record<MuniCode, { name: string; prefCode: PrefCode }>>;

/** 市町村コードから「岡山県西粟倉村」。索引にないコード、県が分からないときは null */
export function townNameOf(index: MuniNameIndex, code: MuniCode): string | null {
  if (!Object.hasOwn(index, code)) return null;
  const e = index[code]!;
  const pref = PREFS.find((x) => x.code === e.prefCode);
  if (!pref || typeof e.name !== "string" || e.name === "") return null;
  return `${pref.name}${e.name}`;
}

/** 近くの発生の表示の語。「約 60 km 以内の今季の発生 2 件（区域に入っている可能性あり）」 */
export function nearbyLabel(n: ConsultNearby): string {
  return `約 ${DISTANCE_BAND_KM} km 以内の今季の発生 ${formatCount(n.casesWithin60km)} 件（${ZONE_LABEL[n.zone]}）`;
}

/** 鶏舎 1 つの語（番号は 1 から）。「鶏舎 1: 採卵鶏 1,200 羽」「鶏舎 3: 採卵鶏 空舎」 */
export function houseLabel(h: ConsultHouse, i: number): string {
  return `鶏舎 ${i + 1}: ${h.birdType} ${h.empty ? "空舎" : `${formatCount(h.flockSize)} 羽`}`;
}

/** 「採卵鶏・平飼い・岡山県西粟倉村・約 60 km 以内の…・鶏舎 1: 採卵鶏 1,200 羽、鶏舎 2: …」。あるものだけ。古い記録の幅は最後 */
export function conditionLabel(c: ConsultFarmUsed): string {
  return [
    c.production ? CONDITION_PRODUCTION_LABEL[c.production] : null,
    c.rearing ? REARING_LABEL[c.rearing] : null,
    c.town ?? null,
    c.nearby ? nearbyLabel(c.nearby) : null,
    c.houses && c.houses.length > 0 ? c.houses.map(houseLabel).join("、") : null,
    c.scale ? SCALE_LABEL[c.scale] : null,
  ]
    .filter((x) => x !== null)
    .join("・");
}

/** 登録の表示（飼育目的と飼い方）。未登録の側は「未登録」と書く。どちらもなければ「未登録」 */
export function registeredLabel(farm: { production: Production | null; rearing?: FarmRearing | null }): string {
  const rearing = farm.rearing ?? null;
  if (!farm.production && !rearing) return "未登録";
  const p = farm.production ? CONDITION_PRODUCTION_LABEL[farm.production] : "飼育目的は未登録";
  const r = rearing ? REARING_LABEL[rearing] : "飼い方は未登録";
  return `${p}・${r}`;
}

/** Claude に渡す farm の行。表示と同じ語。ないものは入れない */
export interface FarmPromptRow {
  production?: string;
  rearing?: string;
  town?: string;
  nearby?: { casesWithin60km: string; zone: string };
  houses?: string[];
}

/** 関数が検査し町の名前を足した条件から、Claude に渡す行を作る（農場の名前・鶏舎の名前・マス目は元からない。古い幅は渡さない） */
export function farmPromptRow(c: ConsultFarmUsed): FarmPromptRow {
  return {
    ...(c.production ? { production: CONDITION_PRODUCTION_LABEL[c.production] } : {}),
    ...(c.rearing ? { rearing: REARING_LABEL[c.rearing] } : {}),
    ...(c.town ? { town: c.town } : {}),
    ...(c.nearby ? { nearby: { casesWithin60km: `約 ${DISTANCE_BAND_KM} km 以内の今季の発生 ${formatCount(c.nearby.casesWithin60km)} 件`, zone: ZONE_LABEL[c.nearby.zone] } } : {}),
    ...(c.houses && c.houses.length > 0 ? { houses: c.houses.map(houseLabel) } : {}),
  };
}

/**
 * 答えの数字の検査（validateAsk の extraText）に足す数。答えが条件を言い直しても落とさないため（以前「3,000 羽以上」で落ちた件と同じ）。
 * 足すのは、実際に渡したものだけ: 鶏舎の番号（渡した棟数まで。2 棟なら 1 と 2）、飼育中の鶏舎の羽数とその合計（2 棟以上のとき）、
 * 近くの発生の件数と距離（約 60 km）。町の名前の文や、鶏舎の行の文そのものは入れない（行の中の数字がどこでも通らないように）。
 * 3 桁区切りは validateAsk が 1 つの数として読むので、コンマなしの数で足す。
 */
export function farmNumberTexts(c: ConsultFarmUsed): string[] {
  const out: string[] = [];
  if (c.houses && c.houses.length > 0) {
    out.push(...c.houses.map((_, i) => String(i + 1)));
    const stocked = c.houses.filter((h) => !h.empty);
    out.push(...stocked.map((h) => String(h.flockSize)));
    if (stocked.length > 1) out.push(String(stocked.reduce((a, h) => a + h.flockSize, 0)));
  }
  if (c.nearby) out.push(String(c.nearby.casesWithin60km), String(DISTANCE_BAND_KM));
  return [...new Set(out)];
}

/** 質問の文と登録の食い違い。inQuestion は質問の側の語、registered は登録の語 */
export interface FarmConflict {
  field: "production" | "rearing";
  inQuestion: string;
  registered: string;
}

// 質問に書かれた飼い方・飼育目的の語。「ケージフリー」（ケージ飼いではない）と「パッケージ」（語の一部）は先に除く
const FLOOR_WORD = /平飼/u;
const CAGE_WORD = /ケージ|ゲージ飼/u;
const CAGE_FREE = /ケージフリー|ゲージフリー|パッケージ/gu;
// 「卵」だけでは止めない（肉用の種鶏の「種卵」など）。採卵の仕事を指す語だけ
const LAYER_WORD = /採卵|産卵|鶏卵|卵の出荷|集卵|卵用/u;
const BROILER_WORD = /肉用|肉鶏|ブロイラー/u;

/**
 * 条件を付けて送る前に、質問の文と登録が食い違っていないかを見る。食い違いがあれば、送らずに本人に訂正を促す（勝手に決めない）。
 * 登録のない側は比べない。全角・半角の違いは揃えてから見る。
 */
export function findFarmConflicts(question: string, c: ConsultFarmCondition): FarmConflict[] {
  const q = question.normalize("NFKC");
  const out: FarmConflict[] = [];
  if (c.production === "broiler" && LAYER_WORD.test(q)) out.push({ field: "production", inQuestion: "採卵", registered: CONDITION_PRODUCTION_LABEL.broiler });
  if (c.production === "layer" && BROILER_WORD.test(q)) out.push({ field: "production", inQuestion: "肉用", registered: CONDITION_PRODUCTION_LABEL.layer });
  if (c.rearing === "cage" && FLOOR_WORD.test(q)) out.push({ field: "rearing", inQuestion: REARING_LABEL.floor, registered: REARING_LABEL.cage });
  if (c.rearing === "floor" && CAGE_WORD.test(q.replace(CAGE_FREE, ""))) out.push({ field: "rearing", inQuestion: REARING_LABEL.cage, registered: REARING_LABEL.floor });
  return out;
}
