import { OFFICIAL_GUIDANCE } from "@hpai/shared/guidance/official";
import { findForbiddenPhrases, REASSURANCE_WORDS, SENSATIONAL_WORDS } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { LEAD_HEADING } from "./GuidanceSection";
import { agencyOf, SECTION_LEADS, SECTION_RELATED, TOPIC_QUESTION } from "./pageNotes";
import PublicPage, { PublicView } from "./PublicPage";

// 作り直し（設計書 2026-11-06-public-known-redesign §6）: 疑問のもくじ、いまの発生、相談先、節の要点と関係する画面。
// 国の文は原文のまま。作品側の文は国の文の枠の外に、見分けのつく見出しで出す。

const MEDICAL_ADVICE = /受診|治療|(?<!獣)医師に|病院へ|保健所/u;

function show(node = <PublicView reviewedOn="2026-11-04" />) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

afterEach(cleanup);

describe("もくじ（疑問の形）", () => {
  it("疑問と、その節の国の文の数と機関を出す。答え（国の文の言い換え）は書かない", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "もくじ" });
    const links = within(nav).getAllByRole("link");
    OFFICIAL_GUIDANCE.forEach((g, i) => {
      const a = links[i] as HTMLElement;
      expect(a.textContent).toContain(TOPIC_QUESTION[g.topic]);
      expect(a.textContent).toContain(`国の文 ${g.statements.length} つ`);
      for (const s of g.statements) expect(a.textContent).toContain(agencyOf(s.sourceTitle));
    });
    // 国の文の一部（10 字）をもくじに写していない
    for (const g of OFFICIAL_GUIDANCE) for (const s of g.statements) expect(nav.textContent).not.toContain(s.text.slice(0, 10));
  });

  it("機関は出典名の先頭から取る。法令は『法令』", () => {
    expect(agencyOf("農林水産省「鳥インフルエンザについて知りたい方へ」")).toBe("農林水産省");
    expect(agencyOf("厚生労働省・国立健康危機管理研究機構「Q&A」")).toBe("厚生労働省");
    expect(agencyOf("家畜伝染病予防法 第 24 条（発掘の禁止）")).toBe("法令");
    for (const g of OFFICIAL_GUIDANCE) for (const s of g.statements) expect(agencyOf(s.sourceTitle), s.sourceTitle).not.toBe("その他");
  });
});

describe("節の要点（作品側のまとめ）", () => {
  it("全 7 節に、見出しの直後、国の文より前に、作品側と分かる見出しで出る", () => {
    const { container } = show();
    expect(Object.keys(SECTION_LEADS).sort()).toEqual(OFFICIAL_GUIDANCE.map((g) => g.topic).sort());
    for (const g of OFFICIAL_GUIDANCE) {
      const sec = container.querySelector(`section#${g.topic}`) as HTMLElement;
      const lead = sec.querySelector("[data-role='section-lead']");
      if (!SECTION_LEADS[g.topic]) {
        expect(lead, g.topic).toBeNull();
        continue;
      }
      expect(lead, g.topic).not.toBeNull();
      expect((sec.querySelector("h2") as HTMLElement).nextElementSibling).toBe(lead);
      expect(lead?.textContent).toContain(LEAD_HEADING);
      expect(lead?.closest("[data-role='official']")).toBeNull();
      expect(lead?.querySelector("blockquote")).toBeNull();
    }
  });

  it("要点・疑問・リンクの名前に、禁止語、安心させる語、あおる語、受診の案内がない", () => {
    const texts = [...Object.values(SECTION_LEADS), ...Object.values(TOPIC_QUESTION), ...Object.values(SECTION_RELATED).flatMap((rs) => rs!.map((r) => r.label))];
    for (const t of texts) {
      expect(findForbiddenPhrases(t as string), t).toEqual([]);
      for (const w of [...REASSURANCE_WORDS, ...SENSATIONAL_WORDS]) expect(t, w).not.toContain(w);
      expect(t).not.toMatch(MEDICAL_ADVICE);
    }
  });

  it("関係する画面のリンクが節の最後に出る（数羽の節は /known#small-flock と対策項目、既存の地図のリンクも残る）", () => {
    const { container } = show();
    const sec = container.querySelector("section#small_flock") as HTMLElement;
    const hrefs = [...sec.querySelectorAll(".guidance-related a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/known#small-flock", "/todo"]);
    expect(within(sec).getByRole("link", { name: /地図/ }).getAttribute("href")).toBe("/");
  });
});

describe("相談先", () => {
  it("役場と家畜保健衛生所の一覧を、作品側のまとめとして 1 か所に出す（受診の案内はしない）", () => {
    const { container } = show();
    const box = container.querySelector("[data-role='contacts']") as HTMLElement;
    expect(box.textContent).toContain("作品側のまとめ");
    expect(box.textContent).toContain("市町村の役場");
    expect(within(box).getByRole("link", { name: "全国の一覧" }).getAttribute("href")).toBe("https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_kaho/");
    expect(box.textContent).not.toMatch(MEDICAL_ADVICE);
  });
});

describe("いまの発生への案内", () => {
  it("件数は出さず（このページは Firebase を読まない）、地図と過去の発生へ案内する。町は推測しない", () => {
    show(<PublicPage />);
    const box = screen.getByRole("region", { name: "いまの発生を見る" });
    const hrefs = within(box).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/compare"]);
    expect(box.textContent).not.toMatch(/\d+\s*件|野鳥|お近く|近くで発生/u);
  });
});
