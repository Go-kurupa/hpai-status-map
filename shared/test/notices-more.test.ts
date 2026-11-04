// M-13: 野鳥、自己点検の期限、死亡率の基準の知らせ。宛先を決める純粋な部分と、文面。
import { describe, expect, it } from "vitest";
import { GeoNotLoadedError } from "../src/geo";
import { MORTALITY_TEXT } from "../src/mortality";
import {
  HEALTH_STANDARD_SOURCE_URL,
  mortalityNotices,
  normalizeRemindDays,
  planSelfCheckDue,
  SELF_CHECK_MAX_MONTHS_PER_RUN,
  selfCheckMonthsOf,
  selfCheckTargetMonthsOf,
  renderMorningDigest,
  renderNotice,
  selfCheckDueNotices,
  subjectOf,
  wildBirdNotices,
  type Notice,
  type NoticeEvent,
} from "../src/notices";
import type { Farm } from "../src/types";
import { findForbiddenPhrases, FIXED_TEXT } from "../src/wording";
import { FAR_B, farmWithId, fakeGeo, GEO_B, NEAR_B, wildBirdFixture } from "./helpers/mFixtures";

type F = Farm & { id: string };

const CTX = { unsubscribeUrl: "https://app.example.test/unsubscribe?farm=f1&uid=u1&sig=abc", appUrl: "https://app.example.test" };
const SOURCE = "https://example.test/moe/1.html";
const urlsIn = (text: string) => [...text.matchAll(/https?:\/\/[^\s)、。]+/gu)].map((m) => m[0]);

function bird(over: Parameters<typeof wildBirdFixture>[0] = {}) {
  return wildBirdFixture(over);
}

describe("wildBirdNotices", () => {
  const farms = (): F[] => [
    farmWithId("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B, prefCode: "33" }),
    farmWithId("far", "u2", { meshCode: FAR_B, muniCode: GEO_B, prefCode: "33" }),
  ];
  const geo = () => fakeGeo({ preload: true });

  it("10km 以内の農場に level:null、morning で届き、遠い農場には届かない", () => {
    const out = wildBirdNotices({ bird: bird(), farms: farms(), geo: geo() });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      farmId: "near",
      uid: "u1",
      subjectId: "wb-2026-1",
      event: "wild_bird_confirmed",
      timing: "morning",
      level: null,
      relationKind: null,
      facts: { muniName: "町A", prefCode: "33", date: "2026-11-04", sourceUrl: SOURCE },
      isCorrection: false,
    });
  });

  it("検査中（screening_positive）と否定の鳥は出さない", () => {
    for (const test of ["screening_positive", "negative"] as const) {
      expect(wildBirdNotices({ bird: bird({ test }), farms: farms(), geo: geo() })).toEqual([]);
    }
  });

  it("市町村が分からない鳥は出さない", () => {
    expect(wildBirdNotices({ bird: bird({ muniCode: null, muniName: null }), farms: farms(), geo: geo() })).toEqual([]);
  });

  it("朝のまとめを切った農場には届かない。notify の欄が欠けていても既定（届く）", () => {
    const off = farmWithId("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B, notify: { level1: true, level2: true, level3: true, morningDigest: false, selfCheckRemindDays: null } });
    expect(wildBirdNotices({ bird: bird(), farms: [off], geo: geo() })).toEqual([]);
    const bare = { ...farmWithId("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B }), notify: undefined } as unknown as F;
    expect(wildBirdNotices({ bird: bird(), farms: [bare], geo: geo() })).toHaveLength(1);
  });

  it("配信を止めた会員には届かない。読めない農場（欄が配列でない）は飛ばす", () => {
    const f = farmWithId("near", "u1", { meshCode: NEAR_B, muniCode: GEO_B, memberUids: ["u1", "u9"], unsubscribedUids: ["u9"] });
    expect(wildBirdNotices({ bird: bird(), farms: [f], geo: geo() }).map((n) => n.uid)).toEqual(["u1"]);
    const broken = { ...f, unsubscribedUids: undefined } as unknown as F;
    expect(wildBirdNotices({ bird: bird(), farms: [broken], geo: geo() })).toEqual([]);
  });

  it("県を読む前は GeoNotLoadedError（黙って届かないことにしない）。読んだ後は届く", async () => {
    const cold = fakeGeo();
    expect(() => wildBirdNotices({ bird: bird(), farms: farms(), geo: cold })).toThrow(GeoNotLoadedError);
    await cold.ensurePrefs(["33"]);
    expect(wildBirdNotices({ bird: bird(), farms: farms(), geo: cold })).toHaveLength(1);
  });
});

describe("selfCheckDueNotices", () => {
  const farm = (over: Partial<Farm> = {}): F =>
    farmWithId("f1", "u1", {
      memberUids: ["u1", "u2"],
      unsubscribedUids: ["u2"],
      selfCheckDue: { "2026-11": "2026-11-05" },
      notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: 3 },
      ...over,
    });

  it("期限の 3 日前から期限の日まで出す: 11/1 はなし、11/2 と 11/5 はあり、11/6 はなし", () => {
    expect(selfCheckDueNotices(farm(), "2026-11-01", [])).toEqual([]);
    expect(selfCheckDueNotices(farm(), "2026-11-02", [])).toHaveLength(1);
    expect(selfCheckDueNotices(farm(), "2026-11-05", [])).toHaveLength(1);
    expect(selfCheckDueNotices(farm(), "2026-11-06", [])).toEqual([]);
  });

  it("Notice の形: subjectId は月、immediate、level なし、期限日を持つ。配信停止の会員は除く", () => {
    const out = selfCheckDueNotices(farm(), "2026-11-03", []);
    expect(out).toEqual([
      {
        farmId: "f1",
        uid: "u1",
        subjectId: "2026-11",
        event: "self_check_due",
        timing: "immediate",
        level: null,
        relationKind: null,
        facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: HEALTH_STANDARD_SOURCE_URL },
        isCorrection: false,
      },
    ]);
  });

  it("記録済みの月は出さない", () => {
    expect(selfCheckDueNotices(farm(), "2026-11-03", ["2026-11"])).toEqual([]);
    expect(selfCheckDueNotices(farm({ selfCheckDue: { "2026-11": "2026-11-05", "2026-12": "2026-11-04" } }), "2026-11-03", ["2026-11"]).map((n) => n.subjectId)).toEqual(["2026-12"]);
  });

  it("selfCheckRemindDays が null なら出さない。notify の朝のまとめを切っていても出す", () => {
    expect(selfCheckDueNotices(farm({ notify: { level1: true, level2: true, level3: true, morningDigest: false, selfCheckRemindDays: null } }), "2026-11-03", [])).toEqual([]);
    expect(selfCheckDueNotices(farm({ notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: 3 } }), "2026-11-03", [])).toHaveLength(1);
  });

  it("欄 selfCheckDue のない農場、壊れた値の月、notify のない農場でも例外にならない", () => {
    const noDue = { ...farm(), selfCheckDue: undefined } as unknown as F;
    expect(selfCheckDueNotices(noDue, "2026-11-03", [])).toEqual([]);
    expect(selfCheckDueNotices(farm({ selfCheckDue: { "2026-11": "来月の5日", "2026-12": "2026-13-45" } as Record<string, string> }), "2026-11-03", [])).toEqual([]);
    const noNotify = { ...farm(), notify: undefined } as unknown as F;
    expect(selfCheckDueNotices(noNotify, "2026-11-03", [])).toEqual([]);
    const noMembers = { ...farm(), memberUids: undefined } as unknown as F;
    expect(selfCheckDueNotices(noMembers, "2026-11-03", [])).toEqual([]);
  });
});

describe("mortalityNotices", () => {
  it("会員全員（配信停止を除く）に immediate。notify の設定は見ない", () => {
    const f = farmWithId("f1", "u1", {
      memberUids: ["u1", "u2", "u3"],
      unsubscribedUids: ["u3"],
      notify: { level1: false, level2: false, level3: false, morningDigest: false, selfCheckRemindDays: null },
    });
    const out = mortalityNotices(f, "2026-11-05_h1", "2026-11-05");
    expect(out.map((n) => n.uid)).toEqual(["u1", "u2"]);
    expect(out[0]).toEqual({
      farmId: "f1",
      uid: "u1",
      subjectId: "2026-11-05_h1",
      event: "mortality_hit",
      timing: "immediate",
      level: null,
      relationKind: null,
      facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: HEALTH_STANDARD_SOURCE_URL },
      isCorrection: false,
    });
  });

  it("会員の欄が配列でない農場は空", () => {
    const f = { ...farmWithId("f1", "u1"), unsubscribedUids: undefined } as unknown as F;
    expect(mortalityNotices(f, "r", "2026-11-05")).toEqual([]);
  });
});

const wild = (over: Partial<Notice> = {}): Notice => ({
  farmId: "f1", uid: "u1", subjectId: "wb-2026-1", event: "wild_bird_confirmed", timing: "morning", level: null, relationKind: null,
  facts: { muniName: "津山市", prefCode: "33", date: "2026-11-04", sourceUrl: SOURCE }, isCorrection: false, ...over,
});
const due = (over: Partial<Notice> = {}): Notice => ({
  farmId: "f1", uid: "u1", subjectId: "2026-11", event: "self_check_due", timing: "immediate", level: null, relationKind: null,
  facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: null }, isCorrection: false, ...over,
});
const hit = (over: Partial<Notice> = {}): Notice => ({
  farmId: "f1", uid: "u1", subjectId: "2026-11-05_h1", event: "mortality_hit", timing: "immediate", level: null, relationKind: null,
  facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: null }, isCorrection: false, ...over,
});
const THREE: Array<[NoticeEvent, Notice]> = [["wild_bird_confirmed", wild()], ["self_check_due", due()], ["mortality_hit", hit()]];

describe("renderNotice: 野鳥、期限、死亡率", () => {
  it("件名", () => {
    expect(subjectOf(wild())).toBe("【野鳥】津山市で野鳥の高病原性鳥インフルエンザが確定しました");
    expect(subjectOf(due())).toBe("【自己点検】11月5日が期限です");
    expect(subjectOf(hit())).toBe("【死亡数】11月5日の死亡率が基準に当たる可能性があります");
  });

  it.each(THREE)("%s: 県の連絡が正です、くわしく、配信停止があり、禁止語がない", (_e, n) => {
    const { subject, text } = renderNotice(n, CTX);
    expect(text).toContain(FIXED_TEXT.prefContactIsAuthority);
    expect(text).toContain(`くわしく: ${CTX.appUrl}`);
    expect(text).toContain(`配信停止: ${CTX.unsubscribeUrl}`);
    expect(findForbiddenPhrases(`${subject}\n${text}`)).toEqual([]);
    expect(text).not.toMatch(/農場名|販売|購入|お得|キャンペーン|ご注文/u);
  });

  it("野鳥: 段階を上げないと書き、環境省の重点区域と防疫指針の区域は別と書く。URL は出典、appUrl、配信停止だけ", () => {
    const { text } = renderNotice(wild(), CTX);
    expect(text).toMatch(/段階は上がりません|段階を上げません/);
    expect(text).toContain("環境省の重点区域と、防疫指針の区域は別");
    expect(new Set(urlsIn(text))).toEqual(new Set([SOURCE, CTX.appUrl, CTX.unsubscribeUrl]));
  });

  it("期限: 記録の画面へのリンクがある。URL は appUrl 配下と配信停止だけ", () => {
    const { text } = renderNotice(due(), CTX);
    expect(text).toContain(`${CTX.appUrl}/record/self-check`);
    expect(new Set(urlsIn(text))).toEqual(new Set([`${CTX.appUrl}/record/self-check`, CTX.appUrl, CTX.unsubscribeUrl]));
    expect(text).toContain("11月分");
  });

  it("死亡率: 基準、入力画面、取り消せない旨がある。感染を言い切らない", () => {
    const { subject, text } = renderNotice(hit(), CTX);
    expect(text).toContain(MORTALITY_TEXT.hit);
    expect(text).toContain(`${CTX.appUrl}/record/deaths`);
    expect(text).toContain("入力を直しても、このメールは取り消せません");
    expect(`${subject}\n${text}`).not.toContain("感染しています");
    expect(`${subject}\n${text}`).not.toContain("鳥インフルエンザです");
    expect(text).toMatch(/可能性/);
    expect(new Set(urlsIn(text))).toEqual(new Set([`${CTX.appUrl}/record/deaths`, CTX.appUrl, CTX.unsubscribeUrl]));
  });

  it("appUrl の末尾の / は重ねない", () => {
    const { text } = renderNotice(due(), { ...CTX, appUrl: "https://app.example.test/" });
    expect(text).toContain("https://app.example.test/record/self-check");
    expect(text).not.toContain("test//record");
  });

  it("日付がなくても例外にならない", () => {
    const d = due({ facts: { muniName: null, prefCode: null, date: null, sourceUrl: null } });
    expect(() => renderNotice(d, CTX)).not.toThrow();
    expect(() => renderNotice(hit({ facts: { muniName: null, prefCode: null, date: null, sourceUrl: null } }), CTX)).not.toThrow();
  });
});

describe("renderMorningDigest: 新しい 3 つの出来事を含められる", () => {
  it("3 件を 1 通にして、配信停止は 1 回、禁止語がない", () => {
    const { subject, text } = renderMorningDigest([wild(), due(), hit()], CTX);
    expect(subject).toBe("【朝のまとめ】3 件");
    expect(text.split(CTX.unsubscribeUrl)).toHaveLength(2);
    expect(text).toContain(subjectOf(wild()));
    expect(text).toContain(subjectOf(due()));
    expect(text).toContain(MORTALITY_TEXT.hit);
    expect(text).toContain(`${CTX.appUrl}/record/self-check`);
    expect(text).toContain(`${CTX.appUrl}/record/deaths`);
    expect(findForbiddenPhrases(`${subject}\n${text}`)).toEqual([]);
  });
});

describe("自己点検の期限と死亡率の基準の知らせの出典", () => {
  it("作り手が出す知らせは、家畜伝染病予防法施行規則（e-Gov）の URL を持ち、本文に『出典』の行で出る", () => {
    expect(HEALTH_STANDARD_SOURCE_URL).toBe("https://laws.e-gov.go.jp/law/326M50010000035");
    for (const n of [due({ facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: HEALTH_STANDARD_SOURCE_URL } }), hit({ facts: { muniName: null, prefCode: null, date: "2026-11-05", sourceUrl: HEALTH_STANDARD_SOURCE_URL } })]) {
      const { text } = renderNotice(n, CTX);
      expect(text).toContain(`出典: ${HEALTH_STANDARD_SOURCE_URL}`);
      expect(text).not.toContain("県の発表:");
      expect(text.indexOf("出典:")).toBeLessThan(text.indexOf(FIXED_TEXT.prefContactIsAuthority));
    }
  });
});

describe("selfCheckDueNotices: 会員が書ける欄で、送る数を増やせない（N-1）", () => {
  const SEVEN = { level1: true, level2: true, level3: true, morningDigest: true };
  const farm = (selfCheckDue: unknown, selfCheckRemindDays: unknown, members = ["u1", "u2"]): F =>
    farmWithId("f1", "u1", {
      memberUids: members,
      unsubscribedUids: [],
      selfCheckDue: selfCheckDue as Record<string, string>,
      notify: { ...SEVEN, selfCheckRemindDays } as Farm["notify"],
    });
  /** 年 1900〜2299 の 12 か月で 4800 キー。値はどれも実在する日付 */
  const manyKeys = (day: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (let y = 1900; y < 2300; y++) for (let m = 1; m <= 12; m++) out[`${y}-${String(m).padStart(2, "0")}`] = day;
    return out;
  };

  it("3100 を超えるキー・日数 100000 でも、1 回に出る期限の知らせは 会員 × 上限の月 以下", () => {
    const due = { ...manyKeys("2026-11-05"), ...Object.fromEntries(selfCheckMonthsOf("2026-11-03").map((m) => [m, "2026-11-05"])) };
    expect(Object.keys(due).length).toBeGreaterThan(3100);
    const plan = planSelfCheckDue(farm(due, 100000), "2026-11-03", []);
    expect(plan.notices.length).toBeLessThanOrEqual(SELF_CHECK_MAX_MONTHS_PER_RUN * 2);
    expect(plan.notices.length).toBeGreaterThan(0);
    // 今季の月だけ（会員が足したほかの年のキーは出ない）
    expect(plan.notices.every((n) => selfCheckMonthsOf("2026-11-03").includes(n.subjectId))).toBe(true);
    // 読み飛ばしたキーの数を返す（中身は返さない）
    expect(plan.skipped).toBeGreaterThanOrEqual(4800 - 8);
  });

  it("普段の農場（今季の 8 か月分、日数 3）では、これまでどおり出る", () => {
    const due = Object.fromEntries(selfCheckMonthsOf("2026-11-28").map((m) => [m, `${m}-30`.replace("-02-30", "-02-28").replace("-04-30", "-04-30")]));
    const plan = planSelfCheckDue(farm(due, 3), "2026-11-28", []);
    expect(plan.notices.map((n) => [n.uid, n.subjectId, n.facts.date])).toEqual([
      ["u1", "2026-11", "2026-11-30"],
      ["u2", "2026-11", "2026-11-30"],
    ]);
    expect(plan.skipped).toBe(0);
  });

  it("期限の早い順に上限の月まで。記録済みの月は上限に数えず、次の月が出る。months には記録済みも入る", () => {
    const due = { "2026-10": "2026-11-04", "2026-11": "2026-11-05", "2026-12": "2026-11-06" };
    const f = farm(due, 7, ["u1"]);
    expect(planSelfCheckDue(f, "2026-11-03", []).notices.map((n) => n.subjectId)).toEqual(["2026-10", "2026-11"]);
    const plan = planSelfCheckDue(f, "2026-11-03", ["2026-10"]);
    expect(plan.notices.map((n) => n.subjectId)).toEqual(["2026-11", "2026-12"]);
    expect(plan.months).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("壊れた値（数、入れ子、長い文字列、日付でない文字列）は例外にせず読み飛ばし、件数だけ数える", () => {
    const due = { "2026-11": 5, "2026-12": { a: 1 }, "2027-01": "x".repeat(100000), "2027-02": "2027-13-45", "2027-03": null, "2027-04": ["2027-04-01"], "garbage": "2026-11-05", "2027-05": "2026-11-05" };
    let plan!: ReturnType<typeof planSelfCheckDue>;
    expect(() => (plan = planSelfCheckDue(farm(due, 7, ["u1"]), "2026-11-03", []))).not.toThrow();
    expect(plan.notices.map((n) => n.subjectId)).toEqual(["2027-05"]);
    expect(plan.skipped).toBe(7);
  });

  it("日数: 7 を超える整数は 7、整数でない値と負の値は 3、数でない値は出さない", () => {
    expect([0, 1, 7, 8, 100000].map(normalizeRemindDays)).toEqual([0, 1, 7, 7, 7]);
    expect([2.5, -1].map(normalizeRemindDays)).toEqual([3, 3]);
    expect([null, undefined, "3", NaN, Infinity, {}].map(normalizeRemindDays)).toEqual([null, null, null, null, null, null]);
    // 日数 100000 でも 7 日より先の期限は出ない
    expect(planSelfCheckDue(farm({ "2026-12": "2026-12-01" }, 100000, ["u1"]), "2026-11-03", []).notices).toEqual([]);
    expect(planSelfCheckDue(farm({ "2026-11": "2026-11-10" }, 100000, ["u1"]), "2026-11-03", []).notices).toHaveLength(1);
  });

  it("今季の月は 10 月から翌 5 月の 8 か月。6 月から 9 月も、その年の 10 月からを返す", () => {
    expect(selfCheckMonthsOf("2026-11-03")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]);
    expect(selfCheckMonthsOf("2027-02-01")).toEqual(selfCheckMonthsOf("2026-11-03"));
    expect(selfCheckMonthsOf("2027-07-01")[0]).toBe("2027-10");
  });
});

describe("selfCheckDueNotices: 退行と境目（2-I-1、2-M-1、2-M-2、2-M-3）", () => {
  const SEVEN = { level1: true, level2: true, level3: true, morningDigest: true };
  const farm = (selfCheckDue: unknown, selfCheckRemindDays: unknown = 3): F =>
    farmWithId("f1", "u1", {
      memberUids: ["u1"],
      unsubscribedUids: [],
      selfCheckDue: selfCheckDue as Record<string, string>,
      notify: { ...SEVEN, selfCheckRemindDays } as Farm["notify"],
    });

  it("2-I-1: 5 月分の期限は 6 月 2〜6 日に来る。6 月 1 日にシーズンが替わっても、前のシーズンの 5 月分を落とさない", () => {
    const f = farm({ "2027-05": "2027-06-03" }, 3);
    for (const today of ["2027-06-01", "2027-06-02", "2027-06-03"]) {
      expect(planSelfCheckDue(f, today, []).notices.map((n) => [n.subjectId, n.facts.date]), today).toEqual([["2027-05", "2027-06-03"]]);
    }
    // 期限の翌日（6/4）は出さない。期間の外（6/1 から 3 日より先の期限）も出さない
    expect(planSelfCheckDue(f, "2027-06-04", []).notices).toEqual([]);
    expect(planSelfCheckDue(farm({ "2027-05": "2027-06-06" }, 3), "2027-06-02", []).notices).toEqual([]);
    expect(planSelfCheckDue(farm({ "2027-05": "2027-06-06" }, 3), "2027-06-03", []).notices).toHaveLength(1);
    // 5 月 31 日までは今季の 5 月分として、これまでどおり
    expect(planSelfCheckDue(farm({ "2027-05": "2027-06-02" }, 3), "2027-05-31", []).notices).toHaveLength(1);
  });

  it("2-I-1: 前のシーズンの 5 月分は 6〜9 月だけ対象。10 月以降と、前の年の 5 月分は対象にしない", () => {
    expect(selfCheckTargetMonthsOf("2027-06-01")).toEqual(["2027-05", ...selfCheckMonthsOf("2027-06-01")]);
    expect(selfCheckTargetMonthsOf("2027-09-30")[0]).toBe("2027-05");
    expect(selfCheckTargetMonthsOf("2027-10-01")).toEqual(selfCheckMonthsOf("2027-10-01"));
    expect(selfCheckTargetMonthsOf("2027-03-15")).toEqual(selfCheckMonthsOf("2027-03-15"));
    // 6 月でも、2 年前の 5 月分（2026-05）は対象にしない
    expect(planSelfCheckDue(farm({ "2026-05": "2027-06-03" }, 3), "2027-06-02", []).notices).toEqual([]);
  });

  it("2-M-1: 送り済みの月は枠に数えない。3 つの月の期限が近いとき、3 つ目の月が出る", () => {
    const f = farm({ "2026-10": "2026-11-04", "2026-11": "2026-11-05", "2026-12": "2026-11-06" }, 7);
    expect(planSelfCheckDue(f, "2026-11-03", []).notices.map((n) => n.subjectId)).toEqual(["2026-10", "2026-11"]);
    const next = planSelfCheckDue(f, "2026-11-03", [], ["2026-10", "2026-11"]);
    expect(next.notices.map((n) => n.subjectId)).toEqual(["2026-12"]);
    expect(next.months).toEqual(["2026-10", "2026-11", "2026-12"]);
    // 記録済み（answered）と送り済み（sent）が混ざっても、残りの月から上限まで
    const mixed = planSelfCheckDue(f, "2026-11-03", ["2026-10"], ["2026-11"]);
    expect(mixed.notices.map((n) => n.subjectId)).toEqual(["2026-12"]);
  });

  it("2-M-2: 期限の早い順に並べる。日付が月の順と逆なら、日付の順（11 月分が 12/10、12 月分が 12/3）", () => {
    const f = farm({ "2026-11": "2026-12-10", "2026-12": "2026-12-03" }, 7);
    const plan = planSelfCheckDue(f, "2026-12-03", []);
    expect(plan.notices.map((n) => n.subjectId)).toEqual(["2026-12", "2026-11"]);
    expect(plan.months).toEqual(["2026-12", "2026-11"]);
    // 同じ日付なら月の順
    const same = planSelfCheckDue(farm({ "2026-12": "2026-12-05", "2026-11": "2026-12-05" }, 7), "2026-12-03", []);
    expect(same.notices.map((n) => n.subjectId)).toEqual(["2026-11", "2026-12"]);
  });

  it("2-M-3: 日数が null や数でないときは、何も出さず、月も読み飛ばしの数も 0（早く戻る）", () => {
    const junk = { "2026-11": "2026-11-05", garbage: "x", "1999-01": "1999-01-05" };
    for (const days of [null, "3", NaN, Infinity]) {
      expect(planSelfCheckDue(farm(junk, days), "2026-11-03", [])).toEqual({ notices: [], months: [], skipped: 0 });
    }
    // 日数が数なら、同じ欄から出る
    expect(planSelfCheckDue(farm(junk, 3), "2026-11-03", []).notices).toHaveLength(1);
  });
});
