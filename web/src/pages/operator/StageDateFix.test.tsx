// 運営者の「事例の段階の日付を直す」（Q-n）。確認の段が出て、「直す」を押すまで何も変わらない。
import type { CorrectStageRequest } from "@hpai/shared/read/review";
import type { Case } from "@hpai/shared/types";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const fnCalls = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn((_f: unknown, name: string) => (data: unknown) => fnCalls.fn(name, data)),
}));
vi.mock("../../firebase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../firebase")>();
  return { ...actual, getFirebase: async () => ({ auth: {}, db: { __db: true }, functions: {}, app: {} }) };
});

import OperatorPage from "./OperatorPage";
import { correctCall } from "./operatorCalls";
import { StageDateFix } from "./StageDateFix";
import { correctableCases, type CorrectableCasesState } from "./useCorrectableCases";
import type { ReviewQueueState } from "./useReviewQueue";

const NOW = new Date("2025-12-22T03:30:00Z"); // JST 2025-12-22
const now = () => NOW;

const mkCase = (o: Partial<Case> = {}): Case => ({
  id: "33203-2025-12-18-1",
  season: 2025,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: null,
  housing: null,
  headCount: null,
  stages: {
    suspected: { date: "2025-12-18", time: null },
    confirmed: { date: "2025-12-19", time: null },
    control_done: { date: "2025-12-21", time: null },
  },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2025-12-21T12:00:00+09:00",
  ...o,
});
const ready = (...cases: Case[]): CorrectableCasesState => ({ status: "ready", cases });

afterEach(() => cleanup());

function setup(state: CorrectableCasesState = ready(mkCase()), correct = vi.fn(async (req: CorrectStageRequest) => ({ ok: true as const, caseId: req.caseId, recordId: "corr-x" }))) {
  const view = render(<StageDateFix cases={state} correct={correct} now={now} />);
  return { correct, ...view };
}

/** 事例、段階、新しい日付を入れて「確かめる」を押す */
function fillAndCheck(stage: string, newDate: string) {
  fireEvent.change(screen.getByLabelText("事例"), { target: { value: "33203-2025-12-18-1" } });
  fireEvent.change(screen.getByLabelText("直す段階"), { target: { value: stage } });
  fireEvent.change(screen.getByLabelText("新しい日付"), { target: { value: newDate } });
  fireEvent.click(screen.getByRole("button", { name: "確かめる" }));
}

describe("確認の段", () => {
  it("「確かめる」で確認の段が出る: 元の日付、新しい日付、理由の欄。まだ送らない", () => {
    const { correct } = setup();
    fillAndCheck("confirmed", "2025-12-20");
    expect(screen.getByText("元の日付: 2025-12-19")).toBeTruthy();
    expect(screen.getByText("新しい日付: 2025-12-20")).toBeTruthy();
    expect(screen.getByLabelText("理由（必須）")).toBeTruthy();
    expect(screen.getByRole("button", { name: "直す" })).toBeTruthy();
    expect(correct).not.toHaveBeenCalled();
  });
  it("理由が空のうちは「直す」を押せない。入れると押せて、押すまで送らない", async () => {
    const { correct } = setup();
    fillAndCheck("confirmed", "2025-12-20");
    const go = screen.getByRole("button", { name: "直す" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    fireEvent.change(screen.getByLabelText("理由（必須）"), { target: { value: "   " } });
    expect(go.disabled).toBe(true); // 空白だけも不可
    expect(correct).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("理由（必須）"), { target: { value: " 県の発表を見直した " } });
    expect(go.disabled).toBe(false);
    expect(correct).not.toHaveBeenCalled(); // 押すまで変わらない
    fireEvent.click(go);
    await waitFor(() => expect(correct).toHaveBeenCalledTimes(1));
    expect(correct).toHaveBeenCalledWith({ caseId: "33203-2025-12-18-1", stage: "confirmed", expectedDate: "2025-12-19", newDate: "2025-12-20", reason: "県の発表を見直した" });
    expect((await screen.findByRole("status")).textContent).toContain("直しました");
  });
  it("「やめる」で入力に戻り、何も送らない", () => {
    const { correct } = setup();
    fillAndCheck("confirmed", "2025-12-20");
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.getByRole("button", { name: "確かめる" })).toBeTruthy();
    expect(screen.queryByLabelText("理由（必須）")).toBeNull();
    expect(correct).not.toHaveBeenCalled();
  });
  it("「直す」を続けて押しても 1 度しか送らない", async () => {
    let release: () => void = () => {};
    const correct = vi.fn(
      (req: CorrectStageRequest) => new Promise<{ ok: true; caseId: string; recordId: string }>((resolve) => (release = () => resolve({ ok: true, caseId: req.caseId, recordId: "r" }))),
    );
    setup(ready(mkCase()), correct);
    fillAndCheck("confirmed", "2025-12-20");
    fireEvent.change(screen.getByLabelText("理由（必須）"), { target: { value: "見直した" } });
    const go = screen.getByRole("button", { name: "直す" });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(correct).toHaveBeenCalledTimes(1);
    release();
    await screen.findByRole("status");
  });
  it("サーバーが拒んだら理由を出し、確認の段のままもう一度押せる", async () => {
    const correct = vi
      .fn()
      .mockRejectedValueOnce({ code: "functions/failed-precondition", message: "事例の日付が変わっています（いまは 2025-12-20）。開き直して、もう一度確かめてください" })
      .mockResolvedValueOnce({ ok: true, caseId: "c", recordId: "r" });
    setup(ready(mkCase()), correct);
    fillAndCheck("confirmed", "2025-12-20");
    fireEvent.change(screen.getByLabelText("理由（必須）"), { target: { value: "見直した" } });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    expect((await screen.findByRole("alert")).textContent).toContain("事例の日付が変わっています");
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    await screen.findByRole("status");
    expect(correct).toHaveBeenCalledTimes(2);
  });
});

describe("確認の段に進めない日付", () => {
  it.each([
    ["未来の日付", "confirmed", "2025-12-23", "未来"],
    ["段階の順序が崩れる日付（疑いより前の確定）", "confirmed", "2025-12-17", "疑い"],
    ["防疫措置の完了より後の確定", "confirmed", "2025-12-22", "防疫措置の完了"],
    ["シーズンの外", "confirmed", "2024-12-20", "シーズン"],
    ["元と同じ日付", "confirmed", "2025-12-19", "同じ"],
  ])("%s は理由を示して止め、送らない", (_n, stage, date, word) => {
    const { correct } = setup();
    fillAndCheck(stage, date);
    expect(screen.getByRole("alert").textContent).toContain(word);
    expect(screen.queryByLabelText("理由（必須）")).toBeNull();
    expect(correct).not.toHaveBeenCalled();
  });
});

describe("一覧と言葉", () => {
  it("確認中と再現の事例、段階のない事例は選べない", () => {
    const list = correctableCases([
      mkCase({ id: "a" }),
      mkCase({ id: "b", confirmState: "reviewing", stages: {} }),
      mkCase({ id: "c", confirmState: "replay" }),
      mkCase({ id: "d", confirmState: "operator" }),
      mkCase({ id: "e", stages: {} }),
    ]);
    expect(list.map((c) => c.id).sort()).toEqual(["a", "d"]);
  });
  it("段階の選択肢は、その事例にある段階だけ。いまの日付を添える", () => {
    setup();
    fireEvent.change(screen.getByLabelText("事例"), { target: { value: "33203-2025-12-18-1" } });
    const options = within(screen.getByLabelText("直す段階")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["選んでください", "疑い（いまは 2025-12-18）", "確定（いまは 2025-12-19）", "防疫措置の完了（いまは 2025-12-21）"]);
  });
  it("押せるボタンは常に 2 つまで", () => {
    const { container } = setup();
    expect(within(container).getAllByRole("button").length).toBeLessThanOrEqual(2);
    fillAndCheck("confirmed", "2025-12-20");
    expect(within(container).getAllByRole("button").length).toBeLessThanOrEqual(2);
  });
  it("禁止の語がない（入力、確認の段、完了、拒否の各場面）", async () => {
    const { container } = setup();
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
    fillAndCheck("confirmed", "2025-12-17");
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "確かめる" }));
    fireEvent.change(screen.getByLabelText("新しい日付"), { target: { value: "2025-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "確かめる" }));
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
    fireEvent.change(screen.getByLabelText("理由（必須）"), { target: { value: "見直した" } });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    await screen.findByRole("status");
    expect(findForbiddenPhrases(container.textContent ?? "")).toEqual([]);
  });
  it("事例がない、読み込み中、読めなかったときの言葉", () => {
    const a = setup({ status: "ready", cases: [] });
    expect(screen.getByText("今季の事例はまだありません。")).toBeTruthy();
    a.unmount();
    const b = setup({ status: "loading" });
    expect(screen.getByText("事例を読み込んでいます")).toBeTruthy();
    b.unmount();
    setup({ status: "error" });
    expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした");
  });
});

describe("運営者の画面への組み込み", () => {
  const queue: ReviewQueueState = { status: "ready", items: [], asOf: "2025-12-22T12:30:00+09:00" };
  it("運営者の画面に出る。運営者でない人（claim なし）には出さない", () => {
    const view = render(
      <MemoryRouter>
        <OperatorPage queue={queue} cases={ready(mkCase())} now={now} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "事例の段階の日付を直す" })).toBeTruthy();
    view.unmount();
    render(
      <MemoryRouter>
        <OperatorPage queue={{ status: "no-claim" }} cases={ready(mkCase())} now={now} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("事例の段階の日付を直す")).toBeNull();
  });
  it("correctCaseStage を名前で呼ぶ", async () => {
    fnCalls.fn.mockResolvedValueOnce({ data: { ok: true, caseId: "c", recordId: "r" } });
    const req: CorrectStageRequest = { caseId: "c", stage: "confirmed", expectedDate: "2025-12-19", newDate: "2025-12-20", reason: "見直した" };
    await correctCall(req);
    expect(fnCalls.fn).toHaveBeenLastCalledWith("correctCaseStage", req);
  });
});
