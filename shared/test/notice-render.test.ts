// M-02: メールの文面（件名と本文）。
import { describe, expect, it } from "vitest";
import { renderMorningDigest, renderNotice, type Notice, type NoticeEvent } from "../src/notices";
import type { Level, LevelReasonKind } from "../src/types";
import { findForbiddenPhrases, FIXED_TEXT } from "../src/wording";

const CTX = { unsubscribeUrl: "https://app.example.test/unsubscribe?farm=f1&uid=u1&sig=abc", appUrl: "https://app.example.test" };
const SOURCE = "https://pref.example.test/page/1.html";

function notice(over: Partial<Notice> & { event: NoticeEvent }): Notice {
  return {
    farmId: "f1",
    uid: "u1",
    subjectId: "c1",
    timing: "immediate",
    level: 1,
    relationKind: "same_muni",
    facts: { muniName: "津山市", prefCode: "33", date: "2025-12-20", sourceUrl: SOURCE },
    isCorrection: false,
    ...over,
  };
}
const at = (level: Level | null, relationKind: LevelReasonKind | null) => ({ level, relationKind });
const urlsIn = (text: string) => [...text.matchAll(/https?:\/\/[^\s)、。]+/gu)].map((m) => m[0]);

const CASE_EVENTS = ["suspected", "confirmed", "negated", "shipment_lifted", "movement_lifted", "reviewing"] as const;

describe("renderNotice: 共通", () => {
  it.each(CASE_EVENTS)("%s: 県の連絡が正です、配信停止があり、禁止語がない", (event) => {
    const n = event === "reviewing" ? notice({ event, ...at(null, null), facts: { muniName: null, prefCode: "33", date: "2025-12-20", sourceUrl: SOURCE } }) : notice({ event });
    const { subject, text } = renderNotice(n, CTX);
    expect(text).toContain(FIXED_TEXT.prefContactIsAuthority);
    expect(text).toContain(`配信停止: ${CTX.unsubscribeUrl}`);
    expect(text).toContain(`くわしく: ${CTX.appUrl}`);
    expect(findForbiddenPhrases(`${subject}\n${text}`)).toEqual([]);
  });
  it.each(CASE_EVENTS)("%s: 本文の URL は sourceUrl、appUrl、配信停止だけ。農場や販売の案内がない", (event) => {
    const n = event === "reviewing" ? notice({ event, ...at(null, null) }) : notice({ event });
    const { text } = renderNotice(n, CTX);
    expect(new Set(urlsIn(text))).toEqual(new Set([SOURCE, CTX.appUrl, CTX.unsubscribeUrl]));
    expect(text).not.toMatch(/農場名|販売|購入|お得|キャンペーン|ご注文/u);
  });
  it("sourceUrl がなければ、その行を出さない", () => {
    const { text } = renderNotice(notice({ event: "confirmed", facts: { muniName: "津山市", prefCode: "33", date: null, sourceUrl: null } }), CTX);
    expect(urlsIn(text).sort()).toEqual([CTX.appUrl, CTX.unsubscribeUrl].sort());
  });
  it("本文の順: 事実、段階の文、固定の文、出典、県の連絡が正です、くわしく、配信停止", () => {
    const { text } = renderNotice(notice({ event: "confirmed" }), CTX);
    const order = ["津山市", "区域に入っている可能性があります", "公表されるのは", SOURCE, FIXED_TEXT.prefContactIsAuthority, "くわしく:", "配信停止:"].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("農場の名前を本文に入れない（Notice が持たない）", () => {
    expect(Object.keys(notice({ event: "confirmed" }))).not.toContain("name");
  });
  it("3 つの出来事（野鳥、期限、死亡率）の文面は M-13（notices-more.test.ts）で確かめる", () => {
    for (const event of ["wild_bird_confirmed", "self_check_due", "mortality_hit"] as const) {
      expect(() => renderNotice(notice({ event, level: null, relationKind: null }), CTX)).not.toThrow();
    }
  });
  it("appUrl の末尾の / は重ねない", () => {
    const { text } = renderNotice(notice({ event: "confirmed" }), { ...CTX, appUrl: "https://app.example.test/" });
    expect(text).toContain("くわしく: https://app.example.test\n");
  });
});

describe("renderNotice: 件名", () => {
  it("疑い、確定", () => {
    expect(renderNotice(notice({ event: "suspected" }), CTX).subject).toBe("【疑い】岡山県津山市で鳥インフルエンザの疑い");
    expect(renderNotice(notice({ event: "confirmed" }), CTX).subject).toBe("【確定】岡山県津山市で鳥インフルエンザの発生");
  });
  it("否定: 訂正なら【訂正】、そうでなければ【お知らせ】", () => {
    expect(renderNotice(notice({ event: "negated", isCorrection: true }), CTX).subject).toBe("【訂正】岡山県津山市の疑いは否定されました");
    expect(renderNotice(notice({ event: "negated", isCorrection: false }), CTX).subject).toBe("【お知らせ】岡山県津山市の疑いは否定されました");
  });
  it("確認中は県だけ、解除は市町村", () => {
    expect(renderNotice(notice({ event: "reviewing", ...at(null, null), facts: { muniName: null, prefCode: "33", date: null, sourceUrl: SOURCE } }), CTX).subject).toBe("【確認中】岡山県の発表を確認しています");
    expect(renderNotice(notice({ event: "shipment_lifted" }), CTX).subject).toBe("【解除】津山市の搬出制限が解除されました");
    expect(renderNotice(notice({ event: "movement_lifted" }), CTX).subject).toBe("【解除】津山市の移動制限が解除されました");
  });
});

describe("renderNotice: 段階の文", () => {
  const body = (event: NoticeEvent, level: Level | null, kind: LevelReasonKind | null) => renderNotice(notice({ event, ...at(level, kind) }), CTX).text;
  it("① 区域に入っている可能性があります。県の連絡を確かめてください", () => {
    for (const kind of ["within_radius", "same_muni"] as const) {
      expect(body("confirmed", 1, kind)).toContain("区域に入っている可能性があります。県の連絡を確かめてください");
      expect(body("suspected", 1, kind)).toContain("区域に入っている可能性があります。県の連絡を確かめてください");
    }
  });
  it("② 隣の町で発生しました（疑いは 隣の町で疑いの発表がありました）", () => {
    expect(body("confirmed", 2, "adjacent")).toContain("隣の町で発生しました");
    expect(body("suspected", 2, "adjacent")).toContain("隣の町で疑いの発表がありました");
  });
  it("③ 登録した町で発生しました（疑いは 登録した町で疑いの発表がありました）", () => {
    expect(body("confirmed", 3, "frequent")).toContain("登録した町で発生しました");
    expect(body("suspected", 3, "frequent")).toContain("登録した町で疑いの発表がありました");
  });
  it("level 2 の same_muni は固定文 sameMuniLifted で、「隣の町」を含まない", () => {
    for (const event of ["confirmed", "suspected"] as const) {
      const t = body(event, 2, "same_muni");
      expect(t).toContain(FIXED_TEXT.sameMuniLifted);
      expect(t).not.toContain("隣の町");
    }
  });
  it("④ や確認中、否定には段階の文を出さない", () => {
    for (const t of [body("negated", 4, null), body("confirmed", 4, null)]) {
      expect(t).not.toMatch(/区域に入っている可能性|隣の町|登録した町/u);
    }
    expect(body("negated", 1, "same_muni")).not.toMatch(/区域に入っている可能性|隣の町|登録した町/u);
    expect(body("reviewing", null, null)).not.toMatch(/区域に入っている可能性|隣の町|登録した町/u);
  });
  it("解除には段階の文を出さない。① の搬出制限の解除だけ、表示が続くことを書く", () => {
    for (const [level, kind] of [[2, "adjacent"], [3, "frequent"]] as const) {
      expect(body("shipment_lifted", level, kind)).not.toMatch(/区域に入っている可能性|隣の町|登録した町/u);
      expect(body("movement_lifted", level, kind)).not.toMatch(/区域に入っている可能性|隣の町|登録した町/u);
    }
    expect(body("shipment_lifted", 1, "within_radius")).toContain("搬出制限は解除されました。区域に入っている可能性の表示は、移動制限の解除まで続きます");
    expect(body("movement_lifted", 1, "within_radius")).not.toContain("表示は、移動制限の解除まで続きます");
    expect(body("shipment_lifted", 2, "adjacent")).not.toContain("表示は、移動制限の解除まで続きます");
  });
});

describe("renderNotice: 断定しない、疑いと確定を混ぜない", () => {
  it("確定の件名と本文に「疑い」がない", () => {
    for (const level of [1, 2, 3] as const) {
      const kind = level === 1 ? "within_radius" : level === 2 ? "adjacent" : "frequent";
      const { subject, text } = renderNotice(notice({ event: "confirmed", ...at(level, kind) }), CTX);
      expect(`${subject}\n${text}`).not.toContain("疑い");
    }
  });
  it("疑いは「疑い」と明記し、確定でないことを書く", () => {
    const { text } = renderNotice(notice({ event: "suspected" }), CTX);
    expect(text).toContain("疑い");
    expect(text).toContain("確定ではありません");
  });
  it("否定: 訂正は先のお知らせの訂正と書き、そうでなければ訂正と書かない", () => {
    expect(renderNotice(notice({ event: "negated", isCorrection: true }), CTX).text).toContain("訂正");
    expect(renderNotice(notice({ event: "negated", isCorrection: false }), CTX).text).not.toContain("訂正");
  });
  it("確認中は市町村を書かない（市町村名が入っていても出さない）", () => {
    const { subject, text } = renderNotice(notice({ event: "reviewing", ...at(null, null), facts: { muniName: "津山市", prefCode: "33", date: "2025-12-20", sourceUrl: SOURCE } }), CTX);
    expect(`${subject}${text}`).not.toContain("津山市");
    expect(text).toContain("岡山県");
  });
  it("日付は 12月20日 の書き方。無ければ日付の言葉を出さない", () => {
    expect(renderNotice(notice({ event: "confirmed" }), CTX).text).toContain("12月20日");
    expect(renderNotice(notice({ event: "confirmed", facts: { muniName: "津山市", prefCode: "33", date: null, sourceUrl: null } }), CTX).text).not.toMatch(/\d+月\d+日/u);
  });
  it("出典が http(s) でなければ出さない", () => {
    const { text } = renderNotice(notice({ event: "confirmed", facts: { muniName: "津山市", prefCode: "33", date: null, sourceUrl: "javascript:alert(1)" } }), CTX);
    expect(text).not.toContain("javascript:");
  });
});

describe("renderMorningDigest", () => {
  const list = [
    notice({ event: "negated", subjectId: "c1", timing: "morning", level: 2, relationKind: "adjacent", isCorrection: true }),
    notice({ event: "movement_lifted", subjectId: "c2", timing: "morning", level: 3, relationKind: "frequent", facts: { muniName: "鳥取市", prefCode: "31", date: "2026-01-21", sourceUrl: "https://pref.example.test/c2.html" } }),
    notice({ event: "confirmed", subjectId: "c1", timing: "morning", level: 2, relationKind: "adjacent" }),
    notice({ event: "suspected", subjectId: "c1", timing: "morning", level: 2, relationKind: "adjacent" }),
  ];
  it("件名は 【朝のまとめ】N 件", () => {
    expect(renderMorningDigest(list, CTX).subject).toBe("【朝のまとめ】4 件");
  });
  it("全件の事実があり、配信停止、県の連絡が正です、くわしくは 1 回ずつ", () => {
    const { text } = renderMorningDigest(list, CTX);
    expect(text.split(CTX.unsubscribeUrl).length - 1).toBe(1);
    expect(text.split(FIXED_TEXT.prefContactIsAuthority).length - 1).toBe(1);
    expect(text).toContain("津山市");
    expect(text).toContain("鳥取市");
    expect(text).toContain("https://pref.example.test/c2.html");
    expect(text).toContain("1月21日");
    expect(findForbiddenPhrases(text)).toEqual([]);
    expect(new Set(urlsIn(text))).toEqual(new Set([SOURCE, "https://pref.example.test/c2.html", CTX.appUrl, CTX.unsubscribeUrl]));
  });
  it("同じ事例は 疑い、確定、否定 の順で、別の事例はまとまっている", () => {
    const { text } = renderMorningDigest(list, CTX);
    const i = ["【疑い】", "【確定】", "【訂正】", "【解除】"].map((s) => text.indexOf(s));
    expect(i.every((x) => x >= 0)).toBe(true);
    // c1 の 疑い < 確定 < 訂正、c1 の最初の出現が c2 より先（入力で最初に現れた事例が先）
    expect(i[0]!).toBeLessThan(i[1]!);
    expect(i[1]!).toBeLessThan(i[2]!);
    expect(i[3]!).toBeGreaterThan(i[2]!);
  });
  it("入力の並びを変えない（元の配列を並べ替えない）", () => {
    const before = list.map((n) => n.event);
    renderMorningDigest(list, CTX);
    expect(list.map((n) => n.event)).toEqual(before);
  });
  it("空なら例外（何もない日は送らない）", () => {
    expect(() => renderMorningDigest([], CTX)).toThrow(RangeError);
  });
  it("野鳥の知らせも朝のまとめに入れられる（M-13）", () => {
    expect(() => renderMorningDigest([notice({ event: "wild_bird_confirmed", level: null, relationKind: null })], CTX)).not.toThrow();
  });
});
