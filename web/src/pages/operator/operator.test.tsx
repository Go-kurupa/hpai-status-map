import type { MuniEntry } from "@hpai/shared/geo";
import type { ResolveRequest, ReviewDetail } from "@hpai/shared/read/review";
import type { ReviewItem } from "@hpai/shared/read/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Firebase の偽物（画面の試験は props で渡すので、これを使うのは useReviewQueue の試験だけ） ──
interface FakeUser {
  uid: string;
  getIdTokenResult: ReturnType<typeof vi.fn>;
}
let claims: Record<string, unknown> = {};
let currentUser: FakeUser | null = null;
const idListeners = new Set<(u: FakeUser | null) => void>();
const fakeAuth = {
  get currentUser() {
    return currentUser;
  },
  authStateReady: async () => {},
  onIdTokenChanged(cb: (u: FakeUser | null) => void) {
    idListeners.add(cb);
    queueMicrotask(() => cb(currentUser));
    return () => idListeners.delete(cb);
  },
};
const mkUser = (): FakeUser => ({ uid: "op1", getIdTokenResult: vi.fn(async () => ({ claims })) });

const fs = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ __where: [field, op, value] })),
  orderBy: vi.fn((field: string, dir: string) => ({ __orderBy: [field, dir] })),
  query: vi.fn((...parts: unknown[]) => ({ __query: parts })),
  onSnapshot: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  collection: fs.collection,
  where: fs.where,
  orderBy: fs.orderBy,
  query: fs.query,
  onSnapshot: fs.onSnapshot,
}));
const fbAuth = vi.hoisted(() => ({ signInWithCustomToken: vi.fn() }));
vi.mock("firebase/auth", () => ({ signInWithCustomToken: fbAuth.signInWithCustomToken }));
const fnCalls = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn((_f: unknown, name: string) => (data: unknown) => fnCalls.fn(name, data)),
}));
vi.mock("../../firebase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../firebase")>();
  return { ...actual, getFirebase: async () => ({ auth: fakeAuth, db: { __db: true }, functions: {}, app: {} }) };
});

import OperatorPage from "./OperatorPage";
import { devTokenOf, useReviewQueue, type ReviewQueueState } from "./useReviewQueue";

// ── 置くもの ──
const ASOF = "2025-12-22T12:30:00+09:00";
const NOW = new Date("2025-12-22T03:30:00Z");
const base = { createdAt: "2025-12-22T10:00:00+09:00", resolvedAt: null } as const;

const docItem = (o: Partial<Extract<ReviewItem, { kind: "document" }>> = {}): ReviewItem => ({
  ...base,
  id: "doc-d1",
  kind: "document",
  documentId: "d1",
  url: "https://example.test/d1.pdf",
  prefCode: "33",
  title: "高病原性鳥インフルエンザの発生について",
  reasons: ["municipality:muni_exists", "compare:primaryDate"],
  hasOutbreakWords: true,
  ...o,
});
const proposal = (o: Partial<Extract<ReviewItem, { kind: "entrance_proposal" }>> = {}): ReviewItem => ({
  ...base,
  id: "entr-1",
  kind: "entrance_proposal",
  prefCode: "33",
  oldUrl: "https://www.pref.okayama.jp/old/index.html",
  proposedUrl: "https://www.pref.okayama.jp/new/index.html",
  sourceKind: "pref_fixed",
  rationale: "年度が変わり、新しい入口に移っていました",
  ...o,
});
type AlertName = Extract<ReviewItem, { kind: "alert" }>["alert"];
const alertItem = (alert: AlertName, o: Partial<Extract<ReviewItem, { kind: "alert" }>> = {}): ReviewItem => ({
  ...base,
  id: `alert-${alert}-k`,
  kind: "alert",
  alert,
  prefCode: "33",
  caseId: null,
  message: "この文は画面に出さない",
  ...o,
});

const detail = (o: Partial<ReviewDetail> = {}): ReviewDetail => ({
  kind: "suspected",
  prefecture: "岡山県",
  municipality: "津山市",
  primaryStage: "suspected",
  primaryDate: { year: null, month: 12, day: 20, time: "09:30" },
  nationalNo: null,
  birdUse: "採卵鶏",
  housing: null,
  headCount: 12000,
  radiiKm: [3, 10],
  issues: [{ field: "municipality", check: "muni_exists", mandatory: true }],
  mismatches: ["primaryDate"],
  error: null,
  ...o,
});

const muni = (code: string, name: string): MuniEntry => ({ code, name, prefCode: code.slice(0, 2), center: [0, 0], bbox: [0, 0, 0, 0] });
const MUNIS: Record<string, MuniEntry> = {
  "33100": muni("33100", "岡山市"),
  "33202": muni("33202", "倉敷市"),
  "33203": muni("33203", "津山市"),
  "28201": muni("28201", "姫路市"),
};

const ready = (...items: ReviewItem[]): ReviewQueueState => ({ status: "ready", items, asOf: ASOF });

function setup(queue: ReviewQueueState, over: Partial<Parameters<typeof OperatorPage>[0]> = {}) {
  const resolve = vi.fn(async (_r: ResolveRequest) => ({ ok: true as const, caseId: null as string | null }));
  const getDetail = vi.fn(async (_id: string) => detail());
  const runAgent = vi.fn(async () => {});
  const loadMunis = vi.fn(async () => MUNIS);
  const utils = render(
    <MemoryRouter>
      <OperatorPage queue={queue} resolve={resolve} getDetail={getDetail} runAgent={runAgent} loadMunis={loadMunis} now={() => NOW} {...over} />
    </MemoryRouter>,
  );
  return { resolve, getDetail, runAgent, loadMunis, ...utils };
}

afterEach(cleanup);
beforeEach(() => {
  claims = {};
  currentUser = null;
  idListeners.clear();
  vi.clearAllMocks();
});

// ── 入口 ──
describe("入口の状態", () => {
  it("claim がなければ一覧を出さず「運営者だけが使えます」", () => {
    setup({ status: "no-claim" });
    expect(screen.getByText(/運営者だけが使えます/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText(/いま確認する項目/)).toBeNull();
  });
  it("ログインしていなければ同じ文とログインへのリンク", () => {
    setup({ status: "signed-out" });
    expect(screen.getByText(/運営者だけが使えます/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /ログイン/ }).getAttribute("href")).toMatch(/^\/login/);
  });
  it("読み込み中と読めなかったことは、空の一覧に見せない", () => {
    const { unmount } = setup({ status: "loading" });
    expect(screen.getByRole("status").textContent).toMatch(/確かめています/);
    expect(screen.queryByText(/いま確認する項目はありません/)).toBeNull();
    unmount();
    setup({ status: "error" });
    expect(screen.getByRole("alert").textContent).toMatch(/読み込めませんでした/);
    expect(screen.queryByText(/いま確認する項目はありません/)).toBeNull();
  });
  it("項目がなければ「いま確認する項目はありません」。いつ時点かを出す", () => {
    setup(ready());
    expect(screen.getByText(/いま確認する項目はありません/)).toBeTruthy();
    expect(screen.getByText("12 月 22 日 12:30 時点")).toBeTruthy();
  });
});

// ── 文書の項目 ──
describe("文書の項目", () => {
  /** 畳んだ記入欄を「直して載せる」で開き、「載せる」を返す（読み取りの結果の読み込みを待つ） */
  const openForm = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "直して載せる" }));
    return screen.findByRole("button", { name: "載せる" });
  };
  it("県、題、原文へのリンク、理由、公開中かを出す", async () => {
    setup(ready(docItem()));
    const card = screen.getByRole("article");
    expect(within(card).getByText(/岡山県/)).toBeTruthy();
    expect(within(card).getByText("高病原性鳥インフルエンザの発生について")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /原文/ }).getAttribute("href")).toBe("https://example.test/d1.pdf");
    expect(within(card).getByText(/市町村/, { selector: "li" })).toBeTruthy(); // 理由の文
    expect(within(card).getByText(/公開しています/)).toBeTruthy();
    await openForm();
  });
  it("発生の語がなければ「公開していません」", async () => {
    setup(ready(docItem({ hasOutbreakWords: false })));
    expect(screen.getByText(/公開していません/)).toBeTruthy();
    await openForm();
  });
  it("自動で外した項目は、外した訳と、二人の読み手の種類を日本語で出す。直して載せる操作は残す", async () => {
    setup(ready(docItem({ hasOutbreakWords: false, reasons: ["compare:kind", "not_poultry_here", "both_read:wild_bird+notice", "outbreak_words_present"] })));
    const card = screen.getByRole("article");
    expect(within(card).getByText(/公開していません（この県の家きんの発生ではないと二人の読み手が読んだので、地図に「確認中」を出していません）/)).toBeTruthy();
    expect(within(card).getByText("この県の家きんの発生・疑いではないと、二人の読み手が読みました", { selector: "li" })).toBeTruthy();
    expect(within(card).getByText("主の読み手が「野鳥」、別の読み手が「周知」と読みました", { selector: "li" })).toBeTruthy();
    await openForm();
  });
  it("二人が同じ種類と読んだ理由は、種類を日本語で出す", async () => {
    setup(ready(docItem({ hasOutbreakWords: false, reasons: ["not_poultry_here", "both_read:other_pref"] })));
    expect(screen.getByText("二人の読み手が「他県の発生」と読みました", { selector: "li" })).toBeTruthy();
    await openForm();
  });
  it("記入欄は最初は畳み、上に「無関係とする」と「直して載せる」を並べる。理由、原文のリンク、公開しているかの文は見せる", async () => {
    setup(ready(docItem()));
    const card = screen.getByRole("article");
    await waitFor(() => expect(within(card).queryByText("読み取りの結果を読み込んでいます")).toBeNull());
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["無関係とする", "直して載せる▼"]);
    const toggle = within(card).getByRole("button", { name: "直して載せる" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(card).queryByRole("combobox", { name: "県" })).toBeNull();
    expect(within(card).queryByRole("textbox", { name: "羽数" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "載せる" })).toBeNull();
    expect(within(card).getByRole("link", { name: /原文/ })).toBeTruthy();
    expect(within(card).getByText(/公開しています/)).toBeTruthy();
    expect(within(card).getByText("確認に回った理由")).toBeTruthy();
  });
  it("「直して載せる」で欄が開き、その下に「載せる」。もう一度押すと畳み、入れた値は残る", async () => {
    setup(ready(docItem()));
    const toggle = await screen.findByRole("button", { name: "直して載せる" });
    await openForm();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(within(region).getByRole("combobox", { name: "県" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "載せる" })).toBeTruthy();
    expect(toggle.compareDocumentPosition(within(region).getByRole("button", { name: "載せる" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "羽数" }), { target: { value: "500" } });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "載せる" })).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByRole("textbox", { name: "羽数" }) as HTMLInputElement).value).toBe("500");
  });
  it("ボタンは button 要素で、キーボードで押せる（type=button。form を誤って送らない）", async () => {
    setup(ready(docItem()));
    for (const name of ["無関係とする", "直して載せる"]) {
      const b = await screen.findByRole("button", { name });
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
    }
  });
  it("欄を畳んだまま「無関係とする」が失敗しても、理由が見え、もう一度押せる", async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error("通信に失敗しました")).mockResolvedValue({ ok: true, caseId: null });
    setup(ready(docItem()), { resolve });
    fireEvent.click(await screen.findByRole("button", { name: "無関係とする" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/処理できませんでした/);
    fireEvent.click(screen.getByRole("button", { name: "無関係とする" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });
  it("読み取りの結果を入力欄の初期値にし、「載せる」で publish_corrected を送る", async () => {
    const { resolve, getDetail } = setup(ready(docItem()));
    const submit = await openForm();
    expect(getDetail).toHaveBeenCalledWith("doc-d1");
    expect((screen.getByLabelText("県") as HTMLSelectElement).value).toBe("33");
    expect((screen.getByLabelText("市町村") as HTMLSelectElement).value).toBe("33203");
    expect((screen.getByLabelText("段階") as HTMLSelectElement).value).toBe("suspected");
    expect((screen.getByLabelText("日付") as HTMLInputElement).value).toBe("2025-12-20");
    expect((screen.getByLabelText("時刻") as HTMLInputElement).value).toBe("09:30");
    expect((screen.getByLabelText("羽数") as HTMLInputElement).value).toBe("12000");
    expect((screen.getByLabelText(/半径/) as HTMLInputElement).value).toBe("3, 10");
    fireEvent.click(submit);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith({
      itemId: "doc-d1",
      action: "publish_corrected",
      values: {
        prefCode: "33",
        muniCode: "33203",
        stage: "suspected",
        date: "2025-12-20",
        time: "09:30",
        nationalNo: null,
        prefNo: null,
        birdUse: "採卵鶏",
        housing: null,
        headCount: 12000,
        radiiKm: [3, 10],
      },
    });
    await screen.findByText(/処理しました/);
  });
  it("直した値で送る。市町村は選んだ県の中から選ぶ", async () => {
    const { resolve } = setup(ready(docItem()));
    await openForm();
    const muniSelect = screen.getByLabelText("市町村") as HTMLSelectElement;
    const codes = () => [...muniSelect.options].map((o) => o.value).filter((v) => v !== "");
    expect(codes().sort()).toEqual(["33100", "33202", "33203"]); // 姫路市は岡山県の中にない
    fireEvent.change(screen.getByLabelText("県"), { target: { value: "28" } });
    expect(codes()).toEqual(["28201"]);
    expect(muniSelect.value).toBe(""); // 別の県に替えたら選び直す
    expect((screen.getByRole("button", { name: "載せる" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("県"), { target: { value: "33" } });
    fireEvent.change(muniSelect, { target: { value: "33202" } });
    fireEvent.change(screen.getByLabelText("段階"), { target: { value: "confirmed" } });
    fireEvent.change(screen.getByLabelText("羽数"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("国内の番号"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "載せる" }));
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(resolve.mock.calls[0]![0]).toMatchObject({ action: "publish_corrected", values: { muniCode: "33202", stage: "confirmed", headCount: null, nationalNo: 7 } });
  });
  it("日付の入力欄は今日（JST）までしか選べず、未来の日付は送らない", async () => {
    const { resolve } = setup(ready(docItem()));
    await openForm();
    const date = screen.getByLabelText("日付") as HTMLInputElement;
    expect(date.max).toBe("2025-12-22");
    fireEvent.change(date, { target: { value: "2052-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "載せる" }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/未来/);
  });
  it("数字でない羽数は送らず、直すよう示す", async () => {
    const { resolve } = setup(ready(docItem()));
    await openForm();
    fireEvent.change(screen.getByLabelText("羽数"), { target: { value: "たくさん" } });
    fireEvent.click(screen.getByRole("button", { name: "載せる" }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/羽数/);
  });
  it("「無関係とする」で mark_irrelevant を送る", async () => {
    const { resolve } = setup(ready(docItem()));
    fireEvent.click(await screen.findByRole("button", { name: "無関係とする" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ itemId: "doc-d1", action: "mark_irrelevant" }));
  });
  it("読み取りの結果を読めなくても、空の入力欄で載せられる", async () => {
    const { resolve } = setup(ready(docItem()), { getDetail: vi.fn(async () => Promise.reject(new Error("x"))) });
    await screen.findByText(/読み取りの結果を読めませんでした/);
    await openForm();
    expect((screen.getByLabelText("県") as HTMLSelectElement).value).toBe("33"); // 項目の県は使う
    fireEvent.change(screen.getByLabelText("市町村"), { target: { value: "33203" } });
    fireEvent.change(screen.getByLabelText("段階"), { target: { value: "suspected" } });
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2025-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "載せる" }));
    await waitFor(() => expect(resolve).toHaveBeenCalled());
  });
  it("操作が失敗したら理由を出し、もう一度押せる", async () => {
    const err = Object.assign(new Error("同じ事例か判断できません。候補の事例を確かめてください"), { code: "functions/failed-precondition", details: { candidateIds: ["33203-2025-12-18-1", "33203-2025-12-22-1"] } });
    const resolve = vi.fn().mockRejectedValueOnce(err).mockResolvedValue({ ok: true, caseId: "c" });
    setup(ready(docItem()), { resolve });
    fireEvent.click(await openForm());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/同じ事例か判断できません/);
    expect(alert.textContent).toMatch(/33203-2025-12-18-1/);
    fireEvent.click(screen.getByRole("button", { name: "載せる" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });
  it("外から来た題と URL は文字として出す（HTML にしない）。http か https でない URL はリンクにしない", async () => {
    const { container } = setup(
      ready(docItem({ title: '<img src=x onerror="alert(1)">本物の題', url: "javascript:alert(1)", reasons: ["<script>x</script>"] })),
    );
    await openForm();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=/)).toBeTruthy();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /原文/ })).toBeNull();
  });
});

// ── 否定、入口、知らせ ──
describe("否定の候補", () => {
  it("確定の前に訂正のメールが届くと示し、確定と退けるの 2 つだけ", () => {
    setup(ready(alertItem("negation_candidate", { caseId: "33203-2025-12-20-1" })));
    const card = screen.getByRole("article");
    expect(within(card).getByText("否定の発表があるようです")).toBeTruthy();
    expect(within(card).getByText(/訂正のメール/)).toBeTruthy();
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["否定を確定する", "退ける"]);
  });
  it("「否定を確定する」は 1 度では送らず、確認の文を出し、もう一度押して初めて confirm_negation を送る", async () => {
    const { resolve } = setup(ready(alertItem("negation_candidate", { caseId: "33203-2025-12-20-1" })));
    const card = screen.getByRole("article");
    fireEvent.click(within(card).getByRole("button", { name: "否定を確定する" }));
    expect(resolve).not.toHaveBeenCalled();
    expect(within(card).getByText(/取り消せません/)).toBeTruthy();
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["はい、否定を確定する", "やめる"]);
    fireEvent.click(within(card).getByRole("button", { name: "やめる" }));
    expect(resolve).not.toHaveBeenCalled();
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["否定を確定する", "退ける"]);
    fireEvent.click(within(card).getByRole("button", { name: "否定を確定する" }));
    fireEvent.click(within(card).getByRole("button", { name: "はい、否定を確定する" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve).toHaveBeenCalledWith({ itemId: "alert-negation_candidate-k", action: "confirm_negation" });
  });
  it("「退ける」で reject_negation", () => {
    const { resolve } = setup(ready(alertItem("negation_candidate")));
    fireEvent.click(screen.getByRole("button", { name: "退ける" }));
    expect(resolve).toHaveBeenCalledWith({ itemId: "alert-negation_candidate-k", action: "reject_negation" });
  });
});

describe("入口の提案", () => {
  it("古い URL、新しい URL、根拠を出し、承認で approve_entrance、退けるで reject_entrance", async () => {
    const { resolve } = setup(ready(proposal()));
    const card = screen.getByRole("article");
    expect(within(card).getByText("https://www.pref.okayama.jp/old/index.html")).toBeTruthy();
    expect(within(card).getByText("https://www.pref.okayama.jp/new/index.html")).toBeTruthy();
    expect(within(card).getByText("年度が変わり、新しい入口に移っていました")).toBeTruthy();
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["承認", "退ける"]);
    fireEvent.click(within(card).getByRole("button", { name: "承認" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ itemId: "entr-1", action: "approve_entrance" }));
    expect(resolve).toHaveBeenCalledTimes(1);
    // 解決の後は、一覧から消えるまで押せない（同じ項目を 2 度送らない）
    expect((within(card).getByRole("button", { name: "退ける" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("退けるで reject_entrance", async () => {
    const { resolve } = setup(ready(proposal()));
    fireEvent.click(screen.getByRole("button", { name: "退ける" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith({ itemId: "entr-1", action: "reject_entrance" }));
  });
  it("古い URL がなければ「なし」", () => {
    setup(ready(proposal({ oldUrl: null })));
    expect(screen.getByText("なし")).toBeTruthy();
  });
});

describe("知らせ", () => {
  const FIXED: Array<[AlertName, string]> = [
    ["case_stalled", "疑いの続報がありません"],
    ["negation_candidate", "否定の発表があるようです"],
    ["national_missing", "国の一覧にあり、作品になかった事例を載せました"],
    ["app_only_confirmed", "確定が 48 時間たっても国の一覧にありません"],
    ["watch_failing", "24 時間以上読めていません"],
    ["agent_run_failed", "入口を直すエージェントの実行に失敗しました"],
    ["mail_failing", "メールを送れていません。アプリパスワードと 1 日の上限を確かめてください"],
  ];
  it.each(FIXED)("%s は決まった言葉で出し、項目の message は出さない", (alert, text) => {
    setup(ready(alertItem(alert)));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/この文は画面に出さない/)).toBeNull();
  });
  it.each(FIXED.filter(([a]) => a !== "negation_candidate" && a !== "agent_run_failed"))("%s は「確認した」で dismiss_alert", (alert) => {
    const { resolve } = setup(ready(alertItem(alert)));
    fireEvent.click(screen.getByRole("button", { name: "確認した" }));
    expect(resolve).toHaveBeenCalledWith({ itemId: `alert-${alert}-k`, action: "dismiss_alert" });
  });
  it("mail_failing は、メールでは知らせていない項目だと分かる", () => {
    setup(ready(alertItem("mail_failing", { prefCode: null })));
    expect(screen.getByText(/メールでは届きません/)).toBeTruthy();
  });
  it("agent_run_failed に「入口を直すエージェントを実行する」があり、押すと runEntranceAgent を 1 回だけ呼ぶ", async () => {
    let finish: () => void = () => {};
    const runAgent = vi.fn(() => new Promise<void>((r) => (finish = r)));
    setup(ready(alertItem("agent_run_failed")), { runAgent });
    const card = screen.getByRole("article");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["入口を直すエージェントを実行する", "確認した"]);
    const run = within(card).getByRole("button", { name: "入口を直すエージェントを実行する" }) as HTMLButtonElement;
    fireEvent.click(run);
    fireEvent.click(run); // 実行中の 2 度押しは呼ばない
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(run.disabled).toBe(true);
    await act(async () => finish());
    await screen.findByText(/実行を依頼しました/);
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
  it("実行に失敗したら「実行できませんでした」と出し、もう一度押せる", async () => {
    const runAgent = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    setup(ready(alertItem("agent_run_failed")), { runAgent });
    fireEvent.click(screen.getByRole("button", { name: "入口を直すエージェントを実行する" }));
    await screen.findByText(/実行できませんでした/);
    fireEvent.click(screen.getByRole("button", { name: "入口を直すエージェントを実行する" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
  });
});

describe("全体", () => {
  const all = [
    docItem(),
    docItem({ id: "doc-d2", documentId: "d2", hasOutbreakWords: false }),
    proposal(),
    ...(["case_stalled", "negation_candidate", "national_missing", "app_only_confirmed", "watch_failing", "agent_run_failed", "mail_failing"] as AlertName[]).map((a) => alertItem(a)),
  ];
  it("1 項目の操作は 2 つまで", async () => {
    setup(ready(...all));
    await waitFor(() => expect(screen.queryByText("読み取りの結果を読み込んでいます")).toBeNull()); // 記入欄は畳んでいるので、読み込みの終わりを待つ
    for (const card of screen.getAllByRole("article")) expect(within(card).getAllByRole("button").length).toBeLessThanOrEqual(2);
  });
  it("禁止の語がない", async () => {
    const { container } = setup(ready(...all));
    await waitFor(() => expect(screen.queryByText("読み取りの結果を読み込んでいます")).toBeNull()); // 記入欄は畳んでいるので、読み込みの終わりを待つ
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });
  it("運営者の画面は farms を読まない（箱の購読だけ）", async () => {
    claims = { operator: true };
    currentUser = mkUser();
    fs.onSnapshot.mockImplementation(() => () => {});
    renderHook(() => useReviewQueue());
    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    expect(fs.collection.mock.calls.map((c) => c[1])).toEqual(["reviewQueue"]);
  });
});

// ── useReviewQueue ──
describe("useReviewQueue", () => {
  it("devToken は模擬環境のときだけ使う", () => {
    const E2E = { DEV: false, MODE: "e2e" };
    const PROD = { DEV: false, MODE: "production" };
    expect(devTokenOf("?emulator=1&devToken=abc", E2E)).toBe("abc");
    expect(devTokenOf("?devToken=abc", { DEV: true, MODE: "development" })).toBe("abc"); // dev server は常に模擬環境
    expect(devTokenOf("?devToken=abc", E2E)).toBeNull(); // ?emulator=1 がなければ使わない
    expect(devTokenOf("?emulator=1&devToken=abc", PROD)).toBeNull(); // 本番の build では ?emulator=1 が付いても使わない
    expect(devTokenOf("?emulator=1", E2E)).toBeNull();
    expect(devTokenOf("?emulator=1&devToken=", E2E)).toBeNull();
  });

  it("ログインしていなければ signed-out", async () => {
    const { result } = renderHook(() => useReviewQueue());
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });
  it("operator の claim がなければ no-claim で、箱を購読しない（member でも）", async () => {
    claims = { member: true };
    currentUser = mkUser();
    const { result } = renderHook(() => useReviewQueue());
    await waitFor(() => expect(result.current.status).toBe("no-claim"));
    expect(fs.onSnapshot).not.toHaveBeenCalled();
    expect(currentUser.getIdTokenResult).toHaveBeenCalledWith(true); // claim の付与の後に取り込む
  });
  it("operator なら未解決を新しい順に購読し、届いた項目を ready で返す", async () => {
    claims = { operator: true };
    currentUser = mkUser();
    let push: (snap: { docs: Array<{ data: () => ReviewItem }> }) => void = () => {};
    fs.onSnapshot.mockImplementation((_q: unknown, ok: typeof push) => {
      push = ok;
      return () => {};
    });
    const { result } = renderHook(() => useReviewQueue());
    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    expect(fs.where).toHaveBeenCalledWith("resolvedAt", "==", null);
    expect(fs.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(result.current.status).toBe("loading");
    act(() => push({ docs: [{ data: () => docItem() }] }));
    expect(result.current).toMatchObject({ status: "ready", items: [{ id: "doc-d1" }] });
    expect((result.current as { asOf: string | null }).asOf).toMatch(/\+09:00$/);
  });
  it("購読が失敗したら error（空の一覧にしない）", async () => {
    claims = { operator: true };
    currentUser = mkUser();
    fs.onSnapshot.mockImplementation((_q: unknown, _ok: unknown, bad: (e: Error) => void) => {
      queueMicrotask(() => bad(new Error("permission-denied")));
      return () => {};
    });
    const { result } = renderHook(() => useReviewQueue());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
  it("模擬環境で devToken があれば signInWithCustomToken で入る", async () => {
    claims = { operator: true };
    fbAuth.signInWithCustomToken.mockImplementation(async () => {
      currentUser = mkUser();
    });
    fs.onSnapshot.mockImplementation(() => () => {});
    window.history.pushState({}, "", "/operator?emulator=1&devToken=dev-abc");
    renderHook(() => useReviewQueue());
    await waitFor(() => expect(fbAuth.signInWithCustomToken).toHaveBeenCalledWith(fakeAuth, "dev-abc"));
    await waitFor(() => expect(fs.onSnapshot).toHaveBeenCalled());
    window.history.pushState({}, "", "/");
  });
});

// 呼び出しの名前
describe("callable の呼び方", () => {
  it("resolveReviewItem、getReviewDetail、runEntranceAgent を名前で呼ぶ", async () => {
    const calls = await import("./operatorCalls");
    fnCalls.fn.mockResolvedValue({ data: { ok: true, caseId: null } });
    await calls.resolveCall({ itemId: "x", action: "dismiss_alert" });
    expect(fnCalls.fn).toHaveBeenLastCalledWith("resolveReviewItem", { itemId: "x", action: "dismiss_alert" });
    fnCalls.fn.mockResolvedValue({ data: { kind: null } });
    await calls.getDetailCall("x");
    expect(fnCalls.fn).toHaveBeenLastCalledWith("getReviewDetail", { itemId: "x" });
    fnCalls.fn.mockResolvedValue({ data: {} });
    await calls.runAgentCall();
    expect(fnCalls.fn).toHaveBeenLastCalledWith("runEntranceAgent", {});
  });
});
