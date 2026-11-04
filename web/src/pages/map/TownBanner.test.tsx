import type { PastSummary } from "@hpai/shared/past";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { TownBanner, type TownBannerProps } from "./TownBanner";
import { TEXT } from "./texts";
import type { TownLine } from "./townLine";

const LINE: TownLine = { tone: "lv2", main: "隣町で発生しました", details: ["津山市で確定（12 月 20 日）"] };
const PAST: PastSummary = {
  sentence: "昨季に隣町で発生しました（記録）",
  latest: null,
  hits: [
    {
      season: 2025,
      no: 8,
      prefCode: "33",
      muniCode: "33203",
      muniNameThen: "津山市",
      date: "2025-12-20",
      birdUse: "採卵鶏",
      housing: null,
      headCount: 430000,
      sourceUrl: "https://example.invalid/a",
      related: false,
      ago: "昨季",
      relation: "adjacent",
      parentDate: null,
    },
    {
      season: 2025,
      no: 8,
      prefCode: "33",
      muniCode: "33203",
      muniNameThen: "津山市",
      date: "2026-01-05", // 関連農場自身の日付（本体の発生日とは別。画面に出してはいけない）
      birdUse: "採卵鶏",
      housing: null,
      headCount: 10000,
      sourceUrl: "https://example.invalid/a",
      related: true,
      ago: "昨季",
      relation: "adjacent",
      parentDate: "2025-12-20",
    },
  ],
};

function props(o: Partial<TownBannerProps> = {}): TownBannerProps {
  return {
    muniCode: "33214",
    muniName: "真庭市",
    loaded: true,
    line: LINE,
    lineFailed: false,
    past: { status: "ready", summary: PAST },
    showPastDisclaimer: true,
    ...o,
  };
}

function show(p: TownBannerProps) {
  return render(
    <MemoryRouter>
      <TownBanner {...p}>
        <p>選び方</p>
      </TownBanner>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("TownBanner: 読めないとき（T10）", () => {
  it("slow でなければ読み込み直しの案内を出さない", () => {
    show(props({ loaded: false, line: null }));
    expect(screen.getByText(TEXT.loading)).toBeTruthy();
    expect(document.body.textContent).not.toContain(TEXT.slowLoad);
  });
  it("slow なら読み込み中の文を残したまま、案内を同じ枠に足す", () => {
    show(props({ loaded: false, line: null, slow: true }));
    const wait = document.querySelector(".state-wait")!;
    expect(wait.textContent).toContain(TEXT.loading);
    expect(wait.textContent).toContain(TEXT.slowLoad);
  });
});

describe("TownBanner", () => {
  it("色（data-tone）は今季の段階の行だけ。過去の行とその中に data-tone がない（§15）", () => {
    const { container } = show(props());
    const toned = container.querySelectorAll("[data-tone]");
    expect(toned).toHaveLength(1);
    expect(toned[0]!.getAttribute("data-tone")).toBe("lv2");
    expect(toned[0]!.textContent).toContain("隣町で発生しました");
    const past = screen.getByText(/昨季に隣町で発生しました（記録）/).closest(".town-past")!;
    expect(past.querySelector("[data-tone]")).toBeNull();
    expect(past.closest("[data-tone]")).toBeNull();
    expect(past.textContent).toContain(FIXED_TEXT.pastDisclaimer);
  });

  it("今季の事例を読めていない間は『読み込んでいます』で、段階の文も色もない（§2）", () => {
    const { container } = show(props({ loaded: false, line: null }));
    expect(screen.getByText(/読み込んでいます/)).toBeTruthy();
    expect(container.querySelector("[data-tone]")).toBeNull();
    expect(screen.queryByText("隣町で発生しました")).toBeNull(); // 段階の文（過去の行の「…（記録）」とは別）
    expect(screen.queryByText("津山市で確定（12 月 20 日）")).toBeNull();
    expect(document.body.textContent).not.toContain("全国の動きをお知らせしています");
  });

  it("段階の計算に失敗したときは『読めませんでした』で、段階の文も色もない", () => {
    const { container } = show(props({ line: null, lineFailed: true }));
    expect(screen.getByRole("alert").textContent).toContain("読めませんでした");
    expect(container.querySelector("[data-tone]")).toBeNull();
  });

  it("町の案内ページ /area/{code} へのリンクがある", () => {
    show(props());
    expect(screen.getByRole("link", { name: /この町のくわしい状況/ }).getAttribute("href")).toBe("/area/33214");
  });

  it("町を選んでいなければ『町を選んでください』。area へのリンクは出さない", () => {
    show(props({ muniCode: null, muniName: null, line: { tone: "none", main: "町を選んでください", details: [] }, past: { status: "idle" } }));
    expect(screen.getByText("町を選んでください")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /この町のくわしい状況/ })).toBeNull();
  });

  it("町の名前と、選び方の部品（children）を出す", () => {
    show(props());
    expect(screen.getByText("真庭市")).toBeTruthy();
    expect(screen.getByText("選び方")).toBeTruthy();
  });

  it("過去の記録が読めていない間は、読み込み中と失敗を分けて書く（0 件にしない）", () => {
    show(props({ past: { status: "loading" } }));
    expect(screen.getByText(/過去の記録を読み込んでいます/)).toBeTruthy();
    cleanup();
    show(props({ past: { status: "failed" } }));
    expect(screen.getByText(/過去の記録を読めませんでした/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/発生はありません/);
  });

  it("過去のシーズンを見ているときは、ページが出している pastDisclaimer を重ねない", () => {
    show(props({ showPastDisclaimer: false }));
    expect(document.body.textContent).not.toContain(FIXED_TEXT.pastDisclaimer);
  });

  it("過去の記録が空でも『何もない』で終わらせない。riskAnywhere を添える（今季の行にまだなければ）", () => {
    show(props({ past: { status: "ready", summary: { sentence: "過去の記録に、この町と隣町の発生はありません（記録）", latest: null, hits: [] } } }));
    expect(screen.getByText(FIXED_TEXT.riskAnywhere)).toBeTruthy();
    cleanup();
    show(
      props({
        line: { tone: "lv4", main: "全国の動きをお知らせしています", details: [FIXED_TEXT.riskAnywhere] },
        past: { status: "ready", summary: { sentence: "過去の記録に、この町と隣町の発生はありません（記録）", latest: null, hits: [] } },
      }),
    );
    expect(screen.getAllByText(FIXED_TEXT.riskAnywhere)).toHaveLength(1);
  });

  it("画面の文に禁じた語がない", () => {
    show(props());
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("過去の発生の一覧（PastList）", () => {
  it('関連農場は「関連農場」と明示し、日付は本体の日付として出す。自分の発生日とは書かない', () => {
    show(props());
    const list = screen.getByRole("list", { name: "過去の発生" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("津山市");
    expect(items[0]!.textContent).toContain("隣町");
    expect(items[0]!.textContent).toContain("12 月 20 日");
    expect(items[1]!.textContent).toContain("関連農場");
    expect(items[1]!.textContent).toMatch(/8 例目/);
    expect(items[1]!.textContent).toMatch(/12 月 20 日の発生に関連/);
    expect(items[1]!.textContent).not.toMatch(/12 月 20 日に発生/);
    // 関連農場の行の日付（h.date = 1 月 5 日）は出さない。本体の日付だけを出す
    expect(items[1]!.textContent).not.toMatch(/1 月 5 日/);
  });

  it("本体が history にない関連農場は、日付を出さない", () => {
    const orphan: PastSummary = { ...PAST, hits: [{ ...PAST.hits[1]!, parentDate: null }] };
    show(props({ past: { status: "ready", summary: orphan } }));
    const li = within(screen.getByRole("list", { name: "過去の発生" })).getByRole("listitem");
    expect(li.textContent).toContain("8 例目の関連農場");
    expect(li.textContent).not.toMatch(/月.*日/);
  });

  it("予測や煽りの言葉がない（§11）", () => {
    show(props());
    expect(document.body.textContent).not.toMatch(/また発生しやすい|危ない|うつる|危険地帯|ホットスポット|確率/);
  });

  it("読み込み中は state-wait、失敗は state-unknown。role と文はそのまま。town-now-wait は使わない", () => {
    const a = show(props({ loaded: false }));
    const wait = within(a.container).getByRole("status", { name: "" });
    expect(wait.className).toBe("state-wait");
    expect(wait.textContent).toBe(TEXT.loading);
    expect(a.container.querySelector(".town-now-wait")).toBeNull();
    cleanup();
    const b = show(props({ lineFailed: true }));
    const bad = within(b.container).getByRole("alert");
    expect(bad.className).toBe("state-unknown");
    expect(bad.textContent).toBe(TEXT.loadFailed);
    expect(b.container.querySelector(".town-now-wait")).toBeNull();
  });

  it("『この町のくわしい状況』のリンクは tap-link", () => {
    show(props());
    expect(screen.getByRole("link", { name: /この町のくわしい状況/ }).className).toContain("tap-link");
  });
});
