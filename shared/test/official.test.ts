import { describe, expect, it } from "vitest";
import { OFFICIAL_GUIDANCE, OFFICIAL_GUIDANCE_REVIEWED_ON, type GuidanceTopic } from "../src/guidance/official";
import { findForbiddenPhrases } from "../src/wording";

// 公式の文（設計書 §11、契約 3.9）。国の機関の文だけを、出典と確認した日つきで固定する。
// 受診の案内は写さない（§2 の「人の健康の質問に答えない」）。国の文だけが根拠で、県のページはリンクだけ。

const TOPICS: ReadonlyArray<[GuidanceTopic, string]> = [
  ["approach", "農場に近づかないでください"],
  ["human_infection", "人への感染"],
  ["food", "卵や鶏肉"],
  ["burial", "埋却と地下水"],
  ["dead_bird", "死んだ鳥を見つけたら"],
  ["rumor", "噂に注意"],
  ["small_flock", "数羽飼っている方へ"],
];

const ALLOWED_HOSTS = ["maff.go.jp", "mhlw.go.jp", "env.go.jp", "e-gov.go.jp"];
// 「獣医師による診断」（届出の条文）は受診の案内ではないので、獣医師は止めない
const MEDICAL_ADVICE = /受診|治療|(?<!獣)医師に|病院へ|保健所/u;

const everyStatement = OFFICIAL_GUIDANCE.flatMap((g) => g.statements.map((s) => ({ topic: g.topic, ...s })));

describe("OFFICIAL_GUIDANCE", () => {
  it("7 項目が決まった順で、見出しがある", () => {
    expect(OFFICIAL_GUIDANCE.map((g) => [g.topic, g.heading])).toEqual(TOPICS);
  });

  it("どの項目にも文が 1 つ以上ある", () => {
    for (const g of OFFICIAL_GUIDANCE) expect(g.statements.length, g.topic).toBeGreaterThan(0);
  });

  it("各文に text、sourceTitle、https の URL、YYYY-MM-DD の確認日がある（§16）", () => {
    for (const s of everyStatement) {
      expect(s.text.trim(), s.topic).not.toBe("");
      expect(s.sourceTitle.trim(), s.topic).not.toBe("");
      expect(s.sourceUrl, s.topic).toMatch(/^https:\/\//u);
      expect(s.checkedOn, s.topic).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(Number.isNaN(Date.parse(s.checkedOn)), s.checkedOn).toBe(false);
    }
  });

  it("文も出典名も見出しも、禁止語（区域の外です・安全・安心）を含まない", () => {
    for (const g of OFFICIAL_GUIDANCE) {
      expect(findForbiddenPhrases(g.heading), g.topic).toEqual([]);
      for (const l of g.links ?? []) expect(findForbiddenPhrases(l.title), l.title).toEqual([]);
    }
    for (const s of everyStatement) {
      expect(findForbiddenPhrases(s.text), s.text).toEqual([]);
      expect(findForbiddenPhrases(s.sourceTitle), s.sourceTitle).toEqual([]);
    }
  });

  it("受診や治療の案内を写さない（§2）", () => {
    for (const g of OFFICIAL_GUIDANCE) {
      expect(g.heading).not.toMatch(MEDICAL_ADVICE);
      for (const l of g.links ?? []) expect(l.title).not.toMatch(MEDICAL_ADVICE);
    }
    for (const s of everyStatement) {
      expect(s.text, s.text).not.toMatch(MEDICAL_ADVICE);
      expect(s.sourceTitle, s.sourceTitle).not.toMatch(MEDICAL_ADVICE);
    }
  });

  it("禁止の表現は、獣医師を止めず、受診の案内を止める", () => {
    expect("獣医師による診断又は検案を受けていない").not.toMatch(MEDICAL_ADVICE);
    expect("前もって医師に連絡を入れて").toMatch(MEDICAL_ADVICE);
    expect("近くの保健所に相談し").toMatch(MEDICAL_ADVICE);
  });

  it("数羽飼っている方へ: 届出の条文（第 13 条の 2）を、条の位置を指す e-Gov の URL つきで引用する", () => {
    const g = OFFICIAL_GUIDANCE.find((x) => x.topic === "small_flock")!;
    const art = g.statements.find((s) => s.sourceTitle.includes("第 13 条の 2"));
    expect(art).toBeDefined();
    expect(art!.sourceUrl).toBe("https://laws.e-gov.go.jp/law/326AC1000000166#Mp-At_13_2");
    expect(art!.text).toContain("都道府県知事にその旨を届け出なければならない");
  });

  it("埋却と地下水: 1 文目は、主語のある文（文の途中から始めない）", () => {
    const g = OFFICIAL_GUIDANCE.find((x) => x.topic === "burial")!;
    expect(g.statements[0]!.text.startsWith("患畜又は疑似患畜の死体は")).toBe(true);
  });

  it("全 sourceUrl のホストは、国の 4 つだけ（§2【決定】）", () => {
    for (const s of everyStatement) {
      const host = new URL(s.sourceUrl).hostname;
      expect(
        ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)),
        `${s.topic}: ${s.sourceUrl}`,
      ).toBe(true);
    }
  });

  it("文は原文の連続した引用で、省略の印（…）で継ぎ合わせない", () => {
    for (const s of everyStatement) {
      expect(s.text, s.text).not.toMatch(/[…]|\.\.\./u);
      expect(s.text, s.text).not.toMatch(/^\s|\s$/u);
    }
  });

  it("links は https のページで、文を写さない（title は 60 字以内）", () => {
    for (const g of OFFICIAL_GUIDANCE) {
      for (const l of g.links ?? []) {
        expect(l.url, l.title).toMatch(/^https:\/\//u);
        expect(l.title.length, l.title).toBeLessThanOrEqual(60);
      }
    }
  });

  it("2016 年更新の厚生労働省 Q&A は、出典名に更新日を書く（索引 Q15-7）", () => {
    const qa = everyStatement.filter((s) => s.sourceUrl.endsWith("/avian-influenza_qa.html"));
    expect(qa.length).toBeGreaterThan(0);
    for (const s of qa) expect(s.sourceTitle).toContain("2016 年 12 月 12 日更新");
  });

  it("食品安全委員会の文書は使わない（題に「安全」を含む）", () => {
    for (const s of everyStatement) expect(s.sourceUrl).not.toContain("fsc.go.jp");
  });

  it("人への感染は、受診の案内を持たず、国の機関ごとに別の文で示す", () => {
    const human = OFFICIAL_GUIDANCE.find((g) => g.topic === "human_infection")!;
    const agencies = new Set(human.statements.map((s) => new URL(s.sourceUrl).hostname));
    expect(agencies.size).toBeGreaterThanOrEqual(2);
  });

  it("数羽飼っている方へは、家保の一覧の公式ページへのリンクを持つ", () => {
    const g = OFFICIAL_GUIDANCE.find((x) => x.topic === "small_flock")!;
    expect((g.links ?? []).map((l) => l.url)).toContain("https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_kaho/");
  });

  it("埋却と地下水の県の調査は、リンクだけで文を写さない（索引 Q15-3）", () => {
    const g = OFFICIAL_GUIDANCE.find((x) => x.topic === "burial")!;
    expect((g.links ?? []).length).toBe(2);
    for (const s of g.statements) expect(new URL(s.sourceUrl).hostname).toMatch(/(maff|e-gov)\.go\.jp$/u);
  });
});

describe("OFFICIAL_GUIDANCE_REVIEWED_ON", () => {
  it("作者と共同経営者が確認した日が入っている", () => {
    expect(OFFICIAL_GUIDANCE_REVIEWED_ON).toBe("2026-11-04");
  });
});
