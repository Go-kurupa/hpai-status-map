// 声かけ文の雛形と検査（M-18、設計書 §7）。説明文（M-19）の検査も同じ部品を使う。純粋関数だけ。
// 検査はすべて normalizeForMatch の後。語は ASCII ではなく日本語なので、正規化した語どうしで探す。
import { OFFICIAL_GUIDANCE, type GuidanceTopic, type OfficialGuidance } from "./guidance/official";
import { formatJaDate } from "./jaDate";
import { normalizeForMatch } from "./text";
import type { Case, IsoDate } from "./types";
import { findForbiddenPhrases, REASSURANCE_WORDS, SENSATIONAL_WORDS } from "./wording";

export type DraftStage = "suspected" | "confirmed";

export interface DraftFacts {
  muniName: string;
  date: IsoDate;
  stage: DraftStage;
}

/** 下書きの元になる、公開の事実だけ（市町村、日付、段階）。農場の名前、位置、記録は持たない。 */
export function workerMessageTemplate(f: DraftFacts): string {
  const d = formatJaDate(f.date);
  return f.stage === "suspected"
    ? `${d}、${f.muniName}で鳥インフルエンザの疑いの発表がありました（確定ではありません）。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`
    : `${d}、${f.muniName}で鳥インフルエンザの発生が確認されました。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`;
}

/** 文に書いてよい日付の数字（年、月、日。頭の 0 は付けない。formatJaDate と同じ書き方）。 */
export function dateNumbers(date: IsoDate): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`日付の形が違います（YYYY-MM-DD）: ${date}`);
  formatJaDate(date); // 存在しない日は RangeError
  return [m[1]!, String(Number(m[2])), String(Number(m[3]))];
}

/**
 * 下書きを作ってよい事例か。作ってよいなら元になる事実を返し、そうでなければ null。
 * 確認中（まだ公開していない）、再現、否定、市町村なし、疑いも確定もない事例は作らない。
 * 確定があれば確定の日、なければ疑いの日。
 */
export function draftFactsOf(c: Case): DraftFacts | null {
  if (c.confirmState === "reviewing" || c.confirmState === "replay") return null;
  if (c.negation === "negated") return null;
  if (c.muniCode === null || c.muniName === null || c.muniName === "") return null;
  const stage: DraftStage | null = c.stages.confirmed ? "confirmed" : c.stages.suspected ? "suspected" : null;
  if (stage === null) return null;
  const stamp = c.stages[stage];
  if (!stamp) return null;
  return { muniName: c.muniName, date: stamp.date, stage };
}

export interface CheckResult {
  ok: boolean;
  failures: string[];
}

/** 人の健康を断定する語。 */
const HEALTH = ["感染しません", "感染しない", "うつりません", "うつらない", "受診", "病院", "発症"] as const;

const KANJI_NUMBER = /[〇一二三四五六七八九十百千万億]+(?:羽|キロ|km|件|例|割|%|人)/giu;
const AVOID_VERB = /行かない|行かず|立ち寄らない|近づかない/u;

/** 数、漢数字の数、煽る語、禁句、人の健康。声かけ文と説明文に共通。normalized は正規化済みの文。 */
function commonFailures(normalized: string, allowedNumbers: readonly string[]): string[] {
  const out: string[] = [];
  const allowed = new Set(allowedNumbers);
  for (const n of new Set(normalized.match(/\d+/gu) ?? [])) if (!allowed.has(n)) out.push(`unknown_number:${n}`);
  for (const k of new Set(normalized.match(KANJI_NUMBER) ?? [])) out.push(`unknown_kanji_number:${k}`);
  for (const w of SENSATIONAL_WORDS) if (normalized.includes(normalizeForMatch(w))) out.push(`sensational:${w}`);
  for (const p of findForbiddenPhrases(normalized)) out.push(`forbidden:${p}`);
  for (const w of HEALTH) if (normalized.includes(normalizeForMatch(w))) out.push(`health:${w}`);
  return out;
}

/**
 * 声かけ文の検査。市町村名と日付がある、2 つの核（発生地の近くに行かない、消毒と着替え）がある、
 * 事実にない数字がない、煽る語がない、禁句がない、人の健康を断定しない。
 */
export function checkWorkerMessage(text: string, f: { muniName: string; date: IsoDate; allowedNumbers: readonly string[] }): CheckResult {
  const t = normalizeForMatch(text);
  const failures: string[] = [];
  if (!t.includes(normalizeForMatch(f.muniName))) failures.push("missing_muni");
  const [, month, day] = dateNumbers(f.date);
  // 12月19日 の中の 2月19日 を日付と認めない（直前が数字でないこと）
  if (!new RegExp(`(?<!\\d)${month}月${day}日`, "u").test(t)) failures.push("missing_date");
  if (!(t.includes("近く") && AVOID_VERB.test(t))) failures.push("missing_core_avoid");
  if (!(t.includes("消毒") && t.includes("着替え"))) failures.push("missing_core_disinfect");
  failures.push(...commonFailures(t, f.allowedNumbers));
  return { ok: failures.length === 0, failures };
}

/**
 * 入力にないのに言い切ってはいけないこと（健康、卵や鶏肉、人への影響、心配はいらない、問題ない）の言い方。
 * 語の固定リストでは「食べても問題ありません」「ご心配には及びません」などの言い換えが通るので、語の組み合わせの形で探す。
 * 理由の符号には label（言い回しの種類）だけを入れ、出力の断片は入れない。
 */
// 助詞（は、も、が、には、では、を）と、打ち消しの言い方（ありません、ございません、ない、なし、ゼロ、ほとんど、考えにくい…）を部品にして組み合わせる。
// 「ないよう」「ないため」は打ち消しの言い切りではない（「病気が入らないよう」）ので、ない の直後がそれなら数えない。
const P = "(?:には|では|は|も|が|を)?";
const NEG = "(?:ありません|ございません|ありえません|ない(?!よう|ため|ので|限り|で(?!す))|なし|ゼロ|ほとんど|考えにくい|考えられません|見られません|出ません|及びません)";
const NEG_OR_LOW = `(?:${NEG}|低い|低く(?!なる|する|す)|低め)`;
const ASSURANCES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "問題ないという言い切り", re: new RegExp(`問題${P}${NEG}|問題なく`, "gu") },
  { label: "大丈夫という言い切り", re: new RegExp(REASSURANCE_WORDS.join("|"), "gu") },
  { label: "差し支えないという言い切り", re: new RegExp(`(?:差し支え|支障)${P}${NEG}|支障なく`, "gu") },
  {
    label: "心配いらないという言い切り",
    re: new RegExp(`心配${P}(?:${NEG}|いりません|いらない|要りません|要らない|無用|不要)|心配する必要|心配なさら|ご?心配なく`, "gu"),
  },
  { label: "影響がないという言い切り", re: new RegExp(`影響${P}${NEG}|影響を受けません`, "gu") },
  { label: "害がないという言い切り", re: new RegExp(`害${P}${NEG}|無害`, "gu") },
  {
    label: "うつらないという言い切り",
    re: new RegExp(`(?:感染|うつ[るり]|移[るり])(?:の|する|し)?(?:こと|おそれ|恐れ|可能性|心配|リスク|危険性)${P}${NEG_OR_LOW}`, "gu"),
  },
  { label: "可能性がないという言い切り", re: new RegExp(`(?:可能性|リスク|おそれ|恐れ|危険性)${P}${NEG_OR_LOW}`, "gu") },
];
/** 入力にないのに出たら雛形に戻す話題の語。説明文の農場の部分では、卵や鶏肉、人の健康、感染は書かない。 */
const OUTSIDE_TOPIC = ["卵", "鶏肉", "人体", "健康", "食べ", "感染", "うつる", "うつり"] as const;

/**
 * 近隣への説明文（M-19）の検査。声かけ文の核は求めない。
 * opts.input を渡すと Claude の返事の検査になる: 入力にない話題の語（卵、鶏肉、人体、健康、食べ）と、入力にない言い切りを落とす。
 * opts なしは入力の文自体の検査で、話題の語は見ない（言い切りは見る）。
 */
export function checkNeighborText(text: string, allowedNumbers: readonly string[], opts?: { input?: string }): CheckResult {
  const t = normalizeForMatch(text);
  const failures = commonFailures(t, allowedNumbers);
  const input = opts?.input === undefined ? null : normalizeForMatch(opts.input);
  for (const a of ASSURANCES) {
    // 入力にある言い回し（本人が書いた）は許す。1 つでも入力にないものがあれば落とす
    const bad = [...t.matchAll(a.re)].some((m) => !(input !== null && input.includes(m[0])));
    if (bad) failures.push(`assurance:${a.label}`);
  }
  if (input !== null) {
    for (const w of OUTSIDE_TOPIC) if (t.includes(w) && !input.includes(w)) failures.push(`outside_topic:${w}`);
  }
  return { ok: failures.length === 0, failures };
}

// ---- 近隣への説明文（M-19、設計書 §11）。農場の対策の部分だけを Claude が下書きし、公式の部分は公式の文のまま。 ----

export type NeighborAudience = "meeting" | "circular";

/** 説明文に載せる公式の話題と順番。死んだ鳥と数羽飼っている方は、近隣への説明の話題ではないので入れない。 */
export const NEIGHBOR_TOPICS = ["approach", "human_infection", "food", "burial", "rumor"] as const satisfies readonly GuidanceTopic[];

export interface NeighborOfficialStatement {
  text: string;
  sourceTitle: string;
  sourceUrl: string;
  checkedOn: IsoDate;
  /** 話題の見出し（OFFICIAL_GUIDANCE の heading）。画面でまとまりを示すためだけに付ける */
  heading: string;
}

export interface NeighborDraftResult {
  /** 農場の対策の部分。Claude か雛形 */
  farmPart: string;
  /** OFFICIAL_GUIDANCE の文そのまま。Claude を通さない */
  officialPart: NeighborOfficialStatement[];
  source: "claude" | "template";
  /** 雛形に戻した理由、入力の文の問題の符号。入力の文そのものは入れない */
  failures: string[];
}

/** 公式の部分。NEIGHBOR_TOPICS の順に、文を一字も変えずに並べる。 */
export function neighborOfficialPart(guidance: readonly OfficialGuidance[] = OFFICIAL_GUIDANCE): NeighborOfficialStatement[] {
  const out: NeighborOfficialStatement[] = [];
  for (const topic of NEIGHBOR_TOPICS) {
    const g = guidance.find((x) => x.topic === topic);
    if (!g) continue;
    for (const s of g.statements) {
      out.push({ text: s.text, sourceTitle: s.sourceTitle, sourceUrl: s.sourceUrl, checkedOn: s.checkedOn, heading: g.heading });
    }
  }
  return out;
}

/** 入力の文に書いてある数字だけが、農場の対策の部分に書いてよい数字。検査と同じ正規化の後で数える（全角の数字も同じ数字）。 */
export function neighborAllowedNumbers(measures: string): string[] {
  return [...new Set(normalizeForMatch(measures).match(/\d+/gu) ?? [])];
}

/** 農場の対策の部分の雛形。本人が入れた文をそのまま入れる。 */
export function neighborTemplate(measures: string, audience: NeighborAudience): string {
  const m = measures.trim();
  const head = "当農場では、鳥インフルエンザを持ち込まない、広げないために、次のことに取り組んでいます。";
  return audience === "meeting"
    ? `${head}\n${m}\nご不明な点は、この場でお尋ねください。`
    : `${head}\n${m}\nご不明な点は、下記までご連絡ください。\n問い合わせ先: （　　　　　　　　）`;
}

/**
 * 自分の農場で発生したときの、近隣への知らせの雛形。Claude を呼ばない固定の文。
 * 日付、疑いか確認か、問い合わせ先は空欄で、本人が埋める。数字は書かない。
 */
export function ownOutbreakNoticeTemplate(): string {
  return [
    "近隣の皆さまへ",
    "",
    "（　　月　　日）、当農場の鶏について、鳥インフルエンザの【疑い／発生の確認】がありました。現在、家畜保健衛生所や県の指示に従って、防疫の作業を進めています。",
    "",
    "皆さまにお願いがあります。",
    "・農場には、近づかないでください。見に来ること、写真や動画を撮ること、敷地に入ることは、ご遠慮ください。人や車がウイルスを運んでしまうおそれがあり、防疫の作業の妨げにもなります。",
    "・根拠のない噂が広がらないよう、ご協力をお願いします。",
    "",
    "今後のことは、わかり次第お知らせします。",
    "",
    "問い合わせ先: （　　　　　　　　）",
  ].join("\n");
}
