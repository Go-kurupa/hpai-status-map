// M-04: 記録の 4 画面（死亡数、自己点検、出力と削除）と上の 2 行。RecordStore だけを使う。
import type { CheckRecord, DeathRecord, Farm, House, Season, SelfCheckItemNo } from "@hpai/shared/types";
import { addDays } from "@hpai/shared/dates";
import { MORTALITY_TEXT } from "@hpai/shared/mortality";
import { SELF_CHECK_SOURCE_NOTE } from "@hpai/shared/reports";
import { findForbiddenPhrases } from "@hpai/shared/wording";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceProvider, RecordStoreProvider } from "../../data/context";
import type { DataSource, RecordStore } from "../../data/types";
import { PRIVACY_NOTICE } from "../privacy/privacyNotice";
import { DeathsPanel } from "./DeathsPanel";
import { ExportPanel } from "./ExportPanel";
import { RecordTabs } from "./RecordTabs";
import { SelfCheckPanel } from "./SelfCheckPanel";
import { TODO_TEXT } from "../todo/texts";
import { RECORD_TEXT } from "./recordTexts";

const authState = vi.hoisted(() => ({
  value: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} },
}));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => authState.value }));

const deleteCall = vi.hoisted(() => vi.fn<(farmId: string, confirmName: string) => Promise<void>>());
vi.mock("../auth/callables", () => ({ deleteFarmDataCall: deleteCall }));

const NOW = new Date("2026-11-06T10:00:00+09:00");
const TODAY = "2026-11-06";

const ds: DataSource = {
  mode: "live",
  now: () => NOW,
  subscribeCases: (_s: Season, cb) => {
    cb([]);
    return () => {};
  },
  subscribeWildBirds: (_s, cb) => {
    cb([]);
    return () => {};
  },
  subscribeWatchStatus: (cb) => {
    cb([]);
    return () => {};
  },
  loadHistory: async () => [],
};

function farmFixture(o: Partial<Farm> = {}): Farm & { id: string } {
  return {
    id: "f1",
    name: "見本農場",
    memberUids: ["u1"],
    unsubscribedUids: [],
    meshCode: "53394611",
    muniCode: "33203",
    prefCode: "33",
    frequentMuniCodes: [],
    production: null,
    housing: null,
    kahoContact: "ある家保 00-0000-0000",
    notify: { level1: true, level2: true, level3: true, morningDigest: true, selfCheckRemindDays: null },
    selfCheckDue: {},
    updatedAt: "2026-11-01T10:00:00+09:00",
    ...o,
  };
}
const h1: House & { id: string } = { id: "h1", name: "1 号舎", birdType: "採卵鶏", flockSize: 100, empty: false };

let farm: (Farm & { id: string }) | null;
let houses: Array<House & { id: string }>;
let deaths: DeathRecord[];
let checks: Array<CheckRecord & { id: string }>;
let mailStopped: boolean;
let failListDeaths: boolean;
let store: RecordStore;
const saveDeath = vi.fn<(r: DeathRecord) => Promise<void>>();
const saveCheck = vi.fn<(c: CheckRecord) => Promise<void>>();
const listDeaths = vi.fn<(from: string, to: string) => Promise<DeathRecord[]>>();

beforeEach(() => {
  farm = farmFixture();
  houses = [h1];
  deaths = [];
  checks = [];
  mailStopped = false;
  failListDeaths = false;
  saveDeath.mockReset();
  saveDeath.mockImplementation(async (r) => {
    deaths = [...deaths.filter((d) => !(d.date === r.date && d.houseId === r.houseId)), r];
  });
  saveCheck.mockReset();
  saveCheck.mockResolvedValue(undefined);
  listDeaths.mockReset();
  listDeaths.mockImplementation(async (from, to) => {
    if (failListDeaths) throw new Error("読めません");
    return deaths.filter((d) => d.date >= from && d.date <= to);
  });
  deleteCall.mockReset();
  deleteCall.mockResolvedValue(undefined);
  store = {
    mode: "firestore",
    getFarm: vi.fn(async () => farm),
    listHouses: vi.fn(async () => houses),
    listDeaths,
    saveDeath,
    listChecks: vi.fn(async () => checks),
    saveCheck,
    isMailStopped: vi.fn(async () => mailStopped),
  } as unknown as RecordStore;
});
afterEach(cleanup);

function mount(ui: React.ReactNode, o: { path?: string; store?: RecordStore } = {}) {
  return render(
    <MemoryRouter initialEntries={[o.path ?? "/record"]}>
      <DataSourceProvider value={ds}>
        <RecordStoreProvider value={o.store ?? store}>{ui}</RecordStoreProvider>
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

const rec = (date: string, deathsN: number, over: Partial<DeathRecord> = {}): DeathRecord => ({
  date,
  houseId: "h1",
  deaths: deathsN,
  flockSizeAt: 1000,
  exclusion: null,
  ...over,
});
/** today の前日から連続 n 日、1 日 1 羽（羽数 1000） */
const history = (n: number, per = 1): DeathRecord[] => Array.from({ length: n }, (_, k) => rec(addDays(TODAY, -(k + 1)), per));

const clean = (c: HTMLElement) => c.textContent ?? "";
const setValue = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function ready() {
  await screen.findByLabelText("死亡数");
}
async function recordDeaths(n: string) {
  await ready();
  setValue("死亡数", n);
  fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
}

describe("RecordTabs（上の 2 行とリンク）", () => {
  it("href は /record/…、最後の記録は死亡数と点検の最新の日付", async () => {
    deaths = [rec("2026-11-03", 0)];
    checks = [{ id: "c", kind: "disinfection", date: "2026-11-05", itemId: "always-17" }];
    mount(<RecordTabs />);
    const nav = screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/record/deaths", "/record/self-check", "/record/disinfection", "/record"]);
    expect(await screen.findByText(/最後の記録: 2026年11月5日/)).toBeTruthy();
  });

  it("記録がなければ『最後の記録: なし』", async () => {
    mount(<RecordTabs />);
    expect(await screen.findByText("最後の記録: なし")).toBeTruthy();
  });

  it("/sample/record の下では href が /sample/record/…。/record で始まる href がない", async () => {
    const sample = { ...store, mode: "sample" } as RecordStore;
    const { container } = mount(<RecordTabs />, { path: "/sample/record/deaths", store: sample });
    await screen.findByText(/最後の記録/);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toEqual(["/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection", "/sample/record"]);
    expect(hrefs.some((h) => h.startsWith("/record"))).toBe(false);
  });

  it("配信を止めているときは常に『メールは止まっています。基準に当たっても届きません』", async () => {
    mailStopped = true;
    mount(<RecordTabs />);
    expect(await screen.findByText(RECORD_TEXT.mailStopped)).toBeTruthy();
  });

  it("止めていなければその行を出さない", async () => {
    mount(<RecordTabs />);
    await screen.findByText(/最後の記録/);
    expect(screen.queryByText(RECORD_TEXT.mailStopped)).toBeNull();
  });
});

describe("DeathsPanel 入力", () => {
  it("saveDeath には {date, houseId, deaths, flockSizeAt, exclusion} だけを渡す", async () => {
    mount(<DeathsPanel />);
    await recordDeaths("3");
    await waitFor(() => expect(saveDeath).toHaveBeenCalledTimes(1));
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({ date: TODAY, houseId: "h1", deaths: 3, flockSizeAt: 100, exclusion: null });
  });

  it("入力の誤りを 3 つに分けて文で知らせ、保存しない（空欄、数字以外、羽数超え）", async () => {
    mount(<DeathsPanel />);
    await ready();
    const cases: Array<[string, string]> = [
      ["", RECORD_TEXT.deathsEmpty],
      ["abc", RECORD_TEXT.deathsNotNumber],
      ["-1", RECORD_TEXT.deathsNotNumber],
      ["1.5", RECORD_TEXT.deathsNotNumber],
      ["101", RECORD_TEXT.deathsOverFlock(100)],
    ];
    for (const [bad, text] of cases) {
      cleanup();
      mount(<DeathsPanel />);
      await ready();
      setValue("死亡数", bad);
      fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
      expect((await screen.findByRole("alert")).textContent).toBe(text);
    }
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("誤りの文の中身（0 と入れる案内、羽数の n）", () => {
    expect(RECORD_TEXT.deathsEmpty).toBe("死亡数を入れてください。死亡がない日は 0 と入れます");
    expect(RECORD_TEXT.deathsNotNumber).toBe("死亡数は 0 以上の整数で入れてください");
    expect(RECORD_TEXT.deathsOverFlock(100)).toBe("死亡数が飼養羽数（100 羽）を超えています");
    expect(RECORD_TEXT.deathsExisting(3)).toBe("この日は 3 羽で記録済みです。入れ直すと置き換わります");
  });

  it("保存したら数と理由が空になり、結果は残る", async () => {
    mount(<DeathsPanel />);
    await ready();
    setValue("除外の理由", "equipment");
    setValue("死亡数", "4");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect((screen.getByLabelText("死亡数") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("除外の理由") as HTMLSelectElement).value).toBe("");
  });

  it("鶏舎を切り替えると数と理由が空になる", async () => {
    houses = [h1, { ...h1, id: "h2", name: "2 号舎" }];
    mount(<DeathsPanel />);
    await ready();
    setValue("除外の理由", "disaster");
    setValue("死亡数", "5");
    setValue("鶏舎", "h2");
    expect((screen.getByLabelText("死亡数") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("除外の理由") as HTMLSelectElement).value).toBe("");
  });

  it("日付を切り替えると理由が空になる", async () => {
    mount(<DeathsPanel />);
    await ready();
    setValue("除外の理由", "disaster");
    setValue("日付", addDays(TODAY, -1));
    expect((screen.getByLabelText("除外の理由") as HTMLSelectElement).value).toBe("");
  });

  it("その日と鶏舎に記録があれば『記録済み』を入力の上に出し、なければ出さない", async () => {
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    const note = screen.getByText(RECORD_TEXT.deathsExisting(3));
    expect(note.getAttribute("role")).toBe("status");
    const input = screen.getByLabelText("死亡数");
    expect(note.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    setValue("日付", addDays(TODAY, -1));
    expect(screen.queryByText(RECORD_TEXT.deathsExisting(3))).toBeNull();
  });

  it("保存したら結果の枠へ動かして focus を移し、先頭に『記録しました』を出す", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount(<DeathsPanel />);
    await recordDeaths("3");
    const saved = await screen.findByText(RECORD_TEXT.saved);
    expect(saved.getAttribute("role")).toBe("status");
    const frame = saved.closest(".death-result-focus") as HTMLElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("tabindex")).toBe("-1");
    expect(frame.firstElementChild).toBe(saved);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "start" }));
    expect(document.activeElement).toBe(frame);
  });

  it("全角の数字も受ける", async () => {
    mount(<DeathsPanel />);
    await recordDeaths("２");
    await waitFor(() => expect(saveDeath).toHaveBeenCalled());
    expect(saveDeath.mock.calls[0]?.[0].deaths).toBe(2);
  });

  it("日付が今日から 120 日より前、または未来なら保存しない", async () => {
    mount(<DeathsPanel />);
    await ready();
    setValue("日付", addDays(TODAY, -121));
    setValue("死亡数", "1");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    expect(await screen.findByText(RECORD_TEXT.dateRange)).toBeTruthy();
    setValue("日付", addDays(TODAY, 1));
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("除外の理由を選ぶと exclusion に入る（設備の故障、急な気温変化、災害、その他）", async () => {
    mount(<DeathsPanel />);
    await ready();
    const reasons = Array.from((screen.getByLabelText("除外の理由") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(reasons).toEqual(["なし", "設備の故障", "急な気温変化", "災害", "その他"]);
    setValue("除外の理由", "equipment");
    setValue("死亡数", "4");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    await waitFor(() => expect(saveDeath).toHaveBeenCalled());
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({
      date: TODAY,
      houseId: "h1",
      deaths: 4,
      flockSizeAt: 100,
      exclusion: { kind: "equipment", note: "" },
    });
  });

  it("空舎は empty で、死亡数は 0", async () => {
    houses = [{ ...h1, empty: true }];
    mount(<DeathsPanel />);
    await screen.findByText(RECORD_TEXT.houseEmpty);
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    await waitFor(() => expect(saveDeath).toHaveBeenCalled());
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({ date: TODAY, houseId: "h1", deaths: 0, flockSizeAt: 100, exclusion: { kind: "empty", note: "" } });
  });

  it("羽数が 0 で空舎でない鶏舎は、空舎と混ぜず保存できない", async () => {
    houses = [{ ...h1, flockSize: 0 }];
    mount(<DeathsPanel />);
    await screen.findByText(RECORD_TEXT.flockZero);
    expect((screen.getByRole("button", { name: RECORD_TEXT.save }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("鶏舎がなければ『鶏舎がまだありません。』と、農場の設定の鶏舎の欄（#houses）へのリンク。保存を出さない", async () => {
    houses = [];
    mount(<DeathsPanel />);
    await screen.findByText(/^鶏舎がまだありません。/);
    expect(screen.queryByText(/。。/)).toBeNull();
    expect(screen.getByRole("link", { name: "鶏舎を足す" }).getAttribute("href")).toBe("/settings/farm#houses");
    expect(screen.queryByRole("button", { name: RECORD_TEXT.save })).toBeNull();
  });

  it("見本の農場（sample）で鶏舎がなければ、今までの文とリンクのまま", async () => {
    houses = [];
    const sample = { ...store, mode: "sample" } as RecordStore;
    mount(<DeathsPanel />, { path: "/sample/record/deaths", store: sample });
    await screen.findByText(new RegExp(RECORD_TEXT.noHouses));
    expect(screen.getByRole("link", { name: RECORD_TEXT.setFarmLink }).getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("link", { name: "鶏舎を足す" })).toBeNull();
  });

  it("農場がなければ /settings/farm へ案内し、保存を出さない", async () => {
    farm = null;
    mount(<DeathsPanel />);
    const link = await screen.findByRole("link", { name: "農場を設定する" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("button", { name: RECORD_TEXT.save })).toBeNull();
  });

  it("保存に失敗したら知らせ、計算の結果を出さない", async () => {
    saveDeath.mockRejectedValueOnce(new Error("権限がありません"));
    mount(<DeathsPanel />);
    await recordDeaths("1");
    expect(await screen.findByText(RECORD_TEXT.saveFailed)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.resultHeading)).toBeNull();
  });
});

describe("DeathsPanel 計算の表示", () => {
  beforeEach(() => {
    houses = [{ ...h1, flockSize: 1000 }]; // 記録の羽数（1000）とそろえる
  });

  it("21 日未満は『まだ計算できません』と使える日数。それでも症状の文は出る", async () => {
    deaths = history(5);
    mount(<DeathsPanel />);
    await recordDeaths("1");
    expect(await screen.findByText(MORTALITY_TEXT.insufficient)).toBeTruthy();
    expect(screen.getByText(/使える日は 6 日です/)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
  });

  it("当たれば hit の文と、登録した家保の連絡先。入力を直すと表示が消える", async () => {
    deaths = history(21); // 1 日 1 羽 / 1000 羽
    mount(<DeathsPanel />);
    await recordDeaths("10"); // 当日 10 羽 → 平均の 2 倍以上
    expect(await screen.findByText(RECORD_TEXT.hitHeading)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.hit)).toBeTruthy();
    expect(screen.getByText(/ある家保 00-0000-0000/)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.askKaho)).toBeTruthy();
    // 入力を直すと消える
    setValue("死亡数", "1");
    expect(screen.queryByText(RECORD_TEXT.hitHeading)).toBeNull();
    expect(screen.queryByText(RECORD_TEXT.resultHeading)).toBeNull();
  });

  it("『入力を直すと画面の表示は消えます。送ったメールは取り消せません』は保存の前から出ている", async () => {
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(RECORD_TEXT.hitAfterEdit)).toBeTruthy();
  });

  it("連絡先が空でも hit を残し、『家保の連絡先が未登録です』と /settings/farm への案内を出す", async () => {
    farm = farmFixture({ kahoContact: "" });
    deaths = history(21);
    mount(<DeathsPanel />);
    await recordDeaths("10");
    expect(await screen.findByText(RECORD_TEXT.hitHeading)).toBeTruthy();
    expect(screen.getByText(new RegExp(RECORD_TEXT.contactMissing))).toBeTruthy();
    expect(screen.getByRole("link", { name: RECORD_TEXT.contactLink }).getAttribute("href")).toBe("/settings/farm");
  });

  it("当たらない日も symptoms、exceptions、reading を出し、『問題ありません』『安全』を書かない", async () => {
    deaths = history(21);
    mount(<DeathsPanel />);
    await recordDeaths("1");
    expect(await screen.findByText(RECORD_TEXT.notHit)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.exceptions)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.reading)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.hitHeading)).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("問題ありません");
    expect(findForbiddenPhrases(text)).toEqual([]);
  });

  it("当日が除外の日なら計算せず、理由と症状の文を出す", async () => {
    deaths = history(21);
    mount(<DeathsPanel />);
    await ready();
    setValue("除外の理由", "disaster");
    setValue("死亡数", "10");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    expect(await screen.findByText(RECORD_TEXT.todayExcluded("災害"))).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.hitHeading)).toBeNull();
  });

  it("記録のない日を飛ばしたら日数を出し、窓が 30 日より長く広がれば『N 日前まで遡って計算しました』", async () => {
    // 前日から 1 日おきに 21 日分（42 日前まで）。当日を入れて 22 件目
    deaths = Array.from({ length: 21 }, (_, k) => rec(addDays(TODAY, -(2 * k + 2)), 1));
    mount(<DeathsPanel />);
    await recordDeaths("1");
    // 窓: 当日 + 20 日分（40 日前まで）。当日と 1 日おきの偶数日 → 窓の範囲 41 日、記録のない日 20 日
    expect(await screen.findByText(RECORD_TEXT.missingDays(20))).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.lookedBack(40))).toBeTruthy();
  });

  it("遡りが 30 日以内なら『遡って』を出さない。除外の日の数は出す", async () => {
    deaths = [...history(21).filter((d) => d.date !== addDays(TODAY, -3)), rec(addDays(TODAY, -3), 0, { exclusion: { kind: "equipment", note: "" } })];
    mount(<DeathsPanel />);
    await recordDeaths("1");
    await screen.findByText(RECORD_TEXT.notHit);
    expect(screen.queryByText(/日前まで遡って計算しました/)).toBeNull();
    expect(screen.getByText(RECORD_TEXT.excludedDays(1))).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.missingDays(0))).toBeTruthy();
  });

  it("ほかの日に誤った値（羽数を超える死亡）があれば invalid_input の日付を出す", async () => {
    deaths = [...history(21), rec("2026-11-02", 5000)];
    mount(<DeathsPanel />);
    await recordDeaths("1");
    expect(await screen.findByText(MORTALITY_TEXT.invalidInput)).toBeTruthy();
    expect(screen.getByText(/確かめる日: 11月2日/)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.notHit)).toBeNull();
  });

  it("保存後に記録を読み直せなければ、保存はできたと伝え、計算は出さない", async () => {
    mount(<DeathsPanel />);
    await ready();
    failListDeaths = true;
    setValue("死亡数", "1");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.save }));
    expect(await screen.findByText(RECORD_TEXT.readFailed)).toBeTruthy();
    expect(saveDeath).toHaveBeenCalledTimes(1);
  });

  it("入れる案内: 死亡がない日も 0 と入れる", async () => {
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(/死亡がない日も 0 と入れてください/)).toBeTruthy();
  });
});

describe("DeathsPanel 週の報告文", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  });

  it("様式の項目に合わせた下書きを出し、コピーでき、保存を呼ばない", async () => {
    deaths = [rec(addDays(TODAY, -1), 2)];
    mount(<DeathsPanel />);
    await ready();
    await screen.findByText(RECORD_TEXT.weeklyHeading);
    expect(screen.getByText(/様式の項目に合わせた下書きです/)).toBeTruthy();
    const report = (await screen.findByLabelText("週の報告文の下書き")) as HTMLTextAreaElement;
    expect(report.value).toContain("農場名: 見本農場");
    expect(report.value).toContain("鳥の種類: 採卵鶏");
    expect(report.value).toContain("飼養羽数: 100");
    expect(report.value).toContain("廃鶏出荷羽数: 未記入");
    setValue(RECORD_TEXT.weeklyCulled, "5");
    expect((screen.getByLabelText("週の報告文の下書き") as HTMLTextAreaElement).value).toContain("廃鶏出荷羽数: 5");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("廃鶏出荷羽数: 5");
    expect(await screen.findByText(RECORD_TEXT.copied)).toBeTruthy();
    expect(saveDeath).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /送信|送る|メール/ })).toBeNull();
  });
});

async function selfReady() {
  const btn = await screen.findByRole("button", { name: RECORD_TEXT.selfSave });
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
}

describe("SelfCheckPanel", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  });

  it("○ と × の意味を、項目より先に出す", async () => {
    mount(<SelfCheckPanel />);
    const legend = await screen.findByText(/^○ できている\s+× できていない$/);
    const firstItem = (await screen.findAllByRole("group"))[0]!;
    expect(legend.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("読み込み中はラジオも保存も disabled で、読み終えると押せる", async () => {
    let release: (v: Array<CheckRecord & { id: string }>) => void = () => {};
    store = { ...store, listChecks: vi.fn(() => new Promise((r) => { release = r as typeof release; })) } as unknown as RecordStore;
    mount(<SelfCheckPanel />);
    const btn = (await screen.findByRole("button", { name: RECORD_TEXT.selfSave })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.length).toBe(21);
    expect(radios.every((r) => r.disabled)).toBe(true);
    // 読み込みは effect で始まる。ボタンは最初の描画で出るので、始まるのを待ってから読み終えさせる（早いと release がまだ空の関数）
    await waitFor(() => expect(store.listChecks).toHaveBeenCalled());
    expect(btn.disabled).toBe(true);
    release([]);
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(radios.every((r) => !r.disabled)).toBe(true);
  });

  it("読み込みに失敗したら保存は disabled のまま。saveCheck は呼ばれない", async () => {
    store = { ...store, listChecks: vi.fn(async () => { throw new Error("読めません"); }) } as unknown as RecordStore;
    mount(<SelfCheckPanel />);
    expect((await screen.findByRole("alert")).textContent).toBe(RECORD_TEXT.readFailed);
    const btn = screen.getByRole("button", { name: RECORD_TEXT.selfSave }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(saveCheck).not.toHaveBeenCalled();
  });

  it("ラベルの文字を押すとその答えが選ばれる", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    const g = screen.getByRole("group", { name: /^17 / });
    fireEvent.click(within(g).getByText("×"));
    expect((within(g).getByLabelText("×") as HTMLInputElement).checked).toBe(true);
  });

  it("ラジオは 48px の押す部分（record.css）", () => {
    const css = readFileSync("web/src/pages/record/record.css", "utf-8");
    const m = css.match(/\.self-choice input\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/width:\s*48px/);
    expect(body).toMatch(/height:\s*48px/);
    expect(css).toMatch(/\.death-result-focus:focus\s*\{\s*outline:\s*none/);
  });

  it("農場がなければ保存を出さず /settings/farm へ案内する", async () => {
    farm = null;
    mount(<SelfCheckPanel />);
    const link = await screen.findByRole("link", { name: "農場を設定する" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("button", { name: RECORD_TEXT.selfSave })).toBeNull();
  });

  it("7 項目を番号つきの ○× で保存し、コピーできる。送信のボタンはない", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    for (const no of ["17", "18", "19", "22", "23", "25", "27"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${no} `) })).toBeTruthy();
    }
    for (const no of ["17", "18", "22", "23", "25"]) {
      fireEvent.click(within(screen.getByRole("group", { name: new RegExp(`^${no} `) })).getByLabelText("○"));
    }
    fireEvent.click(within(screen.getByRole("group", { name: /^19 / })).getByLabelText("×"));
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.selfSave }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    const answers: Record<SelfCheckItemNo, "ok" | "ng" | null> = {
      "17": "ok",
      "18": "ok",
      "19": "ng",
      "22": "ok",
      "23": "ok",
      "25": "ok",
      "27": null,
    };
    expect(saveCheck.mock.calls[0]?.[0]).toEqual({ kind: "self_inspection", date: TODAY, month: "2026-11", answers });

    const report = screen.getByLabelText(RECORD_TEXT.selfReportLabel) as HTMLTextAreaElement;
    expect(report.value.split("\n").slice(0, 3)).toEqual(["自己点検の報告", "農場名: 見本農場", "対象の月: 2026年11月"]);
    expect(report.value).toContain("19 衛生管理区域に立ち入る車両の消毒等: ×");
    expect(report.value).toContain("27 ねずみ及び害虫の駆除: 未記入");
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(report.value));
    expect(screen.queryByRole("button", { name: /送信|送る/ })).toBeNull();
    expect(screen.getByText(SELF_CHECK_SOURCE_NOTE)).toBeTruthy();
  });

  it("期限が未設定なら『期限を設定してください』、設定済みなら日付を出す", async () => {
    const { unmount } = mount(<SelfCheckPanel />);
    expect(await screen.findByText(new RegExp(RECORD_TEXT.selfDueMissing))).toBeTruthy();
    expect(screen.getByRole("link", { name: RECORD_TEXT.selfDueLink }).getAttribute("href")).toBe("/settings/notify");
    unmount();
    farm = farmFixture({ selfCheckDue: { "2026-11": "2026-12-05" } });
    mount(<SelfCheckPanel />);
    expect(await screen.findByText(/期限: 12月5日/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(RECORD_TEXT.selfDueMissing))).toBeNull();
  });

  it("今月の保存済みの答えを読み戻す", async () => {
    checks = [
      {
        id: "self_2026-11",
        kind: "self_inspection",
        date: "2026-11-02",
        month: "2026-11",
        answers: { "17": "ok", "18": null, "19": "ng", "22": null, "23": null, "25": null, "27": null },
      },
    ];
    mount(<SelfCheckPanel />);
    await waitFor(() => {
      const g = screen.getByRole("group", { name: /^19 / });
      expect((within(g).getByLabelText("×") as HTMLInputElement).checked).toBe(true);
    });
  });
});

describe("ExportPanel", () => {
  it("印刷と CSV のボタンがある", async () => {
    mount(<ExportPanel />);
    expect(await screen.findByRole("button", { name: RECORD_TEXT.print })).toBeTruthy();
    expect(screen.getByRole("button", { name: RECORD_TEXT.csvDeaths })).toBeTruthy();
    expect(screen.getByRole("button", { name: RECORD_TEXT.csvChecks })).toBeTruthy();
  });

  it("CSV は BOM つきの文字列を Blob にして渡す", async () => {
    deaths = [rec("2026-11-05", 1)];
    const created: Blob[] = [];
    const urlApi = URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
    urlApi.createObjectURL = (b: Blob) => {
      created.push(b);
      return "blob:x";
    };
    urlApi.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount(<ExportPanel />);
    const csvButton = (await screen.findByRole("button", { name: RECORD_TEXT.csvDeaths })) as HTMLButtonElement;
    await waitFor(() => expect(csvButton.disabled).toBe(false)); // 記録を読み終えるまで押せない
    fireEvent.click(csvButton);
    await waitFor(() => expect(created.length).toBe(1));
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsText(created[0] as Blob);
    });
    expect(text).toContain("日付,鶏舎,鳥の種類,飼養羽数,死亡羽数,除外の理由,メモ");
    expect(text).toContain("2026-11-05,1 号舎,採卵鶏,1000,1,,");
    click.mockRestore();
  });

  it("削除は農場の名前を入れるまで押せない。消すものと消えないものを出す", async () => {
    mount(<ExportPanel />);
    const button = (await screen.findByRole("button", { name: RECORD_TEXT.deleteButton })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(RECORD_TEXT.deleteGone)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.deleteKept)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.deleteAnyMember)).toBeTruthy();
    setValue(RECORD_TEXT.deleteInput, "見本");
    expect(button.disabled).toBe(true);
    setValue(RECORD_TEXT.deleteInput, "見本農場");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith("f1", "見本農場"));
    expect(await screen.findByText(RECORD_TEXT.deleted)).toBeTruthy();
  });

  it("削除に失敗したら知らせ、削除済みの表示にしない", async () => {
    deleteCall.mockRejectedValueOnce(new Error("failed"));
    mount(<ExportPanel />);
    fireEvent.change(await screen.findByLabelText(RECORD_TEXT.deleteInput), { target: { value: "見本農場" } });
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.deleteButton }));
    expect(await screen.findByText(RECORD_TEXT.deleteFailed)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.deleted)).toBeNull();
  });

  it("農場の名前が未設定なら削除できない", async () => {
    farm = farmFixture({ name: "" });
    mount(<ExportPanel />);
    expect(await screen.findByText(RECORD_TEXT.deleteNameMissing)).toBeTruthy();
    expect((screen.getByRole("button", { name: RECORD_TEXT.deleteButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("見本の農場には削除を出さない", async () => {
    const sample = { ...store, mode: "sample" } as RecordStore;
    mount(<ExportPanel />, { store: sample });
    await screen.findByRole("button", { name: RECORD_TEXT.print });
    expect(screen.queryByRole("button", { name: RECORD_TEXT.deleteButton })).toBeNull();
    expect(screen.queryByText(RECORD_TEXT.deleteGone)).toBeNull();
  });

  it("削除の説明は、プライバシーの説明（X-19）と食い違わない", () => {
    const privacy = PRIVACY_NOTICE.flatMap((s) => s.paragraphs).join("\n");
    expect(privacy).toContain(RECORD_TEXT.deleteAnyMember.replace("農場全体を消せます。", "農場全体を消せます"));
    for (const word of ["農場の情報", "送った知らせの記録", "招待", "ログイン用のアカウント", "メールアドレス", "Gmail", "ブラウザの設定"]) {
      expect(privacy).toContain(word);
      expect(RECORD_TEXT.deleteGone + RECORD_TEXT.deleteKept).toContain(word);
    }
    expect(privacy).toContain("消えません");
    expect(RECORD_TEXT.deleteKept).toContain("消えない");
  });
});

describe("所属が複数のとき（M-01: 止まる）", () => {
  it("getFarm が失敗すれば、どの画面にも保存と削除を出さず、読めない案内を出す", async () => {
    const { MultipleFarmsError } = await import("../auth/firestoreRecordStore");
    store = { ...store, getFarm: vi.fn(async () => { throw new MultipleFarmsError(); }) } as unknown as RecordStore;
    for (const [ui, name] of [
      [<DeathsPanel key="d" />, RECORD_TEXT.save],
      [<SelfCheckPanel key="s" />, RECORD_TEXT.selfSave],
      [<ExportPanel key="e" />, RECORD_TEXT.deleteButton],
    ] as const) {
      const { unmount } = mount(ui);
      expect(await screen.findByText(TODO_TEXT.farmFailed)).toBeTruthy();
      expect(screen.queryByRole("button", { name })).toBeNull();
      unmount();
    }
    expect(saveDeath).not.toHaveBeenCalled();
    expect(saveCheck).not.toHaveBeenCalled();
    expect(deleteCall).not.toHaveBeenCalled();
  });
});

describe("全画面", () => {
  it("どの画面にも禁止語がない", async () => {
    deaths = history(21);
    const parts = [<DeathsPanel key="d" />, <SelfCheckPanel key="s" />, <ExportPanel key="e" />, <RecordTabs key="t" />];
    for (const ui of parts) {
      const { container, unmount } = mount(ui);
      await waitFor(() => expect(clean(container).length).toBeGreaterThan(20));
      await new Promise((r) => setTimeout(r, 20));
      expect(findForbiddenPhrases(clean(container))).toEqual([]);
      unmount();
    }
  });
});
