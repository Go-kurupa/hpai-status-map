// M-04: 記録の画面（死亡数、自己点検、消毒・対策）と上の題・タブ・2 行。RecordStore だけを使う。全データの削除は農場の設定へ移した（settings.test.tsx）。
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
import { DeathsPanel } from "./DeathsPanel";
import { DisinfectionPanel } from "./DisinfectionPanel";
import { RecordTabs } from "./RecordTabs";
import { SelfCheckPanel } from "./SelfCheckPanel";
import { DoneButton, useDisinfectionLog } from "./disinfectionLog";
import { SampleRecordStore } from "../sample/SampleRecordStore";
import type { SampleFarmData } from "@hpai/shared/replay";
import sampleJson from "../../../../data/replay/sample-farm.json";
import { TODO_TEXT } from "../todo/texts";
import { RECORD_TEXT } from "./recordTexts";

const authState = vi.hoisted(() => ({
  value: { user: { uid: "u1" }, member: true, loading: false, error: false, refresh: async () => {} },
}));
vi.mock("../auth/useAuthUser", () => ({ useAuthUser: () => authState.value }));

const deleteCall = vi.hoisted(() => vi.fn<(farmId: string, confirmName: string) => Promise<void>>());
vi.mock("../auth/callables", () => ({ deleteFarmDataCall: deleteCall }));
// 消毒の画面は地図の段階を読む。ここでは段階を読まない「ふだんの項目だけ」（段階 4）で試す（段階ごとの試験は todo.test.tsx）
vi.mock("../todo/useTodoData", () => ({
  useTodoData: () => ({ state: { status: "no_spot" }, spot: null, asOf: null, asOfLoading: false, prefUnconfirmed: false }),
  levelOf: () => 4,
}));

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
    if (failListDeaths) throw new Error("読み込めません");
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

const H1 = "1 号舎";
const countLabel = (house = H1) => RECORD_TEXT.deathsInputLabel(house);
const reasonLabel = (house = H1) => RECORD_TEXT.reasonInputLabel(house);
/** 行の「記録する」か「記録し直す」（名前に鶏舎の名前が入る） */
const saveButton = (house = H1) => screen.getByRole("button", { name: new RegExp(`^(${RECORD_TEXT.save}|${RECORD_TEXT.resave}): ${house}$`) });
const rowOf = (house: string) => screen.getAllByRole("listitem").find((li) => li.querySelector(".row-title")?.textContent === house)!;
const tile = (label: string) =>
  within(screen.getByRole("list", { name: RECORD_TEXT.statsLabel }))
    .getAllByRole("listitem")
    .find((li) => li.querySelector(".stat-label")?.textContent === label)!;

async function ready(house = H1) {
  await screen.findByLabelText(countLabel(house));
}
async function recordDeaths(n: string, house = H1) {
  await ready(house);
  setValue(countLabel(house), n);
  fireEvent.click(saveButton(house));
}

describe("RecordTabs（上の題とリンクと 2 行）", () => {
  it("題（h1）と 1 文、タブ 3 つ（/record/…）。最後に記録した日は死亡数と点検の最新の日付（11月5日の形）", async () => {
    deaths = [rec("2026-11-03", 0)];
    checks = [{ id: "c", kind: "disinfection", date: "2026-11-05", itemId: "always-17" }];
    mount(<RecordTabs />);
    expect(screen.getByRole("heading", { level: 1, name: RECORD_TEXT.pageTitle })).toBeTruthy();
    // 「この画面では、〜」の 1 文は各パネルが持つ。上の題の下には出さない（2 回出さない）
    expect(screen.queryByText(/^この画面では/)).toBeNull();
    const nav = screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/record/deaths", "/record/self-check", "/record/disinfection"]);
    expect(links.map((a) => a.textContent)).toEqual(["死亡数", "自己点検", "消毒・対策"]);
    expect(await screen.findByText("最後に記録した日: 11月5日")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/2026-11-05|2026年/);
  });

  it("並びは h1 → 1 文 → タブ → 最後に記録した日 → メールが止まっている行", async () => {
    mailStopped = true;
    mount(<RecordTabs />);
    const stopped = await screen.findByText(RECORD_TEXT.mailStopped);
    const order = [
      screen.getByRole("heading", { level: 1 }),
      screen.getByRole("navigation", { name: RECORD_TEXT.tabsLabel }),
      await screen.findByText(/^最後に記録した日/),
      stopped,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("上の題とパネルを並べても、『この画面では、〜』は 1 回だけ（パネルの 1 文）", async () => {
    mount(
      <>
        <RecordTabs />
        <DeathsPanel />
      </>,
    );
    await ready();
    expect((document.body.textContent ?? "").split("この画面では、").length - 1).toBe(1);
    expect(screen.getByText(RECORD_TEXT.deathsLead)).toBeTruthy();
  });

  it("文の形: 消毒の次にすることは『〜項目が n 項目あります。』、かぎかっこは「」にそろえる", () => {
    expect(RECORD_TEXT.disNext(3)).toBe("まだ押していない項目が 3 つあります。消毒したら「やった」を押します。");
    expect(RECORD_TEXT.flockZero).toContain("「空舎」");
    expect(Object.values(RECORD_TEXT).filter((v) => typeof v === "string" && /[『』]/.test(v))).toEqual([]);
  });

  it("記録がなければ『最後に記録した日: まだありません』", async () => {
    mount(<RecordTabs />);
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
  });

  it("/sample/record の下では href が /sample/record/…。/record で始まる href がない", async () => {
    const sample = { ...store, mode: "sample" } as RecordStore;
    const { container } = mount(<RecordTabs />, { path: "/sample/record/deaths", store: sample });
    await screen.findByText(/最後に記録した日/);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toEqual(["/sample/record/deaths", "/sample/record/self-check", "/sample/record/disinfection"]);
    expect(hrefs.some((h) => h.startsWith("/record"))).toBe(false);
  });

  it("配信を止めているときは常に『メールは止まっています。届け出の基準に達しても届きません』", async () => {
    mailStopped = true;
    mount(<RecordTabs />);
    expect(await screen.findByText(RECORD_TEXT.mailStopped)).toBeTruthy();
  });

  it("止めていなければその行を出さない", async () => {
    mount(<RecordTabs />);
    await screen.findByText(/最後に記録した日/);
    expect(screen.queryByText(RECORD_TEXT.mailStopped)).toBeNull();
  });
});

describe("RecordTabs 保存の後に『最後に記録した日』を読み直す", () => {
  /** 消毒の「やった」を 1 つだけ置く（DisinfectionPanel は地図の段階を読むので、記録の部品だけで試す） */
  function OneDisinfection() {
    const log = useDisinfectionLog(true);
    return <DoneButton itemId="always-17" label="消毒" log={log} />;
  }

  it("死亡数を記録すると、上の『最後に記録した日』がその日付に変わる", async () => {
    mount(
      <>
        <RecordTabs />
        <DeathsPanel />
      </>,
      { path: "/record/deaths" },
    );
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
    await recordDeaths("2");
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(await screen.findByText("最後に記録した日: 11月6日")).toBeTruthy();
  });

  it("前の日付の記録があっても、記録した日付に変わる", async () => {
    deaths = [rec("2026-11-03", 1, { houseId: "h1", flockSizeAt: 100 })];
    mount(
      <>
        <RecordTabs />
        <DeathsPanel />
      </>,
      { path: "/record/deaths" },
    );
    expect(await screen.findByText("最後に記録した日: 11月3日")).toBeTruthy();
    await recordDeaths("0");
    expect(await screen.findByText("最後に記録した日: 11月6日")).toBeTruthy();
  });

  it("自己点検を保存すると、上の『最後に記録した日』がその日付に変わる", async () => {
    saveCheck.mockImplementation(async (c) => {
      checks = [...checks, { ...c, id: c.kind === "disinfection" ? `dis_${c.date}_${c.itemId}` : `self_${c.month}` }];
    });
    mount(
      <>
        <RecordTabs />
        <SelfCheckPanel />
      </>,
      { path: "/record/self-check" },
    );
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
    await selfReady();
    fireEvent.click(within(screen.getByRole("group", { name: /^17 / })).getByRole("button", { name: RECORD_TEXT.selfOk }));
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.selfSave }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("最後に記録した日: 11月6日")).toBeTruthy();
  });

  it("消毒の「やった」を残すと、上の『最後に記録した日』がその日付に変わる", async () => {
    saveCheck.mockImplementation(async (c) => {
      checks = [...checks, { ...c, id: c.kind === "disinfection" ? `dis_${c.date}_${c.itemId}` : `self_${c.month}` }];
    });
    mount(
      <>
        <RecordTabs />
        <OneDisinfection />
      </>,
      { path: "/record/disinfection" },
    );
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: `${TODO_TEXT.done}: 消毒` }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("最後に記録した日: 11月6日")).toBeTruthy();
  });

  it("保存に失敗したら読み直さない（上の行は変わらない）", async () => {
    saveDeath.mockRejectedValue(new Error("書けません"));
    mount(
      <>
        <RecordTabs />
        <DeathsPanel />
      </>,
      { path: "/record/deaths" },
    );
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
    await recordDeaths("2");
    await screen.findByText(RECORD_TEXT.saveFailed);
    expect(screen.getByText("最後に記録した日: まだありません")).toBeTruthy();
  });

  it("見本の農場の口（SampleRecordStore）でも、死亡数を記録すると『最後に記録した日』が変わる", async () => {
    // 見本のデータは 2025 年 12 月まで。この試験の今日（2026-11-06）から 120 日より前なので、初めは「まだありません」
    const sample = new SampleRecordStore(sampleJson as unknown as SampleFarmData);
    mount(
      <>
        <RecordTabs />
        <DeathsPanel />
      </>,
      { path: "/sample/record/deaths", store: sample },
    );
    expect(await screen.findByText("最後に記録した日: まだありません")).toBeTruthy();
    await recordDeaths("2", "鶏舎A");
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(await screen.findByText("最後に記録した日: 11月6日")).toBeTruthy();
  });
});

describe("DeathsPanel 画面の型（題・札・次にすること・行・表）", () => {
  const h2: House & { id: string } = { id: "h2", name: "2 号舎", birdType: "採卵鶏", flockSize: 400, empty: false };
  const h3: House & { id: string } = { id: "h3", name: "3 号舎", birdType: "採卵鶏", flockSize: 300, empty: true };

  it("題は h2『死亡数の記録』、1 文目は『この画面では、』。鶏舎の select はなく、1 鶏舎 1 行", async () => {
    houses = [h1, h2, h3];
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByRole("heading", { level: 2, name: RECORD_TEXT.deathsTitle })).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.deathsLead)).toBeTruthy();
    expect(RECORD_TEXT.deathsLead).toBe("この画面では、鶏舎ごとに、その日の死亡数を記録します。死亡がない日は 0 と記録します。");
    expect(screen.queryByRole("combobox", { name: "鶏舎" })).toBeNull();
    const rows = within(screen.getByRole("list", { name: RECORD_TEXT.rowsLabel })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".row-title")?.textContent)).toEqual(["1 号舎", "2 号舎", "3 号舎"]);
    // 空舎の行は「－」の印で、数の欄がない
    expect(within(rowOf("3 号舎")).getByRole("img", { name: RECORD_TEXT.emptyMark }).textContent).toBe("－");
    expect(screen.queryByLabelText(countLabel("3 号舎"))).toBeNull();
    // 数の欄は inputMode numeric、行に押すものは 1 つ
    const input = screen.getByLabelText(countLabel()) as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(within(rowOf(H1).querySelector(".row-act") as HTMLElement).getAllByRole("button")).toHaveLength(1);
  });

  it("札 4 つ: 今日の入力（空舎を除く）、今日の死亡（未入力の鶏舎の数）、直近 7 日、届け出の基準", async () => {
    houses = [h1, h2, h3];
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 }), rec(addDays(TODAY, -2), 5, { flockSizeAt: 100 }), rec(addDays(TODAY, -8), 9, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statToday).textContent).toBe("今日の入力1 / 2鶏舎空舎を除く");
    expect(tile(RECORD_TEXT.statTodayDeaths).textContent).toBe("今日の死亡3羽1 鶏舎は未入力");
    expect(tile(RECORD_TEXT.statWeek).textContent).toContain("8羽");
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeMissing);
    expect(tile(RECORD_TEXT.statJudge).className).not.toContain("is-alert");
  });

  it("次にすること: 未入力の鶏舎の名前。そろえば『今日の分はそろっています。』", async () => {
    houses = [h1, h2, h3];
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(`${RECORD_TEXT.nextLabel}: 2 号舎がまだ未入力です。死亡数を入れて「記録する」を押します。`)).toBeTruthy();
    await recordDeaths("0", "2 号舎");
    expect(await screen.findByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextDone}`)).toBeTruthy();
    expect(tile(RECORD_TEXT.statToday).textContent).toContain("2 / 2");
  });

  it("届け出の基準の札: 達した鶏舎があれば赤い枠と名前、21 日そろわなければその旨、全部計算できて当たらなければ『達していません』", async () => {
    houses = [{ ...h1, flockSize: 1000 }];
    deaths = [...history(21), rec(TODAY, 10)];
    const first = mount(<DeathsPanel />);
    await ready();
    // 大きな値は「達している可能性」の語だけ、鶏舎の名前は note
    expect(tile(RECORD_TEXT.statJudge).querySelector(".stat-value")?.textContent).toBe(RECORD_TEXT.judgeHit);
    expect(tile(RECORD_TEXT.statJudge).querySelector(".stat-note")?.textContent).toBe("1 号舎");
    expect(tile(RECORD_TEXT.statJudge).className).toContain("is-alert");
    first.unmount();

    deaths = [...history(5), rec(TODAY, 1)];
    const second = mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeInsufficient);
    second.unmount();

    deaths = [...history(21), rec(TODAY, 1)];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeNotHit);
    expect(tile(RECORD_TEXT.statJudge).className).not.toContain("is-alert");
  });

  it("届け出の基準の札は、入力の誤り → 未入力 の順で理由を出す（『達していません』と言い過ぎない）", async () => {
    houses = [{ ...h1, flockSize: 1000 }, { ...h2, flockSize: 1000 }];
    // 1 号舎は誤った値、2 号舎は未入力
    deaths = [...history(21), rec("2026-11-02", 5000), rec(TODAY, 1)];
    const first = mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeInvalid);
    first.unmount();
    // 1 号舎は計算でき当たらない、2 号舎は未入力
    deaths = [...history(21), rec(TODAY, 1)];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeMissing);
    expect(tile(RECORD_TEXT.statJudge).textContent).not.toContain(RECORD_TEXT.judgeNotHit);
  });

  it("直近 14 日の表: 日付は 11月6日 の形、新しい順。未入力は —、空舎の日は 空舎、特段の事情の日は ※ と表の下の注記", async () => {
    houses = [h1, { ...h2, flockSize: 100 }];
    deaths = [
      rec(TODAY, 2, { flockSizeAt: 100 }),
      rec(TODAY, 1, { houseId: "h2", flockSizeAt: 100 }),
      rec(addDays(TODAY, -1), 4, { flockSizeAt: 100, exclusion: { kind: "equipment", note: "" } }),
      rec(addDays(TODAY, -1), 0, { houseId: "h2", flockSizeAt: 100, exclusion: { kind: "empty", note: "" } }),
      rec(addDays(TODAY, -40), 7, { flockSizeAt: 100 }),
    ];
    mount(<DeathsPanel />);
    await ready();
    const table = screen.getByRole("table", { name: RECORD_TEXT.trendHeading });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["日付", "1 号舎", "2 号舎", "合計"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(14);
    expect(rows[0]!.textContent).toBe("11月6日213");
    expect(rows[1]!.textContent).toBe("11月5日4※空舎4");
    expect(rows[2]!.textContent).toBe("11月4日———");
    expect(screen.getByText(RECORD_TEXT.trendExcludedNote)).toBeTruthy();
    expect(table.textContent).not.toMatch(/2026-/);
    // 120 日分は畳んだ中（記録のある日だけ）
    const all = screen.getByRole("table", { name: RECORD_TEXT.trendAll, hidden: true });
    expect(all.closest("details")).toBeTruthy();
    expect(within(all).getAllByRole("row", { hidden: true })).toHaveLength(4);
  });

  it("記録する日を変えると、各行をその日の記録で読み直す", async () => {
    deaths = [rec(addDays(TODAY, -1), 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(within(rowOf(H1)).getByRole("img", { name: "未入力" })).toBeTruthy();
    expect(saveButton().textContent).toBe(RECORD_TEXT.save);
    setValue(RECORD_TEXT.dateLabel, addDays(TODAY, -1));
    expect(within(rowOf(H1)).getByRole("img", { name: "記録済み" })).toBeTruthy();
    expect(within(rowOf(H1)).getByText(RECORD_TEXT.deathsRecorded(3))).toBeTruthy();
    expect(saveButton().textContent).toBe(RECORD_TEXT.resave);
  });

  it("特段の事情の選択は行の中で畳んである（既定は閉じる）。メールの注記は 1 回", async () => {
    mount(<DeathsPanel />);
    await ready();
    const select = screen.getByLabelText(reasonLabel());
    const details = select.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe(RECORD_TEXT.reasonOpen);
    expect(screen.getAllByText(RECORD_TEXT.deathsMailNote)).toHaveLength(1);
  });

  it("札の分母は羽数が 1 以上の飼育中の鶏舎。羽数 0 の鶏舎は未入力と数えず、今日の入力の札にその件数を 1 行で出す", async () => {
    houses = [h1, { ...h2, flockSize: 0 }, h3];
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statToday).textContent).toBe("今日の入力1 / 1鶏舎羽数 0 の鶏舎 1 件は数えていません");
    expect(tile(RECORD_TEXT.statTodayDeaths).textContent).toBe("今日の死亡3羽");
    expect(tile(RECORD_TEXT.statJudge).textContent).not.toContain(RECORD_TEXT.judgeMissing);
    expect(screen.getByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextFlockZero}`)).toBeTruthy();
    // 行では羽数 0 の鶏舎の入力を止めている（札と食い違わない）
    expect(within(rowOf("2 号舎")).getByText(RECORD_TEXT.flockZero)).toBeTruthy();
    expect((screen.getByLabelText(countLabel("2 号舎")) as HTMLInputElement).disabled).toBe(true);
  });

  it("直近 7 日の札: 範囲に記録がなければ『記録なし』（羽と言わない）。あれば n 羽と、記録のある日数", async () => {
    houses = [h1, { ...h2, flockSize: 100 }];
    deaths = [rec(addDays(TODAY, -7), 9, { flockSizeAt: 100 })];
    const first = mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statWeek).textContent).toBe(`直近 7 日の死亡記録なし${RECORD_TEXT.statWeekNote("10月31日")}`);
    expect(tile(RECORD_TEXT.statWeek).textContent).not.toContain("羽");
    first.unmount();

    deaths = [
      rec(TODAY, 1, { flockSizeAt: 100 }),
      rec(TODAY, 2, { houseId: "h2", flockSizeAt: 100 }),
      rec(addDays(TODAY, -3), 4, { flockSizeAt: 100 }),
    ];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statWeek).textContent).toBe("直近 7 日の死亡7羽10月31日から今日まで（記録のある 2 日分）");
  });

  it("届け出の基準が『達していません』でも、特段の事情の日の鶏舎がまざれば、その鶏舎の名前を出し『今日の記録で計算しました』と言わない", async () => {
    const big = (h: House & { id: string }) => ({ ...h, flockSize: 1000, empty: false });
    houses = [big(h1), big(h2), big(h3)];
    deaths = [...history(21), rec(TODAY, 1)];
    const first = mount(<DeathsPanel />);
    await ready();
    // 2 号舎と 3 号舎は未入力
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeMissing);
    first.unmount();

    // 2 号舎だけ特段の事情の日
    deaths = [...history(21), rec(TODAY, 1), rec(TODAY, 0, { houseId: "h2", exclusion: { kind: "equipment", note: "" } })];
    houses = [big(h1), big(h2)];
    const second = mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toBe("届け出の基準達していません2 号舎は特段の事情の日なので計算していません");
    expect(tile(RECORD_TEXT.statJudge).textContent).not.toContain(RECORD_TEXT.judgeNotHitNote);
    second.unmount();

    // 2 号舎と 3 号舎が特段の事情の日。名前は「・」でつなぐ
    houses = [big(h1), big(h2), big(h3)];
    deaths = [
      ...history(21),
      rec(TODAY, 1),
      rec(TODAY, 0, { houseId: "h2", exclusion: { kind: "equipment", note: "" } }),
      rec(TODAY, 2, { houseId: "h3", exclusion: { kind: "disaster", note: "" } }),
    ];
    const third = mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toBe("届け出の基準達していません2 号舎・3 号舎は特段の事情の日なので計算していません");
    third.unmount();

    // 除いた鶏舎がなければ、今までどおり「今日の記録で計算しました」
    houses = [big(h1)];
    deaths = [...history(21), rec(TODAY, 1)];
    mount(<DeathsPanel />);
    await ready();
    expect(tile(RECORD_TEXT.statJudge).textContent).toBe(`届け出の基準達していません${RECORD_TEXT.judgeNotHitNote}`);
  });

  it("飼育中の鶏舎がなく全部空舎なら、次にすることは『飼育中の鶏舎がありません。空舎の日の記録は任意です。』", async () => {
    houses = [{ ...h1, empty: true }, h3];
    mount(<DeathsPanel />);
    expect(await screen.findByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextNoActive}`)).toBeTruthy();
    expect(screen.queryByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextDone}`)).toBeNull();
    expect(tile(RECORD_TEXT.statToday).textContent).toContain("0 / 0");
    expect(tile(RECORD_TEXT.statJudge).textContent).toContain(RECORD_TEXT.judgeNoHouse);
    // 入れられる鶏舎がないので、今日の死亡は「未入力」ではなく「対象なし」
    expect(tile(RECORD_TEXT.statTodayDeaths).textContent).toContain(RECORD_TEXT.statNoTarget);
    expect(tile(RECORD_TEXT.statTodayDeaths).textContent).not.toContain(RECORD_TEXT.statNotEntered);
  });

  it("画面の文に『足す』『つける』『おして』を使わない", async () => {
    houses = [h1, h2, h3];
    deaths = [...history(21), rec(TODAY, 10, { flockSizeAt: 1000 })];
    mount(<DeathsPanel />);
    await ready();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/足す|足して|つける|つけて|おして/);
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
      setValue(countLabel(), bad);
      fireEvent.click(saveButton());
      expect((await screen.findByRole("alert")).textContent).toBe(text);
    }
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("誤りの文の中身（0 と入れる案内、羽数の n）", () => {
    expect(RECORD_TEXT.deathsEmpty).toBe("死亡数を入れてください。死亡がない日は 0 と入れます");
    expect(RECORD_TEXT.deathsNotNumber).toBe("死亡数は 0 以上の整数で入れてください");
    expect(RECORD_TEXT.deathsOverFlock(100)).toBe("死亡数が飼養羽数（100 羽）を超えています");
    expect(RECORD_TEXT.deathsRecorded(3)).toBe("3 羽で記録済み");
  });

  it("保存したら数と理由が空になり、結果は残る", async () => {
    mount(<DeathsPanel />);
    await ready();
    setValue(reasonLabel(), "equipment");
    setValue(countLabel(), "4");
    fireEvent.click(saveButton());
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect((screen.getByLabelText(countLabel()) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(reasonLabel()) as HTMLSelectElement).value).toBe("");
  });

  it("鶏舎ごとに欄が分かれ、ほかの行の入力は混ざらない", async () => {
    houses = [h1, { ...h1, id: "h2", name: "2 号舎" }];
    mount(<DeathsPanel />);
    await ready();
    setValue(countLabel("2 号舎"), "5");
    setValue(reasonLabel("2 号舎"), "disaster");
    expect((screen.getByLabelText(countLabel()) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(reasonLabel()) as HTMLSelectElement).value).toBe("");
    fireEvent.click(saveButton("2 号舎"));
    await waitFor(() => expect(saveDeath).toHaveBeenCalledTimes(1));
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({ date: TODAY, houseId: "h2", deaths: 5, flockSizeAt: 100, exclusion: { kind: "disaster", note: "" } });
  });

  it("日付を切り替えると理由が空になる", async () => {
    mount(<DeathsPanel />);
    await ready();
    setValue(reasonLabel(), "disaster");
    setValue(RECORD_TEXT.dateLabel, addDays(TODAY, -1));
    expect((screen.getByLabelText(reasonLabel()) as HTMLSelectElement).value).toBe("");
  });

  it("その日と鶏舎に記録があれば行に『記録済み』と『記録し直す』を出し、なければ出さない", async () => {
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    const note = screen.getByText(RECORD_TEXT.deathsRecorded(3));
    expect(note.getAttribute("role")).toBe("status");
    const input = screen.getByLabelText(countLabel());
    expect(note.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: RECORD_TEXT.resaveFor(H1) }).textContent).toBe(RECORD_TEXT.resave);
    setValue(RECORD_TEXT.dateLabel, addDays(TODAY, -1));
    expect(screen.queryByText(RECORD_TEXT.deathsRecorded(3))).toBeNull();
    expect(screen.getByRole("button", { name: RECORD_TEXT.saveFor(H1) }).textContent).toBe(RECORD_TEXT.save);
  });

  it("保存したら結果の枠へ動かして focus を移し、先頭に『記録しました』を出す。枠はその鶏舎の行の下", async () => {
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
    expect(frame.closest(".row-more")?.closest("li")).toBe(rowOf(H1));
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
    setValue(RECORD_TEXT.dateLabel, addDays(TODAY, -121));
    setValue(countLabel(), "1");
    fireEvent.click(saveButton());
    expect(await screen.findByText(RECORD_TEXT.dateRange)).toBeTruthy();
    setValue(RECORD_TEXT.dateLabel, addDays(TODAY, 1));
    setValue(countLabel(), "1");
    fireEvent.click(saveButton());
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("除外の理由を選ぶと exclusion に入る（設備の故障、急な気温変化、災害、その他）", async () => {
    mount(<DeathsPanel />);
    await ready();
    const reasons = Array.from((screen.getByLabelText(reasonLabel()) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(reasons).toEqual(["なし", "設備の故障", "急な気温変化", "災害", "その他"]);
    setValue(reasonLabel(), "equipment");
    expect(screen.getByText(RECORD_TEXT.reasonChosen("設備の故障"))).toBeTruthy();
    setValue(countLabel(), "4");
    fireEvent.click(saveButton());
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
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.saveFor(H1) }));
    await waitFor(() => expect(saveDeath).toHaveBeenCalled());
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({ date: TODAY, houseId: "h1", deaths: 0, flockSizeAt: 100, exclusion: { kind: "empty", note: "" } });
  });

  it("空舎の行: 空舎の日の記録だけを『空舎の日として記録済み』と言う。空舎にする前の死亡数の記録なら、その数と『記録し直す』（押すと空舎の日になる）", async () => {
    houses = [{ ...h1, empty: true }];
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    const first = mount(<DeathsPanel />);
    await screen.findByText(RECORD_TEXT.deathsRecorded(3));
    expect(screen.queryByText(RECORD_TEXT.houseEmptyRecorded)).toBeNull();
    const resave = screen.getByRole("button", { name: RECORD_TEXT.resaveFor(H1) });
    expect(resave.textContent).toBe(RECORD_TEXT.resave);
    fireEvent.click(resave);
    await waitFor(() => expect(saveDeath).toHaveBeenCalled());
    expect(saveDeath.mock.calls[0]?.[0]).toEqual({ date: TODAY, houseId: "h1", deaths: 0, flockSizeAt: 100, exclusion: { kind: "empty", note: "" } });
    expect(await screen.findByText(RECORD_TEXT.houseEmptyRecorded)).toBeTruthy();
    expect(screen.queryByRole("button", { name: RECORD_TEXT.resaveFor(H1) })).toBeNull();
    expect(screen.queryByRole("button", { name: RECORD_TEXT.saveFor(H1) })).toBeNull();
    first.unmount();

    // 羽数 0 で記録した日も空舎の日
    deaths = [rec(TODAY, 0, { flockSizeAt: 0 })];
    mount(<DeathsPanel />);
    expect(await screen.findByText(RECORD_TEXT.houseEmptyRecorded)).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(`: ${H1}$`) })).toBeNull();
  });

  it("羽数が 0 で空舎でない鶏舎は、空舎と混ぜず保存できない", async () => {
    houses = [{ ...h1, flockSize: 0 }];
    mount(<DeathsPanel />);
    await screen.findByText(RECORD_TEXT.flockZero);
    expect((screen.getByRole("button", { name: RECORD_TEXT.saveFor(H1) }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextFlockZero}`)).toBeTruthy();
    expect(saveDeath).not.toHaveBeenCalled();
  });

  it("鶏舎がなければ『鶏舎がまだ登録されていません。』と、農場の設定の鶏舎の欄（#houses）へのリンク。保存を出さない", async () => {
    houses = [];
    mount(<DeathsPanel />);
    await screen.findByText(new RegExp(RECORD_TEXT.deathsNoHouses));
    expect(screen.queryByText(/。。/)).toBeNull();
    expect(screen.getByRole("link", { name: RECORD_TEXT.addHouseLink }).getAttribute("href")).toBe("/settings/farm#houses");
    expect(screen.queryByRole("button", { name: /^記録/ })).toBeNull();
  });

  it("見本の農場（sample）で鶏舎がなければ、今までの文とリンクのまま", async () => {
    houses = [];
    const sample = { ...store, mode: "sample" } as RecordStore;
    mount(<DeathsPanel />, { path: "/sample/record/deaths", store: sample });
    await screen.findByText(new RegExp(RECORD_TEXT.noHouses));
    expect(screen.getByRole("link", { name: RECORD_TEXT.setFarmLink }).getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("link", { name: RECORD_TEXT.addHouseLink })).toBeNull();
  });

  it("農場がなければ /settings/farm へ案内し、保存を出さない", async () => {
    farm = null;
    mount(<DeathsPanel />);
    const link = await screen.findByRole("link", { name: "農場を設定する" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("button", { name: /^記録/ })).toBeNull();
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
    expect(screen.getByText(/使える日は 6 日。21 日分そろうと計算します）。$/)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
  });

  it("当たれば hit の文と、登録した家畜保健衛生所の連絡先と留意事項 16 を赤い枠に。入力を直すと表示が消える", async () => {
    deaths = history(21); // 1 日 1 羽 / 1000 羽
    mount(<DeathsPanel />);
    await recordDeaths("10"); // 当日 10 羽 → 平均の 2 倍以上
    const heading = await screen.findByText(RECORD_TEXT.hitHeading);
    const box = heading.closest(".death-hit") as HTMLElement;
    expect(box.getAttribute("role")).toBe("alert");
    expect(within(box).getByText(MORTALITY_TEXT.hit)).toBeTruthy();
    expect(within(box).getByText(/ある家保 00-0000-0000/)).toBeTruthy();
    expect(within(box).getByText(MORTALITY_TEXT.exceptions)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.askKaho)).toBeTruthy();
    // 入力を直すと消える
    setValue(countLabel(), "1");
    expect(screen.queryByText(RECORD_TEXT.hitHeading)).toBeNull();
    expect(screen.queryByText(RECORD_TEXT.resultHeading)).toBeNull();
  });

  it("『入力を直すと、この結果の表示は消えます。送ったメールは取り消せません。』は結果の末尾だけに出る", async () => {
    deaths = history(21);
    mount(<DeathsPanel />);
    await ready();
    expect(screen.queryByText(RECORD_TEXT.hitAfterEdit)).toBeNull();
    await recordDeaths("1");
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(result.lastElementChild?.textContent).toBe(RECORD_TEXT.hitAfterEdit);
    expect(screen.getAllByText(RECORD_TEXT.hitAfterEdit)).toHaveLength(1);
  });

  it("結果の並び: 率の行 → 判定 → 迷うときは家保へ → 畳んだ『計算の内訳と決まりを見る』", async () => {
    deaths = history(21);
    mount(<DeathsPanel />);
    await recordDeaths("1");
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    const order = [
      within(result).getByText(/^この日の死亡率 0\.10%、21 日間の平均 0\.10%。$/),
      within(result).getByText(RECORD_TEXT.notHit),
      within(result).getByText(RECORD_TEXT.askKaho),
      result.querySelector("details") as HTMLElement,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const fold = result.querySelector("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")?.textContent).toBe(RECORD_TEXT.detailOpen);
    for (const t of [MORTALITY_TEXT.definition, MORTALITY_TEXT.exceptions, MORTALITY_TEXT.reading, MORTALITY_TEXT.symptoms, RECORD_TEXT.missingDays(0)]) {
      expect(within(fold).getByText(t)).toBeTruthy();
    }
  });

  it("連絡先が空でも hit を残し、『家畜保健衛生所の連絡先が未登録です』と /settings/farm への案内を出す", async () => {
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
    setValue(reasonLabel(), "disaster");
    setValue(countLabel(), "10");
    fireEvent.click(saveButton());
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
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(within(result).getByText(MORTALITY_TEXT.invalidInput)).toBeTruthy(); // 上の札にも同じ語が出る
    expect(screen.getByText(/確かめる日: 11月2日/)).toBeTruthy();
    expect(screen.getByText(MORTALITY_TEXT.symptoms)).toBeTruthy();
    expect(screen.queryByText(RECORD_TEXT.notHit)).toBeNull();
  });

  it("保存後に記録を読み直せなければ、保存はできたと伝え、計算は出さない", async () => {
    mount(<DeathsPanel />);
    await ready();
    failListDeaths = true;
    setValue(countLabel(), "1");
    fireEvent.click(saveButton());
    expect(await screen.findByText(RECORD_TEXT.readFailed)).toBeTruthy();
    expect(saveDeath).toHaveBeenCalledTimes(1);
  });

  it("入れる案内: 死亡がない日は 0 と記録する", async () => {
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(/死亡がない日は 0 と記録します/)).toBeTruthy();
  });
});

describe("DeathsPanel 週の報告文", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  });

  const openWeekly = () => fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.weeklyOpen }));

  it("開いた直後は畳んであり、見出しと『週の報告文を作る』のボタンだけを出す（aria-expanded は false）", async () => {
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByRole("heading", { level: 3, name: RECORD_TEXT.weeklyHeading })).toBeTruthy();
    const btn = screen.getByRole("button", { name: RECORD_TEXT.weeklyOpen });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("週の報告文の下書き")).toBeNull();
    expect(screen.queryByLabelText(RECORD_TEXT.weeklyStart)).toBeNull();
    expect(screen.queryByLabelText(RECORD_TEXT.weeklyCulled)).toBeNull();
    expect(screen.queryByText(/様式の項目に合わせた下書きです/)).toBeNull();
  });

  it("押すと開き（aria-expanded は true、aria-controls は開いた中身）、もう一度押すと畳む。入れた値は畳んでも残る", async () => {
    mount(<DeathsPanel />);
    await ready();
    openWeekly();
    const btn = screen.getByRole("button", { name: RECORD_TEXT.weeklyOpen });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(btn.getAttribute("aria-controls") ?? "");
    expect(body).toBeTruthy();
    expect(within(body!).getByLabelText("週の報告文の下書き")).toBeTruthy();
    for (const label of [RECORD_TEXT.weeklyStart, RECORD_TEXT.weeklyCulled, RECORD_TEXT.weeklyIntroduced, RECORD_TEXT.weeklyHealth, RECORD_TEXT.weeklyMortality]) {
      expect(within(body!).getByLabelText(label)).toBeTruthy();
    }
    setValue(RECORD_TEXT.weeklyCulled, "7");
    setValue(RECORD_TEXT.weeklyHealth, "産卵率は横ばい");
    openWeekly();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(RECORD_TEXT.weeklyCulled)).toBeNull();
    openWeekly();
    expect((screen.getByLabelText(RECORD_TEXT.weeklyCulled) as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText(RECORD_TEXT.weeklyHealth) as HTMLTextAreaElement).value).toBe("産卵率は横ばい");
    expect((screen.getByLabelText("週の報告文の下書き") as HTMLTextAreaElement).value).toContain("廃鶏出荷羽数: 7");
  });

  it("様式の項目に合わせた下書きを出し、コピーでき、保存を呼ばない", async () => {
    deaths = [rec(addDays(TODAY, -1), 2)];
    mount(<DeathsPanel />);
    await ready();
    await screen.findByText(RECORD_TEXT.weeklyHeading);
    openWeekly();
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

  const answer = (no: string, text: string) => within(screen.getByRole("group", { name: new RegExp(`^${no} `) })).getByRole("button", { name: text });
  const pressed = (no: string) =>
    [RECORD_TEXT.selfOk, RECORD_TEXT.selfNg].map((t) => answer(no, t).getAttribute("aria-pressed"));

  it("項目ごとに『できている』『できていない』の押しボタン 2 つ（aria-pressed）。丸の選択肢と『未記入』の選択肢はない", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    for (const no of ["17", "18", "19", "22", "23", "25", "27"]) {
      const g = screen.getByRole("group", { name: new RegExp(`^${no} `) });
      expect(within(g).getAllByRole("button").map((b) => b.textContent)).toEqual([RECORD_TEXT.selfOk, RECORD_TEXT.selfNg]);
      expect(pressed(no)).toEqual(["false", "false"]);
    }
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "未記入" })).toBeNull();
    expect(RECORD_TEXT.selfOk).toBe("できている");
    expect(RECORD_TEXT.selfNg).toBe("できていない");
  });

  it("使い方（押し直すと未記入に戻る）は 7 項目の下に 1 回。報告文の ○× との対応は報告文の近くに 1 回", async () => {
    const { container } = mount(<SelfCheckPanel />);
    const how = await screen.findByText(RECORD_TEXT.selfMeaning);
    const items = await screen.findAllByRole("group");
    expect(items[items.length - 1]!.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((container.textContent ?? "").split(RECORD_TEXT.selfMeaning).length - 1).toBe(1);
    const map = screen.getByText(new RegExp(`^${RECORD_TEXT.selfReportNote}`));
    const reportHeading = screen.getByRole("heading", { name: RECORD_TEXT.selfReportHeading });
    expect(reportHeading.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(RECORD_TEXT.selfReportNote).toMatch(/○/);
    expect(RECORD_TEXT.selfReportNote).toMatch(/×/);
    // ○× の説明と出典の断りは 1 回だけ（断りを繰り返さない）。上の 1 文には書かない
    expect((container.textContent ?? "").split(RECORD_TEXT.selfReportNote).length - 1).toBe(1);
    expect((container.textContent ?? "").split(SELF_CHECK_SOURCE_NOTE).length - 1).toBe(1);
    expect(RECORD_TEXT.selfLead).not.toMatch(/○|×/);
  });

  it("読み込み中は答えのボタンも保存も disabled で、読み終えると押せる", async () => {
    let release: (v: Array<CheckRecord & { id: string }>) => void = () => {};
    store = { ...store, listChecks: vi.fn(() => new Promise((r) => { release = r as typeof release; })) } as unknown as RecordStore;
    mount(<SelfCheckPanel />);
    const btn = (await screen.findByRole("button", { name: RECORD_TEXT.selfSave })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const radios = screen.getAllByRole("button", { name: new RegExp(`^(${RECORD_TEXT.selfOk}|${RECORD_TEXT.selfNg})$`) }) as HTMLButtonElement[];
    expect(radios.length).toBe(14);
    expect(radios.every((r) => r.disabled)).toBe(true);
    // 読み込みは effect で始まる。ボタンは最初の描画で出るので、始まるのを待ってから読み終えさせる（早いと release がまだ空の関数）
    await waitFor(() => expect(store.listChecks).toHaveBeenCalled());
    expect(btn.disabled).toBe(true);
    release([]);
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(radios.every((r) => !r.disabled)).toBe(true);
  });

  it("読み込みに失敗したら保存は disabled のまま。saveCheck は呼ばれない", async () => {
    store = { ...store, listChecks: vi.fn(async () => { throw new Error("読み込めません"); }) } as unknown as RecordStore;
    mount(<SelfCheckPanel />);
    expect((await screen.findByRole("alert")).textContent).toBe(RECORD_TEXT.readFailed);
    const btn = screen.getByRole("button", { name: RECORD_TEXT.selfSave }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(saveCheck).not.toHaveBeenCalled();
  });

  it("押すとその答えだけが押された状態になり、もう一方を押すと替わり、同じものをもう一度押すと未記入（両方押していない）に戻る", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    fireEvent.click(answer("17", RECORD_TEXT.selfNg));
    expect(pressed("17")).toEqual(["false", "true"]);
    expect(pressed("18")).toEqual(["false", "false"]);
    fireEvent.click(answer("17", RECORD_TEXT.selfOk));
    expect(pressed("17")).toEqual(["true", "false"]);
    fireEvent.click(answer("17", RECORD_TEXT.selfOk));
    expect(pressed("17")).toEqual(["false", "false"]);
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.selfSave }));
    await waitFor(() => expect(saveCheck).toHaveBeenCalledTimes(1));
    expect((saveCheck.mock.calls[0]?.[0] as { answers: Record<string, unknown> }).answers["17"]).toBeNull();
  });

  it("答えのボタンは部品の .btn（高さ --tap）で、押した状態は theme の変数の色（record.css）", () => {
    const css = readFileSync("web/src/pages/record/record.css", "utf-8");
    const m = css.match(/\.self-answer \.btn\[aria-pressed="true"\]\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    // 主のボタン（塗りの --accent）と分けて、薄い塗りと太枠
    expect(body).toMatch(/background:\s*var\(--soft\)/);
    expect(body).toMatch(/border:\s*2px solid var\(--accent\)/);
    expect(body).toMatch(/color:\s*var\(--accent\)/);
    expect(body).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(css).not.toMatch(/\.self-choice/);
    expect(css).toMatch(/\.death-result-focus:focus\s*\{\s*outline:\s*none/);
  });

  it("農場がなければ保存を出さず /settings/farm へ案内する", async () => {
    farm = null;
    mount(<SelfCheckPanel />);
    const link = await screen.findByRole("link", { name: "農場を設定する" });
    expect(link.getAttribute("href")).toBe("/settings/farm");
    expect(screen.queryByRole("button", { name: RECORD_TEXT.selfSave })).toBeNull();
  });

  it("7 項目を番号つきで保存し（形は ok・ng・null のまま）、報告文は ○× でコピーできる。送信のボタンはない", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    for (const no of ["17", "18", "19", "22", "23", "25", "27"]) {
      expect(screen.getByRole("group", { name: new RegExp(`^${no} `) })).toBeTruthy();
    }
    for (const no of ["17", "18", "22", "23", "25"]) fireEvent.click(answer(no, RECORD_TEXT.selfOk));
    fireEvent.click(answer("19", RECORD_TEXT.selfNg));
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

  it("期限が未設定なら『未登録』の札（任意の項目なので赤くしない）と通知の設定へのリンク、設定済みなら日付と残りの日数を出す。見本ではリンクを出さない", async () => {
    const dueTile = () => screen.getByText(RECORD_TEXT.selfDueTile).closest("li")!;
    const { unmount } = mount(<SelfCheckPanel />);
    await selfReady();
    expect(dueTile().textContent).toContain(RECORD_TEXT.selfDueMissing);
    expect(dueTile().className).not.toContain("is-alert");
    expect(within(dueTile()).getByRole("link", { name: RECORD_TEXT.selfDueLink }).getAttribute("href")).toBe("/settings/notify");
    unmount();
    mount(<SelfCheckPanel />, { store: { ...store, mode: "sample" } as unknown as RecordStore });
    await selfReady();
    expect(dueTile().textContent).toContain(RECORD_TEXT.selfDueMissing);
    expect(within(dueTile()).queryByRole("link")).toBeNull();
    cleanup();
    farm = farmFixture({ selfCheckDue: { "2026-11": "2026-12-05" } });
    mount(<SelfCheckPanel />);
    await selfReady();
    expect(dueTile().textContent).toBe("期限12月5日あと 29 日");
    expect(dueTile().className).not.toContain("is-alert");
    expect(RECORD_TEXT.selfDueLeft(0)).toBe("今日が期限です");
    expect(RECORD_TEXT.selfDueLeft(-2)).toBe("2 日過ぎています");
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
    await waitFor(() => expect(pressed("19")).toEqual(["false", "true"]));
    expect(pressed("17")).toEqual(["true", "false"]);
    expect(pressed("18")).toEqual(["false", "false"]);
  });

  it("題と 1 文、札（今月の分・期限・記録した項目）、次にすることを出し、記録すると札と次にすることが変わる", async () => {
    const tiles = () => within(screen.getByRole("list", { name: RECORD_TEXT.selfStatsLabel })).getAllByRole("listitem").map((i) => i.textContent);
    mount(<SelfCheckPanel />);
    expect(await screen.findByRole("heading", { level: 2, name: RECORD_TEXT.selfTitle })).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.selfLead)).toBeTruthy();
    // 読み込み中は「…」（未記録や 0 と言わない）
    expect(tiles()[0]).toBe("2026年11月の分…");
    await selfReady();
    expect(tiles()).toEqual(["2026年11月の分未記録", `期限${RECORD_TEXT.selfDueMissing}${RECORD_TEXT.selfDueLink}`, "記録した項目0 / 7"]);
    expect(screen.getByText(`次にすること: ${RECORD_TEXT.selfNext}`)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.selfBlankCount(7))).toBeTruthy();
    for (const no of ["17", "18", "19", "22", "23"]) fireEvent.click(answer(no, RECORD_TEXT.selfOk));
    fireEvent.click(answer("25", RECORD_TEXT.selfNg));
    expect(screen.getByText(RECORD_TEXT.selfBlankCount(1))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.selfSave }));
    await screen.findByText(RECORD_TEXT.saved);
    expect(tiles()[0]).toBe("2026年11月の分記録済み11月6日に記録");
    expect(tiles()[2]).toBe("記録した項目6 / 7");
    expect(screen.getByText(`次にすること: ${RECORD_TEXT.selfNextDone}`)).toBeTruthy();
  });

  it("各行の見出しは確認リストの平易な文、その下に小さく基準の項目の語。印は未記入 ☐・できている ○・できていない ×", async () => {
    const { CHECKLIST_ITEMS } = await import("@hpai/shared/checklist");
    const { SELF_CHECK_ITEMS } = await import("@hpai/shared/reports");
    mount(<SelfCheckPanel />);
    await selfReady();
    const rows = within(screen.getByRole("list", { name: RECORD_TEXT.selfItemsLabel })).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    SELF_CHECK_ITEMS.forEach((it, k) => {
      const plain = CHECKLIST_ITEMS.find((c) => c.id === `always-${it.no}`)?.text;
      expect(plain, it.no).toBeTruthy(); // 7 項目とも確認リストに平易な文がある
      expect(rows[k]!.querySelector(".row-title")?.textContent).toBe(plain);
      expect(rows[k]!.querySelector(".row-sub")?.textContent).toBe(`基準 項目 ${it.no}: ${it.label}`);
    });
    expect(rows[0]!.querySelector(".row-title")?.textContent).toBe("衛生管理区域（消毒して入る範囲）の入口で、立ち入る人に手指の洗浄と消毒をしてもらう");
    expect(within(rows[0]!).getByRole("img", { name: RECORD_TEXT.selfMarkBlank }).textContent).toBe("☐");
    fireEvent.click(answer("17", RECORD_TEXT.selfOk));
    fireEvent.click(answer("18", RECORD_TEXT.selfNg));
    expect(within(rows[0]!).getByRole("img", { name: "できている" }).textContent).toBe("○");
    expect(within(rows[1]!).getByRole("img", { name: "できていない" }).textContent).toBe("×");
    // 報告文は法令の語のまま
    const report = screen.getByLabelText(RECORD_TEXT.selfReportLabel) as HTMLTextAreaElement;
    expect(report.value).toContain("17 衛生管理区域に立ち入る者の手指消毒等: ○");
    expect(report.value).not.toContain("消毒して入る範囲");
  });

  it("120 日前からの自己点検を読み、これまでの自己点検を新しい月から ○・×・未記入の数で出す", async () => {
    checks = [
      { id: "self_2026-09", kind: "self_inspection", date: "2026-10-03", month: "2026-09", answers: { "17": "ok", "18": "ok", "19": "ok", "22": "ok", "23": "ok", "25": "ok", "27": "ok" } },
      { id: "self_2026-10", kind: "self_inspection", date: "2026-11-02", month: "2026-10", answers: { "17": "ok", "18": "ng", "19": null, "22": "ok", "23": "ok", "25": "ok", "27": "ok" } },
      { id: "dis_2026-11-05_always-17", kind: "disinfection", date: "2026-11-05", itemId: "always-17" },
    ];
    mount(<SelfCheckPanel />);
    await selfReady();
    expect(store.listChecks).toHaveBeenCalledWith(addDays(TODAY, -120), TODAY);
    // 先月の分を今月に読み戻さない
    expect(pressed("17")).toEqual(["false", "false"]);
    const table = within(screen.getByRole("region", { name: RECORD_TEXT.selfHistoryHeading })).getByRole("table");
    const body = within(table).getAllByRole("row").slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["対象の月", "記録した日", "○", "×", "未記入"]);
    expect(body).toEqual([
      ["2026年10月", "11月2日", "5", "1", "1"],
      ["2026年9月", "10月3日", "7", "0", "0"],
    ]);
    // 記録すると今月の行が先頭に入る
    fireEvent.click(answer("17", RECORD_TEXT.selfOk));
    fireEvent.click(screen.getByRole("button", { name: RECORD_TEXT.selfSave }));
    await screen.findByText(RECORD_TEXT.saved);
    expect(within(table).getAllByRole("row")[1]!.textContent).toBe("2026年11月11月6日106");
  });

  it("記録がまだなければ、これまでの自己点検は『まだ記録がありません。』", async () => {
    mount(<SelfCheckPanel />);
    await selfReady();
    expect(within(screen.getByRole("region", { name: RECORD_TEXT.selfHistoryHeading })).getByText(RECORD_TEXT.selfHistoryNone)).toBeTruthy();
  });
});

describe("所属が複数のとき（M-01: 止まる）", () => {
  it("getFarm が失敗すれば、どの画面にも保存と削除を出さず、読み込めない案内を出す", async () => {
    const { MultipleFarmsError } = await import("../auth/firestoreRecordStore");
    store = { ...store, getFarm: vi.fn(async () => { throw new MultipleFarmsError(); }) } as unknown as RecordStore;
    for (const [ui, name] of [
      [<DeathsPanel key="d" />, /^(記録する|記録し直す)/], // 死亡数の行の押すものは「記録する: 鶏舎の名前」
      [<SelfCheckPanel key="s" />, RECORD_TEXT.selfSave],
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
    const parts = [<DeathsPanel key="d" />, <SelfCheckPanel key="s" />, <RecordTabs key="t" />];
    for (const ui of parts) {
      const { container, unmount } = mount(ui);
      await waitFor(() => expect(clean(container).length).toBeGreaterThan(20));
      await new Promise((r) => setTimeout(r, 20));
      expect(findForbiddenPhrases(clean(container))).toEqual([]);
      unmount();
    }
  });
});

describe("2026-11-08 レビューの直し（札の値・鶏舎の順・結果の枠・表・ボタン）", () => {
  const css = readFileSync("web/src/pages/record/record.css", "utf-8");
  const theme = readFileSync("web/src/ui/theme.css", "utf-8");
  const h2: House & { id: string } = { id: "h2", name: "2 号舎", birdType: "採卵鶏", flockSize: 400, empty: false };
  const h10: House & { id: string } = { id: "h10", name: "10 号舎", birdType: "採卵鶏", flockSize: 1200, empty: false };
  const rowTitles = () =>
    within(screen.getByRole("list", { name: RECORD_TEXT.rowsLabel }))
      .getAllByRole("listitem")
      .map((r) => r.querySelector(".row-title")?.textContent);

  it("札の大きな値は 2〜8 文字の語（理由は note）。届け出の基準と自己点検の札の値", () => {
    for (const v of [
      RECORD_TEXT.judgeHit,
      RECORD_TEXT.judgeNotHit,
      RECORD_TEXT.judgeMissing,
      RECORD_TEXT.judgeInsufficient,
      RECORD_TEXT.judgeInvalid,
      RECORD_TEXT.judgeExcluded,
      RECORD_TEXT.judgeNoHouse,
      RECORD_TEXT.statNotEntered,
      RECORD_TEXT.statNoTarget,
      RECORD_TEXT.statWeekNone,
      RECORD_TEXT.selfRecorded,
      RECORD_TEXT.selfNotRecorded,
      RECORD_TEXT.selfDueMissing,
    ]) {
      expect(v.length, v).toBeGreaterThanOrEqual(2);
      expect(v.length, v).toBeLessThanOrEqual(8); // 「達している可能性」は 8 文字（「達する」と縮めると意味が変わる）
      expect(v, v).not.toMatch(/。/);
    }
    expect(RECORD_TEXT.judgeMissing).toBe("未入力あり");
    expect(RECORD_TEXT.judgeMissingNote).toBe("今日の分がそろうと計算します");
    expect(RECORD_TEXT.judgeInsufficient).toBe("日数が不足");
    expect(RECORD_TEXT.judgeInsufficientNote).toBe("21 日分そろうと計算します");
    expect(RECORD_TEXT.judgeHit).toBe("達している可能性");
    expect(RECORD_TEXT.selfDueLink).toBe("期限を決める");
  });

  it("届け出の基準の札: 未入力と日数不足は、値が短い語で note に理由", async () => {
    houses = [{ ...h1, flockSize: 1000 }, { ...h2, flockSize: 1000 }];
    deaths = [...history(21), rec(TODAY, 1)];
    const first = mount(<DeathsPanel />);
    await ready();
    const judge = () => tile(RECORD_TEXT.statJudge);
    expect(judge().querySelector(".stat-value")?.textContent).toBe("未入力あり");
    expect(judge().querySelector(".stat-note")?.textContent).toBe("今日の分がそろうと計算します");
    first.unmount();
    houses = [{ ...h1, flockSize: 1000 }];
    deaths = [...history(5), rec(TODAY, 1)];
    mount(<DeathsPanel />);
    await ready();
    expect(judge().querySelector(".stat-value")?.textContent).toBe("日数が不足");
    expect(judge().querySelector(".stat-note")?.textContent).toBe("21 日分そろうと計算します");
  });

  it("鶏舎は名前の順（2 号舎は 10 号舎より前）。行、14 日の表の列、次にすることが同じ順で、記録しても行の順は変わらない", async () => {
    houses = [h2, h10, h1];
    deaths = [rec(addDays(TODAY, -1), 1, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(rowTitles()).toEqual(["1 号舎", "2 号舎", "10 号舎"]);
    const table = screen.getByRole("table", { name: RECORD_TEXT.trendHeading });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["日付", "1 号舎", "2 号舎", "10 号舎", "合計"]);
    expect(screen.getByText(`${RECORD_TEXT.nextLabel}: ${RECORD_TEXT.nextMissing("1 号舎・2 号舎・10 号舎")}`)).toBeTruthy();
    // 真ん中の 2 号舎を記録しても、未入力の行を先に並べ替えない
    await recordDeaths("0", "2 号舎");
    await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(rowTitles()).toEqual(["1 号舎", "2 号舎", "10 号舎"]);
    expect(screen.getByText(`${RECORD_TEXT.nextLabel}: 1 号舎・10 号舎がまだ未入力です。死亡数を入れて「記録する」を押します。`)).toBeTruthy();
    expect(listDeaths).toHaveBeenCalled();
  });

  it("飼養の羽数は 3 桁ごとに区切る（飼養 1,200 羽）", async () => {
    houses = [h10];
    mount(<DeathsPanel />);
    await ready("10 号舎");
    expect(within(rowOf("10 号舎")).getByText("飼養 1,200 羽")).toBeTruthy();
  });

  it("主のボタンは未記録の「記録する」だけ。「記録し直す」は secondary", async () => {
    houses = [h1, h2];
    deaths = [rec(TODAY, 3, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByRole("button", { name: RECORD_TEXT.resaveFor(H1) }).className).not.toContain("btn-primary");
    expect(screen.getByRole("button", { name: RECORD_TEXT.saveFor("2 号舎") }).className).toContain("btn-primary");
    expect(screen.getByRole("button", { name: RECORD_TEXT.weeklyOpen }).className).not.toContain("btn-primary");
  });

  it("記録した直後の結果: 「記録しました」は小さな緑の 1 行、結果は枠。日数が足りなければ 1 行に詰め、句点のない行がない", async () => {
    houses = [{ ...h1, flockSize: 1000 }];
    deaths = history(0);
    mount(<DeathsPanel />);
    await recordDeaths("1");
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    expect(screen.getByText(RECORD_TEXT.saved).className).toBe("death-saved");
    expect(within(result).getByRole("status").textContent).toBe(
      "11月6日の記録で計算しました。まだ計算できません（使える日は 1 日。21 日分そろうと計算します）。",
    );
    const lines = Array.from(result.querySelectorAll("p")).map((p) => p.textContent ?? "");
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line, line).toMatch(/。$/);
    expect(css).toMatch(/\.death-result\s*\{[^}]*border-left:\s*4px solid var\(--line\)[^}]*background:\s*var\(--soft\)/);
    expect(css).toMatch(/\.death-saved,\s*\.record-saved\s*\{[^}]*color:\s*var\(--farm\)/);
  });

  it("当たらない日も、結果の文はすべて句点で終わる", async () => {
    houses = [{ ...h1, flockSize: 1000 }];
    deaths = history(21);
    mount(<DeathsPanel />);
    await recordDeaths("1");
    const result = await screen.findByRole("region", { name: RECORD_TEXT.resultHeading });
    for (const p of Array.from(result.querySelectorAll("p"))) expect(p.textContent, p.textContent ?? "").toMatch(/。$/);
  });

  it("特段の事情の開閉は「ここで選びます」の文で、閉じた ▸ と開いた ▾ の印を CSS で出す", () => {
    expect(RECORD_TEXT.reasonOpen).toBe("特段の事情がある日は、ここで選びます（設備の故障など）");
    expect(css).toMatch(/\.death-reason summary::before\s*\{\s*content:\s*"▸"/);
    expect(css).toMatch(/\.death-reason\[open\] > summary::before\s*\{\s*content:\s*"▾"/);
    expect(css).toMatch(/\.death-reason summary\s*\{[^}]*list-style:\s*none/);
  });

  it("直近 14 日に記録がなければ表を出さず 1 行。120 日分の畳みは記録があるときだけ", async () => {
    const first = mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(RECORD_TEXT.recentEmpty)).toBeTruthy();
    expect(screen.queryByRole("table", { name: RECORD_TEXT.trendHeading })).toBeNull();
    expect(screen.queryByText(RECORD_TEXT.trendAll)).toBeNull();
    first.unmount();
    // 14 日より前にだけ記録がある: 1 行と、120 日分の畳み
    deaths = [rec(addDays(TODAY, -40), 2, { flockSizeAt: 100 })];
    mount(<DeathsPanel />);
    await ready();
    expect(screen.getByText(RECORD_TEXT.recentEmpty)).toBeTruthy();
    expect(screen.getByText(RECORD_TEXT.trendAll)).toBeTruthy();
  });

  it("表の数字は右寄せで桁をそろえ、日付の列は折り返さない（.record-table td の規則に負けない詳細度）", () => {
    expect(css).toMatch(/\.record-table\.death-table td\s*\{[^}]*text-align:\s*right[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/\.record-table tbody th\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).not.toMatch(/(^|\n)\.death-table td\s*\{/);
  });

  it("スマホ（599px 以下）の死亡数の行: 欄は 1 行、ボタンは次の行の全幅。3 タブの本文の幅は 48rem", () => {
    const narrow = /@media \(max-width:\s*599px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(narrow).toMatch(/\.deaths-panel \.row-act\s*\{[^}]*flex-direction:\s*column/);
    expect(narrow).toMatch(/\.deaths-panel \.death-field\s*\{[^}]*white-space:\s*nowrap/);
    expect(narrow).toMatch(/\.deaths-panel \.row-act > \.btn\s*\{[^}]*width:\s*100%[^}]*min-height:\s*var\(--tap\)/);
    expect(css).toMatch(/\.deaths-panel,\s*\.self-check-panel,\s*\.disinfection-panel\s*\{\s*max-width:\s*48rem/);
    expect(css).not.toMatch(/export-panel/);
  });

  it("札の CSS は .stat-tiles の下だけ（地図の .stat-row の規則を上書きしない）。値の字は clamp で縮む", () => {
    const block = theme.slice(theme.indexOf("/* 状態の数字の札（ui/StatRow.tsx"), theme.indexOf("/* 1 行 1 操作の一覧"));
    expect(block.length).toBeGreaterThan(100);
    const selectors = [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(",").map((x) => x.trim()));
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel, sel).toMatch(/^\.stat-tiles\b/);
    expect(block).toMatch(/\.stat-tiles \.stat-value\s*\{[^}]*font-size:\s*clamp\(1\.2rem, 2\.2vw, 1\.6rem\)/);
    expect(block).not.toMatch(/align-self/);
  });

  it("自己点検: 「記録する」だけ primary、「コピー」は secondary。札は「記録済み」と、記録した日を note に", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    checks = [
      { id: "self_2026-11", kind: "self_inspection", date: "2026-11-03", month: "2026-11", answers: { "17": "ok", "18": null, "19": null, "22": null, "23": null, "25": null, "27": null } },
    ];
    mount(<SelfCheckPanel />);
    await selfReady();
    expect(screen.getByRole("button", { name: RECORD_TEXT.selfSave }).className).toContain("btn-primary");
    expect(screen.getByRole("button", { name: RECORD_TEXT.copy }).className).not.toContain("btn-primary");
    const month = within(screen.getByRole("list", { name: RECORD_TEXT.selfStatsLabel })).getAllByRole("listitem")[0]!;
    expect(month.querySelector(".stat-value")?.textContent).toBe(RECORD_TEXT.selfRecorded);
    expect(month.querySelector(".stat-note")?.textContent).toBe("11月3日に記録");
  });

  it("消毒: 直近 14 日に記録がなければ表を出さず 1 行。記録があれば表", async () => {
    const first = mount(<DisinfectionPanel />, { path: "/record/disinfection" });
    expect(await screen.findByText(RECORD_TEXT.recentEmpty)).toBeTruthy();
    const region = screen.getByRole("region", { name: RECORD_TEXT.disTableHeading });
    expect(within(region).queryByRole("table")).toBeNull();
    expect(screen.getByText(`次にすること: ${RECORD_TEXT.disNext(3)}`)).toBeTruthy();
    expect(RECORD_TEXT.disNext(3)).toBe("まだ押していない項目が 3 つあります。消毒したら「やった」を押します。");
    first.unmount();
    checks = [{ id: "c", kind: "disinfection", date: addDays(TODAY, -2), itemId: "always-17" }];
    mount(<DisinfectionPanel />, { path: "/record/disinfection" });
    const region2 = await screen.findByRole("region", { name: RECORD_TEXT.disTableHeading });
    await waitFor(() => expect(within(region2).getByRole("table")).toBeTruthy());
    expect(screen.queryByText(RECORD_TEXT.recentEmpty)).toBeNull();
  });
});
