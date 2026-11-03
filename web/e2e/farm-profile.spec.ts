import { expect, test, type Page } from "@playwright/test";
import { latestSignInLink, seedInvite } from "./helpers/seedInvite";

// 農場の設定（農場名、採卵か肉用か、飼い方、行き来する町、鶏舎、家保の連絡先）を保存し、再読み込みで残り、
// 登録した町の発生が『登録した町で発生しました』として出ることを確かめる通し（M-05）。M-01 の member-join と同じ形。
// 模擬環境（Auth、Firestore、Functions）が動いていること。実行の例（リポジトリの根から）:
//   npm run build && firebase emulators:exec --only auth,firestore,functions --project demo-hpai \
//     "cd web && browser-guard run -- npx playwright test farm-profile"
// 農場は津山市（33203）、行き来する町は札幌市（01100。隣り合わず、10km より遠い）。
// 連絡先の文字は見本の語だけ。実在の連絡先は書かない。

const EMAIL = "farm-profile@example.test";
const EMULATOR = process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080";

type PickerHandle = {
  project(lngLat: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
};
// member-join.spec.ts が Window.__hpaiPicker を宣言しているので、ここでは型の別名で受ける（宣言を重ねない）
type W = { __hpaiPicker?: PickerHandle };

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

type FieldValue =
  | { stringValue: string }
  | { integerValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FieldValue[] } }
  | { mapValue: { fields: Record<string, FieldValue> } };
function toValue(v: unknown): FieldValue {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toValue(x)])) } };
}

/** 日本時間の今日（YYYY-MM-DD）と、今のシーズン（6 月 1 日から翌年 5 月 31 日まで） */
function jstToday(): { date: string; season: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const season = jst.getUTCMonth() + 1 >= 6 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
  return { date: jst.toISOString().slice(0, 10), season };
}

async function joinAsMember(page: Page, link: string) {
  await page.goto(link);
  await page.getByLabel("ログインに使うメールアドレス").fill(EMAIL);
  await page.getByRole("button", { name: "つづける" }).click();
  await expect(page).toHaveURL(/\/settings\/farm/);
  await expect(page.getByRole("heading", { name: "農場の設定", level: 1 })).toBeVisible();
}

/** 見出しで探した欄。各欄の『保存しました』は、その欄の中だけで待つ（ほかの欄の表示と重ならない） */
const sectionOf = (page: Page, heading: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

async function pickTown(page: Page, prefCode: string, muniCode: string) {
  await page.getByLabel("都道府県", { exact: true }).selectOption(prefCode);
  await page.getByLabel("市町村", { exact: true }).selectOption(muniCode);
  await expect(page.getByRole("status").filter({ hasText: /地図で、農場のあたりをおしてください/ })).toBeVisible();
  const res = await page.request.get("/geo/muni-index.json");
  const index = (await res.json()) as Record<string, { center: [number, number] }>;
  const [lng, lat] = index[muniCode]!.center;
  await page.waitForFunction(() => !!(window as unknown as W).__hpaiPicker);
  const at = await page.evaluate(
    ([x, y]) => {
      const m = (window as unknown as W).__hpaiPicker!;
      const p = m.project([x!, y!]);
      const r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [lng, lat],
  );
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole("status").filter({ hasText: /地点を選びました/ })).toBeVisible();
  return { lat, lng };
}

test("農場の設定を保存し、再読み込みで残り、登録した町の発生が出る", async ({ browser, request }) => {
  const code = await seedInvite();

  // 文脈 A でリンクを送り、storage が空の文脈 B で開く（M-01 と同じ）
  const a = await browser.newContext();
  const pageA = await a.newPage();
  await pageA.goto(`/join/${code}?emulator=1`);
  await pageA.getByLabel("メールアドレス").fill(EMAIL);
  await pageA.getByRole("button", { name: "ログインのリンクを送る" }).click();
  await expect(pageA.getByText(/メールを送りました/)).toBeVisible();
  const link = await latestSignInLink(EMAIL);
  await a.close();

  const b = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await b.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  const page = await b.newPage();
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.postData()) sent.push(r.postData() ?? "");
  });
  await joinAsMember(page, link);

  // 農場がないあいだは地点の欄だけ
  await expect(page.getByLabel("農場名", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "鶏舎を足す" })).toHaveCount(0);

  // 地点を津山市の center に置いて保存する
  const spot = await pickTown(page, "33", "33203");
  await page.getByRole("button", { name: "地点を保存" }).click();
  await expect(page.getByText(/最終保存/)).toBeVisible();

  // 農場名、採卵、開放的
  await page.getByLabel("農場名", { exact: true }).fill("テスト農場");
  await page.getByLabel("採卵", { exact: true }).check();
  await page.getByLabel("開放的な鶏舎", { exact: true }).check();
  await page.getByRole("button", { name: "農場の情報を保存" }).click();
  await expect(sectionOf(page, "農場の情報").getByRole("status")).toHaveText("保存しました");

  // 行き来する町 札幌市
  await page.getByLabel("足す町の県", { exact: true }).selectOption("01");
  await page.getByLabel("足す町", { exact: true }).selectOption("01100");
  await page.getByRole("button", { name: "この町を足す" }).click();
  await page.getByRole("button", { name: "行き来する町を保存" }).click();
  await expect(sectionOf(page, "行き来する町").getByRole("status")).toHaveText("保存しました");

  // 鶏舎を 2 つ
  const addHouse = async (name: string, bird: string, flock: string) => {
    await page.getByRole("button", { name: "鶏舎を足す" }).click();
    await page.getByLabel("鶏舎の名前", { exact: true }).fill(name);
    await page.getByLabel("鳥の種類", { exact: true }).selectOption(bird);
    await page.getByLabel("飼養羽数", { exact: true }).fill(flock);
    await page.getByRole("button", { name: "鶏舎を保存" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  };
  await addHouse("1 号舎", "採卵鶏", "1200");
  await addHouse("2 号舎", "採卵鶏", "800");

  // 家保の連絡先（見本の語だけ）
  await page.getByLabel("家畜保健衛生所の連絡先", { exact: true }).fill("テスト用の連絡先");
  await page.getByRole("button", { name: "家保の連絡先を保存" }).click();
  await expect(sectionOf(page, "家畜保健衛生所の連絡先").getByRole("status")).toHaveText("保存しました");

  // 再読み込みで残る（各欄の保存が終わってから読み直す）
  await page.reload();
  await expect(page.getByLabel("農場名", { exact: true })).toHaveValue("テスト農場");
  await expect(page.getByLabel("採卵", { exact: true })).toBeChecked();
  await expect(page.getByLabel("開放的な鶏舎", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "札幌市を外す" })).toBeVisible();
  await expect(page.getByText("1 号舎", { exact: true })).toBeVisible();
  await expect(page.getByText("1200 羽")).toBeVisible();
  await expect(page.getByText("2 号舎", { exact: true })).toBeVisible();
  await expect(page.getByText("800 羽")).toBeVisible();
  await expect(page.getByLabel("家畜保健衛生所の連絡先", { exact: true })).toHaveValue("テスト用の連絡先");
  await expect(page.getByText(/最終保存/)).toBeVisible();

  // 鶏舎の羽数を直しても、同じ鶏舎のまま（2 つのまま）
  await page.getByRole("button", { name: "2 号舎を編集" }).click();
  await page.getByLabel("飼養羽数", { exact: true }).fill("700");
  await page.getByRole("button", { name: "鶏舎を保存" }).click();
  await expect(page.getByText("700 羽")).toBeVisible();
  await expect(page.getByRole("button", { name: /を編集$/ })).toHaveCount(2);

  // 緯度経度をサーバーへ送っていない
  const wire = sent.join("\n");
  expect(wire).not.toContain(String(spot.lat).slice(0, 7));
  expect(wire).not.toContain(String(spot.lng).slice(0, 8));

  // 札幌市の事例を模擬環境に入れると、『/』に登録した町の 1 文が出て、隣町とは言わない
  const { date, season } = jstToday();
  const doc = {
    season,
    nationalNo: null,
    prefNo: null,
    prefCode: "01",
    muniCode: "01100",
    muniName: "札幌市",
    birdUse: null,
    housing: null,
    headCount: 1000,
    stages: { confirmed: { date, time: null } },
    radiiKm: [],
    prefEstimates: { shipment: null, movement: null, surveillance: null },
    negation: "none",
    negatedAt: null,
    confirmState: "auto",
    sourceUrls: [],
    updatedAt: `${date}T12:00:00+09:00`,
  };
  // Authorization: Bearer owner は模擬環境の管理者（ルールを通らない）
  const res = await request.patch(`http://${EMULATOR}/v1/projects/demo-hpai/databases/(default)/documents/cases/m05-sapporo`, {
    headers: { Authorization: "Bearer owner" },
    data: { fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, toValue(v)])) },
  });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto("/?emulator=1");
  await expect(page.getByText("登録した町で発生しました")).toBeVisible({ timeout: 30_000 });
  // 過去の一覧の『（隣町）』ではなく、段階の文（②）が出ていないことを見る
  await expect(page.getByText("隣町で発生しました")).toHaveCount(0);
  await b.close();
});
