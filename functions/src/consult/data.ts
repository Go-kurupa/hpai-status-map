// 同梱のカードと条件の問いを読む。bundle の後は lib/data/consult/ にある（同梱は Task 8）。
// 形が違えば throw する（黙って落とさない）。呼び手は、次の呼び出しでやり直せるよう、結果を覚えるのは成功したときだけにする。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseCardsFile } from "@hpai/shared/consult/schema";
import type { ConsultCardsFile, ConsultQuestion } from "@hpai/shared/consult/types";

const text = z.string().trim().min(1);
const questionsSchema = z.array(
  z.strictObject({
    id: text,
    text,
    options: z.array(z.strictObject({ id: text, label: text, tags: z.array(text) })).min(1),
  }),
);

export interface ConsultData {
  cards: ConsultCardsFile;
  questions: ConsultQuestion[];
}

export async function loadConsultData(dir: string = path.join(__dirname, "data", "consult")): Promise<ConsultData> {
  const cards = parseCardsFile(JSON.parse(await readFile(path.join(dir, "cards.json"), "utf8")));
  const questions = questionsSchema.parse(JSON.parse(await readFile(path.join(dir, "questions.json"), "utf8")));
  return { cards, questions };
}
