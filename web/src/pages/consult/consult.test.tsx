// 対策の相談の画面。相談の関数（consultAskCall）、カードの一覧、足した項目の口は偽物に差し替える。
import { CONSULT_TOPICS } from "@hpai/shared/consult/topics";
import { CONSULT_DAILY_LIMIT, type ConsultAnswerCard, type ConsultCard, type ConsultSource } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT } from "@hpai/shared/consult/validate";
import { findWordingViolations } from "@hpai/shared/wording";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordStoreProvider } from "../../data/context";
import type { RecordStore } from "../../data/types";
import type { ConsultAskResponse } from "@hpai/shared/consult/types";
import { CONSULT_TEXT, attributionText } from "./consultTexts";

const box = vi.hoisted(() => ({
  ask: vi.fn(),
  reviews: { addReview: vi.fn(), listReviews: vi.fn(), removeReview: vi.fn() },
  auth: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} } as unknown,
}));
vi.mock("../auth/callables", () => ({ consultAskCall: (...a: unknown[]) => box.ask(...a) }));
vi.mock("./reviewStore", () => ({ useReviewStore: () => box.reviews }));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => box.auth }));

import ConsultPage from "./ConsultPage";

const SOURCES: ConsultSource[] = [
  {
    id: "maff-s1", title: "飼養衛生管理基準遵守指導の手引き", publisher: "農林水産省", url: "https://www.maff.go.jp/example.pdf",
    fetchedAt: "2026-11-06", domestic: true, kind: "guide", license: "PDL1.0", licenseVerified: true, studyDesign: null,
  },
  {
    id: "aphis-s1", title: "Table Egg Layers Case-Control Study", publisher: "USDA APHIS（米国農務省 動植物検疫局）", url: "https://www.aphis.usda.gov/example.pdf",
    fetchedAt: "2026-11-06", domestic: false, kind: "report", license: "US Gov", licenseVerified: true, studyDesign: null,
  },
];
const CARD_JP: ConsultCard = {
  id: "maff-M07", origin: "M07", action: "着替え・履き替えの前後の動線を分ける", appliesTo: "すべての農場", evidence: "obligation",
  evidenceNote: "条文", quote: "更衣の前後に利用する経路を一方通行とすること", sourceId: "maff-s1", locator: "印刷頁 10",
  caveats: ["完熟堆肥のみの保管では不要との記載がある", "小規模な農場には、この資料からは言えない"], conditionTags: [], approved: true,
};
const CARD_US: ConsultCard = {
  id: "aphis-A01", origin: "A01", action: "鶏舎の入口で専用の靴に履き替える", appliesTo: "採卵鶏の農場", evidence: "study-association",
  evidenceNote: "症例対照研究", quote: "changing shoes at the barn entrance was a protective factor", sourceId: "aphis-s1", locator: "p.2",
  caveats: [], conditionTags: [], approved: true,
};

// 応答のカードは、カードのデータに資料の情報が付いたもの（画面は静的な cards.json を読まない）
function ans(card: ConsultCard, src: ConsultSource | undefined = SOURCES.find((x) => x.id === card.sourceId)): ConsultAnswerCard {
  const s = src!;
  return { ...card, source: { id: s.id, title: s.title, publisher: s.publisher, url: s.url, domestic: s.domestic, license: s.license } };
}

function reply(over: Partial<ConsultAskResponse> = {}): ConsultAskResponse {
  return { answer: "履き替えの前後で動線を分けてください。", cards: [ans(CARD_JP), ans(CARD_US)], outOfScope: false, notice: null, ...over };
}

const store = { mode: "firestore" } as unknown as RecordStore;
function renderPage(url = "/consult") {
  return render(
    <RecordStoreProvider value={store}>
      <MemoryRouter initialEntries={[url]}>
        <ConsultPage />
      </MemoryRouter>
    </RecordStoreProvider>,
  );
}
const input = () => screen.getByLabelText(CONSULT_TEXT.questionLabel) as HTMLTextAreaElement;
const askButton = () => screen.getByRole("button", { name: CONSULT_TEXT.ask });

beforeEach(() => {
  box.ask.mockReset();
  box.reviews.addReview.mockReset().mockResolvedValue(undefined);
  box.reviews.listReviews.mockReset().mockResolvedValue([]);
  box.reviews.removeReview.mockReset().mockResolvedValue(undefined);
  box.auth = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("対策の相談の画面", () => {
  it("題と案内、話題の 7 つ、文の欄（例の文つき）、画面の下の 1 行がいつも出る", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "鳥インフルの対策の相談" })).toBeTruthy();
    expect(screen.getByText("話題を選ぶか、聞きたいことを書いてください。")).toBeTruthy();
    const topics = within(screen.getByRole("group", { name: CONSULT_TEXT.topicsLabel })).getAllByRole("button");
    expect(topics.map((b) => b.textContent)).toEqual(CONSULT_TOPICS.map((t) => t.label));
    expect(topics).toHaveLength(7);
    expect(input().placeholder).toBe("例: 平飼いで 500 羽。長靴の消毒はどうしたら？");
    expect(screen.getByText(CONSULT_TEXT.footer)).toBeTruthy();
    expect(CONSULT_TEXT.footer).toBe(
      "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。",
    );
  });

  it("文の欄が空（空白だけも）なら「聞く」を押せない。300 字を越える文は入らない", () => {
    renderPage();
    expect((askButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "   " } });
    expect((askButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "長靴の消毒は？" } });
    expect((askButton() as HTMLButtonElement).disabled).toBe(false);
    expect(input().maxLength).toBe(300);
  });

  it("話題を押すと、その話題の id ですぐ聞く。送っている間、聞いた文の欄に話題の文が出る", async () => {
    let done: (r: ConsultAskResponse) => void = () => {};
    box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
    renderPage();
    const topic = CONSULT_TOPICS[1]!;
    fireEvent.click(screen.getByRole("button", { name: topic.label }));
    await waitFor(() => expect(box.ask).toHaveBeenCalledTimes(1));
    expect(box.ask).toHaveBeenCalledWith({ topicId: topic.id }, false);
    expect(input().value).toBe(topic.question);
    done(reply());
    await screen.findByText(CONSULT_TEXT.advice);
    // 自分の文の吹き出しにも話題の文
    expect(within(screen.getByTestId("consult-entry")).getByText(topic.question)).toBeTruthy();
  });

  it("文で聞くと、その文（前後の空白を除く）で呼ばれる。答えたら欄は空になる", async () => {
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "  長靴の消毒はどうしたら？ " } });
    fireEvent.click(askButton());
    await waitFor(() => expect(box.ask).toHaveBeenCalledWith({ question: "長靴の消毒はどうしたら？" }, false));
    await screen.findByText(CONSULT_TEXT.advice);
    expect(input().value).toBe("");
  });

  it("送っている間は「聞いています…」と出て、聞くボタンと話題のボタンを押せない", async () => {
    let done: (r: ConsultAskResponse) => void = () => {};
    box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    const busy = await screen.findByRole("button", { name: "聞いています…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    for (const b of within(screen.getByRole("group", { name: CONSULT_TEXT.topicsLabel })).getAllByRole("button")) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(busy);
    expect(box.ask).toHaveBeenCalledTimes(1);
    done(reply());
    await screen.findByText(CONSULT_TEXT.advice);
    expect(screen.queryByRole("button", { name: "聞いています…" })).toBeNull();
  });

  it("おすすめの枠と、カードの対策・根拠の札・引用・資料名と発行者とリンク・注意書き・追加のボタンが、データどおり出る", async () => {
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const advice = screen.getByTestId("consult-advice");
    expect(within(advice).getByText("履き替えの前後で動線を分けてください。")).toBeTruthy();

    const cards = screen.getAllByTestId("consult-card");
    expect(cards).toHaveLength(2);
    const jp = within(cards[0]!);
    expect(jp.getByText(CARD_JP.action)).toBeTruthy();
    expect(jp.getByText("義務")).toBeTruthy();
    const quote = cards[0]!.querySelector("blockquote")!;
    expect(quote.textContent).toBe(CARD_JP.quote);
    expect(jp.getByRole("link", { name: /飼養衛生管理基準遵守指導の手引き/ }).getAttribute("href")).toBe("https://www.maff.go.jp/example.pdf");
    expect(cards[0]!.textContent).toContain("農林水産省");
    for (const c of CARD_JP.caveats) expect(jp.getByText(c)).toBeTruthy();
    expect(jp.queryByText(CONSULT_TEXT.foreign)).toBeNull(); // 国内の資料には出さない
    expect(jp.getByRole("button", { name: CONSULT_TEXT.add })).toBeTruthy();

    const us = within(cards[1]!);
    expect(us.getByText("研究で関係あり")).toBeTruthy();
    expect(us.getByText("日本と飼い方が違う可能性があります。")).toBeTruthy();
    expect(cards[1]!.textContent).toContain("USDA APHIS");
  });

  it("前の相談が残り、新しい相談は下に足される（新しい相談の位置へ動く）", async () => {
    box.ask.mockResolvedValueOnce(reply({ answer: "一つ目の答え" })).mockResolvedValueOnce(reply({ answer: "二つ目の答え", cards: [ans(CARD_US)] }));
    renderPage();
    fireEvent.change(input(), { target: { value: "一つ目の問い" } });
    fireEvent.click(askButton());
    await screen.findByText("一つ目の答え");
    fireEvent.change(input(), { target: { value: "二つ目の問い" } });
    fireEvent.click(askButton());
    await screen.findByText("二つ目の答え");
    const entries = screen.getAllByTestId("consult-entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toContain("一つ目の答え");
    expect(entries[1]!.textContent).toContain("二つ目の答え");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("範囲外は決まった文だけを出し、おすすめの枠もカードも出さない", async () => {
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: true, notice: null });
    renderPage();
    fireEvent.change(input(), { target: { value: "この鶏は病気？" } });
    fireEvent.click(askButton());
    await screen.findByText(OUT_OF_SCOPE_TEXT);
    expect(OUT_OF_SCOPE_TEXT).toBe("集めた資料では分かりません。管轄の家畜保健衛生所にご相談ください。");
    expect(screen.queryByText(CONSULT_TEXT.advice)).toBeNull();
    expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
  });

  it("範囲外でなくカードが 0 枚で決まった文が返っても、決まった文だけが出る（Claude が使えなかったとき）", async () => {
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: false, notice: null });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(OUT_OF_SCOPE_TEXT);
    expect(screen.queryByText(CONSULT_TEXT.advice)).toBeNull();
  });

  it("notice: daily_limit（会員）は回数を使い切った文を出す", async () => {
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: false, notice: "daily_limit" });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("今日の相談の回数（10 回）を使い切りました。明日また使えます。")).toBeTruthy();
    expect(screen.queryByText(CONSULT_TEXT.advice)).toBeNull();
    expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
  });

  it("notice: budget_stop は受け付けていない文を出す", async () => {
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: false, notice: "budget_stop" });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("いまは相談を受け付けていません。しばらくしてからお試しください。")).toBeTruthy();
  });

  it("関数が失敗したら失敗の文が出て、入力の文は残り、もう一度聞ける", async () => {
    box.ask.mockRejectedValueOnce(new Error("internal")).mockResolvedValueOnce(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    expect((await screen.findByRole("alert")).textContent).toBe("相談を送れませんでした。もう一度お試しください。");
    expect(input().value).toBe("長靴は？");
    expect((askButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryAllByTestId("consult-entry")).toHaveLength(0);
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("話題で失敗したときも、話題の文が欄に残る", async () => {
    box.ask.mockRejectedValue(new Error("internal"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
    await screen.findByRole("alert");
    expect(input().value).toBe(CONSULT_TOPICS[0]!.question);
  });

  it("「対策項目に足す」を押すと保存し、「対策項目に足しました」の押せないボタンになる", async () => {
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に足しました" })).toBeTruthy());
    expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07");
    expect((first.getByRole("button", { name: "対策項目に足しました" }) as HTMLButtonElement).disabled).toBe(true);
    // もう 1 枚は足していない
    expect(within(screen.getAllByTestId("consult-card")[1]!).getByRole("button", { name: CONSULT_TEXT.add })).toBeTruthy();
  });

  it("足し済みのカードは、最初から押せない形で出る", async () => {
    box.reviews.listReviews.mockResolvedValue(["aphis-A01"]);
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const us = within(screen.getAllByTestId("consult-card")[1]!);
    await waitFor(() => expect((us.getByRole("button", { name: "対策項目に足しました" }) as HTMLButtonElement).disabled).toBe(true));
    expect(box.reviews.addReview).not.toHaveBeenCalled();
  });

  it("保存中は「足しています…」で押せず、二度押しでも addReview は 1 回だけ", async () => {
    let done: () => void = () => {};
    box.reviews.addReview.mockReturnValue(new Promise<void>((r) => (done = r)));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    const btn = first.getByRole("button", { name: CONSULT_TEXT.add });
    fireEvent.click(btn);
    fireEvent.click(btn);
    const busy = await first.findByRole("button", { name: "足しています…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    done();
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に足しました" })).toBeTruthy());
    expect(box.reviews.addReview).toHaveBeenCalledTimes(1);
    expect(first.queryByRole("alert")).toBeNull();
  });

  it("一覧を読めずに足し済みを知らなかったとき、permission-denied で失敗したら読み直し、足し済みなら「足しました」にする", async () => {
    box.reviews.listReviews.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(["maff-M07"]);
    box.reviews.addReview.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に足しました" })).toBeTruthy());
    expect(first.queryByRole("alert")).toBeNull();
  });

  it("permission-denied でも、読み直して足し済みでなければ（読み直しに失敗しても）失敗の文のまま", async () => {
    box.reviews.addReview.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    box.reviews.listReviews.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("x"));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    expect((await first.findByRole("alert")).textContent).toBe(CONSULT_TEXT.addFailed);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    await waitFor(() => expect(box.reviews.listReviews).toHaveBeenCalledTimes(3));
    expect((await first.findByRole("alert")).textContent).toBe(CONSULT_TEXT.addFailed);
  });

  it("資料のリンクは https だけ（http はリンクにしない）", async () => {
    const http = { ...SOURCES[0]!, url: "http://www.maff.go.jp/example.pdf" };
    box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP, http), ans(CARD_US)] }));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const cards = screen.getAllByTestId("consult-card");
    expect(within(cards[1]!).getByRole("link")).toBeTruthy();
    expect(within(cards[0]!).queryByRole("link")).toBeNull();
  });

  it("足すのに失敗したら、そのカードにだけ失敗の文が出て、ボタンはそのまま", async () => {
    box.reviews.addReview.mockRejectedValue(new Error("permission-denied"));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    expect((await first.findByRole("alert")).textContent).toBe(CONSULT_TEXT.addFailed);
    expect((first.getByRole("button", { name: CONSULT_TEXT.add }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("審査員の入口（?judge=1）は、judge: true で呼び、足すボタンがなく、案内が出る。会員の確認を通さない", async () => {
    box.auth = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    box.ask.mockResolvedValue(reply());
    renderPage("/consult?judge=1");
    expect(screen.getByText("審査員の方向けの試しの画面です。1 日の回数に上限があり、相談は保存しません。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
    await waitFor(() => expect(box.ask).toHaveBeenCalledWith({ topicId: CONSULT_TOPICS[0]!.id }, true));
    await screen.findByText(CONSULT_TEXT.advice);
    expect(screen.getAllByTestId("consult-card")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /対策項目に足/ })).toBeNull();
    expect(box.reviews.listReviews).not.toHaveBeenCalled();
  });

  it("審査員の入口の daily_limit は、試しの回数の文を出す", async () => {
    box.auth = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: false, notice: "daily_limit" });
    renderPage("/consult?judge=1");
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("今日の試しの回数を使い切りました。")).toBeTruthy();
  });

  it("会員でない人が開くと会員の案内になり、相談の欄は出ない（?judge=1 がなければ）", () => {
    box.auth = { user: { uid: "u2" }, member: false, loading: false, error: false, refresh: async () => {} };
    renderPage("/consult");
    expect(screen.getByRole("heading", { name: "招待コードを入れてください" })).toBeTruthy();
    expect(screen.queryByLabelText(CONSULT_TEXT.questionLabel)).toBeNull();
  });

  it("資料の行は応答の source から出す。静的なカードの一覧（/consult/cards.json）は読まない", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("読まないはず")));
    vi.stubGlobal("fetch", fetchSpy);
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    expect(first.getByText(CARD_JP.action)).toBeTruthy();
    expect(first.getByRole("link", { name: /飼養衛生管理基準遵守指導の手引き/ })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("notice: unavailable は「答えを作れませんでした…」を出す。回数を使ったことは書かず、決まった文もおすすめの枠もカードも出さない", async () => {
    box.ask.mockResolvedValue({ answer: "", cards: [], outOfScope: false, notice: "unavailable" });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    const note = await screen.findByText("答えを作れませんでした。時間をおいて、もう一度お試しください。");
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).not.toMatch(/回数|使い切/u);
    expect(screen.queryByText(OUT_OF_SCOPE_TEXT)).toBeNull();
    expect(screen.queryByText(CONSULT_TEXT.advice)).toBeNull();
    expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
  });

  it("審査員の入口でも unavailable は同じ文", async () => {
    box.auth = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    box.ask.mockResolvedValue({ answer: "", cards: [], outOfScope: false, notice: "unavailable" });
    renderPage("/consult?judge=1");
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    expect(await screen.findByText(CONSULT_TEXT.unavailable)).toBeTruthy();
  });

  it("おすすめの文の改行が保たれる（段落の文字列はそのまま、CSS は white-space: pre-line）", async () => {
    const text = "1. 裏口で履き替える。\n2. 動線を分ける。\n3. 業者に服を貸す。";
    box.ask.mockResolvedValue(reply({ answer: text }));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const answer = screen.getByTestId("consult-advice").querySelector(".consult-answer")!;
    expect(answer.textContent).toBe(text);
    const css = fs.readFileSync(path.join(__dirname, "consult.css"), "utf8");
    expect(css).toMatch(/\.consult-answer\s*\{[^}]*white-space:\s*pre-line/u);
  });

  describe("資料の帰属（許可証ごとの短い文）", () => {
    const withLicense = (license: ConsultSource["license"], over: Partial<ConsultSource> = {}) => {
      const src = { ...SOURCES[0]!, license, ...over };
      return reply({ cards: [ans(CARD_JP, src)] });
    };
    const attribution = async (r: ConsultAskResponse) => {
      box.ask.mockResolvedValue(r);
      renderPage();
      fireEvent.change(input(), { target: { value: "長靴は？" } });
      fireEvent.click(askButton());
      await screen.findByText(CONSULT_TEXT.advice);
      return within(screen.getByTestId("consult-card")).getByTestId("consult-attribution").textContent;
    };

    it("PDL1.0: 出典: 〈発行者〉『〈題〉』を加工して作成", async () => {
      expect(await attribution(withLicense("PDL1.0"))).toBe("出典: 農林水産省『飼養衛生管理基準遵守指導の手引き』を加工して作成");
    });
    it("CC BY 4.0: 〈題〉（CC BY 4.0、URL ）。要約と抜き出しは当サイト", async () => {
      expect(await attribution(withLicense("CC BY 4.0"))).toBe(
        "飼養衛生管理基準遵守指導の手引き（CC BY 4.0、https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しは当サイト",
      );
    });
    it("OGL v3.0: Contains public sector information licensed under the Open Government Licence v3.0.", async () => {
      expect(await attribution(withLicense("OGL v3.0"))).toBe("Contains public sector information licensed under the Open Government Licence v3.0.");
    });
    it("US Gov: 米国政府の著作物", async () => {
      expect(await attribution(withLicense("US Gov"))).toBe("米国政府の著作物");
    });
  });

  it("帰属の文は禁句を含まない", () => {
    for (const license of ["PDL1.0", "CC BY", "CC BY 4.0", "OGL v3.0", "US Gov"] as const) {
      const src = { ...SOURCES[0]!, license };
      expect(findWordingViolations(attributionText({ id: src.id, title: src.title, publisher: src.publisher, url: src.url, domestic: src.domestic, license }))).toEqual([]);
    }
  });

  it("画面の下の 1 行の前に、要約・加工の断りが出る（回答の前でも出る）", () => {
    renderPage();
    const note = screen.getByText("カードの対策・効く条件・注意書きは、資料を要約・加工したものです。引用は原文のままです。");
    const footer = screen.getByText(CONSULT_TEXT.footer);
    expect(note.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("入力欄の近くに「農場の名前や場所は書かないでください。」が出る", () => {
    renderPage();
    const hint = screen.getByText("農場の名前や場所は書かないでください。");
    expect(hint.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("回数の文の「10 回」は shared の CONSULT_DAILY_LIMIT から組む", () => {
    expect(CONSULT_DAILY_LIMIT).toBe(10);
    expect(CONSULT_TEXT.dailyLimit).toBe(`今日の相談の回数（${CONSULT_DAILY_LIMIT} 回）を使い切りました。明日また使えます。`);
  });

  it("画面の文言に禁句がない", () => {
    expect(findWordingViolations(Object.values(CONSULT_TEXT).join("\n"))).toEqual([]);
  });
});
