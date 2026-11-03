import type { Case, HistoryCase, Season, WatchStatus } from "@hpai/shared/types";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findForbiddenPhrases, FIXED_TEXT } from "@hpai/shared/wording";
import { PREFS } from "@hpai/shared/pref";
import historyJson from "../../../../data/history/cases.json";
import { DataSourceProvider } from "../../data/context";
import type { DataSource } from "../../data/types";
import type { MapViewProps } from "./MapView";

// MapView は maplibre（WebGL）を使うので、jsdom では差し替える。渡された props を控える
const seen: MapViewProps[] = [];
vi.mock("./MapView", () => ({
  default: (props: MapViewProps) => {
    seen.push(props);
    return <div data-testid="map" />;
  },
}));

import MapPage from "./MapPage";

const history = historyJson as HistoryCase[];
const NOW = new Date("2026-11-04T09:00:00+09:00"); // 今季は 2026

interface Rig {
  ds: DataSource;
  deliverCases(rows: Case[]): void;
  deliverWatch(rows: WatchStatus[]): void;
  historyDeferred: { resolve(h: HistoryCase[]): void; reject(e: Error): void };
}

function rig(opts: { history?: "now" | "deferred" } = {}): Rig {
  let casesCb: ((c: Case[]) => void) | null = null;
  let watchCb: ((w: WatchStatus[]) => void) | null = null;
  const hd = { resolve: (_h: HistoryCase[]) => {}, reject: (_e: Error) => {} };
  const ds: DataSource = {
    mode: "live",
    now: () => NOW,
    subscribeCases: (_s: Season, cb) => {
      casesCb = cb;
      return () => {};
    },
    subscribeWildBirds: (_s: Season, cb) => {
      cb([]);
      return () => {};
    },
    subscribeWatchStatus: (cb) => {
      watchCb = cb;
      return () => {};
    },
    loadHistory: () =>
      opts.history === "deferred"
        ? new Promise<HistoryCase[]>((res, rej) => {
            hd.resolve = res;
            hd.reject = rej;
          })
        : Promise.resolve(history),
  };
  return {
    ds,
    deliverCases: (rows) => act(() => casesCb!(rows)),
    deliverWatch: (rows) => act(() => watchCb!(rows)),
    historyDeferred: hd,
  };
}

function show(r: Rig) {
  return render(
    <MemoryRouter>
      <DataSourceProvider value={r.ds}>
        <MapPage />
      </DataSourceProvider>
    </MemoryRouter>,
  );
}

const okWatch = (): WatchStatus[] =>
  PREFS.map((p) => ({
    prefCode: p.code,
    checkedAt: "2026-11-04T08:30:00+09:00",
    ok: true,
    lastOkAt: "2026-11-04T08:30:00+09:00",
    failingSince: null,
  }));

const lastProps = () => seen[seen.length - 1]!;

beforeEach(() => {
  seen.length = 0;
});
afterEach(cleanup);

describe("MapPage", () => {
  it("今季の事例がまだ届かないうちは『0 件』と書かず、riskAnywhere も出さない。県はすべて確認できていない扱い", async () => {
    show(rig());
    await screen.findByTestId("map");
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(document.body.textContent).not.toMatch(/(^|[^0-9])0 件/);
    expect(document.body.textContent).toContain("まだ読めていません");
    expect(lastProps().view.loaded).toBe(false);
    expect(lastProps().failedPrefCodes).toHaveLength(47);
  });

  it("今季 0 件が届いたら riskAnywhere を出す。禁句はない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(await screen.findByText(FIXED_TEXT.riskAnywhere)).toBeTruthy();
    expect(lastProps().failedPrefCodes).toEqual([]);
    expect(findForbiddenPhrases(document.body.textContent ?? "")).toEqual([]);
    expect(screen.queryByText(FIXED_TEXT.pastDisclaimer)).toBeNull();
  });

  it("見回りに失敗した県があるときは県名を書き、0 件でも『発生なし』に見せない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch().map((w) => (w.prefCode === "33" ? { ...w, ok: false, failingSince: "2026-11-04T01:00:00+09:00" } : w)));
    expect(lastProps().failedPrefCodes).toEqual(["33"]);
    expect(document.body.textContent).toMatch(/確認できていない県.*岡山県/);
    expect(document.body.textContent).not.toMatch(/発生なし/);
    // いちばん目立つ「今季 0 件」にも注記が付く
    expect(screen.getByRole("button", { name: /今季.*0 件.*確認できていない県あり/ })).toBeTruthy();
  });

  it("見回りの結果が全県確認できているときは注記を付けない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    expect(screen.getByRole("button", { name: /今季.*0 件/ }).textContent).not.toContain("確認できていない");
  });

  it("過去のシーズンを選んでも、野鳥の配列は同じ参照のまま（地図の source を替えない）", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const before = lastProps().wildBirds;
    fireEvent.click(await screen.findByRole("button", { name: /昨季.*24 件/ }));
    expect(lastProps().view.isCurrent).toBe(false);
    expect(lastProps().wildBirds).toBe(before);
  });

  it("昨季を押すと『24 件』、pastDisclaimer が出て、riskAnywhere は出ない", async () => {
    const r = rig();
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    r.deliverWatch(okWatch());
    const bar = await screen.findByRole("button", { name: /昨季.*24 件/ });
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(FIXED_TEXT.pastDisclaimer)).toBeTruthy();
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
    expect(lastProps().view.total).toBe(24);
    expect(lastProps().view.confirmedMuniCodes).toContain("33203");
    expect(lastProps().failedPrefCodes).toEqual([]);
  });

  it("過去の記録が届かないうちの昨季は『まだ読めていません』で、0 件にしない", async () => {
    const r = rig({ history: "deferred" });
    show(r);
    await screen.findByTestId("map");
    r.deliverCases([]);
    const bar = screen.getByRole("button", { name: /昨季/ });
    expect(bar.textContent).toContain("まだ読めていません");
    fireEvent.click(bar);
    expect(lastProps().view.loaded).toBe(false);
    expect(screen.queryByText(FIXED_TEXT.riskAnywhere)).toBeNull();
  });

  it("地図の下に固定のリンクが 5 つある", async () => {
    show(rig());
    await screen.findByTestId("map");
    const nav = screen.getByRole("navigation", { name: "ほかのページ" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/public", "/known", "/replay", "/results", "/privacy"]);
  });
});
