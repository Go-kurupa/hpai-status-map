import { expect, test } from "@playwright/test";
import { latestSignInLink, seedInvite } from "./helpers/seedInvite";

// 招待で会員になり、農場の地点を保存する通し（M-01）。
// 模擬環境（Auth、Firestore、Functions）が動いていること。実行の例（リポジトリの根から）:
//   npm run build && firebase emulators:exec --only auth,firestore,functions --project demo-hpai \
//     "cd web && browser-guard run -- npx playwright test member-join"
// 初回は、functions/.secret.local と functions/.env.demo-hpai があり、値を聞かれずに起動することを確かめる（契約 4.1）。
// 文脈 A でリンクを送り、そのリンクを storage が空の別の文脈 B で開く（別の端末でメールを開く場面）。

const EMAIL = "member-join@example.test";

type PickerHandle = {
  project(lngLat: [number, number]): { x: number; y: number };
  unproject(point: [number, number]): { lng: number; lat: number };
  getCanvas(): HTMLCanvasElement;
};
declare global {
  interface Window {
    __hpaiPicker?: PickerHandle;
  }
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("招待リンクを別の文脈で開き、会員になって、地点を保存し、再読み込みで残る", async ({ browser }) => {
  const code = await seedInvite();

  // 文脈 A: リンクを送る
  const a = await browser.newContext();
  const pageA = await a.newPage();
  await pageA.goto(`/join/${code}?emulator=1`);
  await pageA.getByLabel("メールアドレス").fill(EMAIL);
  await pageA.getByRole("button", { name: "ログインのリンクを送る" }).click();
  await expect(pageA.getByText(/メールを送りました/)).toBeVisible();
  const link = await latestSignInLink(EMAIL);
  await a.close();

  // 文脈 B: storage が空。リンクを開くとメールを聞かれ、招待が保たれて会員になる
  const b = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await b.route("https://cyberjapandata.gsi.go.jp/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1PX }),
  );
  const page = await b.newPage();
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.postData()) sent.push(r.postData() ?? "");
  });

  await page.goto(link);
  await page.getByLabel("ログインに使うメールアドレス").fill(EMAIL);
  await page.getByRole("button", { name: "つづける" }).click();
  await expect(page).toHaveURL(/\/settings\/farm/);
  await expect(page.getByRole("heading", { name: "農場の設定" })).toBeVisible();

  // 地図が出て（Worker の読み込みに失敗しない）、地点を選べる
  await expect(page.getByRole("region", { name: "農場の地点を選ぶ地図" })).toBeVisible();
  await page.getByLabel("都道府県").selectOption("33");
  await page.getByLabel("市町村").selectOption("33203");
  await expect(page.getByRole("status").filter({ hasText: /地図で、農場のあたりをおしてください/ })).toBeVisible();

  const res = await page.request.get("/geo/muni-index.json");
  const index = (await res.json()) as Record<string, { center: [number, number] }>;
  const [lng, lat] = index["33203"]!.center;
  await page.waitForFunction(() => !!window.__hpaiPicker);
  const at = await page.evaluate(([x, y]) => {
    const m = window.__hpaiPicker!;
    const p = m.project([x!, y!]);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lng, lat]);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole("status").filter({ hasText: /地点を選びました/ })).toBeVisible();

  await page.getByRole("button", { name: "地点を保存" }).click();
  await expect(page.getByText(/最終保存/)).toBeVisible();

  // 再読み込みで残る（根の Provider が本物の Firestore につながっている）
  await page.reload();
  await expect(page.getByText(/最終保存/)).toBeVisible();
  await expect(page.getByLabel("市町村")).toHaveValue("33203");
  await expect(page.getByText(/登録した地点:/)).toBeVisible();

  // 緯度経度をサーバーへ送っていない
  const wire = sent.join("\n");
  expect(wire).not.toContain(String(lat).slice(0, 7));
  expect(wire).not.toContain(String(lng).slice(0, 8));

  expect(problems.filter((p) => /Worker failed to load/i.test(p))).toEqual([]);
  await b.close();
});
