import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import KnownPage, { KnownView } from "./KnownPage";
import { KNOWN_FINDINGS, PAST_BASIS, type KnownFinding } from "./knownFindings";

// 「分かっていること」（§11）。研究の知見を、決まり（公式の文）と分けて示す固定のページ。AI は答えない。
// 文の元は、原本（論文の DOI、国の文書）で確かめた日（verifiedOn）を持つ。確かめていない行は画面に出さない。

const FORBIDDEN = /また発生しやすい|この町も危ない|隣町からうつる|危険地帯|ホットスポット|感染確率|[8８]\s*割/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function show(node = <KnownPage />) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

function strings(f: KnownFinding): string[] {
  return [f.text, f.region, f.period, f.certaintyNote ?? "", f.limit, ...f.sources.map((s) => s.title)];
}

afterEach(cleanup);

describe("KNOWN_FINDINGS（データ）", () => {
  it("設計書 §11 の 7 行が、決まった順で並ぶ", () => {
    expect(KNOWN_FINDINGS.map((f) => f.id)).toEqual([
      "recurrence",
      "basic-management",
      "water-and-flock-size",
      "small-flock",
      "changing-shoes",
      "standard-measures",
      "neighbor-cases",
    ]);
  });

  it("どの行も、文・地域・時期・確からしさ・限界・出典がそろう", () => {
    for (const f of KNOWN_FINDINGS) {
      expect(f.text.length, f.id).toBeGreaterThan(20);
      expect(f.region.length, f.id).toBeGreaterThan(0);
      expect(f.period.length, f.id).toBeGreaterThan(0);
      expect(["高い", "中くらい", "低い"], f.id).toContain(f.certainty);
      expect(f.limit.length, f.id).toBeGreaterThan(20);
      expect(f.sources.length, f.id).toBeGreaterThan(0);
      for (const s of f.sources) {
        expect(s.title.length, f.id).toBeGreaterThan(0);
        expect(s.url, f.id).toMatch(/^https:\/\//);
      }
      if (f.verifiedOn !== null) expect(f.verifiedOn, f.id).toMatch(ISO_DATE);
    }
  });

  it("文にも出典名にも、禁止語がない（『また発生しやすい』などの予測や、安全・安心）", () => {
    for (const f of KNOWN_FINDINGS) {
      for (const s of strings(f)) {
        expect(s, `${f.id}: ${s}`).not.toMatch(FORBIDDEN);
        expect(findForbiddenPhrases(s), `${f.id}: ${s}`).toEqual([]);
      }
    }
  });

  it("基準の対策の行に『実施を勧めないという意味ではありません』がある", () => {
    const row = KNOWN_FINDINGS.find((f) => f.id === "standard-measures");
    expect(row?.text).toContain("実施を勧めないという意味ではありません");
  });

  it("効果の大きさを示す数字（何割減る、何倍）を、対策の行に書いていない", () => {
    const row = KNOWN_FINDINGS.find((f) => f.id === "standard-measures");
    for (const s of row ? strings(row) : []) expect(s).not.toMatch(/[0-9０-９]\s*(割|倍)|%|％/u);
  });

  it("PAST_BASIS は国の報告書の一文で、出典は農林水産省", () => {
    expect(PAST_BASIS.text).toContain("地域としての感染予防対策");
    expect(new URL(PAST_BASIS.sourceUrl).hostname).toBe("www.maff.go.jp");
    expect(PAST_BASIS.sourceTitle).toContain("疫学調査報告書");
    if (PAST_BASIS.verifiedOn !== null) expect(PAST_BASIS.verifiedOn).toMatch(ISO_DATE);
    expect(PAST_BASIS.text).not.toMatch(FORBIDDEN);
    expect(findForbiddenPhrases(PAST_BASIS.text)).toEqual([]);
  });
});

describe("KnownPage（画面）", () => {
  it("入力欄がなく、『研究の知見です。決まりではありません』がある", () => {
    const { container } = show();
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "分かっていること" })).toBeTruthy();
    expect(document.body.textContent).toContain("研究の知見です。決まりではありません");
    expect(document.body.textContent).toContain("質問に答える機能はありません");
  });

  it("公式の文の見た目（GuidanceSection、引用ブロック）を使わない", () => {
    const { container } = show();
    expect(container.querySelectorAll("[data-role='official'], blockquote, section.guidance")).toHaveLength(0);
    const src = readFileSync(path.resolve(import.meta.dirname, "KnownPage.tsx"), "utf8");
    expect(src).not.toMatch(/import[^;]*GuidanceSection/u);
    expect(src).not.toMatch(/<GuidanceSection/u);
  });

  it("確かめた行だけが出て、行ごとに地域・時期・確からしさ・限界・出典・確認日がある", () => {
    const { container } = show();
    const shown = KNOWN_FINDINGS.filter((f) => f.verifiedOn !== null);
    const items = [...container.querySelectorAll("[data-role='finding']")] as HTMLElement[];
    expect(items.map((el) => el.getAttribute("data-id"))).toEqual(shown.map((f) => f.id));
    shown.forEach((f, i) => {
      const el = items[i] as HTMLElement;
      expect(el.textContent, f.id).toContain(f.text);
      expect(el.textContent, f.id).toContain(f.region);
      expect(el.textContent, f.id).toContain(f.period);
      expect(el.textContent, f.id).toContain(`確からしさ: ${f.certainty}`);
      expect(el.textContent, f.id).toContain(f.limit);
      expect(el.textContent, f.id).toContain(`確認日 ${f.verifiedOn}`);
      for (const s of f.sources) {
        const a = within(el).getByRole("link", { name: s.title });
        expect(a.getAttribute("href")).toBe(s.url);
        expect(a.getAttribute("rel")).toContain("noopener");
      }
    });
  });

  it("verifiedOn が null の行は出さない（文も出典も）", () => {
    const base = KNOWN_FINDINGS[0] as KnownFinding;
    const second = KNOWN_FINDINGS[1] as KnownFinding;
    const hidden: KnownFinding = { ...base, id: "hidden-row", text: "この文は確かめていないので出ない。".repeat(2), verifiedOn: null };
    const { container } = show(<KnownView findings={[hidden, { ...second, verifiedOn: "2026-11-04" }]} />);
    const items = [...container.querySelectorAll("[data-role='finding']")];
    expect(items.map((el) => el.getAttribute("data-id"))).toEqual([second.id]);
    expect(document.body.textContent).not.toContain("この文は確かめていない");
  });

  it("確かめた行が 1 つもないときは、準備中と示し、空の一覧を出さない", () => {
    const base = KNOWN_FINDINGS[0] as KnownFinding;
    const { container } = show(<KnownView findings={[{ ...base, verifiedOn: null }]} />);
    expect(container.querySelectorAll("[data-role='finding']")).toHaveLength(0);
    expect(container.querySelectorAll("ol, ul li")).toHaveLength(0);
    expect(document.body.textContent).toContain("確かめが終わった文から");
  });

  it("確からしさが『低い』の行は、何について低いのかが画面に出る", () => {
    const { container } = show();
    for (const el of container.querySelectorAll("[data-role='finding']")) {
      const f = KNOWN_FINDINGS.find((x) => x.id === el.getAttribute("data-id")) as KnownFinding;
      if (f.certaintyNote !== null) expect(el.textContent, f.id).toContain(f.certaintyNote);
    }
  });

  it("ページ全体に、禁止語（予測の言い方、安全・安心）がない", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(findForbiddenPhrases(text)).toEqual([]);
  });

  it("鶏を飼っていない方へ（/public）と、地図へのリンクがある", () => {
    show();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/public");
    expect(hrefs).toContain("/");
  });
});
