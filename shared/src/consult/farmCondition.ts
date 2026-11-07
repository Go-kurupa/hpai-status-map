// 相談に付ける農場の条件（飼育目的と飼い方）。画面（表示・送る前の食い違いの確認・記録の読み込み）と関数（入力の検査）が同じものを使う。
// 条件は本人が農場の設定に登録し、相談のたびに「この飼い方で相談する」を選んだときだけ送る。登録のない側は推測で埋めない。
// 鶏舎の造り（housing）、農場名、場所、記録は条件に入れない。
import type { FarmRearing, Production } from "../types";
import type { ConsultFarmCondition } from "./types";

export const PRODUCTION_VALUES = ["layer", "broiler"] as const satisfies readonly Production[];
export const REARING_VALUES = ["cage", "floor"] as const satisfies readonly FarmRearing[];

/** 条件の表示の語（国の事例一覧 data/history/cases.json の語と同じ）。Claude にもこの語で渡す */
export const CONDITION_PRODUCTION_LABEL: Record<Production, string> = { layer: "採卵鶏", broiler: "肉用鶏" };
export const REARING_LABEL: Record<FarmRearing, string> = { cage: "ケージ飼い", floor: "平飼い" };

/** 農場の登録から条件を作る。どちらも未登録なら null。飼い方の項目がない古い農場は、飼い方を未登録として扱う */
export function conditionOfFarm(farm: { production: Production | null; rearing?: FarmRearing | null }): ConsultFarmCondition | null {
  const c: ConsultFarmCondition = {
    ...(farm.production ? { production: farm.production } : {}),
    ...(farm.rearing ? { rearing: farm.rearing } : {}),
  };
  return c.production || c.rearing ? c : null;
}

/** 「採卵鶏・平飼い」。登録された分だけ */
export function conditionLabel(c: ConsultFarmCondition): string {
  return [c.production ? CONDITION_PRODUCTION_LABEL[c.production] : null, c.rearing ? REARING_LABEL[c.rearing] : null].filter((x) => x !== null).join("・");
}

/** 登録の表示。未登録の側は「未登録」と書く。どちらもなければ「未登録」 */
export function registeredLabel(farm: { production: Production | null; rearing?: FarmRearing | null }): string {
  const rearing = farm.rearing ?? null;
  if (!farm.production && !rearing) return "未登録";
  const p = farm.production ? CONDITION_PRODUCTION_LABEL[farm.production] : "飼育目的は未登録";
  const r = rearing ? REARING_LABEL[rearing] : "飼い方は未登録";
  return `${p}・${r}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isIn = <T extends string>(values: readonly T[], v: unknown): v is T => typeof v === "string" && (values as readonly string[]).includes(v);

/**
 * 送られてきた条件の検査。項目なし・null は条件なし。null の項目は落とす。
 * 列挙の外の値、型の違い、余計な項目（housing、農場名など）、空の条件（{} やすべて null）は拒む（{ ok: false }）。
 */
export function parseFarmCondition(raw: unknown): { ok: true; value: ConsultFarmCondition | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isRecord(raw)) return { ok: false };
  if (Object.keys(raw).some((k) => k !== "production" && k !== "rearing")) return { ok: false };
  const p = raw["production"] ?? null;
  const r = raw["rearing"] ?? null;
  if (p !== null && !isIn(PRODUCTION_VALUES, p)) return { ok: false };
  if (r !== null && !isIn(REARING_VALUES, r)) return { ok: false };
  const value: ConsultFarmCondition = { ...(p !== null ? { production: p } : {}), ...(r !== null ? { rearing: r } : {}) };
  if (!value.production && !value.rearing) return { ok: false };
  return { ok: true, value };
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
