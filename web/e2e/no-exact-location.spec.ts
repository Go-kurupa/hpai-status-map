import type { Case } from "@hpai/shared/types";
import { expect, test, type Page } from "@playwright/test";
import { installFixture } from "./fixtures";
import { latestSignInLink, seedInvite } from "./helpers/seedInvite";

// 地点の通信内容の確認（X-23、設計書 §12、§16）。
// 公開の画面でも会員の画面でも、農場の正確な位置（緯度経度）が端末の外へ出ないことを、通信の中身で確かめる。
//   公開: 町と地点を指定しても、全要求に緯度経度のキーも小数の組もなく、端末の中の hpai.spot.v1 は 3 つのキーだけ。
//   会員: 招待で入り、町を選び、地図を押して保存する。送るのは meshCode（約 1km 四方）で、緯度経度ではない。
// 会員の通しは模擬環境（Auth、Firestore、Functions）が要る。実行の例（リポジトリの根から）:
//   npm run bundle -w functions && firebase emulators:exec --only firestore,auth,functions --project demo-hpai \
//     "cd web && browser-guard run -- npx playwright test no-exact-location"

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 緯度経度のキー（plan X-23 の式のまま。centerLat や spotLng のような複合のキーも拾うため、語の境界を要求しない） */
const LATLNG_KEY = /"?(lat|lng|latitude|longitude)"?\s*[:=]/i;
/** 小数の緯度経度の組（-?DD.ddd, -?DDD.ddd。コンマが %2C でもよい） */
const LATLNG_PAIR = /-?\d{2}\.\d{3,}\s*(?:,|%2C)+\s*-?\d{2,3}\.\d{3,}/i;

interface Wire {
  url: string;
  body: string;
}

/** 生の文字列と、フォームの符号と URL の符号を戻した文字列の両方で調べる（Firestore の通信は符号化された本文で送る） */
function decoded(s: string): string[] {
  const out = [s];
  try {
    out.push(decodeURIComponent(s.replace(/\+/g, " ")));
  } catch {
    // 符号が壊れた本文は、生の文字列だけを調べる
  }
  return out;
}

function leaks(wire: Wire[]): string[] {
  const found: string[] = [];
  for (const r of wire) {
    // URL は query のキーも見る（lat=35.0 の形）
    for (const u of decoded(r.url)) {
      if (/[?&](lat|lng|latitude|longitude)=/i.test(u)) found.push(`url key: ${safeUrl(r.url)}`);
      if (LATLNG_PAIR.test(u)) found.push(`url pair: ${safeUrl(r.url)}`);
    }
    for (const b of decoded(r.body)) {
      if (LATLNG_KEY.test(b)) found.push(`body key: ${safeUrl(r.url)}`);
      if (LATLNG_PAIR.test(b)) found.push(`body pair: ${safeUrl(r.url)}`);
    }
  }
  return [...new Set(found)];
}

/** 失敗の表示に query と本文を出さない（出すのは host と path だけ） */
function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname}`;
  } catch {
    return "(url)";
  }
}

function recordWire(page: Page): { wire: Wire[]; sockets: string[]; external: string[] } {
  const wire: Wire[] = [];
  const sockets: string[] = [];
  const external: string[] = [];
  page.on("request", (r) => {
    wire.push({ url: r.url(), body: r.postData() ?? "" });
    const host = new URL(r.url()).hostname;
    if (host.endsWith("googleapis.com") || host.endsWith("firebaseio.com")) external.push(`${host}${new URL(r.url()).pathname}`);
  });
  page.on("websocket", (ws) => {
    ws.on("framesent", (f) => sockets.push(typeof f.payload === "string" ? f.payload : f.payload.toString("utf8")));
  });
  return { wire, sockets, external };
}

test("検査そのものが働く: 緯度経度のキーも小数の組も、符号化されていても見つける", () => {
  const enc = (o: unknown) => `req0___data__=${encodeURIComponent(JSON.stringify(o))}`;
  expect(leaks([{ url: "https://x.test/a", body: enc({ lat: 35.0693, lng: 134.0041 }) }]).length).toBeGreaterThan(0);
  expect(leaks([{ url: "https://x.test/a", body: enc({ fields: { latitude: { doubleValue: 35.1 } } }) }]).length).toBeGreaterThan(0);
  expect(leaks([{ url: "https://x.test/a?lat=35.1", body: "" }]).length).toBeGreaterThan(0);
  expect(leaks([{ url: "https://x.test/a?q=35.06931%2C134.00412", body: "" }]).length).toBeGreaterThan(0);
  expect(leaks([{ url: "https://x.test/a", body: '{"longitude" : 134.0}' }]).length).toBeGreaterThan(0);
  // 複合のキー名と Firestore の値の形（緯度と経度が隣り合わない）も拾う
  expect(leaks([{ url: "https://x.test/a", body: enc({ fields: { centerLat: { doubleValue: 35.0693 }, centerLng: { doubleValue: 134.004 } } }) }]).length).toBeGreaterThan(0);
  // 当たってはいけないもの: meshCode と整数の座標（地図のタイル番号）
  expect(leaks([{ url: "https://tile.test/xyz/std/11/1795/811.png", body: enc({ fields: { meshCode: { stringValue: "51334557" } } }) }])).toEqual([]);
});

// ── 公開の画面 ──

const WATCH_OK = Array.from({ length: 47 }, (_, i) => ({
  prefCode: String(i + 1).padStart(2, "0"),
  checkedAt: "2026-11-10T08:30:00+09:00",
  ok: true,
  lastOkAt: "2026-11-10T08:30:00+09:00",
  failingSince: null,
}));
/** 津山市（33203）で今季、確定 */
const TSUYAMA_CASE: Case = {
  id: "e2e-1",
  season: 2026,
  nationalNo: null,
  prefNo: null,
  prefCode: "33",
  muniCode: "33203",
  muniName: "津山市",
  birdUse: null,
  housing: null,
  headCount: 1000,
  stages: { confirmed: { date: "2026-11-02", time: null } },
  radiiKm: [],
  prefEstimates: { shipment: null, movement: null, surveillance: null },
  negation: "none",
  negatedAt: null,
  confirmState: "auto",
  sourceUrls: [],
  updatedAt: "2026-11-02T12:00:00+09:00",
};
/** 津山駅の近く（津山市の中）。公開されている駅の位置で、農場の位置ではない */
const TSUYAMA_STATION: [number, number] = [134.004, 35.069];

type MapHandle = {
  getStyle(): { sources: Record<string, unknown> };
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  getCenter(): { lng: number; lat: number };
  isMoving(): boolean;
};
type W = { __hpaiMap?: MapHandle };

test("公開: 町と地点を指定しても、全要求に緯度経度がなく、端末の中は 3 つのキーだけ。Google への通信が 0 件", async ({ page }) => {
  const { wire, sockets, external } = recordWire(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  await installFixture(page, { now: "2026-11-10T09:00:00+09:00", cases: [TSUYAMA_CASE], wildBirds: [], watch: WATCH_OK });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as W).__hpaiMap, undefined, { timeout: 20_000 });

  // 町を選ぶ
  await page.getByRole("button", { name: "地域を選択", exact: true }).click();
  await page.getByLabel("都道府県").selectOption("33");
  await page.getByLabel("市町村").selectOption("33203");
  await page.getByRole("button", { name: "この地域にする" }).click();

  // 地点を指定する。十字を津山駅の近くへ合わせ（動きが終わるまで寄せ直す）、決める
  await page.getByRole("button", { name: "地図で場所を合わせる" }).click();
  await expect(page.locator(".crosshair")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async ([lng, lat]) => {
          const m = (window as unknown as W).__hpaiMap!;
          m.jumpTo({ center: [lng!, lat!], zoom: 11 });
          await new Promise((r) => setTimeout(r, 400));
          const c = m.getCenter();
          return !m.isMoving() && Math.abs(c.lng - lng!) < 0.001 && Math.abs(c.lat - lat!) < 0.001;
        }, TSUYAMA_STATION),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "ここに決める" }).click();
  await page.getByRole("button", { name: "決める", exact: true }).click();
  await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();
  // 距離の輪と約 60km の札が地点から作られた後でも、通信に緯度経度を出さない（下で調べる）
  await expect(page.getByText("輪は距離の目安で、発表の区域ではありません。")).toBeVisible();
  await expect(page.locator(".stat", { hasText: "約 60 km 以内" })).toContainText(/今季 \d+ 件/);

  // 端末の中には、3 つのキーだけ（hpai.spot.v1）
  const saved = await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"));
  expect(saved).not.toBeNull();
  expect(Object.keys(JSON.parse(saved!) as object).sort()).toEqual(["frequentMuniCodes", "meshCode", "muniCode"]);
  // 端末の中のほかの場所にも緯度経度がない
  const stores = await page.evaluate(() => [...Object.entries(window.localStorage), ...Object.entries(window.sessionStorage)].flat().concat(document.cookie).join("\n"));
  expect(stores).not.toMatch(LATLNG_KEY);
  expect(stores).not.toMatch(LATLNG_PAIR);

  // 指定の前後の全要求と、WebSocket の送信に、緯度経度がない
  expect(wire.length).toBeGreaterThan(5);
  expect(leaks(wire)).toEqual([]);
  expect(leaks(sockets.map((s) => ({ url: "ws://frame", body: s })))).toEqual([]);
  // Google（Firestore、Auth を含む）への通信がない。公開の画面は Firebase を読み込まない
  expect(external).toEqual([]);

  // 再読み込みでも通信に緯度経度が出ず、保存した値は変わらない
  const before = wire.length;
  await page.reload();
  await expect(page.getByText("区域に入っている可能性があります。県の連絡を確かめてください")).toBeVisible();
  expect(wire.length).toBeGreaterThan(before);
  expect(leaks(wire)).toEqual([]);
  expect(await page.evaluate(() => window.localStorage.getItem("hpai.spot.v1"))).toBe(saved);
});

// ── 会員の画面 ──

type PickerHandle = {
  project(lngLat: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
};
type PW = { __hpaiPicker?: PickerHandle };

test("会員: 招待で入り、町を選び、地図を押して保存すると、通信に meshCode があり、緯度経度はない。保存の後に『最終保存』が出る", async ({ browser }) => {
  const email = "no-exact-location@example.test";
  const code = await seedInvite();

  // 文脈 A: ログインのリンクを送る
  const a = await browser.newContext();
  try {
    const pageA = await a.newPage();
    await pageA.goto(`/join/${code}?emulator=1`);
    await pageA.getByLabel("メールアドレス").fill(email);
    await pageA.getByRole("button", { name: "ログインのリンクを送る" }).click();
    await expect(pageA.getByText(/メールを送りました/)).toBeVisible();
  } finally {
    await a.close();
  }
  const link = await latestSignInLink(email);

  // 文脈 B: リンクを開いて会員になる
  const b = await browser.newContext({ viewport: { width: 390, height: 900 } });
  try {
    await b.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
    );
    const page = await b.newPage();
    const { wire, sockets } = recordWire(page);

    await page.goto(link);
    await page.getByLabel("ログインに使うメールアドレス").fill(email);
    await page.getByRole("button", { name: "つづける" }).click();
    await expect(page).toHaveURL(/\/settings\/farm/);
    await expect(page.getByRole("heading", { name: "農場の設定" })).toBeVisible();

    // 町を選び、地図を押す
    await expect(page.getByRole("region", { name: "農場の地点を選ぶ地図" })).toBeVisible();
    await page.getByLabel("都道府県").selectOption("33");
    await page.getByLabel("市町村").selectOption("33203");
    await expect(page.getByRole("status").filter({ hasText: /地図で、農場のあたりをおしてください/ })).toBeVisible();
    const index = (await (await page.request.get("/geo/muni-index.json")).json()) as Record<string, { center: [number, number] }>;
    const [lng, lat] = index["33203"]!.center;
    await page.waitForFunction(() => !!(window as unknown as PW).__hpaiPicker);
    const at = await page.evaluate(([x, y]) => {
      const m = (window as unknown as PW).__hpaiPicker!;
      const p = m.project([x!, y!]);
      const r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, [lng, lat]);
    const before = wire.length;
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole("status").filter({ hasText: /地点を選びました/ })).toBeVisible();

    // 保存。『最終保存』（Farm.updatedAt）が出る
    await page.getByRole("button", { name: "地点を保存" }).click();
    await expect(page.getByText(/最終保存/)).toBeVisible();

    // 保存の通信に meshCode（8 桁）があり、緯度経度のキーも小数の組もない
    expect(wire.length).toBeGreaterThan(before);
    const sent = wire.flatMap((r) => decoded(r.body)).concat(sockets.flatMap((s) => decoded(s)));
    expect(sent.some((s) => /meshCode/.test(s) && /\d{8}/.test(s)), "保存の通信に meshCode がある").toBe(true);
    expect(leaks(wire)).toEqual([]);
    expect(leaks(sockets.map((s) => ({ url: "ws://frame", body: s })))).toEqual([]);

    // 端末の中にも緯度経度がない
    const stores = await page.evaluate(() => [...Object.entries(window.localStorage), ...Object.entries(window.sessionStorage)].flat().concat(document.cookie).join("\n"));
    expect(stores).not.toMatch(LATLNG_KEY);
    expect(stores).not.toMatch(LATLNG_PAIR);
  } finally {
    await b.close();
  }
});
