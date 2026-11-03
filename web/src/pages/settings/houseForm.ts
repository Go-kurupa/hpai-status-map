// 鶏舎の入力の純粋な部分（設計書 §8）。画面は文字で受け取り、ここで House にする。
import type { House } from "@hpai/shared/types";

/** 鳥の種類【計】。死亡数の報告文はこの語で集計する。語を変えると過去の鶏舎と合わなくなる */
export const BIRD_TYPES: readonly string[] = ["採卵鶏", "肉用鶏", "種鶏", "あひる", "うずら", "その他"];

export const HOUSE_NAME_MAX = 40;

export interface HouseInput {
  name: string;
  birdType: string;
  /** 画面の入力欄の文字のまま */
  flockSize: string;
  empty: boolean;
}

export type ParsedHouse = { ok: true; house: House } | { ok: false; errors: string[] };

/**
 * 入力を House にする。直せるように、拒む理由は全部返す。
 * - 羽数は 0 以上の整数だけ。全角の数字は半角として読む【計】。文字、符号、小数、空は拒む。
 * - 0 羽は空舎のときだけ通す。空舎の羽数は 0 に決め、空にも 1 以上にもしない
 *   （羽数が未設定の鶏舎と、鶏がいない空舎を混ぜない。死亡率の計算が空舎の日を除くため）。
 */
export function parseHouseInput(i: HouseInput): ParsedHouse {
  const errors: string[] = [];

  const name = i.name.trim();
  if (name === "") errors.push("鶏舎の名前を入れてください");
  else if (name.length > HOUSE_NAME_MAX) errors.push(`鶏舎の名前は ${HOUSE_NAME_MAX} 文字までにしてください`);

  if (i.birdType === "") errors.push("鳥の種類を選んでください");
  else if (!BIRD_TYPES.includes(i.birdType)) errors.push("鳥の種類は一覧から選んでください");

  let flockSize = 0;
  const digits = i.flockSize.normalize("NFKC").trim();
  if (digits === "") {
    errors.push("飼養羽数を入れてください（鶏がいないときは空舎にして 0 羽）");
  } else if (!/^\d+$/.test(digits) || !Number.isSafeInteger(Number(digits)) || Number(digits) > 100_000_000) {
    errors.push("飼養羽数は 0 以上の整数で、数字だけで入れてください");
  } else {
    flockSize = Number(digits);
    if (i.empty && flockSize !== 0) errors.push("空舎の羽数は 0 羽にしてください。鶏を入れるときは空舎を外します");
    else if (!i.empty && flockSize === 0) errors.push("0 羽にできるのは空舎のときだけです。鶏がいないときは空舎にしてください");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, house: { name, birdType: i.birdType, flockSize, empty: i.empty } };
}
