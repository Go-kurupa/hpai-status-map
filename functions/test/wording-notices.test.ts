// X-20: 全ての出来事と段階のメールの文面に、禁句がなく、県の連絡が正です、配信停止のリンク、出典がある。
// 純粋な試験（模擬環境は使わない）。配信停止のリンクは、送る側が使う unsubscribeUrlFor で作り、署名が通ることまで確かめる。
// 出典は「県の発表: URL」「発表: URL」の行。出来事ごとに Notice.facts.sourceUrl があれば出る。
import { describe, expect, it } from "vitest";
import { baseNotices, DATA_NOT_INSTRUCTION, DROPPED_NOTICE, staleNotice } from "@hpai/shared/api";
import {
  HEALTH_STANDARD_SOURCE_URL,
  mortalityNotices,
  renderMorningDigest,
  renderNotice,
  selfCheckDueNotices,
  type Notice,
  type NoticeEvent,
} from "@hpai/shared/notices";
import type { Farm, Level, LevelReasonKind } from "@hpai/shared/types";
import { normalizeForMatch } from "@hpai/shared/text";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { unsubscribeUrlFor } from "../src/notify/dispatch";
import { verifyUnsubscribe } from "../src/notify/unsubscribeSig";

const SECRET = "test-unsubscribe-secret";
/**
 * 過去の発生について言わないこと（設計書 §11 の表の「言わないこと」）。web/e2e/wording.helper.ts の PAST_NG_PATTERNS と同じ内容。
 * （helper は DOM の型を使う画面の試験の部品で、DOM の型のない tsconfig からは import できないので、写している）
 */
const PAST_NG: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "また発生しやすい", re: /また発生しやすい/u },
  { label: "この町も危ない", re: /この町も危ない/u },
  { label: "隣町からうつる", re: /隣町からうつる/u },
  { label: "危険地帯", re: /危険地帯/u },
  { label: "ホットスポット", re: /ホットスポット/u },
  { label: "X km 以内なら感染確率は Y%", re: /\d+(?:\.\d+)?km以内なら|感染確率は?\d+(?:\.\d+)?%/u },
  { label: "発生の N 割は農場間", re: /発生の\d+割は農場間/u },
];

/** 禁句と過去の発生の NG の語。見つかった語の一覧 */
function findWordingViolations(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return [...findForbiddenPhrases(text), ...PAST_NG.filter((p) => p.re.test(normalized)).map((p) => p.label)];
}

const APP_URL = "https://app.example.test";
const SOURCE = "https://www.pref.example.test/page/1.html";
const urlOf = (n: Pick<Notice, "farmId" | "uid">) => unsubscribeUrlFor(n, { appUrl: APP_URL, unsubscribeSecret: SECRET });
const ctxOf = (n: Pick<Notice, "farmId" | "uid">) => ({ unsubscribeUrl: urlOf(n), appUrl: APP_URL });

const CASE_EVENTS = ["suspected", "confirmed", "negated", "shipment_lifted", "movement_lifted", "reviewing"] as const;
const LEVELS: Array<Level | null> = [1, 2, 3, 4, null];
const KINDS: Array<LevelReasonKind | null> = ["within_radius", "same_muni", "adjacent", "frequent", null];

function notice(event: NoticeEvent, over: Partial<Notice> = {}): Notice {
  return {
    farmId: "f1",
    uid: "u1",
    subjectId: "c1",
    event,
    timing: "immediate",
    level: null,
    relationKind: null,
    facts: {
      muniName: event === "reviewing" ? null : "津山市",
      prefCode: "33",
      date: "2025-12-20",
      sourceUrl: SOURCE,
    },
    isCorrection: false,
    ...over,
  };
}

/** 事例の出来事 × 段階 × 理由 × 訂正 の全ての組み合わせ */
function caseNotices(): Notice[] {
  const out: Notice[] = [];
  for (const event of CASE_EVENTS) {
    for (const level of LEVELS) {
      for (const relationKind of KINDS) {
        for (const isCorrection of [false, true]) out.push(notice(event, { level, relationKind, isCorrection }));
      }
    }
  }
  return out;
}

/** 本物の作り方で作った、野鳥、自己点検の期限、死亡率の基準の知らせ */
function otherNotices(): Notice[] {
  const farm: Farm & { id: string } = {
    id: "f1",
    name: "架空の農場",
    memberUids: ["u1"],
    unsubscribedUids: [],
    meshCode: "52344160",
    muniCode: "33203",
    prefCode: "33",
    frequentMuniCodes: [],
    production: "layer",
    housing: "windowless",
    kahoContact: "",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: 3 },
    selfCheckDue: { "2025-12": "2025-12-31" },
    updatedAt: "2025-12-30T09:00:00+09:00",
  };
  const selfCheck = selfCheckDueNotices(farm, "2025-12-30", []);
  const mortality = mortalityNotices(farm, "death-1", "2025-12-30");
  const wild = notice("wild_bird_confirmed", { timing: "morning", facts: { muniName: "津山市", prefCode: "33", date: "2025-12-20", sourceUrl: SOURCE } });
  return [...selfCheck, ...mortality, wild];
}

const labelOf = (n: Notice) => `${n.event}/level=${n.level}/kind=${n.relationKind}/訂正=${n.isCorrection}`;

/** メール 1 通（件名と本文）の検査。問題の一覧を返す */
function problemsOf(mail: { subject: string; text: string }, n: Notice, opts: { source: boolean }): string[] {
  const all = `${mail.subject}\n${mail.text}`;
  const out: string[] = [];
  for (const w of findWordingViolations(all)) out.push(`禁句「${w}」`);
  if (!all.includes(FIXED_TEXT.prefContactIsAuthority)) out.push("「県の連絡が正です」がない");
  const link = urlOf(n);
  if (!mail.text.includes(`配信停止: ${link}`)) out.push("配信停止のリンクがない");
  if (opts.source && !/(県の発表|発表|出典): https?:\/\/\S+/u.test(mail.text)) out.push("出典の行がない");
  return out;
}

describe("配信停止のリンク（送る側が作るもの）", () => {
  it("unsubscribeUrlFor の署名が verifyUnsubscribe で通る（試験の前提）", () => {
    const n = notice("confirmed");
    const url = new URL(urlOf(n));
    expect(url.origin + url.pathname).toBe(`${APP_URL}/unsubscribe`);
    expect(verifyUnsubscribe(url.searchParams.get("farm")!, url.searchParams.get("uid")!, url.searchParams.get("sig")!, SECRET)).toBe(true);
  });
});

describe("1 通のメール: 全ての出来事と段階", () => {
  it("組み合わせを数えている（空の走査で通らない）", () => {
    expect(caseNotices()).toHaveLength(CASE_EVENTS.length * LEVELS.length * KINDS.length * 2);
    expect(otherNotices().map((n) => n.event).sort()).toEqual(["mortality_hit", "self_check_due", "wild_bird_confirmed"]);
  });

  it.each(CASE_EVENTS)("%s: 禁句がなく、県の連絡が正です、配信停止のリンクがある", (event) => {
    const problems: string[] = [];
    for (const n of caseNotices().filter((x) => x.event === event)) {
      for (const p of problemsOf(renderNotice(n, ctxOf(n)), n, { source: false })) problems.push(`${labelOf(n)}: ${p}`);
    }
    expect(problems).toEqual([]);
  });

  it.each(CASE_EVENTS)("%s: 出典（県の発表の URL）の行がある", (event) => {
    const problems: string[] = [];
    for (const n of caseNotices().filter((x) => x.event === event)) {
      const { text } = renderNotice(n, ctxOf(n));
      if (!text.includes(`県の発表: ${SOURCE}`)) problems.push(labelOf(n));
    }
    expect(problems).toEqual([]);
  });

  it("野鳥、自己点検の期限、死亡率の基準: 禁句がなく、県の連絡が正です、配信停止のリンクがある", () => {
    const problems: string[] = [];
    for (const n of otherNotices()) {
      for (const p of problemsOf(renderNotice(n, ctxOf(n)), n, { source: true })) problems.push(`${labelOf(n)}: ${p}`);
    }
    expect(problems).toEqual([]);
  });

  // 設計書 §16「メール」の欄は出典を求める。自己点検の期限と死亡率の基準の知らせは、法令（家畜伝染病予防法施行規則）の URL を出典の行に出す。
  it.each(["wild_bird_confirmed", "self_check_due", "mortality_hit"] as const)("%s: 出典の行がある", (event) => {
    const n = otherNotices().find((x) => x.event === event)!;
    const { text } = renderNotice(n, ctxOf(n));
    expect(text, `${event} の本文`).toMatch(/(県の発表|発表|出典): https?:\/\/\S+/u);
    if (event !== "wild_bird_confirmed") expect(text).toContain(`出典: ${HEALTH_STANDARD_SOURCE_URL}`);
  });
});

describe("朝のまとめ", () => {
  it("全ての出来事を 1 通にまとめても、禁句がなく、県の連絡が正です、配信停止のリンクが 1 回ある", () => {
    const list = [...CASE_EVENTS.map((e) => notice(e, { level: 1, relationKind: "same_muni", subjectId: `c-${e}` })), ...otherNotices()];
    const mail = renderMorningDigest(list, ctxOf(list[0]!));
    expect(problemsOf(mail, list[0]!, { source: false })).toEqual([]);
    expect(mail.text.split("配信停止:").length - 1).toBe(1);
    expect(mail.text).toContain(`出典: ${HEALTH_STANDARD_SOURCE_URL}`); // 自己点検の期限、死亡率の基準の件
  });

  it.each(LEVELS.filter((l): l is Level => l !== null))("段階 %s の疑い、確定、否定、解除をまとめても、禁句がない", (level) => {
    const list = (["suspected", "confirmed", "negated", "shipment_lifted", "movement_lifted"] as const).map((e) =>
      notice(e, { level, relationKind: level === 3 ? "frequent" : level === 2 ? "adjacent" : "within_radius", subjectId: "c1", timing: "morning" }),
    );
    const mail = renderMorningDigest(list, ctxOf(list[0]!));
    expect(problemsOf(mail, list[0]!, { source: false })).toEqual([]);
  });

  it("まとめた各件に出典の行がある（事例の件は県の発表の URL）", () => {
    const list = CASE_EVENTS.filter((e) => e !== "reviewing").map((e) => notice(e, { level: 1, relationKind: "same_muni", subjectId: `c-${e}`, timing: "morning" }));
    const { text } = renderMorningDigest(list, ctxOf(list[0]!));
    expect(text.split(`県の発表: ${SOURCE}`).length - 1).toBe(list.length);
  });
});

describe("API の応答に添える文", () => {
  it("baseNotices は『県の連絡が正です』と『どこでも感染のリスクがあります』を含み、禁句がない", () => {
    const joined = baseNotices().join("\n");
    expect(joined).toContain("県の連絡が正です");
    expect(joined).toContain("シーズン中はどこでも感染のリスクがあります");
    expect(joined).toContain(DATA_NOT_INSTRUCTION);
    expect(findWordingViolations(joined)).toEqual([]);
  });
  it("省いた記録の注意、古さの注意にも禁句がない", () => {
    expect(findWordingViolations([DROPPED_NOTICE, staleNotice(90)].join("\n"))).toEqual([]);
  });
});
