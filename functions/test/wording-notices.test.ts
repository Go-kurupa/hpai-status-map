// X-20: 全ての出来事と段階のメールの文面に、禁句がなく、県の連絡が正です、配信停止のリンク、出典がある。
// 純粋な試験（模擬環境は使わない）。配信停止のリンクは、送る側が使う unsubscribeUrlFor で作り、署名が通ることまで確かめる。
// 出典は「県の発表: URL」「発表: URL」の行。出来事ごとに Notice.facts.sourceUrl があれば出る。
import { describe, expect, it } from "vitest";
import { baseNotices, DATA_NOT_INSTRUCTION, DROPPED_NOTICE, staleNotice } from "@hpai/shared/api";
import {
  HEALTH_STANDARD_SOURCE_URL,
  mortalityNotices,
  renderMemberMail,
  renderMorningDigest,
  renderNotice,
  selfCheckDueNotices,
  type Notice,
  type NoticeEvent,
} from "@hpai/shared/notices";
import type { NearFacts, OverviewDay } from "@hpai/shared/overview";
import type { Farm, Level, LevelReasonKind } from "@hpai/shared/types";
import { findWordingViolations, FIXED_TEXT } from "@hpai/shared/wording";
import { unsubscribeUrlFor } from "../src/notify/dispatch";
import { createRebuildContext, rebuildNotice, type QueueRec } from "../src/notify/rebuild";
import { verifyUnsubscribe } from "../src/notify/unsubscribeSig";

const SECRET = "test-unsubscribe-secret";
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

describe("全国まとめ（daily_overview）", () => {
  const day: OverviewDay = {
    date: "2026-11-05", asOf: "2026-11-05T06:00:00+09:00", season: 2026, seasonCount: 0, recentCount: 0, past: { seasons: 6, min: 0, max: 5 },
    birds: { total: 1, confirmed: 1, screening: 0 }, newCaseCount: 0, newCases: [], newBirdCount: 1,
    corrections: [
      { target: "case", change: "negated", place: "岡山県津山市" }, { target: "case", change: "to_confirmed", place: "岡山県津山市" }, { target: "case", change: "to_suspected", place: "岡山県津山市" }, { target: "case", change: "withdrawn", place: null },
      { target: "bird", change: "negated", place: "岡山県津山市" }, { target: "bird", change: "to_confirmed", place: "岡山県津山市" }, { target: "bird", change: "to_screening", place: "岡山県津山市" }, { target: "bird", change: "withdrawn", place: "岡山県津山市" },
    ],
    reviewingPrefCodes: ["31"], caseMarks: {}, birdMarks: {},
    newBirds: [{ prefName: "岡山県", muniName: "津山市", date: "2026-11-04", suspected: false, sourceUrl: SOURCE }],
    muniCounts: {}, unknownMuniCount: 1, watch: { okCount: 46, failedPrefCodes: ["33"] }, caseIds: [], birdIds: ["b1"], sentence: "今季は 0 件です。", sentenceFailures: [],
  };
  const near: NearFacts = {
    withinCount: 2, within: [{ prefName: "岡山県", muniName: "津山市", count: 2, distanceKm: 23, sameTown: false, registered: true }],
    registeredCount: 2, registered: [{ prefName: "岡山県", muniName: "津山市", count: 2 }],
  };
  const overview = (over: Partial<NonNullable<Notice["overview"]>> = {}) =>
    notice("daily_overview", { subjectId: "2026-11-05", timing: "morning", overview: { day, near, ...over } });

  it.each([
    ["まとめだけ", () => [overview()]],
    ["ほかの知らせと 1 通", () => [overview(), notice("confirmed", { timing: "morning", level: 2, relationKind: "adjacent" })]],
    ["近くの件数を出せない朝", () => [overview({ near: null })]],
    ["過去と確認の状況を読めない朝", () => [overview({ day: { ...day, past: null, watch: null } })]],
  ])("%s: 禁句がなく、県の連絡が正です、配信停止のリンク、出典がある", (_name, list) => {
    const notices = list();
    const mail = renderMemberMail(notices, ctxOf(notices[0]!));
    expect(problemsOf(mail, notices[0]!, { source: true })).toEqual([]);
    expect(mail.text.split("配信停止:").length - 1).toBe(1);
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

describe("送り直しで作り直した知らせ（rebuildNotice）にも、出典の行がある", () => {
  const farm: Farm & { id: string } = {
    id: "f1", name: "架空の農場", memberUids: ["u1"], unsubscribedUids: [], meshCode: "52344160", muniCode: "33203", prefCode: "33",
    frequentMuniCodes: [], production: "layer", housing: "windowless", kahoContact: "",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: 3 },
    selfCheckDue: { "2025-12": "2025-12-31" }, updatedAt: "2025-12-30T09:00:00+09:00",
  };
  // 農場と記録済みの有無は、メモの表に先に入れておく（Firestore には触らない）
  const ctx = () => {
    const c = createRebuildContext(undefined as never, undefined as never, "2025-12-30");
    c.farms.set("f1", Promise.resolve({ kind: "ok", farm }));
    c.answered.set("f1__2025-12", Promise.resolve(false));
    return c;
  };
  const rec = (event: "self_check_due" | "mortality_hit", subjectId: string): QueueRec => ({
    ref: undefined as never, id: "r1",
    data: { farmId: "f1", uid: "u1", subjectId, event, timing: "immediate", state: "queued", queuedAt: "2025-12-30T06:00:00+09:00", sentAt: null },
  });

  it.each([
    ["self_check_due", "2025-12"],
    ["mortality_hit", "2025-12-30_h1"],
  ] as const)("%s: 作り直した知らせの本文に『出典: 施行規則の URL』が出る", async (event, subjectId) => {
    const out = await rebuildNotice(ctx(), rec(event, subjectId));
    expect(out.kind).toBe("send");
    if (out.kind !== "send") return;
    const { text } = renderNotice(out.notice, ctxOf(out.notice));
    expect(text).toContain(`出典: ${HEALTH_STANDARD_SOURCE_URL}`);
    expect(findWordingViolations(text)).toEqual([]);
  });

  it("作り手（selfCheckDueNotices、mortalityNotices）が出す知らせと、作り直した知らせは、事実の欄が同じ", async () => {
    const made = [...selfCheckDueNotices(farm, "2025-12-30", []), ...mortalityNotices(farm, "2025-12-30_h1", "2025-12-30")];
    const rebuilt = [await rebuildNotice(ctx(), rec("self_check_due", "2025-12")), await rebuildNotice(ctx(), rec("mortality_hit", "2025-12-30_h1"))];
    expect(rebuilt.map((r) => (r.kind === "send" ? r.notice.facts : null))).toEqual(made.map((n) => n.facts));
  });
});
