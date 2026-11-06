// 同梱のカードを読む。bundle の後は lib/data/consult/ にある（同梱は R2）。
// 形が違えば throw する（黙って落とさない）。呼び手は、次の呼び出しでやり直せるよう、結果を覚えるのは成功したときだけにする。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCardsFile } from "@hpai/shared/consult/types";

export interface ConsultData {
  cards: ConsultCardsFile;
}

export async function loadConsultData(dir: string = path.join(__dirname, "data", "consult")): Promise<ConsultData> {
  const cards = parseCardsFile(JSON.parse(await readFile(path.join(dir, "cards.json"), "utf8")));
  return { cards };
}
