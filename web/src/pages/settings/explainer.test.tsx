// M-19: 近隣への説明文の画面。Claude の呼び出しは偽物（実際には呼ばない）。
import { neighborOfficialPart, neighborTemplate, ownOutbreakNoticeTemplate, type NeighborDraftResult } from "@hpai/shared/drafts";
import { OFFICIAL_GUIDANCE, OFFICIAL_GUIDANCE_REVIEWED_ON } from "@hpai/shared/guidance/official";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import type { DataSource, RecordStore } from "../../data/types";

const authState = vi.hoisted(() => ({
  value: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} } as {
    user: { uid: string } | null;
    member: boolean;
    loading: boolean;
    error: boolean;
    refresh(): Promise<void>;
  },
}));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => authState.value }));

const draftCall = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../auth/callables", () => ({
  draftNeighborExplainerCall: draftCall.fn,
  createFarmInviteCall: vi.fn(),
  redeemInviteCall: vi.fn(),
}));

import ExplainerPage, { explainFailures } from "./ExplainerPage";

const dataSource = { mode: "live", now: () => new Date("2026-11-07T10:00:00+09:00") } as unknown as DataSource;
const MEASURES = "入口で長靴を履き替え、消毒しています。";
const clipboard = { writeText: vi.fn(async (_t: string) => {}) };

function LocationProbe() {
  return <p data-testid="at">{useLocation().pathname}</p>;
}

function mount(mode: "firestore" | "sample" = "firestore") {
  const store = { mode } as unknown as RecordStore;
  const routes: RouteObject[] = [
    {
      path: "/settings/explainer",
      element: (
        <DataSourceProvider value={dataSource}>
          <RecordStoreProvider value={store}>
            <LocationProbe />
            <ExplainerPage />
          </RecordStoreProvider>
        </DataSourceProvider>
      ),
    },
    { path: "/login", element: <LocationProbe /> },
  ];
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/settings/explainer"] })} />);
}

function claudeResult(o: Partial<NeighborDraftResult> = {}): NeighborDraftResult {
  return { farmPart: "Claude が書いた農場の部分です。", officialPart: neighborOfficialPart(), source: "claude", failures: [], ...o };
}

const measuresBox = () => screen.getByLabelText("農場でしている対策") as HTMLTextAreaElement;
const createButton = () => screen.getByRole("button", { name: "下書きを作る" });

async function makeDraft(result: NeighborDraftResult = claudeResult()) {
  draftCall.fn.mockResolvedValueOnce(result);
  fireEvent.change(measuresBox(), { target: { value: MEASURES } });
  fireEvent.click(createButton());
  await screen.findByRole("region", { name: "説明文の下書き" });
}

beforeEach(() => {
  authState.value = { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} };
  draftCall.fn.mockReset();
  clipboard.writeText.mockReset();
  clipboard.writeText.mockImplementation(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(cleanup);

describe("会員だけの画面", () => {
  it("未ログインなら入力の欄を出さず /login へ（RequireMember で包む）", async () => {
    authState.value = { ...authState.value, user: null, member: false };
    mount();
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe("/login"));
    expect(screen.queryByLabelText("農場でしている対策")).toBeNull();
  });
  it("claim がなければ招待コードの入力欄で、入力の欄は出ない", async () => {
    authState.value = { ...authState.value, member: false };
    mount();
    expect(await screen.findByRole("heading", { name: "招待コードを入れてください" })).toBeTruthy();
    expect(screen.queryByLabelText("農場でしている対策")).toBeNull();
  });
});

describe("入力の欄", () => {
  it("題と、配る相手の選び方と、入力の上限（2000 字）がある", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "近隣への説明文" })).toBeTruthy();
    expect(measuresBox().maxLength).toBe(2000);
    expect(screen.getByText("0 / 2000 字")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "住民説明会で話す" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "回覧で配る" })).toBeTruthy();
    fireEvent.change(measuresBox(), { target: { value: "ネットを張っています" } });
    expect(screen.getByText("10 / 2000 字")).toBeTruthy();
  });

  it("ボタンの前に『入力した文を Claude に送ります』と出る（農場の名前、位置、記録は送らない）", () => {
    mount();
    const notice = screen.getByText(/入力した文を Claude に送ります/);
    expect(notice.textContent).toContain("農場の名前、位置、記録は送りません");
    // 文書の中でボタンより前にある
    expect(notice.compareDocumentPosition(createButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("入力が空の間はボタンが押せず、Claude を呼ばない", () => {
    mount();
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(measuresBox(), { target: { value: "   " } });
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
    expect(draftCall.fn).not.toHaveBeenCalled();
  });

  it("『配るのは農場で、作品からは送りません』と書いてある", () => {
    mount();
    expect(screen.getAllByText(/配るのは農場で、作品からは送りません/).length).toBeGreaterThan(0);
  });

  it("書く前の画面の文に、使ってはいけない語（安全、安心、区域の外です）がない", () => {
    const { container } = mount();
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });
});

describe("下書きを作る", () => {
  it("入力の文と配り方だけを渡して呼ぶ", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "回覧で配る" }));
    await makeDraft();
    expect(draftCall.fn).toHaveBeenCalledTimes(1);
    expect(draftCall.fn).toHaveBeenCalledWith(MEASURES, "circular");
  });

  it("作っている間はボタンが押せず、二度押しても 1 回だけ呼ぶ", async () => {
    let release: (r: NeighborDraftResult) => void = () => {};
    draftCall.fn.mockImplementationOnce(() => new Promise<NeighborDraftResult>((res) => (release = res)));
    mount();
    fireEvent.change(measuresBox(), { target: { value: MEASURES } });
    fireEvent.click(createButton());
    const busy = await screen.findByRole("button", { name: "下書きを作っています" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(draftCall.fn).toHaveBeenCalledTimes(1);
    await act(async () => release(claudeResult()));
    await screen.findByRole("region", { name: "説明文の下書き" });
  });

  it("失敗したら知らせ、入力の文は残す", async () => {
    draftCall.fn.mockRejectedValueOnce(new Error("permission-denied"));
    mount();
    fireEvent.change(measuresBox(), { target: { value: MEASURES } });
    fireEvent.click(createButton());
    expect((await screen.findByRole("alert")).textContent).toContain("下書きを作れませんでした");
    expect(measuresBox().value).toBe(MEASURES);
    expect(screen.queryByRole("region", { name: "説明文の下書き" })).toBeNull();
  });

  it("Claude の下書きは直せる欄に入り、『下書きです』と出る", async () => {
    mount();
    await makeDraft();
    const farm = screen.getByLabelText("農場の部分（直して使えます）") as HTMLTextAreaElement;
    expect(farm.value).toBe("Claude が書いた農場の部分です。");
    expect(screen.getByText(/Claude が下書きしました/).textContent).toContain("配る前に、必ず読んで、直してください");
  });

  it("雛形のときは、Claude の下書きではないことと理由を出す", async () => {
    mount();
    await makeDraft(claudeResult({ source: "template", farmPart: neighborTemplate(MEASURES, "meeting"), failures: ["unknown_number:43"] }));
    expect(screen.getByText(/Claude の下書きではなく、入力した文を入れた雛形/)).toBeTruthy();
    expect(screen.getByText(/入力にない数字や、書かない言い方があったため/)).toBeTruthy();
    expect((screen.getByLabelText("農場の部分（直して使えます）") as HTMLTextAreaElement).value).toContain(MEASURES);
  });

  it("作り直すと、前の下書きの直しは新しい下書きに置き換わる", async () => {
    mount();
    await makeDraft();
    fireEvent.change(screen.getByLabelText("農場の部分（直して使えます）"), { target: { value: "直した" } });
    expect(screen.getByText(/作り直すと、下の下書きに加えた直しは消えます/)).toBeTruthy();
    draftCall.fn.mockResolvedValueOnce(claudeResult({ farmPart: "二回目の下書き" }));
    fireEvent.click(createButton());
    await waitFor(() => expect((screen.getByLabelText("農場の部分（直して使えます）") as HTMLTextAreaElement).value).toBe("二回目の下書き"));
  });
});

describe("国の文と出典の確認", () => {
  it("国の文は一字も変えずに、出典つきで並ぶ", async () => {
    mount();
    await makeDraft();
    const official = neighborOfficialPart();
    const first = official[0]!;
    const quote = screen.getByText(first.text);
    expect(quote.closest("blockquote")!.textContent).toContain(first.sourceTitle);
    for (const s of official) expect(screen.getAllByText(s.text, { exact: true }).length).toBeGreaterThan(0);
  });

  it("出典の確認の一覧: 出典ごとに 1 つ、リンクとチェックがある。確かめた数が増える", async () => {
    mount();
    await makeDraft();
    const urls = new Set(neighborOfficialPart().map((s) => s.sourceUrl));
    const boxes = screen.getAllByRole("checkbox", { name: /を確かめた$/ });
    expect(boxes).toHaveLength(urls.size);
    expect(screen.getByText(`確かめた 0 / ${urls.size} 件`)).toBeTruthy();
    fireEvent.click(boxes[0]!);
    expect(screen.getByText(`確かめた 1 / ${urls.size} 件`)).toBeTruthy();
    const links = screen.getAllByRole("link").filter((a) => urls.has(a.getAttribute("href") ?? ""));
    expect(links.length).toBeGreaterThanOrEqual(urls.size);
    for (const a of links) expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("国の文を確認した日を出し、『確認前』とは出さない", async () => {
    mount();
    await makeDraft();
    expect(document.body.textContent).toContain(`文面を確認した日: ${OFFICIAL_GUIDANCE_REVIEWED_ON}`);
    expect(screen.queryByText(/作者と共同経営者の確認前/)).toBeNull();
  });
});

describe("コピー", () => {
  it("直した農場の部分と、国の文（出典つき）をまとめてコピーする", async () => {
    mount();
    await makeDraft();
    fireEvent.change(screen.getByLabelText("農場の部分（直して使えます）"), { target: { value: "直した農場の部分" } });
    fireEvent.click(screen.getByRole("button", { name: "説明文をコピーする" }));
    await screen.findByText(/コピーしました/);
    const copied = clipboard.writeText.mock.calls[0]![0];
    expect(copied.startsWith("直した農場の部分")).toBe(true);
    const human = OFFICIAL_GUIDANCE.find((g) => g.topic === "human_infection")!;
    for (const s of human.statements) expect(copied).toContain(`${s.text}（出典: ${s.sourceTitle}）`);
    expect(copied).toContain("【人への感染】");
    expect(copied).not.toContain("Claude が書いた");
  });

  it("付けない話題のチェックを外すと、その話題はコピーに入らない", async () => {
    mount();
    await makeDraft();
    const burial = OFFICIAL_GUIDANCE.find((g) => g.topic === "burial")!;
    fireEvent.click(screen.getByRole("checkbox", { name: `${burial.heading}を付ける` }));
    expect(screen.queryByText(burial.statements[0]!.text)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "説明文をコピーする" }));
    await screen.findByText(/コピーしました/);
    const copied = clipboard.writeText.mock.calls[0]![0];
    expect(copied).not.toContain(`【${burial.heading}】`);
    expect(copied).toContain("【人への感染】");
  });

  it("コピーできない端末では、手でコピーするよう知らせる", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    mount();
    await makeDraft();
    fireEvent.click(screen.getByRole("button", { name: "説明文をコピーする" }));
    expect((await screen.findByText(/コピーできませんでした/)).textContent).toContain("手でコピー");
  });
});

describe("自分の農場で発生したときの知らせ", () => {
  it("開いた時から雛形があり、日付、疑いか確認か、問い合わせ先の空欄がある。農場に近づかないよう書いてある", () => {
    mount();
    const box = screen.getByLabelText("発生したときの知らせ（直して使えます）") as HTMLTextAreaElement;
    expect(box.value).toBe(ownOutbreakNoticeTemplate());
    expect(box.value).toMatch(/（　+月　+日）/u);
    expect(box.value).toContain("【疑い／発生の確認】");
    expect(box.value).toMatch(/問い合わせ先: （　+）/u);
    expect(box.value).toContain("近づかないでください");
  });

  it("Claude を呼ばない。直してコピーできる", async () => {
    mount();
    const box = screen.getByLabelText("発生したときの知らせ（直して使えます）");
    fireEvent.change(box, { target: { value: "直した知らせ" } });
    fireEvent.click(screen.getByRole("button", { name: "知らせをコピーする" }));
    await screen.findByText(/コピーしました/);
    expect(clipboard.writeText).toHaveBeenCalledWith("直した知らせ");
    expect(draftCall.fn).not.toHaveBeenCalled();
  });
});

describe("見本の農場", () => {
  it("Claude にも Firebase にもつながず、雛形に入力の文を入れて見せる。送ると書かない", async () => {
    mount("sample");
    expect(screen.queryByText(/入力した文を Claude に送ります/)).toBeNull();
    expect(screen.getByText(/入力した文は Claude に送らず/)).toBeTruthy();
    fireEvent.change(measuresBox(), { target: { value: MEASURES } });
    fireEvent.click(createButton());
    await screen.findByRole("region", { name: "説明文の下書き" });
    expect((screen.getByLabelText("農場の部分（直して使えます）") as HTMLTextAreaElement).value).toBe(neighborTemplate(MEASURES, "meeting"));
    expect(draftCall.fn).not.toHaveBeenCalled();
  });
});

describe("1 日の回数の上限（レビュー指摘 2）", () => {
  it("上限に当たった結果は『今日はこれ以上作れません』と雛形を出す", async () => {
    mount();
    await makeDraft(claudeResult({ source: "template", farmPart: neighborTemplate(MEASURES, "meeting"), failures: ["daily_limit"] }));
    expect(screen.getByText(/今日はこれ以上作れません/)).toBeTruthy();
    expect((screen.getByLabelText("農場の部分（直して使えます）") as HTMLTextAreaElement).value).toContain(MEASURES);
  });
  it("書く前から『1 日 10 回まで』と書いてある", () => {
    mount();
    expect(screen.getByText(/1 日 10 回まで/)).toBeTruthy();
  });
});

describe("explainFailures", () => {
  it("理由を、やさしい言葉にする。入力の文の問題は、語だけを示す", () => {
    expect(explainFailures(["budget_stop"])).toEqual(["今月の Claude の利用が上限に達しているため、Claude には頼みませんでした。"]);
    expect(explainFailures(["claude:refusal"])[0]).toContain("使える返事が来なかった");
    const out = explainFailures(["forbidden:安全", "input:forbidden:安心"]);
    expect(out.some((x) => x.includes("書かない言い方"))).toBe(true);
    expect(out.some((x) => x.includes("入力した文に"))).toBe(true);
    expect(out.at(-1)).toBe("気になる言い方: 「安心」");
  });
  it("1 日の上限と、回数を確かめられなかったときの理由", () => {
    expect(explainFailures(["daily_limit"])[0]).toContain("今日はこれ以上作れません");
    expect(explainFailures(["limit_unavailable"])[0]).toContain("回数を確かめられなかった");
  });
  it("言い切りの検査に落ちたときも、返事の断片を出さない", () => {
    const out = explainFailures(["assurance:問題ないという言い切り", "outside_topic:卵"]).join("");
    expect(out).toContain("書かない言い方");
    expect(out).not.toContain("卵");
  });
  it("Claude の返事の断片（数字など）は出さない", () => {
    expect(explainFailures(["unknown_number:43", "unknown_kanji_number:三キロ"]).join("")).not.toMatch(/43|三キロ/u);
  });
});
