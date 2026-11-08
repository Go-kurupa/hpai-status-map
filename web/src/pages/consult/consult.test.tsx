// AIに対策を相談の画面。相談の関数（consultAskCall）、カードの一覧、足した項目の口は偽物に差し替える。
import { CONSULT_BIRD_TYPES, ZONE_LABEL } from "@hpai/shared/consult/farmCondition";
import { JUDGE_UID } from "@hpai/shared/judge";
import { STATS_SOURCE, computeStats } from "@hpai/shared/consult/stats";
import { CONSULT_TOPICS } from "@hpai/shared/consult/topics";
import { CONSULT_DAILY_LIMIT, type ConsultAnswerCard, type ConsultCard, type ConsultSource } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT } from "@hpai/shared/consult/validate";
import type { HistoryCase } from "@hpai/shared/types";
import { FIXED_TEXT, findWordingViolations } from "@hpai/shared/wording";
import { RISK_SENTENCE } from "../../ui/RiskLine";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordStoreProvider } from "../../data/context";
import type { RecordStore } from "../../data/types";
import type { ConsultAskResponse } from "@hpai/shared/consult/types";
import { CONSULT_TEXT, attributionText } from "./consultTexts";

const box = vi.hoisted(() => ({
  ask: vi.fn(),
  reviews: { addReview: vi.fn(), listReviews: vi.fn(), removeReview: vi.fn() },
  auth: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} } as unknown,
  getFarm: vi.fn(),
  // 鶏舎（鶏舎ごとの羽数を送る）。既定は鶏舎なし
  listHouses: vi.fn(),
  // 近くの発生の状況と町の名前（farmNearby.ts の useFarmPlace。対策項目と地図の計算は farmNearby.test.tsx で確かめる）
  place: vi.fn(),
  // カードの一覧（/consult/cards.json）。足し済みの判定で、足したカードの id から対策の文を引くのに使う
  loadCatalog: vi.fn(),
}));
vi.mock("../auth/callables", () => ({ consultAskCall: (...a: unknown[]) => box.ask(...a) }));
vi.mock("./reviewStore", () => ({ useReviewStore: () => box.reviews }));
vi.mock("./cardsData", () => ({ loadConsultCatalog: () => box.loadCatalog() }));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => box.auth }));
vi.mock("./farmNearby", () => ({ useFarmPlace: (p: unknown) => box.place(p) }));

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

// 同じ対策の文を持つ別のカード（本物の一覧の maff-M02a と maff-M02b のような組）
const CARD_JP_TWIN: ConsultCard = { ...CARD_JP, id: "maff-M07b", origin: "M07b", quote: "別の引用" };
function catalogOf(cards: ConsultCard[] = [CARD_JP, CARD_JP_TWIN, CARD_US], sources: ConsultSource[] = SOURCES) {
  return { cards: new Map(cards.map((c) => [c.id, c] as const)), sources: new Map(sources.map((x) => [x.id, x] as const)) };
}

// 応答のカードは、カードのデータに資料の情報が付いたもの（画面は静的な cards.json を読まない）
function ans(card: ConsultCard, src: ConsultSource | undefined = SOURCES.find((x) => x.id === card.sourceId)): ConsultAnswerCard {
  const s = src!;
  return { ...card, source: { id: s.id, title: s.title, publisher: s.publisher, url: s.url, domestic: s.domestic, license: s.license } };
}

function reply(over: Partial<ConsultAskResponse> = {}): ConsultAskResponse {
  return { answer: "履き替えの前後で動線を分けてください。", cards: [ans(CARD_JP), ans(CARD_US)], outOfScope: false, notice: null, ...over };
}

// 農場の登録（飼育目的と飼い方、市町村とマス目）は getFarm、鶏舎の羽数は listHouses で読む。既定は農場なし・鶏舎なし
const store = {
  mode: "firestore",
  getFarm: (...a: unknown[]) => box.getFarm(...a),
  listHouses: (...a: unknown[]) => box.listHouses(...a),
} as unknown as RecordStore;
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
/** 答えの下の「根拠の資料 N 件を見る」を押して、カードを開く（i 番目の答え） */
function openSources(i = 0) {
  const toggles = screen.getAllByRole("button", { name: /根拠の資料 \d+ 件を見る/u });
  fireEvent.click(toggles[i]!);
}
/** 文で聞いて、答え（おすすめの吹き出し）が出るまで待つ */
async function askText(q = "長靴は？") {
  fireEvent.change(input(), { target: { value: q } });
  fireEvent.click(askButton());
  await screen.findAllByText(CONSULT_TEXT.advice);
}

beforeEach(() => {
  box.ask.mockReset();
  box.reviews.addReview.mockReset().mockResolvedValue(undefined);
  box.reviews.listReviews.mockReset().mockResolvedValue([]);
  box.reviews.removeReview.mockReset().mockResolvedValue(undefined);
  box.auth = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  box.getFarm.mockReset().mockResolvedValue(null);
  box.listHouses.mockReset().mockResolvedValue([]);
  // 既定: 近くの発生は確認できていない（送らない）。町の名前は引ける
  box.place.mockReset().mockReturnValue({ nearby: { status: "unavailable" }, townName: "岡山県津山市" });
  box.loadCatalog.mockReset().mockResolvedValue(catalogOf());
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(cleanup);

describe("AIに対策を相談の画面", () => {
  it("題と最初の吹き出し、話題の 7 つ、文の欄（例の文つき）、画面の下の 1 行がいつも出る", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "AIに対策を相談" })).toBeTruthy();
    expect(screen.getByText("鳥インフルの対策について、公的な資料と論文から答えます。何から見直しますか？")).toBeTruthy();
    const topics = within(screen.getByRole("group", { name: CONSULT_TEXT.topicsLabel })).getAllByRole("button");
    expect(topics.map((b) => b.textContent)).toEqual(CONSULT_TOPICS.map((t) => t.label));
    expect(topics).toHaveLength(7);
    expect(input().placeholder).toBe("ほかに聞きたいことがあれば、ここに書いてください");
    expect(screen.getByText(CONSULT_TEXT.footer)).toBeTruthy();
    expect(CONSULT_TEXT.footer).toBe(
      "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。",
    );
  });

  it("文の欄が空（空白だけも）なら「送る」を押せない。300 字を越える文は入らない", () => {
    renderPage();
    expect((askButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "   " } });
    expect((askButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "長靴の消毒は？" } });
    expect((askButton() as HTMLButtonElement).disabled).toBe(false);
    expect(input().maxLength).toBe(300);
  });

  it("話題を押すと、その話題の id ですぐ聞く。送っている間、自分の吹き出しに話題の文と、答えを作っている印が出る", async () => {
    let done: (r: ConsultAskResponse) => void = () => {};
    box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
    renderPage();
    const topic = CONSULT_TOPICS[1]!;
    fireEvent.click(screen.getByRole("button", { name: topic.label }));
    await waitFor(() => expect(box.ask).toHaveBeenCalledTimes(1));
    expect(box.ask).toHaveBeenCalledWith({ topicId: topic.id }, []);
    expect(screen.getByText(topic.question)).toBeTruthy();
    expect(screen.getByText(CONSULT_TEXT.thinking)).toBeTruthy();
    expect(input().value).toBe("");
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
    await waitFor(() => expect(box.ask).toHaveBeenCalledWith({ question: "長靴の消毒はどうしたら？" }, []));
    await screen.findByText(CONSULT_TEXT.advice);
    expect(input().value).toBe("");
  });

  it("送っている間は「送っています…」と出て、送るボタンと話題のボタンを押せない", async () => {
    let done: (r: ConsultAskResponse) => void = () => {};
    box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    const busy = await screen.findByRole("button", { name: CONSULT_TEXT.asking });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    for (const b of within(screen.getByRole("group", { name: CONSULT_TEXT.topicsLabel })).getAllByRole("button")) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(busy);
    expect(box.ask).toHaveBeenCalledTimes(1);
    done(reply());
    await screen.findByText(CONSULT_TEXT.advice);
    expect(screen.queryByRole("button", { name: CONSULT_TEXT.asking })).toBeNull();
  });

  it("おすすめの枠と、カードの対策・根拠の札・引用・資料名と発行者とリンク・注意書き・追加のボタンが、データどおり出る", async () => {
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const advice = screen.getByTestId("consult-advice");
    expect(within(advice).getByText("履き替えの前後で動線を分けてください。")).toBeTruthy();
    // カードは畳んである
    expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
    openSources();

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
    // 足すボタンは根拠のカードの中ではなく、答えのすぐ下の対策の一覧にある
    expect(jp.queryByRole("button", { name: CONSULT_TEXT.add })).toBeNull();

    const us = within(cards[1]!);
    expect(us.getByText("研究で関係あり")).toBeTruthy();
    expect(us.getByText("日本と飼い方が違う可能性があります。")).toBeTruthy();
    expect(cards[1]!.textContent).toContain("USDA APHIS");
  });

  it("海外のカードの注意書きに「海外:」があれば、一般の「日本と飼い方が違う可能性があります。」の行は出さない（二重にしない）", async () => {
    const us = ans({ ...CARD_US, caveats: ["海外: 日本と飼い方が違う可能性があります（米国の採卵農場の研究）"] });
    box.ask.mockResolvedValue(reply({ cards: [us] }));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    openSources();
    const card = screen.getByTestId("consult-card");
    expect(within(card).getByText(us.caveats[0]!)).toBeTruthy();
    expect(within(card).queryByText(CONSULT_TEXT.foreign)).toBeNull();
    // 「海外:」で始まらない注意書きでは、今までどおり出る
    cleanup();
    const us2 = ans({ ...CARD_US, caveats: ["対照が少ない"] });
    box.ask.mockResolvedValue(reply({ cards: [us2] }));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    openSources();
    expect(within(screen.getByTestId("consult-card")).getByText(CONSULT_TEXT.foreign)).toBeTruthy();
  });

  it("返事のカードに source がなくても落ちず、資料の行と帰属の文は出さず、カードの本体は出す", async () => {
    const { source: _omit, ...bare } = ans(CARD_JP);
    box.ask.mockResolvedValue(reply({ cards: [bare as ConsultAnswerCard] }));
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    openSources();
    const card = within(screen.getByTestId("consult-card"));
    expect(card.getByText(CARD_JP.action)).toBeTruthy();
    expect(card.getByText("義務")).toBeTruthy();
    expect(card.getByText(CARD_JP.quote)).toBeTruthy();
    for (const c of CARD_JP.caveats) expect(card.getByText(c)).toBeTruthy();
    expect(card.queryByTestId("consult-attribution")).toBeNull();
    expect(card.queryByRole("link")).toBeNull();
    expect(card.queryByText(/資料:/)).toBeNull();
  });

  it("同じ相談の中で前の往復が残り、続けて聞くと下に足される（新しい往復の位置へ動く）。2 回目は前の往復を渡す", async () => {
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
    expect(box.ask).toHaveBeenNthCalledWith(1, { question: "一つ目の問い" }, []);
    expect(box.ask).toHaveBeenNthCalledWith(2, { question: "二つ目の問い" }, [{ question: "一つ目の問い", answer: "一つ目の答え" }]);
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

  it("notice: daily_limit（審査員の会員 judge-demo）は、回数の数字を出さない文にする（審査員の全員で数えるので 10 回ではない）", async () => {
    box.auth = { user: { uid: JUDGE_UID }, member: true, loading: false, error: false, refresh: async () => {} };
    box.ask.mockResolvedValue({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: false, notice: "daily_limit" });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    const notice = await screen.findByTestId("consult-notice");
    expect(within(notice).getByText("今日の相談の回数を使い切りました。明日またお試しください。")).toBeTruthy();
    expect(notice.textContent).not.toMatch(/\d/u);
    expect(screen.queryByText(/10 回/u)).toBeNull();
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

  it("話題で失敗したときは失敗の文が出て、話題のボタンは残り、もう一度押せる（欄には話題の文を入れない）", async () => {
    box.ask.mockRejectedValue(new Error("internal"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
    await screen.findByRole("alert");
    expect(input().value).toBe("");
    expect((screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("「対策項目に追加する」を押すと保存し、「対策項目に追加しました」の押せないボタンになる", async () => {
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-action")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に追加しました" })).toBeTruthy());
    expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07");
    expect((first.getByRole("button", { name: "対策項目に追加しました" }) as HTMLButtonElement).disabled).toBe(true);
    // もう 1 枚は足していない
    expect(within(screen.getAllByTestId("consult-action")[1]!).getByRole("button", { name: CONSULT_TEXT.add })).toBeTruthy();
  });

  it("足し済みのカードは、最初から押せない形で出る", async () => {
    box.reviews.listReviews.mockResolvedValue(["aphis-A01"]);
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const us = within(screen.getAllByTestId("consult-action")[1]!);
    await waitFor(() => expect((us.getByRole("button", { name: "対策項目に追加しました" }) as HTMLButtonElement).disabled).toBe(true));
    expect(box.reviews.addReview).not.toHaveBeenCalled();
  });

  it("保存中は「追加しています…」で押せず、二度押しでも addReview は 1 回だけ", async () => {
    let done: () => void = () => {};
    box.reviews.addReview.mockReturnValue(new Promise<void>((r) => (done = r)));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-action")[0]!);
    const btn = first.getByRole("button", { name: CONSULT_TEXT.add });
    fireEvent.click(btn);
    fireEvent.click(btn);
    const busy = await first.findByRole("button", { name: "追加しています…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    done();
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に追加しました" })).toBeTruthy());
    expect(box.reviews.addReview).toHaveBeenCalledTimes(1);
    expect(first.queryByRole("alert")).toBeNull();
  });

  it("一覧を読み込めずに足し済みを知らなかったとき、permission-denied で失敗したら読み直し、足し済みなら「足しました」にする", async () => {
    box.reviews.listReviews.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(["maff-M07"]);
    box.reviews.addReview.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-action")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    await waitFor(() => expect(first.getByRole("button", { name: "対策項目に追加しました" })).toBeTruthy());
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
    const first = within(screen.getAllByTestId("consult-action")[0]!);
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
    openSources();
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
    const first = within(screen.getAllByTestId("consult-action")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    expect((await first.findByRole("alert")).textContent).toBe(CONSULT_TEXT.addFailed);
    expect((first.getByRole("button", { name: CONSULT_TEXT.add }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("農場がなくて足せないときは、農場を登録する案内と設定へのリンクが、そのカードに出る（「もう一度」とは言わない）", async () => {
    box.reviews.addReview.mockRejectedValue(Object.assign(new Error("x"), { code: "no-farm" }));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    const first = within(screen.getAllByTestId("consult-action")[0]!);
    fireEvent.click(first.getByRole("button", { name: CONSULT_TEXT.add }));
    const alert = await first.findByRole("alert");
    expect(alert.textContent).toContain("対策項目に追加するには、先に『農場と通知の設定』で農場を登録してください。");
    expect(alert.textContent).not.toContain("もう一度");
    expect(first.getByRole("link", { name: "農場と通知の設定" }).getAttribute("href")).toBe("/settings/farm");
    // 別のカードには出ない
    expect(within(screen.getAllByTestId("consult-action")[1]!).queryByRole("alert")).toBeNull();
  });

  // 審査員の試しの入口（?judge=1）は外した（2026-11-08。審査員は審査員用のリンクで会員として入る）
  it("/consult?judge=1 は、ログインしていなければ会員の確認（ログインの案内）になり、相談の欄は出ず、関数を呼ばない", async () => {
    box.auth = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
    render(
      <RecordStoreProvider value={store}>
        <MemoryRouter initialEntries={["/consult?judge=1"]}>
          <Routes>
            <Route path="/consult" element={<ConsultPage />} />
            <Route path="/login" element={<p>ログインの画面</p>} />
          </Routes>
        </MemoryRouter>
      </RecordStoreProvider>,
    );
    expect(await screen.findByText("ログインの画面")).toBeTruthy();
    expect(screen.queryByLabelText(CONSULT_TEXT.questionLabel)).toBeNull();
    expect(screen.queryByText(/審査員/u)).toBeNull();
    expect(box.ask).not.toHaveBeenCalled();
    expect(box.getFarm).not.toHaveBeenCalled();
  });

  it("相談の画面の文に、審査員の試しの文が残っていない", () => {
    expect(JSON.stringify(CONSULT_TEXT)).not.toMatch(/審査員|試しの回数/u);
  });

  it("会員でない人が開くと会員の案内になり、相談の欄は出ない", () => {
    box.auth = { user: { uid: "u2" }, member: false, loading: false, error: false, refresh: async () => {} };
    renderPage("/consult");
    expect(screen.getByRole("heading", { name: "招待コードを入れてください" })).toBeTruthy();
    expect(screen.queryByLabelText(CONSULT_TEXT.questionLabel)).toBeNull();
  });

  it("資料の行は応答の source から出す。静的なカードの一覧（/consult/cards.json）の資料は使わない（一覧は足し済みの判定にだけ使う）", async () => {
    box.loadCatalog.mockResolvedValue(catalogOf(undefined, [{ ...SOURCES[0]!, title: "一覧の側の別の題" }, SOURCES[1]!]));
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    await waitFor(() => expect(box.loadCatalog).toHaveBeenCalled());
    openSources();
    const first = within(screen.getAllByTestId("consult-card")[0]!);
    expect(first.getByText(CARD_JP.action)).toBeTruthy();
    expect(first.getByRole("link", { name: /飼養衛生管理基準遵守指導の手引き/ })).toBeTruthy();
    expect(screen.queryByText(/一覧の側の別の題/u)).toBeNull();
  });

  describe("同じ対策の文の別のカード（maff-M02a と maff-M02b など）は、どれかを足していれば足し済み", () => {
    const historyOpen = () => fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.historyOpen }));

    it("足し済みが maff-M07 だけでも、答えに同じ文の maff-M07b が出たら「足しました」の押せないボタンで、押しても足さない", async () => {
      box.reviews.listReviews.mockResolvedValue(["maff-M07"]);
      box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP_TWIN), ans(CARD_US)] }));
      renderPage();
      await askText();
      const twin = within(screen.getAllByTestId("consult-action")[0]!);
      const btn = await twin.findByRole("button", { name: "対策項目に追加しました" });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(btn);
      // 別の文のカードは足していない
      expect(within(screen.getAllByTestId("consult-action")[1]!).getByRole("button", { name: CONSULT_TEXT.add })).toBeTruthy();
      expect(screen.getByRole("link", { name: CONSULT_TEXT.toTodo })).toBeTruthy();
      expect(box.reviews.addReview).not.toHaveBeenCalled();
    });

    it("答え 1 の文を足したら、答え 2 に出た同じ文の別のカードも「足しました」になり、二重に足さない", async () => {
      box.ask.mockResolvedValueOnce(reply({ cards: [ans(CARD_JP)] })).mockResolvedValueOnce(reply({ cards: [ans(CARD_JP_TWIN)] }));
      renderPage();
      await askText();
      await waitFor(() => expect(box.loadCatalog).toHaveBeenCalled());
      fireEvent.click(within(screen.getAllByTestId("consult-action")[0]!).getByRole("button", { name: CONSULT_TEXT.add }));
      await waitFor(() => expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07"));
      fireEvent.change(input(), { target: { value: "裏口は？" } });
      fireEvent.click(askButton());
      await waitFor(() => expect(screen.getAllByTestId("consult-action")).toHaveLength(2));
      const second = within(screen.getAllByTestId("consult-action")[1]!);
      expect((second.getByRole("button", { name: "対策項目に追加しました" }) as HTMLButtonElement).disabled).toBe(true);
      expect(box.reviews.addReview).toHaveBeenCalledTimes(1);
    });

    it("同じ文の別のカードを足している最中に、もう一方を押しても、足すのは 1 回だけ", async () => {
      let done: () => void = () => {};
      box.reviews.addReview.mockReturnValue(new Promise<void>((r) => (done = r)));
      box.ask.mockResolvedValueOnce(reply({ cards: [ans(CARD_JP)] })).mockResolvedValueOnce(reply({ cards: [ans(CARD_JP_TWIN)] }));
      renderPage();
      await askText();
      await waitFor(() => expect(box.loadCatalog).toHaveBeenCalled());
      fireEvent.change(input(), { target: { value: "裏口は？" } });
      fireEvent.click(askButton());
      await waitFor(() => expect(screen.getAllByTestId("consult-action")).toHaveLength(2));
      const rows = screen.getAllByTestId("consult-action");
      fireEvent.click(within(rows[0]!).getByRole("button", { name: CONSULT_TEXT.add }));
      await within(rows[0]!).findByRole("button", { name: "追加しています…" });
      // もう一方の答えの行は、まだ「足す」のまま（足している最中の印は押したカードの行だけ）。押しても書かない
      fireEvent.click(within(rows[1]!).getByRole("button", { name: CONSULT_TEXT.add }));
      done();
      await waitFor(() => expect(within(rows[1]!).getByRole("button", { name: "対策項目に追加しました" })).toBeTruthy());
      expect(box.reviews.addReview).toHaveBeenCalledTimes(1);
      expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07");
    });

    it("カードの一覧を読み込めないときは、今までどおりカードの id だけで判定する（足せなくはしない）", async () => {
      box.loadCatalog.mockRejectedValue(new Error("読み込めません"));
      box.reviews.listReviews.mockResolvedValue(["maff-M07"]);
      box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP_TWIN), ans(CARD_US)] }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.advice);
      await waitFor(() => expect(box.loadCatalog).toHaveBeenCalled());
      expect(screen.queryByRole("link", { name: CONSULT_TEXT.toTodo })).toBeNull();
      historyOpen();
      const item = screen.getByRole("button", { name: new RegExp(`^${CONSULT_TOPICS[0]!.label}\\s*1 往復`, "u") });
      expect(item.textContent).not.toContain(CONSULT_TEXT.addedCount(1));
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.historyClose }));
      fireEvent.click(within(screen.getAllByTestId("consult-action")[0]!).getByRole("button", { name: CONSULT_TEXT.add }));
      await waitFor(() => expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07b"));
    });

    it("一覧の「足した対策の数」も、同じ文のカードは 1 つと数える（maff-M07 を足し、答えには maff-M07b）", async () => {
      box.reviews.listReviews.mockResolvedValue(["maff-M07"]);
      box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP_TWIN), ans(CARD_US)] }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.advice);
      historyOpen();
      const item = () => screen.getByRole("button", { name: new RegExp(`^${CONSULT_TOPICS[0]!.label}\\s*1 往復`, "u") });
      await waitFor(() => expect(item().textContent).toContain(CONSULT_TEXT.addedCount(1)));
    });

    it("古いデータで同じ文のカードが 2 件とも足してあっても、数えるのは 1 つ", async () => {
      box.reviews.listReviews.mockResolvedValue(["maff-M07", "maff-M07b"]);
      box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP_TWIN), ans(CARD_US)] }));
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.advice);
      expect((await screen.findByRole("button", { name: "対策項目に追加しました" }) as HTMLButtonElement).disabled).toBe(true);
      historyOpen();
      const item = screen.getByRole("button", { name: new RegExp(`^${CONSULT_TOPICS[0]!.label}\\s*1 往復`, "u") });
      expect(item.textContent).toContain(CONSULT_TEXT.addedCount(1));
    });
  });

  it("notice: unavailable は「答えを作れませんでした…」を出す。回数を使ったことは書かず、決まった文もおすすめの枠もカードも出さない", async () => {
    box.ask.mockResolvedValue({ answer: "", cards: [], outOfScope: false, notice: "unavailable" });
    renderPage();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    const note = await screen.findByText("答えを作れませんでした。時間をおいて、もう一度お試しください。");
    expect(note.closest("[role=log]")).not.toBeNull(); // やりとりの欄（role=log）の中に出る。入れ子の role=status にはしない
    expect(note.textContent).not.toMatch(/回数|使い切/u);
    expect(screen.queryByText(OUT_OF_SCOPE_TEXT)).toBeNull();
    expect(screen.queryByText(CONSULT_TEXT.advice)).toBeNull();
    expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
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
      openSources();
      return within(screen.getByTestId("consult-card")).getByTestId("consult-attribution").textContent;
    };

    it("PDL1.0: 出典: 〈発行者〉『〈題〉』を加工して作成", async () => {
      expect(await attribution(withLicense("PDL1.0"))).toBe("出典: 農林水産省『飼養衛生管理基準遵守指導の手引き』を加工して作成");
    });
    it("CC BY 4.0: 帰属の文に題を入れない（資料の行にある）", async () => {
      const text = await attribution(withLicense("CC BY 4.0"));
      expect(text).toBe("CC BY 4.0（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しはこのサイト");
      expect(text).not.toContain("飼養衛生管理基準遵守指導の手引き");
    });
    it("CC BY（版なし）も同じ形で、題を入れない", async () => {
      const text = await attribution(withLicense("CC BY"));
      expect(text).toBe("CC BY（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しはこのサイト");
      expect(text).not.toContain("飼養衛生管理基準遵守指導の手引き");
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

  it("入力欄のすぐ下に「農場の名前や場所は書かないでください。」と、続けて聞くと前のやりとりも渡る断りが出る", () => {
    renderPage();
    const hint = screen.getByText(/^農場の名前や場所は書かないでください。/u);
    expect(hint.textContent).toContain("続けて聞くと、この相談の前のやりとりも AI に渡ります。");
    expect(input().compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.closest(".consult-composer")).toBe(input().closest(".consult-composer"));
  });

  it("回数の文の「10 回」は shared の CONSULT_DAILY_LIMIT から組む", () => {
    expect(CONSULT_DAILY_LIMIT).toBe(10);
    expect(CONSULT_TEXT.dailyLimit).toBe(`今日の相談の回数（${CONSULT_DAILY_LIMIT} 回）を使い切りました。明日また使えます。`);
  });

  it("画面の文言に禁句がない", () => {
    const texts = Object.values(CONSULT_TEXT).map((v) => (typeof v === "function" ? (v as (a: number, b: number) => string)(3, 4) : v));
    expect(findWordingViolations(texts.join("\n"))).toEqual([]);
  });

  describe("チャットの形（2026-11-07）", () => {
    const historyOpen = () => fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.historyOpen }));
    const stored = () => JSON.parse(localStorage.getItem("hpai.consult.history.v1:u1") ?? "[]") as { title: string; turns: unknown[] }[];

    it("根拠の資料は畳んであり、押すと開いて aria-expanded が true になり、もう一度押すと閉じる", async () => {
      box.ask.mockResolvedValue(reply());
      renderPage();
      await askText();
      const toggle = screen.getByRole("button", { name: CONSULT_TEXT.sourcesOpen(2) });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
      fireEvent.click(toggle);
      expect(screen.getAllByTestId("consult-card")).toHaveLength(2);
      const close = screen.getByRole("button", { name: CONSULT_TEXT.sourcesClose(2) });
      expect(close.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(close);
      expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
    });

    it("続けて聞く候補が最後の答えの後に出て、押すとその文で、前の往復を付けて聞く", async () => {
      box.ask
        .mockResolvedValueOnce(reply({ answer: "一つ目の答え", followUps: ["裏口から入るときは？", "業者さんの服は？"] }))
        .mockResolvedValueOnce(reply({ answer: "二つ目の答え", followUps: [] }));
      renderPage();
      await askText("長靴は？");
      const group = screen.getByRole("group", { name: CONSULT_TEXT.followUpsLabel });
      expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["裏口から入るときは？", "業者さんの服は？"]);
      fireEvent.click(within(group).getByRole("button", { name: "裏口から入るときは？" }));
      await screen.findByText("二つ目の答え");
      expect(box.ask).toHaveBeenLastCalledWith({ question: "裏口から入るときは？" }, [{ question: "長靴は？", answer: "一つ目の答え" }]);
      // 最後の答えに候補がないので、前の候補は消える
      expect(screen.queryByRole("group", { name: CONSULT_TEXT.followUpsLabel })).toBeNull();
      // 話題のボタンは、相談が始まったら出さない
      expect(screen.queryByRole("group", { name: CONSULT_TEXT.topicsLabel })).toBeNull();
    });

    it("古い関数の返事（followUps がない）でも落ちず、候補は出さない", async () => {
      const { followUps: _omit, ...old } = reply();
      box.ask.mockResolvedValue(old);
      renderPage();
      await askText();
      expect(screen.queryByRole("group", { name: CONSULT_TEXT.followUpsLabel })).toBeNull();
    });

    it("決まった文や回数の知らせの往復は、次に渡す前の往復に入れない", async () => {
      box.ask
        .mockResolvedValueOnce(reply({ answer: "一つ目の答え" }))
        .mockResolvedValueOnce({ answer: OUT_OF_SCOPE_TEXT, cards: [], outOfScope: true, notice: null })
        .mockResolvedValueOnce(reply({ answer: "三つ目の答え" }));
      renderPage();
      await askText("一つ目");
      fireEvent.change(input(), { target: { value: "二つ目" } });
      fireEvent.click(askButton());
      await screen.findByText(OUT_OF_SCOPE_TEXT);
      fireEvent.change(input(), { target: { value: "三つ目" } });
      fireEvent.click(askButton());
      await screen.findByText("三つ目の答え");
      expect(box.ask).toHaveBeenLastCalledWith({ question: "三つ目" }, [{ question: "一つ目", answer: "一つ目の答え" }]);
    });

    it("前の往復は直前の 3 往復まで渡す", async () => {
      for (let i = 1; i <= 4; i++) box.ask.mockResolvedValueOnce(reply({ answer: `答え${i}` }));
      box.ask.mockResolvedValueOnce(reply({ answer: "答え5" }));
      renderPage();
      for (let i = 1; i <= 5; i++) {
        fireEvent.change(input(), { target: { value: `問い${i}` } });
        fireEvent.click(askButton());
        await screen.findByText(`答え${i}`);
      }
      expect(box.ask).toHaveBeenLastCalledWith({ question: "問い5" }, [
        { question: "問い2", answer: "答え2" },
        { question: "問い3", answer: "答え3" },
        { question: "問い4", answer: "答え4" },
      ]);
    });

    it("会員の相談は、この端末のブラウザ（会員ごとの置き場所）に残り、開き直すと「これまでの相談」に出て、押すと続きから見られる", async () => {
      box.ask.mockResolvedValueOnce(reply({ answer: "一つ目の答え" })).mockResolvedValueOnce(reply({ answer: "二つ目の答え" }));
      renderPage();
      await askText("一つ目の問い");
      fireEvent.change(input(), { target: { value: "二つ目の問い" } });
      fireEvent.click(askButton());
      await screen.findByText("二つ目の答え");
      expect(stored()).toHaveLength(1);
      expect(stored()[0]!.title).toBe("一つ目の問い");
      expect(stored()[0]!.turns).toHaveLength(2);
      cleanup();

      renderPage();
      // 開き直した直後は、新しい相談（前の往復は出さない）
      expect(screen.queryAllByTestId("consult-entry")).toHaveLength(0);
      historyOpen();
      expect(screen.getByRole("heading", { level: 2, name: CONSULT_TEXT.historyTitle })).toBeTruthy();
      expect(screen.getByRole("heading", { level: 3, name: CONSULT_TEXT.groupToday })).toBeTruthy();
      expect(screen.getByText(CONSULT_TEXT.historyKept)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /^一つ目の問い/u }));
      expect(screen.getAllByTestId("consult-entry")).toHaveLength(2);
      expect(screen.getByText("二つ目の答え")).toBeTruthy();
      // 続けて聞くと、同じ相談に足され、前の往復を渡す
      box.ask.mockResolvedValueOnce(reply({ answer: "三つ目の答え" }));
      fireEvent.change(input(), { target: { value: "三つ目の問い" } });
      fireEvent.click(askButton());
      await screen.findByText("三つ目の答え");
      expect((box.ask.mock.lastCall as unknown[])[1]).toEqual([
        { question: "一つ目の問い", answer: "一つ目の答え" },
        { question: "二つ目の問い", answer: "二つ目の答え" },
      ]);
      expect(stored()).toHaveLength(1);
      expect(stored()[0]!.turns).toHaveLength(3);
    });

    it("「＋ 新しい相談」で空の相談になり、次に聞いた分は別の相談として一覧に足される", async () => {
      box.ask.mockResolvedValueOnce(reply({ answer: "一つ目の答え" })).mockResolvedValueOnce(reply({ answer: "別の答え" }));
      renderPage();
      await askText("一つ目の問い");
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.newChat }));
      expect(screen.queryAllByTestId("consult-entry")).toHaveLength(0);
      expect(screen.getByRole("group", { name: CONSULT_TEXT.topicsLabel })).toBeTruthy();
      await askText("別の問い");
      expect(box.ask).toHaveBeenLastCalledWith({ question: "別の問い" }, []);
      expect(stored().map((c) => c.title)).toEqual(["別の問い", "一つ目の問い"]);
    });

    it("一覧の「消す」でその相談だけ消え、「すべて消す」は確かめてから全部消す", async () => {
      box.ask.mockResolvedValueOnce(reply({ answer: "A の答え" })).mockResolvedValueOnce(reply({ answer: "B の答え" }));
      renderPage();
      await askText("A の問い");
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.newChat }));
      await askText("B の問い");
      historyOpen();
      fireEvent.click(screen.getByRole("button", { name: "「A の問い」を消す" }));
      expect(stored().map((c) => c.title)).toEqual(["B の問い"]);
      expect(screen.queryByRole("button", { name: /A の問い/u })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.removeAll }));
      // まだ消えない
      expect(stored()).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.removeAllCancel }));
      expect(stored()).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.removeAll }));
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.removeAllConfirm }));
      expect(localStorage.getItem("hpai.consult.history.v1:u1")).toBeNull();
      expect(screen.getByText(CONSULT_TEXT.historyEmpty)).toBeTruthy();
    });

    it("ほかの会員の記録は出ない（置き場所が会員ごと）", async () => {
      localStorage.setItem(
        "hpai.consult.history.v1:u9",
        JSON.stringify([{ id: "x", title: "ほかの人の問い", createdAt: 1, updatedAt: 1, turns: [{ question: "ほかの人の問い", at: 1, result: reply() }] }]),
      );
      renderPage();
      historyOpen();
      expect(screen.queryByText("ほかの人の問い")).toBeNull();
      expect(screen.getByText(CONSULT_TEXT.historyEmpty)).toBeTruthy();
    });

    it("壊れた記録があっても画面は出て、読み込めない分は捨てる", () => {
      localStorage.setItem("hpai.consult.history.v1:u1", "{壊れた");
      renderPage();
      historyOpen();
      expect(screen.getByText(CONSULT_TEXT.historyEmpty)).toBeTruthy();
    });

    it("JSON としては読み込めても形の違う記録（候補が文字列、中身のないカード）は捨て、画面は落ちない", () => {
      const good = { id: "g", title: "良い問い", createdAt: 2, updatedAt: Date.now(), turns: [{ question: "良い問い", at: Date.now(), result: reply() }] };
      const badFollow = { id: "b1", title: "候補が壊れた", createdAt: 1, updatedAt: Date.now(), turns: [{ question: "q", at: 1, result: { ...reply(), followUps: "ab" } }] };
      const badCard = { id: "b2", title: "カードが壊れた", createdAt: 1, updatedAt: Date.now(), turns: [{ question: "q", at: 1, result: { ...reply(), cards: [{}] } }] };
      localStorage.setItem("hpai.consult.history.v1:u1", JSON.stringify([good, badFollow, badCard]));
      renderPage();
      historyOpen();
      expect(screen.getByRole("button", { name: /^良い問い/u })).toBeTruthy();
      expect(screen.queryByText("候補が壊れた")).toBeNull();
      expect(screen.queryByText("カードが壊れた")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^良い問い/u }));
      openSources();
      expect(screen.getAllByTestId("consult-card")).toHaveLength(2);
    });

    it("話題や候補のボタンで聞いても、入力欄の書きかけの文は消さない（失敗しても置き換えない）", async () => {
      box.ask.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(reply());
      renderPage();
      fireEvent.change(input(), { target: { value: "書きかけ" } });
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByRole("alert");
      expect(input().value).toBe("書きかけ");
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.advice);
      expect(input().value).toBe("書きかけ");
    });

    it("答えを待っている間に会員が替わったら、届いた答えを今の会員の一覧と置き場所に入れない", async () => {
      let done: (r: ConsultAskResponse) => void = () => {};
      box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
      const view = renderPage();
      fireEvent.change(input(), { target: { value: "u1 の問い" } });
      fireEvent.click(askButton());
      await screen.findByText(CONSULT_TEXT.thinking);
      box.auth = { user: { uid: "u2" }, member: true, loading: false, error: false, refresh: async () => {} };
      view.rerender(
        <RecordStoreProvider value={store}>
          <MemoryRouter initialEntries={["/consult"]}>
            <ConsultPage />
          </MemoryRouter>
        </RecordStoreProvider>,
      );
      done(reply({ answer: "u1 への答え" }));
      await waitFor(() => expect(screen.queryByText(CONSULT_TEXT.thinking)).toBeNull());
      expect(screen.queryByText("u1 への答え")).toBeNull();
      expect(localStorage.getItem("hpai.consult.history.v1:u2")).toBeNull();
      expect(localStorage.getItem("hpai.consult.history.v1:u1")).toBeNull();
    });

    it("ログインの状態を読み込み中（会員が未定）に聞いても、答えは出て、決まった会員の置き場所に残る", async () => {
      let done: (r: ConsultAskResponse) => void = () => {};
      box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
      box.auth = { user: null, member: false, loading: false, error: false, refresh: async () => {} };
      // RequireMember の確認は見本の農場（sample）で素通しにし、会員の画面の uid だけ未定にする
      const sample = { mode: "sample" } as unknown as RecordStore;
      // 描き直しは毎回新しい要素で（同じ要素だと React が描き直しを省く）
      const page = () => (
        <RecordStoreProvider value={sample}>
          <MemoryRouter initialEntries={["/consult"]}>
            <ConsultPage />
          </MemoryRouter>
        </RecordStoreProvider>
      );
      const view = render(page());
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.thinking);
      box.auth = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
      view.rerender(page());
      done(reply({ answer: "未定の間に聞いた答え" }));
      expect(await screen.findByText("未定の間に聞いた答え")).toBeTruthy();
      expect(stored()).toHaveLength(1);
    });

    it("送っている間は、答えを作っている吹き出しの位置へ動く", async () => {
      box.ask.mockReturnValue(new Promise<ConsultAskResponse>(() => {}));
      renderPage();
      fireEvent.change(input(), { target: { value: "長靴は？" } });
      fireEvent.click(askButton());
      const thinking = await screen.findByText(CONSULT_TEXT.thinking);
      await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
      const called = (Element.prototype.scrollIntoView as unknown as { mock: { contexts: Element[] } }).mock.contexts;
      expect(called.some((el) => el.contains(thinking))).toBe(true);
    });

    it("答えのすぐ下に、この答えの対策が 1 行ずつ出て（根拠を開かなくても）、同じ対策の別の引用は 1 行にまとめる", async () => {
      const twin = ans({ ...CARD_JP, id: "maff-M07b", quote: "別の引用" });
      box.ask.mockResolvedValue(reply({ cards: [ans(CARD_JP), twin, ans(CARD_US)] }));
      renderPage();
      await askText();
      const actions = within(screen.getByTestId("consult-actions"));
      expect(actions.getByText(CONSULT_TEXT.actionsHead)).toBeTruthy();
      const rows = screen.getAllByTestId("consult-action");
      expect(rows.map((r) => r.querySelector(".consult-action-name")!.textContent)).toEqual([CARD_JP.action, CARD_US.action]);
      expect(screen.queryAllByTestId("consult-card")).toHaveLength(0);
      // 根拠は 3 件（まとめるのは対策の行だけ）
      expect(screen.getByRole("button", { name: CONSULT_TEXT.sourcesOpen(3) })).toBeTruthy();
      // まとめた行で足すと、その対策の最初のカードを足す
      fireEvent.click(within(rows[0]!).getByRole("button", { name: CONSULT_TEXT.add }));
      await waitFor(() => expect(box.reviews.addReview).toHaveBeenCalledWith("maff-M07"));
    });

    it("足したら「対策項目で見る」のリンク（/todo）が出る。足す前は出ない", async () => {
      box.ask.mockResolvedValue(reply());
      renderPage();
      await askText();
      expect(screen.queryByRole("link", { name: CONSULT_TEXT.toTodo })).toBeNull();
      fireEvent.click(within(screen.getAllByTestId("consult-action")[0]!).getByRole("button", { name: CONSULT_TEXT.add }));
      const link = await screen.findByRole("link", { name: CONSULT_TEXT.toTodo });
      expect(link.getAttribute("href")).toBe("/todo");
    });

    it("話題から始めた相談の一覧の題は、話題の短い名前。足した対策の数も出る", async () => {
      box.reviews.listReviews.mockResolvedValue(["aphis-A01"]);
      box.ask.mockResolvedValue(reply());
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
      await screen.findByText(CONSULT_TEXT.advice);
      expect(stored()[0]!.title).toBe(CONSULT_TOPICS[0]!.label);
      historyOpen();
      // 一覧の項目（話題の札「長靴・服 1」とは別）
      const item = screen.getByRole("button", { name: new RegExp(`^${CONSULT_TOPICS[0]!.label}\\s*1 往復`, "u") });
      expect(item.textContent).toContain(CONSULT_TEXT.addedCount(1));
    });

    it("?q= の文が入力欄に入って開く（送るのは本人。自動では送らない）", () => {
      renderPage(`/consult?q=${encodeURIComponent("  裏口で長靴を替える  ")}`);
      expect(input().value).toBe("裏口で長靴を替える");
      expect(box.ask).not.toHaveBeenCalled();
    });

    it("ボタンの名前に記号（≡ ＋ × ▸）を入れない（読み上げで記号を読まない）", async () => {
      box.ask.mockResolvedValue(reply());
      renderPage();
      expect(screen.getByRole("button", { name: "これまでの相談" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "新しい相談" })).toBeTruthy();
      await askText();
      expect(screen.getByRole("button", { name: "根拠の資料 2 件を見る（引用・出典）" })).toBeTruthy();
      expect(within(screen.getAllByTestId("consult-action")[0]!).getByRole("button", { name: "対策項目に追加する" })).toBeTruthy();
      historyOpen();
      expect(screen.getByRole("button", { name: "閉じる" })).toBeTruthy();
    });

    it("答えが届くと新しい往復へ、これまでの相談を開くと見出しへ、相談を開き直すとやりとりの欄へフォーカスが移る", async () => {
      box.ask.mockResolvedValue(reply({ answer: "届いた答え" }));
      renderPage();
      await askText("問い");
      const entries = screen.getAllByTestId("consult-entry");
      expect(document.activeElement).toBe(entries[entries.length - 1]);
      historyOpen();
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: CONSULT_TEXT.historyTitle }));
      fireEvent.click(screen.getByRole("button", { name: /^問い/u }));
      expect(document.activeElement).toBe(screen.getByRole("log", { name: CONSULT_TEXT.logLabel }));
    });

    describe("発生の件数の表", () => {
      const past = (prefCode: string, season: number): HistoryCase => ({
        season, no: 1, prefCode, muniCode: `${prefCode}201`, muniNameThen: "市", date: `${season}-12-01`, birdUse: "採卵鶏",
        housing: null, headCount: 1000, sourceUrl: "https://www.maff.go.jp/a.pdf", related: false,
      });
      const PAST = [past("33", 2024), past("33", 2022), past("31", 2024)];
      const okayama = computeStats(PAST, { groupBy: "season", season: null, prefCode: "33" });
      const statsOnly = (stats = okayama): ConsultAskResponse => ({ answer: "", cards: [], outOfScope: false, notice: null, followUps: ["鳥取県では？"], stats });

      it("件数だけの答え: 題・まとめ・表・合計、過去の記録の断り・今季は含まない・出典・データで探すへのリンク。対策の一覧と根拠のボタンは出さない", async () => {
        box.ask.mockResolvedValue(statsOnly());
        renderPage();
        fireEvent.change(input(), { target: { value: "岡山県では過去に何件？" } });
        fireEvent.click(askButton());
        const box1 = within(await screen.findByTestId("consult-stats"));
        expect(screen.getByText(CONSULT_TEXT.statsWho)).toBeTruthy();
        expect(box1.getByText("岡山県の発生（シーズンごと）")).toBeTruthy();
        expect(box1.getByText(okayama.summary)).toBeTruthy();
        const table = box1.getByRole("table", { name: "岡山県の発生（シーズンごと）" });
        expect(within(table).getAllByRole("row")).toHaveLength(1 + 6 + 1);
        expect(within(table).getByRole("rowheader", { name: "2024 年 6 月〜2025 年 5 月" }).closest("tr")!.textContent).toContain("1 件");
        expect(within(table).getByRole("rowheader", { name: CONSULT_TEXT.statsTotal }).closest("tr")!.textContent).toContain("2 件");
        expect(box1.getByText(`${FIXED_TEXT.pastDisclaimer}。`)).toBeTruthy();
        expect(box1.getByText(RISK_SENTENCE, { exact: false })).toBeTruthy(); // 県を指定した表
        expect(box1.getByRole("link", { name: CONSULT_TEXT.statsMapLink }).getAttribute("href")).toBe("/");
        expect(box1.getByRole("link", { name: STATS_SOURCE.label }).getAttribute("href")).toBe(STATS_SOURCE.url);
        expect(box1.getByRole("link", { name: CONSULT_TEXT.statsExploreLink }).getAttribute("href")).toBe("/explore");
        expect(screen.queryByTestId("consult-actions")).toBeNull();
        expect(screen.queryByRole("button", { name: /根拠の資料/u })).toBeNull();
        // 続けて聞く候補は出る
        expect(within(screen.getByRole("group", { name: CONSULT_TEXT.followUpsLabel })).getByRole("button", { name: "鳥取県では？" })).toBeTruthy();
      });

      it("全国の表には県のリスクの文を出さない。一覧の外のシーズンは表を出さず、まとめの文だけ", async () => {
        box.ask.mockResolvedValueOnce(statsOnly(computeStats(PAST, { groupBy: "pref", season: 2024, prefCode: null })));
        box.ask.mockResolvedValueOnce(statsOnly(computeStats(PAST, { groupBy: "pref", season: 2026, prefCode: null })));
        renderPage();
        fireEvent.change(input(), { target: { value: "2024 年のシーズンは県ごとに何件？" } });
        fireEvent.click(askButton());
        const first = within((await screen.findAllByTestId("consult-stats"))[0]!);
        expect(first.queryByText(RISK_SENTENCE, { exact: false })).toBeNull();
        expect(first.getByRole("table")).toBeTruthy();
        fireEvent.change(input(), { target: { value: "今季は？" } });
        fireEvent.click(askButton());
        await waitFor(() => expect(screen.getAllByTestId("consult-stats")).toHaveLength(2));
        const second = within(screen.getAllByTestId("consult-stats")[1]!);
        expect(second.queryByRole("table")).toBeNull();
        expect(second.getByText(/今季の発生は、地図で見てください。/u)).toBeTruthy();
      });

      it("件数だけの往復も続けて聞くときの前の往復に入り、答えには表のまとめの文を渡す。端末に残り、開き直しても表が出る", async () => {
        box.ask.mockResolvedValueOnce(statsOnly()).mockResolvedValueOnce(statsOnly(computeStats(PAST, { groupBy: "season", season: null, prefCode: "31" })));
        renderPage();
        fireEvent.change(input(), { target: { value: "岡山県では？" } });
        fireEvent.click(askButton());
        await screen.findByTestId("consult-stats");
        fireEvent.click(screen.getByRole("button", { name: "鳥取県では？" }));
        await waitFor(() => expect(screen.getAllByTestId("consult-stats")).toHaveLength(2));
        expect(box.ask).toHaveBeenLastCalledWith({ question: "鳥取県では？" }, [{ question: "岡山県では？", answer: okayama.summary }]);
        cleanup();
        renderPage();
        historyOpen();
        fireEvent.click(screen.getByRole("button", { name: /^岡山県では？/u }));
        expect(screen.getAllByTestId("consult-stats")).toHaveLength(2);
      });

      it("表の中に、件数はプログラムが数えたことを必ず出す（対策の答えと一緒のときも）", async () => {
        box.ask.mockResolvedValue(reply({ stats: okayama }));
        renderPage();
        await askText();
        expect(within(screen.getByTestId("consult-stats")).getByText(CONSULT_TEXT.statsCounted)).toBeTruthy();
      });

      it("端末に残った件数の表に query がない（古い形・壊れた中身）ときは、その往復の相談を捨て、画面は落ちない", () => {
        const { query: _q, ...noQuery } = okayama;
        const bad = { id: "b", title: "壊れた件数", createdAt: 1, updatedAt: Date.now(), turns: [{ question: "q", at: 1, result: statsOnly(noQuery as never) }] };
        const good = { id: "g", title: "良い件数", createdAt: 1, updatedAt: Date.now(), turns: [{ question: "q", at: 1, result: statsOnly() }] };
        localStorage.setItem("hpai.consult.history.v1:u1", JSON.stringify([bad, good]));
        renderPage();
        historyOpen();
        expect(screen.queryByText("壊れた件数")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /^良い件数/u }));
        expect(screen.getByTestId("consult-stats")).toBeTruthy();
      });

      it("対策の答えと件数の表を一緒に出せる", async () => {
        box.ask.mockResolvedValue(reply({ stats: okayama }));
        renderPage();
        await askText();
        expect(screen.getByTestId("consult-actions")).toBeTruthy();
        expect(screen.getByTestId("consult-stats")).toBeTruthy();
        expect(screen.getByText(CONSULT_TEXT.advice)).toBeTruthy();
      });
    });

    describe("一覧の検索と札、パソコンの幅の 2 列", () => {
      const seed = () => {
        const at = Date.now();
        const c = (id: string, title: string, q: string, over: Record<string, unknown> = {}) => ({
          id, title, createdAt: at, updatedAt: at, turns: [{ question: q, at, result: reply({ answer: `${title}の答え` }) }], ...over,
        });
        localStorage.setItem(
          "hpai.consult.history.v1:u1",
          JSON.stringify([
            c("a", "長靴・服", "長靴と服の履き替え・消毒で、まず見直すとよいことは？", { topicId: "boots-clothes" }),
            c("b", "裏口の長靴は？", "裏口の長靴は？"),
            c("c", "防鳥ネット・鶏舎の破れ", "防鳥ネットの点検は？", { topicId: "net-house" }),
          ]),
        );
      };

      it("検索の文で一覧を絞り、件数を出す。当てはまらなければその旨", () => {
        seed();
        renderPage();
        historyOpen();
        expect(screen.getByText(CONSULT_TEXT.resultCount(3))).toBeTruthy();
        fireEvent.change(screen.getByLabelText(CONSULT_TEXT.searchLabel), { target: { value: "長靴" } });
        expect(screen.getByText(CONSULT_TEXT.resultCount(2))).toBeTruthy();
        expect(screen.queryByRole("button", { name: /^防鳥ネット・鶏舎の破れ\s*1 往復/u })).toBeNull();
        fireEvent.change(screen.getByLabelText(CONSULT_TEXT.searchLabel), { target: { value: "ワクチン" } });
        expect(screen.getByText(CONSULT_TEXT.noMatch)).toBeTruthy();
      });

      it("話題の札（件数つき）で絞り、もう一度押すと戻る。押している札は aria-pressed", () => {
        seed();
        renderPage();
        historyOpen();
        const tags = within(screen.getByRole("group", { name: CONSULT_TEXT.tagsLabel }));
        expect(tags.getAllByRole("button").map((b) => b.textContent)).toEqual([CONSULT_TEXT.tagAll(3), "長靴・服 1", "防鳥ネット・鶏舎の破れ 1", `${CONSULT_TEXT.tagFree} 1`]);
        fireEvent.click(tags.getByRole("button", { name: `${CONSULT_TEXT.tagFree} 1` }));
        expect(tags.getByRole("button", { name: `${CONSULT_TEXT.tagFree} 1` }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByText(CONSULT_TEXT.resultCount(1))).toBeTruthy();
        expect(screen.getByRole("button", { name: /^裏口の長靴は？\s*1 往復/u })).toBeTruthy();
        fireEvent.click(tags.getByRole("button", { name: `${CONSULT_TEXT.tagFree} 1` }));
        expect(screen.getByText(CONSULT_TEXT.resultCount(3))).toBeTruthy();
      });

      it("話題のボタンで始めた相談には話題の id が残る（札に数えられる）", async () => {
        box.ask.mockResolvedValue(reply());
        renderPage();
        fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[2]!.label }));
        await screen.findByText(CONSULT_TEXT.advice);
        expect((stored()[0] as { topicId?: string }).topicId).toBe(CONSULT_TOPICS[2]!.id);
      });

      it("パソコンの幅では、一覧と相談の中身を同時に出し、切り替えのボタンは隠す。一覧から開くと右に中身と見出しが出る", () => {
        vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(min-width: 64rem)", addEventListener: () => {}, removeEventListener: () => {} }));
        try {
          seed();
          renderPage();
          expect(screen.getByRole("heading", { level: 2, name: CONSULT_TEXT.historyTitle })).toBeTruthy();
          expect(screen.getByRole("log", { name: CONSULT_TEXT.logLabel })).toBeTruthy();
          expect(screen.queryByRole("button", { name: CONSULT_TEXT.historyOpen })).toBeNull();
          fireEvent.click(screen.getByRole("button", { name: /^裏口の長靴は？\s*1 往復/u }));
          expect(screen.getByText("裏口の長靴は？の答え")).toBeTruthy();
          expect(screen.getByRole("heading", { level: 2, name: CONSULT_TEXT.historyTitle })).toBeTruthy();
          expect(document.querySelector(".consult-chat-title")!.textContent).toBe("裏口の長靴は？");
          expect(document.querySelector(".consult-page")!.classList.contains("is-wide")).toBe(true);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });

    it("この端末に残せなかったときは、相談の画面にもその旨が出る", async () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      box.ask.mockResolvedValue(reply());
      renderPage();
      await askText();
      expect(screen.getByText(CONSULT_TEXT.historySaveFailed)).toBeTruthy();
      spy.mockRestore();
    });

    it("やりとりの欄は読み上げの対象（role=log）で、入力欄に注意の文が結び付いている", () => {
      renderPage();
      expect(screen.getByRole("log", { name: CONSULT_TEXT.logLabel })).toBeTruthy();
      const hint = document.getElementById(input().getAttribute("aria-describedby")!)!;
      expect(hint.textContent).toBe(CONSULT_TEXT.inputHint);
    });

    it("送っている間は、これまでの相談と新しい相談のボタンを押せない", async () => {
      let done: (r: ConsultAskResponse) => void = () => {};
      box.ask.mockReturnValue(new Promise<ConsultAskResponse>((r) => (done = r)));
      renderPage();
      fireEvent.change(input(), { target: { value: "長靴は？" } });
      fireEvent.click(askButton());
      await screen.findByText(CONSULT_TEXT.thinking);
      expect((screen.getByRole("button", { name: CONSULT_TEXT.historyOpen }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: CONSULT_TEXT.newChat }) as HTMLButtonElement).disabled).toBe(true);
      done(reply());
      await screen.findByText(CONSULT_TEXT.advice);
    });
  });
});

describe("登録した農場の情報で相談する（本人が選んだときだけ送る）", () => {
  const FARM_BASE = {
    id: "f1", name: "A 農場", memberUids: ["u1"], unsubscribedUids: [], meshCode: "53394611", muniCode: "33203", prefCode: "33",
    frequentMuniCodes: [], housing: "open", kahoContact: "", notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {}, updatedAt: "2026-11-07T10:00:00+09:00",
  };
  const withFarm = (over: Record<string, unknown>) => box.getFarm.mockResolvedValue({ ...FARM_BASE, production: null, ...over });
  const condition = () => screen.getByTestId("consult-condition");
  const useIt = () => screen.findByRole("checkbox", { name: CONSULT_TEXT.conditionUse });

  it("登録があれば、質問の欄の前に「登録した条件: 採卵鶏・平飼い」と、選ぶ欄（最初は選ばれていない）が出る", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    renderPage();
    expect(((await useIt()) as HTMLInputElement).checked).toBe(false);
    expect(within(condition()).getByText("登録した条件: 採卵鶏・平飼い")).toBeTruthy();
    // 見出しは「飼い方」と重ねない。選ぶ欄の名前は「登録した農場の情報で相談する」（2026-11-08。飼い方だけでなく町・近くの発生・鶏舎も渡す）
    expect(CONSULT_TEXT.conditionUse).toBe("登録した農場の情報で相談する");
    expect(within(condition()).queryByText(/登録した飼い方/)).toBeNull();
    // 欄は入力欄より前にある
    expect(condition().compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("選ばずに送ると、今までどおり条件なしで呼ぶ（2 つの引数だけ）。答えの近くに条件は出ない", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    box.ask.mockResolvedValue(reply());
    renderPage();
    await useIt();
    await askText("長靴は？");
    expect(box.ask).toHaveBeenCalledWith({ question: "長靴は？" }, []);
    expect(box.ask.mock.calls[0]).toHaveLength(2);
    expect(screen.queryByText(/今回の条件/)).toBeNull();
  });

  it("選ぶと送る内容が先に出て、条件 { production, rearing } を付けて呼ぶ。答えの近くに「今回の条件: 採卵鶏・平飼い」が出て、記録にも残る", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    box.ask.mockResolvedValue(reply({ farm: { production: "layer", rearing: "floor" } }));
    renderPage();
    fireEvent.click(await useIt());
    expect(within(condition()).getByText("AI に渡すのは「採卵鶏・平飼い・岡山県津山市」です。")).toBeTruthy();
    expect(within(condition()).getByText(CONSULT_TEXT.conditionNotSent)).toBeTruthy();
    await askText("長靴は？");
    expect(box.ask).toHaveBeenCalledWith({ question: "長靴は？" }, [], { production: "layer", rearing: "floor", muniCode: "33203" });
    const advice = screen.getByTestId("consult-advice");
    expect(within(advice).getByText("今回の条件: 採卵鶏・平飼い")).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem("hpai.consult.history.v1:u1") ?? "[]") as { turns: { result: { farm?: unknown } }[] }[];
    expect(stored[0]!.turns[0]!.result.farm).toEqual({ production: "layer", rearing: "floor" });
  });

  it("話題のボタンも、選んでいれば条件を付けて呼ぶ", async () => {
    withFarm({ production: "broiler", rearing: "cage" });
    box.ask.mockResolvedValue(reply({ farm: { production: "broiler", rearing: "cage" } }));
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TOPICS[0]!.label }));
    await waitFor(() => expect(box.ask).toHaveBeenCalledWith({ topicId: CONSULT_TOPICS[0]!.id }, [], { production: "broiler", rearing: "cage", muniCode: "33203" }));
    expect(await screen.findByText("今回の条件: 肉用鶏・ケージ飼い")).toBeTruthy();
  });

  it("片方だけの登録は、未登録の側を「未登録」と出し、登録した側だけを送る（推測で埋めない）", async () => {
    withFarm({ production: "layer", rearing: null });
    box.ask.mockResolvedValue(reply({ farm: { production: "layer" } }));
    renderPage();
    fireEvent.click(await useIt());
    expect(within(condition()).getByText("登録した条件: 採卵鶏・飼い方は未登録")).toBeTruthy();
    expect(within(condition()).getByText("AI に渡すのは「採卵鶏・岡山県津山市」です。")).toBeTruthy();
    await askText("長靴は？");
    expect(box.ask).toHaveBeenCalledWith({ question: "長靴は？" }, [], { production: "layer", muniCode: "33203" });
    expect(screen.getByText("今回の条件: 採卵鶏")).toBeTruthy();
  });

  it("未登録（どちらも未設定・飼い方の項目がない前からの農場・農場なし）は「未登録」と出し、選ぶ欄を出さない。条件なしで相談できる", async () => {
    for (const setFarm of [() => withFarm({ production: null, rearing: null }), () => withFarm({}), () => box.getFarm.mockResolvedValue(null)]) {
      setFarm();
      box.ask.mockReset().mockResolvedValue(reply());
      renderPage();
      expect(await within(await screen.findByTestId("consult-condition")).findByText(/^登録した条件: 未登録。/)).toBeTruthy();
      expect(screen.queryByRole("checkbox", { name: CONSULT_TEXT.conditionUse })).toBeNull();
      expect(within(condition()).getByRole("link", { name: CONSULT_TEXT.conditionSettingsLink }).getAttribute("href")).toBe("/settings/farm");
      await askText("長靴は？");
      expect(box.ask.mock.calls[0]).toHaveLength(2);
      cleanup();
      localStorage.clear();
    }
  });

  it("登録を読み込めないときは、読み込めなかったと出し、選ぶ欄を出さない（未登録とは言わない）", async () => {
    box.getFarm.mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByText(CONSULT_TEXT.conditionLoadFailed)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: CONSULT_TEXT.conditionUse })).toBeNull();
    expect(screen.queryByText(/未登録/)).toBeNull();
  });

  it("食い違い: 登録はケージ飼いなのに質問に「平飼い」 → 送らずに訂正を促す。文は残る", async () => {
    withFarm({ production: "layer", rearing: "cage" });
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "平飼いで長靴は？" } });
    fireEvent.click(askButton());
    const alert = await screen.findByTestId("consult-conflict");
    expect(within(alert).getByText("質問では平飼い、登録はケージ飼いです。登録を直すか、送り方を選んでください。")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: CONSULT_TEXT.conflictFix }).getAttribute("href")).toBe("/settings/farm");
    expect(box.ask).not.toHaveBeenCalled();
    expect(input().value).toBe("平飼いで長靴は？");
  });

  it("食い違い: 「条件を付けずに送る」を選んだときだけ、条件なしで送る", async () => {
    withFarm({ production: "broiler", rearing: null });
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "卵の出荷の消毒は？" } });
    fireEvent.click(askButton());
    const alert = await screen.findByTestId("consult-conflict");
    expect(within(alert).getByText("質問では採卵、登録は肉用鶏です。登録を直すか、送り方を選んでください。")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: CONSULT_TEXT.conflictSendWithout }));
    await screen.findByText(CONSULT_TEXT.advice);
    expect(box.ask).toHaveBeenCalledTimes(1);
    expect(box.ask.mock.calls[0]).toEqual([{ question: "卵の出荷の消毒は？" }, []]);
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    expect(screen.queryByText(/今回の条件/)).toBeNull();
  });

  it("食い違い: 確認には「登録を直す（リンク）」「このまま条件を付けて送る」「条件を付けずに送る」「やめる」がこの順で並び、主のボタンはない", async () => {
    withFarm({ production: "layer", rearing: "cage" });
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "平飼いで長靴は？" } });
    fireEvent.click(askButton());
    const alert = await screen.findByTestId("consult-conflict");
    const actions = Array.from(alert.querySelectorAll("a, button"));
    expect(actions.map((el) => [el.tagName, el.textContent])).toEqual([
      ["A", CONSULT_TEXT.conflictFix],
      ["BUTTON", CONSULT_TEXT.conflictSendWith],
      ["BUTTON", CONSULT_TEXT.conflictSendWithout],
      ["BUTTON", CONSULT_TEXT.conflictCancel],
    ]);
    expect(CONSULT_TEXT.conflictSendWith).toBe("このまま条件を付けて送る");
    for (const el of actions) expect(el.classList.contains("btn-primary"), el.textContent ?? "").toBe(false);
    // 押さなければ送らない
    expect(box.ask).not.toHaveBeenCalled();
  });

  it("食い違い: 「このまま条件を付けて送る」を押すと、登録した条件を付けて 1 回だけ送り、確認が消える", async () => {
    withFarm({ production: "layer", rearing: "cage" });
    box.ask.mockResolvedValue(reply({ farm: { production: "layer", rearing: "cage" } }));
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "平飼いで長靴は？" } });
    fireEvent.click(askButton());
    const alert = await screen.findByTestId("consult-conflict");
    expect(box.ask).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: CONSULT_TEXT.conflictSendWith }));
    await screen.findByText(CONSULT_TEXT.advice);
    expect(box.ask.mock.calls).toEqual([[{ question: "平飼いで長靴は？" }, [], { production: "layer", rearing: "cage", muniCode: "33203" }]]);
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    expect(screen.getByText("今回の条件: 採卵鶏・ケージ飼い")).toBeTruthy();
    // 選んだ状態は残る（次の相談でも本人が外すまで条件を付ける）
    expect(((await useIt()) as HTMLInputElement).checked).toBe(true);
  });

  it("食い違い: 続けて聞く候補の文で食い違っても、同じ 4 つの確認が出て、押すまで送らない。「このまま条件を付けて送る」で条件を付けて送る", async () => {
    withFarm({ production: "layer", rearing: "cage" });
    box.ask
      .mockResolvedValueOnce(reply({ answer: "一つ目の答え", followUps: ["平飼いの鶏舎では？"], farm: { production: "layer", rearing: "cage" } }))
      .mockResolvedValueOnce(reply({ answer: "二つ目の答え", followUps: [], farm: { production: "layer", rearing: "cage" } }));
    renderPage();
    fireEvent.click(await useIt());
    await askText("長靴は？");
    const group = screen.getByRole("group", { name: CONSULT_TEXT.followUpsLabel });
    fireEvent.click(within(group).getByRole("button", { name: "平飼いの鶏舎では？" }));
    const alert = await screen.findByTestId("consult-conflict");
    expect(within(alert).getByText("質問では平飼い、登録はケージ飼いです。登録を直すか、送り方を選んでください。")).toBeTruthy();
    expect(Array.from(alert.querySelectorAll("a, button")).map((el) => el.textContent)).toEqual([
      CONSULT_TEXT.conflictFix,
      CONSULT_TEXT.conflictSendWith,
      CONSULT_TEXT.conflictSendWithout,
      CONSULT_TEXT.conflictCancel,
    ]);
    expect(box.ask).toHaveBeenCalledTimes(1);
    fireEvent.click(within(alert).getByRole("button", { name: CONSULT_TEXT.conflictSendWith }));
    await screen.findByText("二つ目の答え");
    expect(box.ask).toHaveBeenCalledTimes(2);
    expect(box.ask.mock.calls[1]![0]).toEqual({ question: "平飼いの鶏舎では？" });
    expect(box.ask.mock.calls[1]![2]).toEqual({ production: "layer", rearing: "cage", muniCode: "33203" });
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
  });

  it("「新しい相談」を始めると「登録した農場の情報で相談する」は外れる（付けるかは相談のたびに選ぶ）", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    box.ask.mockResolvedValue(reply({ farm: { production: "layer", rearing: "floor" } }));
    renderPage();
    fireEvent.click(await useIt());
    await askText("長靴は？");
    expect(((await useIt()) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.newChat }));
    expect(((await useIt()) as HTMLInputElement).checked).toBe(false);
    await askText("網は？");
    expect(box.ask.mock.calls[1]).toEqual([{ question: "網は？" }, []]);
  });

  it("一覧から別の相談を開くと「登録した農場の情報で相談する」は外れる", async () => {
    const at = Date.now();
    localStorage.setItem(
      "hpai.consult.history.v1:u1",
      JSON.stringify([{ id: "old", title: "前の相談", createdAt: at, updatedAt: at, turns: [{ question: "前の相談", at, result: reply() }] }]),
    );
    withFarm({ production: "layer", rearing: "floor" });
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.click(await useIt());
    expect(((await useIt()) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.historyOpen }));
    fireEvent.click(screen.getByRole("button", { name: /^前の相談/u }));
    expect(((await useIt()) as HTMLInputElement).checked).toBe(false);
    await askText("続きは？");
    expect(box.ask.mock.calls[0]![2]).toBeUndefined();
    expect(box.ask.mock.calls[0]).toHaveLength(2);
  });

  it("食い違い: 「やめる」や、質問を書き直すと、確認が消えて送らない", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    box.ask.mockResolvedValue(reply({ farm: { production: "layer", rearing: "floor" } }));
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "ケージ飼いの網は？" } });
    fireEvent.click(askButton());
    fireEvent.click(within(await screen.findByTestId("consult-conflict")).getByRole("button", { name: CONSULT_TEXT.conflictCancel }));
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    expect(input().value).toBe("ケージ飼いの網は？");
    fireEvent.click(askButton());
    await screen.findByTestId("consult-conflict");
    // 書き直すと消え、食い違いのない文は条件を付けて送れる
    fireEvent.change(input(), { target: { value: "網の穴は？" } });
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    expect(box.ask.mock.calls).toEqual([[{ question: "網の穴は？" }, [], { production: "layer", rearing: "floor", muniCode: "33203" }]]);
  });

  it("選ばなければ、質問の文と登録が食い違っても確かめない（条件を送らないので）", async () => {
    withFarm({ rearing: "cage" });
    box.ask.mockResolvedValue(reply());
    renderPage();
    await useIt();
    await askText("平飼いで長靴は？");
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    expect(box.ask.mock.calls[0]).toEqual([{ question: "平飼いで長靴は？" }, []]);
  });

  it("件数だけの答えには、条件を付けて聞いても「今回の条件」を出さない（表は条件で絞っていない）", async () => {
    withFarm({ production: "layer", rearing: "floor" });
    const stats = computeStats([], { groupBy: "season", season: null, prefCode: null });
    box.ask.mockResolvedValue({ answer: "", cards: [], outOfScope: false, notice: null, stats, farm: { production: "layer", rearing: "floor" } });
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "件数は？" } });
    fireEvent.click(askButton());
    await screen.findByTestId("consult-stats");
    expect(screen.queryByText(/今回の条件/)).toBeNull();
  });

  it("会員が替わったら、その会員の登録を読み直し、選んだ状態と食い違いの確認を戻す（前の会員の条件を送らない）", async () => {
    box.getFarm.mockResolvedValue({ ...FARM_BASE, production: "layer", rearing: "cage" });
    box.ask.mockResolvedValue(reply());
    const view = renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "平飼いは？" } });
    fireEvent.click(askButton());
    await screen.findByTestId("consult-conflict");
    // u2 に替わる。u2 の農場は肉用・平飼い
    box.getFarm.mockResolvedValue({ ...FARM_BASE, id: "f2", production: "broiler", rearing: "floor" });
    box.auth = { user: { uid: "u2" }, member: true, loading: false, error: false, refresh: async () => {} };
    view.rerender(
      <RecordStoreProvider value={store}>
        <MemoryRouter initialEntries={["/consult"]}>
          <ConsultPage />
        </MemoryRouter>
      </RecordStoreProvider>,
    );
    expect(await screen.findByText("登録した条件: 肉用鶏・平飼い")).toBeTruthy();
    expect(screen.queryByText(/採卵鶏・ケージ飼い/)).toBeNull();
    expect(((await useIt()) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    fireEvent.change(input(), { target: { value: "長靴は？" } });
    fireEvent.click(askButton());
    await screen.findByText(CONSULT_TEXT.advice);
    expect(box.ask.mock.calls).toEqual([[{ question: "長靴は？" }, []]]);
  });

  it("条件の欄と食い違いの確認の文に禁止語がない", async () => {
    withFarm({ production: "layer", rearing: "cage" });
    renderPage();
    fireEvent.click(await useIt());
    fireEvent.change(input(), { target: { value: "平飼いは？" } });
    fireEvent.click(askButton());
    await screen.findByTestId("consult-conflict");
    expect(findWordingViolations(condition().textContent ?? "")).toEqual([]);
    expect(findWordingViolations(screen.getByTestId("consult-conflict").textContent ?? "")).toEqual([]);
  });
});

describe("町・近くの発生・鶏舎ごとの羽数（2026-11-08 豪さんの決定。マス目・緯度経度・農場の名前・鶏舎の名前は送らない）", () => {
  const FARM = {
    id: "f1", name: "A 農場", memberUids: ["u1"], unsubscribedUids: [], meshCode: "53394611", muniCode: "33203", prefCode: "33",
    frequentMuniCodes: ["33214"], housing: "open", kahoContact: "", notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {}, updatedAt: "2026-11-07T10:00:00+09:00", production: "layer", rearing: "floor",
  };
  const house = (id: string, flockSize: unknown, empty = false, birdType = "採卵鶏") => ({ id, name: `${id} 号舎`, birdType, flockSize, empty });
  const H = (flockSize: number, empty = false) => ({ birdType: "採卵鶏", flockSize, empty });
  const NEAR = { casesWithin60km: 2, zone: "possible" } as const;
  const ready = (townName: string | null = "岡山県津山市") => box.place.mockReturnValue({ nearby: { status: "ready", nearby: NEAR }, townName });
  const condition = () => screen.getByTestId("consult-condition");
  const useIt = () => screen.findByRole("checkbox", { name: CONSULT_TEXT.conditionUse });
  const LABEL = "採卵鶏・平飼い・岡山県津山市・約 60 km 以内の今季の発生 2 件（区域に入っている可能性あり）・鶏舎 1: 採卵鶏 1,200 羽、鶏舎 2: 採卵鶏 800 羽、鶏舎 3: 採卵鶏 空舎";

  it("渡すものを表示し、市町村コード・近くの発生・鶏舎ごとの羽数（名前なし・番号の順）を付けて呼ぶ。答えの近くと端末の記録に、関数が返した条件（町の名前つき）が出る", async () => {
    box.getFarm.mockResolvedValue(FARM);
    box.listHouses.mockResolvedValue([house("1", 1200), house("2", 800), house("3", 0, true)]);
    ready();
    const sent = { production: "layer", rearing: "floor", muniCode: "33203", nearby: NEAR, houses: [H(1200), H(800), H(0, true)] };
    box.ask.mockResolvedValue(reply({ farm: { ...sent, town: "岡山県津山市" } as never }));
    renderPage();
    fireEvent.click(await useIt());
    expect(within(condition()).getByText("登録した条件: 採卵鶏・平飼い")).toBeTruthy();
    expect(within(condition()).getByText(`AI に渡すのは「${LABEL}」です。`)).toBeTruthy();
    expect(within(condition()).getByText(CONSULT_TEXT.conditionNotSent)).toBeTruthy();
    expect(CONSULT_TEXT.conditionNotSent).toContain("約 1km のマス目・緯度経度・農場の名前・鶏舎の名前・鶏舎の造り・記録は渡しません");
    await askText("長靴は？");
    expect(box.ask.mock.calls).toEqual([[{ question: "長靴は？" }, [], sent]]);
    // マス目・農場の名前・鶏舎の名前・よく行き来する町は送らない
    expect(JSON.stringify(box.ask.mock.calls)).not.toMatch(/53394611|A 農場|号舎|33214|housing/u);
    expect(within(screen.getByTestId("consult-advice")).getByText(`今回の条件: ${LABEL}`)).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem("hpai.consult.history.v1:u1") ?? "[]") as { turns: { result: { farm?: unknown } }[] }[];
    expect(stored[0]!.turns[0]!.result.farm).toEqual({ ...sent, town: "岡山県津山市" });
  });

  it("近くの発生は、登録した農場のマス目と市町村から数える（端末の地点ではない）", async () => {
    box.getFarm.mockResolvedValue(FARM);
    renderPage();
    await useIt();
    expect(box.place).toHaveBeenLastCalledWith({ meshCode: "53394611", muniCode: "33203", frequentMuniCodes: ["33214"] });
  });

  it("近くの発生が確認中・確認できていないときは送らず、そう書く（0 件と言わない）", async () => {
    for (const [status, note] of [
      ["loading", CONSULT_TEXT.conditionNearbyLoading],
      ["unavailable", CONSULT_TEXT.conditionNearbyUnavailable],
    ] as const) {
      box.getFarm.mockResolvedValue(FARM);
      box.listHouses.mockResolvedValue([house("1", 1200)]);
      box.place.mockReturnValue({ nearby: { status }, townName: "岡山県津山市" });
      box.ask.mockReset().mockResolvedValue(reply());
      renderPage();
      fireEvent.click(await useIt());
      expect(within(condition()).getByText(note), status).toBeTruthy();
      expect(condition().textContent, status).not.toMatch(/0 件|60 km/u);
      await askText("長靴は？");
      expect(box.ask.mock.calls[0]![2], status).toEqual({ production: "layer", rearing: "floor", muniCode: "33203", houses: [H(1200)] });
      cleanup();
      localStorage.clear();
    }
  });

  it("町の名前を読めないときは、市町村コードで出す（送るのはコードだけ）", async () => {
    box.getFarm.mockResolvedValue(FARM);
    ready(null);
    renderPage();
    fireEvent.click(await useIt());
    expect(within(condition()).getByText(/^AI に渡すのは「採卵鶏・平飼い・市町村コード 33203・約 60 km/u)).toBeTruthy();
  });

  it("鶏舎なし・31 棟以上・読めない羽数・一覧の外の鳥・読み込みの失敗・同期の例外のときは鶏舎を送らない（推測で埋めない）。ほかの条件は送る", async () => {
    const many = Array.from({ length: 31 }, (_, i) => house(String(i + 1), 100));
    const cases: [string, () => void][] = [
      ["鶏舎なし", () => box.listHouses.mockResolvedValue([])],
      ["31 棟", () => box.listHouses.mockResolvedValue(many)],
      ["読めない羽数", () => box.listHouses.mockResolvedValue([house("1", 5000), house("2", "たくさん")])],
      ["上限を超える羽数", () => box.listHouses.mockResolvedValue([house("1", 1_000_001)])],
      ["一覧の外の鳥", () => box.listHouses.mockResolvedValue([house("1", 100, false, "ダチョウ")])],
      ["読み込みの失敗", () => box.listHouses.mockRejectedValue(new Error("offline"))],
      [
        "同期の例外",
        () =>
          box.listHouses.mockImplementation(() => {
            throw new Error("boom");
          }),
      ],
    ];
    for (const [name, set] of cases) {
      box.getFarm.mockResolvedValue(FARM);
      box.listHouses.mockReset();
      set();
      ready();
      box.ask.mockReset().mockResolvedValue(reply());
      renderPage();
      fireEvent.click(await useIt());
      expect(within(condition()).queryByText(/鶏舎 1/u), name).toBeNull();
      await askText("長靴は？");
      expect(box.ask.mock.calls[0]![2], name).toEqual({ production: "layer", rearing: "floor", muniCode: "33203", nearby: NEAR });
      cleanup();
      localStorage.clear();
    }
  });

  it("飼育目的も飼い方も未登録なら、町と鶏舎があっても選ぶ欄を出さない（町や鶏舎だけの条件は作らない）", async () => {
    box.getFarm.mockResolvedValue({ ...FARM, production: null, rearing: null });
    box.listHouses.mockResolvedValue([house("1", 5000)]);
    ready();
    renderPage();
    expect(await within(await screen.findByTestId("consult-condition")).findByText(/^登録した条件: 未登録。/u)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: CONSULT_TEXT.conditionUse })).toBeNull();
  });

  it("鶏舎を読み終えるまで選ぶ欄を出さない（最初の 1 回だけ鶏舎なしで送ることがない）", async () => {
    box.getFarm.mockResolvedValue(FARM);
    let done: (v: unknown) => void = () => {};
    box.listHouses.mockReturnValue(new Promise((r) => (done = r)));
    renderPage();
    await waitFor(() => expect(box.listHouses).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("checkbox", { name: CONSULT_TEXT.conditionUse })).toBeNull();
    done([house("1", 4000)]);
    fireEvent.click(await useIt());
    expect(within(condition()).getByText(/鶏舎 1: 採卵鶏 4,000 羽/u)).toBeTruthy();
  });

  it("2026-11-08 より前の記録（羽数の幅つき）も読めて、今回の条件に幅を出す", async () => {
    const at = Date.now();
    localStorage.setItem(
      "hpai.consult.history.v1:u1",
      JSON.stringify([{ id: "old", title: "前の相談", createdAt: at, updatedAt: at, turns: [{ question: "前の相談", at, result: reply({ farm: { production: "layer", rearing: "floor", scale: "1000to3000" } }) }] }]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: CONSULT_TEXT.historyOpen }));
    fireEvent.click(screen.getByRole("button", { name: /^前の相談/u }));
    expect(await screen.findByText("今回の条件: 採卵鶏・平飼い・1,000〜2,999 羽")).toBeTruthy();
  });

  it("鳥の種類の列は、農場の設定の鶏舎の一覧（BIRD_TYPES）と同じ", async () => {
    const { BIRD_TYPES } = await import("../settings/houseForm");
    expect([...CONSULT_BIRD_TYPES]).toEqual([...BIRD_TYPES]);
  });

  it("条件の欄の文・区域の語に禁止語がない", async () => {
    for (const label of Object.values(ZONE_LABEL)) expect(findWordingViolations(label), label).toEqual([]);
    box.getFarm.mockResolvedValue(FARM);
    box.listHouses.mockResolvedValue([house("1", 4000)]);
    ready();
    renderPage();
    fireEvent.click(await useIt());
    expect(findWordingViolations(condition().textContent ?? "")).toEqual([]);
  });

  it("質問の羽数と鶏舎の羽数は突き合わせない（食い違いの確認を出さない）", async () => {
    box.getFarm.mockResolvedValue(FARM);
    box.listHouses.mockResolvedValue([house("1", 4000)]);
    box.ask.mockResolvedValue(reply());
    renderPage();
    fireEvent.click(await useIt());
    await askText("うちは 300 羽です。長靴は？");
    expect(screen.queryByTestId("consult-conflict")).toBeNull();
    expect(box.ask.mock.calls[0]![2]).toEqual({ production: "layer", rearing: "floor", muniCode: "33203", houses: [H(4000)] });
  });
});
