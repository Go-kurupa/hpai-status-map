import { FIXED_TEXT } from "@hpai/shared/wording";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RISK_LINE_TEXT, RISK_SENTENCE, RISK_SHORT_TEXT, RISK_SOURCE_NAME, RISK_URL, RiskLine, RiskSource, TextItem } from "./RiskLine";

afterEach(cleanup);

describe("RiskLine（守る文の 1 行）", () => {
  it("「文（出典: 名前）」の形で、名前を出典の URL へのリンクにする。URL は本文に出さない", () => {
    const { container } = render(<RiskLine className="map-notice" />);
    const p = container.firstElementChild!;
    expect(p.tagName).toBe("P");
    expect(p.className).toBe("map-notice");
    expect(p.textContent).toBe("件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典: 農林水産省 疫学調査報告書）");
    expect(p.textContent).toBe(RISK_LINE_TEXT);
    expect(p.textContent).not.toContain("https://");
    const link = screen.getByRole("link", { name: "農林水産省 疫学調査報告書" });
    expect(link.getAttribute("href")).toBe(RISK_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("定数は FIXED_TEXT の文から取り出したもので、組み戻すと一字一句同じ", () => {
    expect(`${RISK_SENTENCE}（出典: ${RISK_SOURCE_NAME} ${RISK_URL}）`).toBe(FIXED_TEXT.riskAnywhere);
    expect(RISK_URL).toMatch(/^https:\/\/www\.maff\.go\.jp\/.+\.pdf$/u);
  });

  it("置き場に合わせて li や span にもなる。文の本体は要素の直下にあり、文の本体で探せる", () => {
    const { container } = render(
      <ul>
        <RiskLine as="li" />
      </ul>,
    );
    expect(container.querySelector("li")!.textContent).toBe(RISK_LINE_TEXT);
    expect(screen.getByText(RISK_SENTENCE, { exact: false }).tagName).toBe("LI");
    cleanup();
    render(<RiskLine as="span" />);
    expect(screen.getByText(RISK_SENTENCE, { exact: false }).tagName).toBe("SPAN");
  });
});

describe("RiskLine の短い形と RiskSource（スマホの札の前）", () => {
  it("短い形は「文（出典）」で、リンクの名前に出典の名前を持つ。URL は本文に出さない", () => {
    const { container } = render(<RiskLine short className="map-risk" />);
    expect(container.firstElementChild!.textContent).toBe("件数が少なくても、シーズン中はどこでも感染のリスクがあります（出典）");
    expect(container.firstElementChild!.textContent).toBe(RISK_SHORT_TEXT);
    const link = screen.getByRole("link", { name: "出典: 農林水産省 疫学調査報告書" });
    expect(link.getAttribute("href")).toBe(RISK_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("RiskSource は「出典: 名前」で、名前をリンクにする。URL は本文に出さない", () => {
    const { container } = render(<RiskSource className="map-risk-source" />);
    const p = container.firstElementChild!;
    expect(p.className).toBe("map-risk-source");
    expect(p.textContent).toBe("出典: 農林水産省 疫学調査報告書");
    const link = screen.getByRole("link", { name: RISK_SOURCE_NAME });
    expect(link.getAttribute("href")).toBe(RISK_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("TextItem（文字列の箇条書きの 1 行）", () => {
  it("守る文はリンクの形にし、URL を本文に出さない", () => {
    const { container } = render(
      <ul>
        <TextItem text={FIXED_TEXT.riskAnywhere} />
        <TextItem text={FIXED_TEXT.areaNoDistance} />
      </ul>,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe(RISK_LINE_TEXT);
    expect(items[0]!.querySelector("a")!.getAttribute("href")).toBe(RISK_URL);
    expect(items[1]!.textContent).toBe(FIXED_TEXT.areaNoDistance);
    expect(items[1]!.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain(RISK_URL);
  });
});
