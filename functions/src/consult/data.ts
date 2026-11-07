// 同梱のカードと過去の事例を読む。bundle の後は lib/data/consult/ と lib/data/history/ にある（同梱は R2、過去の事例は契約 1.3）。
// 形が違えば throw する（黙って落とさない）。呼び手は、次の呼び出しでやり直せるよう、結果を覚えるのは成功したときだけにする。
// 過去の事例は、発生の件数の表（shared/src/consult/stats.ts）を数えるためだけに使う。Claude には渡さない。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCardsFile } from "@hpai/shared/consult/types";
import type { HistoryCase } from "@hpai/shared/types";

export interface ConsultData {
  cards: ConsultCardsFile;
  history: readonly HistoryCase[];
}

export async function loadConsultData(
  dir: string = path.join(__dirname, "data", "consult"),
  historyFile: string = path.join(__dirname, "data", "history", "cases.json"),
): Promise<ConsultData> {
  const cards = parseCardsFile(JSON.parse(await readFile(path.join(dir, "cards.json"), "utf8")));
  const history: unknown = JSON.parse(await readFile(historyFile, "utf8"));
  if (!Array.isArray(history)) throw new Error("過去の事例の形が違います");
  return { cards, history: history as HistoryCase[] };
}
