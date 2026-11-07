import type { PastSummary } from "@hpai/shared/past";
import { findForbiddenPhrases, findWordingViolations, FIXED_TEXT } from "@hpai/shared/wording";
import { RISK_LINE_TEXT, RISK_SENTENCE, RISK_SOURCE_NAME, RISK_URL } from "../../ui/RiskLine";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NearbyPastState } from "./NearbyPast";
import { TownBanner, type TownBannerProps } from "./TownBanner";
import { TEXT } from "./texts";
import type { TownLine } from "./townLine";

const LINE: TownLine = { tone: "lv2", main: "隣町で発生しました", details: ["津山市で確定（12 月 20 日）"] };
const PAST: PastSummary = {
  sentence: "1 年前に隣町で発生しました（記録）",
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
      ago: "1 年前",
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
      ago: "1 年前",
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
  it("鶏舎の場所の行は、選択地域の行のすぐ下、段階の文より前に描く（2026-11-07 作者の決定 A）", () => {
    const { container } = show(props({ spotRow: <div className="spot-row-probe">鶏舎の場所</div> }));
    const row = container.querySelector(".town-name-row")!;
    expect(row.nextElementSibling?.className).toBe("spot-row-probe");
    const probe = container.querySelector(".spot-row-probe")!;
    const now = container.querySelector(".town-now")!;
    expect(probe.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("町を選んでいないときは鶏舎の場所の行を出さない", () => {
    show(props({ muniCode: null, muniName: null, spotRow: <div className="spot-row-probe">鶏舎の場所</div> }));
    expect(document.querySelector(".spot-row-probe")).toBeNull();
  });

  it("色（data-tone）は今季の段階の行だけ。過去の行とその中に data-tone がない（§15）", () => {
    const { container } = show(props());
    const toned = container.querySelectorAll("[data-tone]");
    expect(toned).toHaveLength(1);
    expect(toned[0]!.getAttribute("data-tone")).toBe("lv2");
    expect(toned[0]!.textContent).toContain("隣町で発生しました");
    const past = screen.getByText(/1 年前に隣町で発生しました（記録）/).closest(".town-past")!;
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

  it("town の画面では案内ページへのリンクを出す", () => {
    show(props());
    expect(screen.getByRole("link", { name: "この町の案内ページ（登録なしで開ける・共有用）" }).getAttribute("href")).toBe("/area/33214");
  });

  it("最初の画面では案内ページへのリンクを出さない（選択地域の過去を見るの 1 本。設計書 2026-11-06-town-picker D8）", () => {
    show(props({ pastBrief: true }));
    expect(screen.queryByRole("link", { name: TEXT.areaLink })).toBeNull();
    expect(screen.getByRole("link", { name: TEXT.townPastLink })).toBeTruthy();
  });

  it("名前の横に差し込める（地域を選択ボタンの置き場。設計書 2026-11-06-town-picker D1）", () => {
    show(props({ nameAction: <button type="button">x</button> }));
    const row = document.querySelector(".town-name-row")!;
    const btn = screen.getByRole("button", { name: "x" });
    expect(row.contains(btn)).toBe(true);
    expect(row.querySelector(".town-name")!.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("町を選んでいなければ町を選ぶ案内を出す。area へのリンクは出さない", () => {
    show(props({ muniCode: null, muniName: null, line: { tone: "none", main: "町を選んでください", details: [] }, past: { status: "idle" } }));
    expect(screen.getByText(TEXT.pickPrompt)).toBeTruthy();
    expect(screen.queryByRole("link", { name: TEXT.areaLink })).toBeNull();
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
    expect(screen.getByText(RISK_SENTENCE, { exact: false })).toBeTruthy();
    cleanup();
    show(
      props({
        line: { tone: "lv4", main: "全国の動きをお知らせしています", details: [FIXED_TEXT.riskAnywhere] },
        past: { status: "ready", summary: { sentence: "過去の記録に、この町と隣町の発生はありません（記録）", latest: null, hits: [] } },
      }),
    );
    expect(screen.getAllByText(RISK_SENTENCE, { exact: false })).toHaveLength(1);
  });

  it("画面の文に禁じた語がない", () => {
    show(props());
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
  });
});

describe("TownBanner: 周辺の町の過去の発生", () => {
  const NEARBY: NearbyPastState = {
    status: "ready",
    basis: "mesh",
    summary: {
      towns: [
        { muniCode: "33214", name: "真庭市", distanceKm: 0, count: 1, seasons: [2025] },
        { muniCode: "33203", name: "津山市", distanceKm: 12.4, count: 2, seasons: [2024, 2022] },
      ],
      total: 3,
      seasonsWithCases: 3,
      windowSeasons: 6,
    },
    smallFlocks: { total: 247, known: 247, small: 15 },
    current: 2026,
  };

  it("畳んだ外に合計を出し、開くと近い順の表と距離の説明がある。既存の『この町』『隣町』の文は残る", () => {
    show(props({ nearby: NEARBY }));
    expect(screen.getByText(/1 年前に隣町で発生しました（記録）/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "過去の発生" })).getAllByRole("listitem")[0]!.textContent).toContain("隣町");
    const box = document.querySelector(".nearby-past")!;
    expect(box.closest("[data-tone]")).toBeNull();
    expect(box.querySelector("details:not([open])")).toBeTruthy();
    expect(box.textContent).toContain(TEXT.nearbyTotal(3, 3, 6));
    const table = within(box as HTMLElement).getByRole("table", { name: TEXT.nearbyAria, hidden: true });
    const rows = within(table).getAllByRole("row", { hidden: true }).slice(1);
    expect(rows.map((r) => r.querySelector("th")!.textContent)).toEqual(["真庭市", "津山市"]);
    expect(rows[0]!.textContent).toContain("この町");
    expect(rows[1]!.textContent).toContain("約 12 km");
    expect(rows[1]!.textContent).toContain("2 件");
    expect(rows[1]!.textContent).toContain("2 年前、4 年前");
    expect(box.textContent).toContain(TEXT.nearbyBasisMesh);
    expect(box.textContent).toContain(TEXT.statBandRelated);
    expect(box.textContent).toContain(TEXT.smallFlocks(6, 247, 247, 15));
    expect(document.querySelector(".town-past > p")!.textContent).toMatch(/^過去の記録 .+（記録）$/u);
  });

  it("町だけのときは中心どうしの説明。距離が 1km 未満の別の町は『約 1 km 未満』", () => {
    const summary = { ...NEARBY.summary, towns: [{ muniCode: "33203", name: "津山市", distanceKm: 0.4, count: 1, seasons: [2025] }] };
    show(props({ nearby: { ...NEARBY, basis: "center", summary } }));
    const box = document.querySelector(".nearby-past")!;
    expect(box.textContent).toContain(TEXT.nearbyBasisCenter);
    expect(box.textContent).not.toContain(TEXT.nearbyBasisMesh);
    expect(box.textContent).toContain("約 1 km 未満");
  });

  it("周辺に記録がなくても『何もない』で終わらせない。表を出さず、riskAnywhere を 1 つだけ添える", () => {
    const summary = { towns: [], total: 0, seasonsWithCases: 0, windowSeasons: 6 };
    const none: PastSummary = { sentence: "過去の記録に、この町と隣町の発生はありません（記録）", latest: null, hits: [] };
    show(props({ nearby: { ...NEARBY, summary }, past: { status: "ready", summary: none } }));
    expect(document.querySelector(".nearby-past table")).toBeNull();
    expect(document.querySelector(".nearby-past")!.textContent).toContain(TEXT.nearbyNone(60, 6));
    expect(screen.getAllByText(RISK_SENTENCE, { exact: false })).toHaveLength(1);
    cleanup();
    show(props({ nearby: { ...NEARBY, summary } })); // 町と隣町に記録があり、今季の行に riskAnywhere がない
    expect(screen.getAllByText(RISK_SENTENCE, { exact: false })).toHaveLength(1);
  });

  it("読み込み中と失敗を分ける。0 件と書かない。過去の行が読めていない間は重ねて出さない", () => {
    show(props({ nearby: { status: "loading" } }));
    expect(screen.getByText(TEXT.nearbyLoading)).toBeTruthy();
    cleanup();
    show(props({ nearby: { status: "failed" } }));
    expect(screen.getByRole("alert").textContent).toBe(TEXT.nearbyFailed);
    cleanup();
    show(props({ nearby: { status: "failed" }, past: { status: "failed" } }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/ 0 件/u);
  });

  it("比べるシーズンがなければ出さない", () => {
    show(props({ nearby: { ...NEARBY, summary: { towns: [], total: 0, seasonsWithCases: 0, windowSeasons: 0 } } }));
    expect(document.querySelector(".nearby-past")).toBeNull();
  });

  it("新しい文に書かない語がない。距離に『約』が付く", () => {
    const words = [
      TEXT.nearbyTitle(60, 6),
      TEXT.nearbyTotal(3, 3, 6),
      TEXT.nearbyNone(60, 6),
      TEXT.nearbyDetails,
      TEXT.nearbyAria,
      TEXT.nearbyBasisCenter,
      TEXT.nearbyBasisMesh,
      TEXT.nearbyLoading,
      TEXT.nearbyFailed,
      TEXT.smallFlocks(6, 247, 247, 15),
    ].join("");
    expect(findWordingViolations(words)).toEqual([]);
    expect(words).not.toMatch(/問題ありません|区域|多い|少ない/);
    expect(TEXT.nearbyTitle(60, 6)).toContain("約 60 km");
    expect(TEXT.nearbyDistance(12.4)).toBe("約 12 km");
    expect(TEXT.nearbyDistance(0.4)).toBe("約 1 km 未満");
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

  it("案内ページへのリンクは tap-link", () => {
    show(props());
    expect(screen.getByRole("link", { name: TEXT.areaLink }).className).toContain("tap-link");
  });
});

describe("TownBanner: 最初の画面の過去の記録（近くの自治体のボタン）", () => {
  const NEARBY: NearbyPastState = {
    status: "ready",
    basis: "center",
    summary: {
      // 近い順で渡ってくる。画面では件数の多い順、同じなら近い順に並べ直す
      towns: [
        { muniCode: "33214", name: "真庭市", distanceKm: 0, count: 1, seasons: [2025] },
        { muniCode: "33202", name: "津山市", distanceKm: 12.4, count: 3, seasons: [2024, 2022, 2021] },
        { muniCode: "33205", name: "新見市", distanceKm: 20.1, count: 1, seasons: [2023] },
        { muniCode: "33204", name: "高梁市", distanceKm: 30.2, count: 3, seasons: [2024, 2023, 2022] },
      ],
      total: 8,
      seasonsWithCases: 4,
      windowSeasons: 6,
    },
    smallFlocks: { total: 0, known: 0, small: 0 },
    current: 2026,
  };

  it("pastBrief と onPickTown なら、件数の多い順（同じなら近い順）の「名前 N 件」のボタンと、1 文を出す。押すと市町村コードが渡る", () => {
    const onPickTown = vi.fn();
    show(props({ pastBrief: true, nearby: NEARBY, onPickTown }));
    const list = document.querySelector("ul.town-cases-picks")!;
    const buttons = [...list.querySelectorAll("button[data-muni]")];
    expect(buttons.map((b) => b.textContent)).toEqual(["津山市 3 件", "高梁市 3 件", "真庭市 1 件", "新見市 1 件"]);
    expect(buttons.map((b) => b.getAttribute("data-muni"))).toEqual(["33202", "33204", "33214", "33205"]);
    expect(buttons[0]!.textContent).toBe(TEXT.pastPick("津山市", 3));
    expect(document.body.textContent).toContain(TEXT.pastNearby(4, 8, 2020, 2026));
    fireEvent.click(buttons[1]!);
    expect(onPickTown).toHaveBeenCalledTimes(1);
    expect(onPickTown).toHaveBeenCalledWith("33204");
    expect(screen.getByRole("link", { name: TEXT.townPastLink })).toBeTruthy();
  });

  it("onPickTown を渡さなければボタンを出さず、今までの 1 文にする", () => {
    show(props({ pastBrief: true, nearby: NEARBY }));
    expect(document.querySelector("ul.town-cases-picks")).toBeNull();
    expect(document.body.textContent).toContain(PAST.sentence);
  });

  it("hideNationalHead なら「全国の動き」の見出しを出さず、下の文（details）は残す", () => {
    const line: TownLine = { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.riskAnywhere] };
    show(props({ line, hideNationalHead: true }));
    expect(document.querySelector("p.town-main")).toBeNull();
    expect(document.body.textContent).not.toContain(TEXT.national);
    expect(document.querySelector(".town-details")!.textContent).toContain("シーズン中はどこでも");
  });

  it("町の文の箇条書きにある守る文は「出典: 名前」のリンクにし、URL を本文に出さない（地図の下に置く残りの行も同じ）", () => {
    const line: TownLine = { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.areaNoDistance, FIXED_TEXT.riskAnywhere] };
    for (const part of ["all", "rest"] as const) {
      show(props({ line, part }));
      const items = [...document.querySelectorAll(".town-details li")].map((li) => li.textContent);
      expect(items, part).toEqual([FIXED_TEXT.areaNoDistance, RISK_LINE_TEXT]);
      expect(screen.getByRole("link", { name: RISK_SOURCE_NAME }).getAttribute("href"), part).toBe(RISK_URL);
      expect(document.body.textContent, part).not.toContain(RISK_URL);
      cleanup();
    }
  });

  it("hideNationalHead でなければ見出しを出す。全国でない行（隣町など）は hideNationalHead でも見出しが残る", () => {
    const line: TownLine = { tone: "lv4", main: TEXT.national, details: [FIXED_TEXT.riskAnywhere] };
    show(props({ line }));
    expect(document.querySelector("p.town-main")!.textContent).toBe(TEXT.national);
    cleanup();
    show(props({ hideNationalHead: true }));
    expect(document.querySelector("p.town-main")!.textContent).toBe(LINE.main);
  });
});

describe("時刻つきの文（スマホの地図の前は短い文、時刻は地図の下。2026-11-07 作者の決定）", () => {
  const timed = {
    tone: "none" as const,
    main: "この県のホームページを、11 月 4 日 1:00 から読み込めていません。発生がないとは言えません",
    details: ["全国どこでも"],
    lead: { main: "この県のホームページを読み込めていません。発生がないとは言えません", note: "読み込めなくなったのは 11 月 4 日 1:00 からです" },
  };
  it("地図の前（lead）は短い文だけ", () => {
    const { container } = show(props({ line: timed, part: "lead" }));
    expect(container.querySelector(".town-main")?.textContent).toBe(timed.lead.main);
    expect(container.textContent).not.toContain("1:00");
  });
  it("地図の下（rest）は、時刻の行を先頭に、残りの行を続ける", () => {
    const { container } = show(props({ line: timed, part: "rest" }));
    expect([...container.querySelectorAll(".town-details li")].map((li) => li.textContent)).toEqual([timed.lead.note, "全国どこでも"]);
  });
  it("PC（all）は時刻つきの 1 文のまま。時刻の行は重ねない", () => {
    const { container } = show(props({ line: timed }));
    expect(container.querySelector(".town-main")?.textContent).toBe(timed.main);
    expect(container.textContent).not.toContain(timed.lead.note);
  });
});
