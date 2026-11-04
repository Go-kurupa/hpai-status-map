# 領域 M: 会員、記録、通知 の実装計画

正は設計書（`§`）と共通の取り決め（`契約`）。契約の型と名前は写さない。契約 6.5 で M へ移した宣言だけを各 Interfaces に置く（`types.ts` に入れず、そのファイルから export する）。

**試験**: `T <project> <file>` は `npx vitest run --passWithNoTests=false --project <project> <file>`。`EMUL <file>` は `npx firebase emulators:exec --only firestore,auth,storage --project demo-hpai "npx vitest run --passWithNoTests=false --project functions-emul <file>"`。`RULES` は同じ形で `--only firestore,auth`、`--project rules`。E2E は `npm run bundle -w functions` の後に `npx firebase emulators:exec --only firestore,auth,functions --project demo-hpai "cd web && browser-guard run -- npx playwright test <file>"`（先に契約 4.1 の模擬環境のファイル。busy なら再試行せず待つ）。各タスクの「失敗を確かめる」と「通ることを確かめる」は、Test の全ファイルをそれぞれの形で実行する。Commit は Files の全部を `git add` する。

**試験の部品**（M-01 の `shared/test/helpers/mFixtures.ts`）: 緯度はすべて 35.0〜35.1 の矩形。

| 名前 | コード | 県 | 経度 | 隣 |
|---|---|---|---|---|
| A | 33203 | 33 | 134.00〜134.10 | B |
| B | 33214 | 33 | 134.10〜134.40 | A |
| C | 33606 | 33 | 135.00〜135.10 | なし |
| D | 01100 | 01 | 141.00〜141.10 | なし |

- メッシュ: `IN_A` (35.05, 134.05)、`NEAR_B` (35.05, 134.19。A から約 8km)、`FAR_B` (35.05, 134.38。約 25km)、`IN_D` (35.05, 141.05)。
- `fakeGeo(over?)`: `ensurePrefs` の前の `geometry` は `GeoNotLoadedError`（契約 3.2）。`over` で矩形を差し替える。
- `makeCase` の既定: `id:"33203-2025-12-19-1"`、`season:2025`、A、`muniName:"津山市"`、`stages:{}`、`radiiKm:[]`、`negation:"none"`、`confirmState:"auto"`、`sourceUrls:["https://example.test/press"]`。`makeFarm` の既定: `id:"f1"`、`memberUids:["u1"]`、`meshCode:IN_A`、A、`notify` は全部 true で `selfCheckRemindDays:3`、`selfCheckDue:{}`。

M-07 と基準の知らせは深い機能なので落とさない。

---

### Task M-07: 死亡率

読む節: 2.3、3.1、索引 Q1、Q2、M-07 Interfaces

**Day:** 11/6 / **Depends on:** F-01 / **Human:** 家保への電話（索引の人の作業）で索引 Q1 の読み方と現行の告示を確かめる。既定で進め、回答が違えば Step 1 の括弧の値、`validDays`、`needed` を直し、`docs/standards-check.md` に足す

**Files:** Create `shared/src/mortality.ts`、`docs/standards-check.md`。Test `shared/test/mortality.test.ts`

**Interfaces:**

```ts
// shared/src/mortality.ts — §8。Claude を使わない
interface MortalityDay { date: IsoDate; deaths: number; flockSize: number; exclusion: ExclusionKind | null }
type MortalityResult =
  | { status: "insufficient"; validDays: number; needed: 21 }
  | { status: "today_excluded"; kind: ExclusionKind }
  | { status: "no_record" }
  | { status: "invalid_input"; dates: IsoDate[] } // NaN、負の数、小数、羽数を超える値の日
  | { status: "evaluated"; todayRate: number; averageRate: number; hit: boolean; windowDates: IsoDate[]; skippedMissingDates: IsoDate[] };
function computeMortality(days: readonly MortalityDay[], today: IsoDate): MortalityResult;
function toMortalityDays(records: readonly DeathRecord[]): MortalityDay[]; // flockSizeAt と除外の種類を写し日付順
const MORTALITY_TEXT; // insufficient、invalidInput、hit、symptoms、exceptions、definition、reading。値は Step 3
```

- [ ] **Step 1: 失敗する試験を書く**（当日 `2026-01-31`、1000 羽。「過去 p、当日 q」は 21 日分）
  - 記録なし → `no_record`。当日が除外 → `today_excluded`。20 日分 → `{insufficient,validDays:20,needed:21}`。21 日で `evaluated`。
  - 22 日分で 5 日前を `equipment`、死亡 500 → 窓に 5 日前がなく最後が `addDays(TODAY,-21)`、平均に入らない。`empty` も同じ。羽数 0 の日も飛ばす。記録のない日は `skippedMissingDates`（索引 Q2）。
  - 過去 0、当日 1 → 当たる（どの読みでも）。過去 0、当日 0 → 当たらない。過去 1、当日 10 → 当たる。過去 10、当日 11 → 当たらない。
  - 索引 Q1、当日を含める（括弧は含めないときの値）: 過去 19、当日 40 → 当たる、平均 0.02（過去 10、当日 20）。過去 19、当日 39 → 当たらない（過去 10、当日 19）。過去 1、当日 2 → 当たらない（含めないなら当たる）。
  - 索引 Q1、日別の率の平均: 1000 羽 10 羽が 10 日、500 羽 10 羽が 10 日、当日 500 羽 15 羽 → 当たらない（合計÷羽数日なら 0.01387 で当たる）。当日を含めないときは 1000 羽 10 羽が 10 日、500 羽 10 羽が 11 日、当日 500 羽 14 羽で同じ分かれ方。
  - **入力の誤り**: 窓の中か当日に、死亡数が NaN、負の数、小数、羽数を超える日があれば `{status:"invalid_input",dates}` で `evaluated` にしない（黙って当たらない扱いにしない）。
  - 全文に禁止語がない。`symptoms` に「特定症状」がない（告示でなく防疫指針の記述のため）。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装** 当日から降順に有効な日を 21 日集め、入力の誤りがあれば先に返す。`validDays` は当日を含む。判定は `today.deaths > 0 && todayRate >= 2 * averageRate - 1e-12`。
  - `insufficient`: `まだ計算できません`
  - `invalidInput`: `入力を確かめてください`
  - `hit`: `設備の故障など明らかな理由がなければ、直ちに家保へ通報してください（基準 項目 32）`
  - `symptoms`: `5 羽以上のまとまった死亡やうずくまり、鶏冠や肉垂のチアノーゼ、沈うつ、産卵率の低下など、数字に出ない症状も確かめてください`
  - `exceptions`: `指針の留意事項 16 は、明らかに別の事情の例として、概ね 100 羽未満で平均 0 羽のときに 1 羽が死亡して症状がない場合、ひなの死亡、誘導換羽を挙げています。この場合も、翌日に基準に当たれば届け出るよう指導するとされています。この画面は例に当たるかを判定しません`
  - `definition`: `告示の定義: 同じ鶏舎で、1 日の死亡率が対象期間の平均の 2 倍以上。対象期間は当日から遡って 21 日間で、特段の事情の日と空舎の日を除いた通算 21 日間です`
  - `reading`: `この計算は当日を平均に含め、日ごとの率を平均しています。読み方に迷うときは家保へ確かめてください`
  - `docs/standards-check.md`: 基準は e-Gov の施行 2026-10-01 の版で確かめた番号、2025-10-01 の振り直し。告示（平成 23 年農林水産省告示第 1865 号）は国の PDF の改正履歴の最終が令和 4 年 3 月 17 日、家きんの欄にエミューがなく、現行か未確認。
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: Commit** `feat(shared): 告示の定義で死亡率 2 倍を計算する`

---

### Task M-01: ログイン、招待、農場と知らせの設定

読む節: 2.3、3.10、4.1、4.2、5、8、索引の人の作業 3、F-02 Interfaces

**Day:** 11/6 / **Depends on:** F-02、F-05、W-02 / **Human:** 人の作業 3 で「メール/パスワードのプロバイダ」と「メールリンクの方式」、Google のプロバイダを有効にし、許可するドメインに本番の Hosting を足す

**Files:** Create `functions/src/farm/{inviteCode,redeemInvite,createFarmInvite}.ts`、`web/src/pages/auth/{RequireMember.tsx,useAuthUser.ts,emailLink.ts}`、`web/src/pages/settings/{MeshPicker.tsx,farmForm.ts}`、`shared/src/jaDate.ts`、`shared/test/helpers/mFixtures.ts`、`web/e2e/helpers/seedInvite.ts`（M-05、X-23 も使う）。Modify `functions/src/farm/index.ts`、`web/src/pages/auth/{firestoreRecordStore.ts,LoginPage.tsx,JoinPage.tsx}`、`web/src/pages/settings/{FarmSettingsPage,NotifySettingsPage}.tsx`。Test `functions/test/emul/farm-invites.test.ts`、`firestore-tests/record-store.test.ts`、`shared/test/ja-date.test.ts`、`web/src/pages/auth/auth.test.tsx`、`web/src/pages/settings/settings.test.tsx`、`web/e2e/member-join.spec.ts`

**Interfaces:**
- Consumes: `Invite`、`create-invite`（F-02）、`getFirebase`（W-01）、`web/src/geo/maplibre.ts`、`MAP_ATTRIBUTION`（W-02）
- Produces: `redeemInvite`（`{code}` → `{farmId: string | null}`、60s / 256MiB）、`createFarmInvite`（`{farmId}` → `{code, url}`）、`RequireMember`、`useAuthUser()`（`{user, member, loading}`）、`hashInviteCode(code)`、`handleRedeemInvite(deps, uid, code)`、`createFirestoreRecordStore()` と `createFirestoreRecordStoreWith(db, uid)`（契約 3.10）

```ts
function formatJaDate(d: IsoDate): string; // shared/src/jaDate.ts。"12月19日"。M-02、M-13、M-18 が使う
// web/src/pages/settings/farmForm.ts
function pickToFarmPatch(pick: { lat: number; lng: number }, muni: MuniEntry): Pick<Farm, "meshCode" | "muniCode" | "prefCode">;
function seasonMonths(season: Season): string[];
// web/src/pages/auth/emailLink.ts
function sendInviteLink(auth: Auth, email: string, code: string | null): Promise<void>; // url は /join/:code、なければ /login。location.search を保つ
function completeEmailLink(auth: Auth, href: string, askEmail: () => Promise<string>): Promise<User | null>; // isSignInWithEmailLink を確かめ、localStorage の hpai.emailForSignIn が空なら askEmail
function signInWithGoogle(auth: Auth): Promise<User>; // signInWithPopup と GoogleAuthProvider
function afterSignIn(user: User, code: string | null, redeem: (code: string) => Promise<unknown>): Promise<void>; // code があれば redeem、次に getIdToken(true)。メールのリンクと Google で共用
```

- [ ] **Step 1: 失敗する試験を書く**
  - 部品: `fakeGeo().geometry(A)` は `GeoNotLoadedError`。`ensurePrefs(["33"])` の後は読め、`geometry(D)` はまだ投げる。
  - 招待: 正しいコードで既存の claim を保って `member` が付く／平文を保存しない／`create-invite` のコードが通る／回数の上限と期限切れは `failed-precondition`／同じ人の 2 回目は成功し 1 回に数える／農場の招待は `memberUids` に足す、農場がなければ `not-found`／存在しないコードは `invites/_attempts/uids/{uid}` に数える／1 時間に 10 回失敗で正しいコードも `resource-exhausted`、1 時間後に戻る（契約 8）／未ログインは `unauthenticated`。
  - `createFarmInvite`: 会員だけ／7 日で切れ 1 回だけの `kind:"farm"` を指紋で保存し、平文は返り値だけ／`url` は `${APP_URL}/join/${code}`。
  - store: 引数なしの生成で Firebase を読まず、未ログインの `getFarm` は null／新規の農場は `memberUids:[uid]`、`unsubscribedUids:[]`、`name:""`、`production:null`、`housing:null`、`frequentMuniCodes:[]`、`kahoContact:""`、`selfCheckDue:{}` で実際のルールを通る（残りは M-05）／`saveFarm` は `updatedAt` を入れる／`listHouses` と `saveHouse` が読み書きできる／`isMailStopped` は自分の uid だけを見る／`getCaseDraft` は未ログインなら Firestore を呼ばず null、claim がなければ `permission-denied` を null に変え、`member` は読める／ID は `{date}_{houseId}`、`dis_{date}_{itemId}`、`self_{month}`／中身に `uid`、`createdBy`、`lat`、`lng` がない／claim のない利用者（API でパスワード登録した人を含む）は農場を作れない。
  - 認証の画面: `/login` の説明の文に `確認日`（文面を確かめた日。§15）／`sendInviteLink` の `url` に招待コードが入る／`sessionStorage` を使わない／`localStorage` が空ならメールを聞き直してから `signInWithEmailLink`／`redeemInvite`、`getIdToken(true)`、`/settings/farm` の順／失敗の文は `このコードは使えません` だけ／`RequireMember` は sample で素通し、未ログインは `/login`、claim がなければ招待コードの入力欄。
  - Google（`signInWithPopup` は mock）: `/login`、`/join/:code` に `Google で入る` のボタン／`/join/:code` は `signInWithPopup`、`redeemInvite`、`getIdToken(true)`、`/settings/farm` の順／`/login` は `redeemInvite` を呼ばず、claim がなければ招待コードの入力欄へ進む／ポップアップの失敗（`auth/popup-blocked` など）は例外にせず、`redeemInvite` を呼ばず `メールのリンクで入ってください` を出す。
  - 農場なしの会員: `getFarm` が null なら `/settings/notify` は保存を出さず `/settings/farm` へ案内する（ルールが `meshCode` を要るため）。
  - 設定の画面: 保存の後に `最終保存`（`Farm.updatedAt`。§15）／地図の欄に `MAP_ATTRIBUTION` の 3 つの出典（`/地理院タイル/`、`/Vector Map Level 0/`、`/国土数値情報/`。§15）／`pickToFarmPatch({lat:35.681,lng:139.767}, 13101 の千代田区)` は `{meshCode:"53394611",muniCode:"13101",prefCode:"13"}`／`seasonMonths(2026)` は `2026-10`〜`2027-05`／`formatJaDate("2025-12-19")` は `12月19日`／住所の欄がない／点を描かず `約 1km のマス目で保存します`／地点を選ぶまで保存できない（ルールが `meshCode` を要る）／期限は月ごとで既定の日を入れない／知らせの設定は `saveFarm` に `notify` だけ渡し、期限の知らせを切ると `selfCheckRemindDays:null`。
  - E2E（build の後）: 文脈 A で `/join/{code}?emulator=1` からリンクを送り、oobCodes の `oobLink` を**別の文脈 B（storage が空）**で開く → メールを聞かれ、招待が保たれて会員になる → `/settings/farm` で `Worker failed to load` なしに地図が出て地点を選べる → 保存して再読み込みしても残る（根の Provider が本物につながる）。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装**
  - 模擬環境の準備: 契約 4.1 の 2 つのファイルを置く。E2E の初回で、値を聞かれずに起動することを確かめる。
  - `usedBy` と `memberUids` は同じトランザクション。失敗の記録は `{failures, windowStart}`。招待は `randomBytes(16).toString("base64url")`【計】。新規の農場の `notify` は mFixtures の値【計】。
  - `LoginPage` の文: `メールのリンクか Google で入ります。パスワードはいりません`、`LINE の中で開くと Google が使えないことがあります。そのときはメールのリンクで入ってください`。`確認日` は定数 `LOGIN_TEXT_CHECKED_ON` に持つ。
  - `MeshPicker`: `dragRotate:false`。`MAP_ATTRIBUTION` を出す。座標は `pickToFarmPatch` に渡して捨て、state に残さない。`/settings/*` は `RequireMember` で包む。会員を足すのは `招待リンクを作る` のボタン 1 つ。下に `/privacy` へのリンク。
- [ ] **Step 4: 通ることを確かめる**、`npm run typecheck`
- [ ] **Step 5: Commit** `feat: 招待で会員になり、農場と知らせを設定できるようにする`

---

### Task M-05: 農場の設定、鶏舎

読む節: 2.3、3.10、4.1、4.2、M-01 Interfaces、W-02 Interfaces（`web/src/geo/loadGeo.ts`）

**Day:** 11/6 / **Depends on:** M-01

**Files:** Create `web/src/pages/settings/{FarmProfileForm,MuniMultiPicker,HouseList}.tsx`、`web/src/pages/settings/houseForm.ts`。Modify `web/src/pages/settings/FarmSettingsPage.tsx`。Test `web/src/pages/settings/farm-profile.test.tsx`、`web/src/pages/settings/house-form.test.ts`、`web/e2e/farm-profile.spec.ts`

**Interfaces:**
- Consumes: `RecordStore` の `getFarm`、`saveFarm`、`listHouses`、`saveHouse`、`GeoStore.index`、`seedInvite.ts`（M-01）
- Produces:

```ts
// web/src/pages/settings/houseForm.ts — §8
const BIRD_TYPES: readonly string[]; // 採卵鶏、肉用鶏、種鶏、あひる、うずら、その他【計】。報告文はこの語で集計する
function parseHouseInput(i: { name: string; birdType: string; flockSize: string; empty: boolean }): { ok: true; house: House } | { ok: false; errors: string[] };
```

- [ ] **Step 1: 失敗する試験を書く**
  - 農場の設定（§8）: 農場名、採卵か肉用か（`layer`、`broiler`）、飼い方（`windowless`、`open`、`free_range`）を `saveFarm` に渡す。渡すのはその項目だけ（`toEqual`）。未選択は null で保存でき、確認リストは両方を出す（§7）。
  - 行き来する市町村（§5 の③）: 県から市町村を選んで足す、外す／同じ町を 2 度足せない／農場の町を足せない／20 件まで【計】／保存は `frequentMuniCodes` だけで、値は `GeoStore.index` のコード（政令市は市のコード）／住所と緯度経度の欄がない。
  - 鶏舎（§8）: `parseHouseInput` は名前なし、鳥の種類なし、羽数の文字、負の数、小数を拒む。0 羽は空舎のときだけ通す。`saveHouse` に `{name,birdType,flockSize,empty}` だけ渡す（`toEqual`。入力者を持たない）／一覧に名前、鳥の種類、羽数、空舎が出て、編集で同じ id に保存する／空舎に切り替えられる／羽数を変えても `saveDeath` を呼ばない（過去の `flockSizeAt` を動かさない）／消すボタンがない（過去の記録があるので空舎にする）【計】。
  - 家保の連絡先（§8）: `saveFarm` に `{kahoContact}` だけ渡す（`toEqual`）／空でも保存できる／説明と入力の例に電話番号の形がない。
  - 農場がない間（地点の保存の前）は地点の欄だけを出し、他の欄で `saveFarm` を呼ばない。
  - 全文に禁止語がない。鶏舎の保存の後も `最終保存` が進む。
  - E2E（M-01 の形で build の後）: `seedInvite` で入り、地点を 33203 の center に置き、農場名、採卵、開放的、行き来 01100（隣でなく 11km より遠い町）、鶏舎 2 つ、家保の連絡先を保存する → 再読み込みで残る → 模擬環境の `cases` に 01100 の事例を入れると `/` に `登録した町で発生しました`（③）が出て `隣町` がない。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装** `FarmSettingsPage` の並びは 地点、農場名、採卵か肉用か、飼い方、行き来する町、鶏舎、家保の連絡先、招待。飼い方に `確かめておくとよいことの並びに使います`。家保の連絡先は自由記入の 1 欄で、例に実在の連絡先を書かない。鶏舎の保存の後に `saveFarm({})` で `updatedAt` を進める。部品は `MuniMultiPicker` だけ新しく作り、`TownPicker` は使わない（1 つを選ぶ部品のため）。
- [ ] **Step 4: 通ることを確かめる**、`npm run typecheck`
- [ ] **Step 5: Commit** `feat: 農場の設定と鶏舎を登録できるようにする`

---

### Task M-02: 通知の決定、文面、送信

読む節: 1.4、2.1、2.3、2.4、2.7、3.2、4.1、6.3、I-01（`describeFixture`）、I-02（`enqueueReview`）、I-04（`hasOutbreakWords`）Interfaces、M-02 Interfaces、索引 Q3

**Day:** 11/6 / **Depends on:** M-01、F-07、I-18

**Files:** Create `shared/src/notices.ts`、`functions/src/notify/{unsubscribeSig,dispatch,onCaseWritten}.ts`、`functions/test/emul/mHelpers.ts`。Modify `functions/src/notify/index.ts`。Test `shared/test/notices.test.ts`、`shared/test/notice-render.test.ts`、`functions/test/unsubscribe-sig.test.ts`、`functions/test/emul/notify-case.test.ts`

**Interfaces:**
- Consumes: `sendMail`（`functions/src/notify/send.ts`、I-18）、`enqueueReview`、`reviewAlertId`（I-02）、`hasOutbreakWords`（I-04）、`describeFixture`（I-01）、`relationToCase`、`loadGeoStore`、`GMAIL_APP_PASSWORD`、`UNSUBSCRIBE_SECRET`、`APP_URL`
- Produces:

```ts
// shared/src/notices.ts — §6
type NoticeEvent = "suspected" | "confirmed" | "reviewing" | "negated" | "shipment_lifted" | "movement_lifted"
  | "wild_bird_confirmed" | "self_check_due" | "mortality_hit";
type NoticeTiming = "immediate" | "morning";
interface SentNotice { // sentNotices/{noticeDocId(...)}。重複防止は会員単位
  farmId: string; uid: string; subjectId: string; // caseId、wildBirdId、"YYYY-MM"、deathRecordId
  event: NoticeEvent; timing: NoticeTiming; state: "queued" | "sent" | "failed"; queuedAt: IsoDateTime; sentAt: IsoDateTime | null;
}
interface Notice {
  farmId: string; uid: string; subjectId: string; event: NoticeEvent; timing: NoticeTiming;
  level: Level | null; relationKind: LevelReasonKind | null;
  facts: { muniName: string | null; prefCode: PrefCode | null; date: IsoDate | null; sourceUrl: string | null };
  isCorrection: boolean;
}
function farmPoint(f: Pick<Farm, "meshCode" | "muniCode" | "frequentMuniCodes">): FarmPoint;
function diffCaseEvents(before: Case | null, after: Case): NoticeEvent[];
function timingFor(event: NoticeEvent, relation: Level): NoticeTiming | null;
function planCaseNotices(i: { event: NoticeEvent; caseDoc: Case; farms: ReadonlyArray<Farm & { id: string }>; geo: GeoStore; alreadySent: readonly SentNotice[] }): Notice[];
function noticeDocId(farmId: string, uid: string, subjectId: string, event: NoticeEvent): string; // join("__")
function renderNotice(n: Notice, ctx: { unsubscribeUrl: string; appUrl: string }): { subject: string; text: string };
function renderMorningDigest(list: readonly Notice[], ctx: { unsubscribeUrl: string; appUrl: string }): { subject: string; text: string };
// functions/src/notify/
function signUnsubscribe(farmId: string, uid: string, secret: string): string; // HMAC-SHA256 の base64url
function verifyUnsubscribe(farmId: string, uid: string, sig: string, secret: string): boolean;
interface NotifyDeps { db: Firestore; mailer: typeof sendMail; emailOf(uid: string): Promise<string | null>; appUrl: string; unsubscribeSecret: string; now(): Date }
function dispatchNotices(deps: NotifyDeps, notices: readonly Notice[]): Promise<{ mailStopped: boolean }>;
function noteMailStop(deps: NotifyDeps): Promise<void>; // enqueueReview に reviewAlertId("mail_failing", JST の今日)。M-13 も使う
function isMailStopError(e: unknown): "auth" | "quota" | null; // EAUTH と 535 は auth。Gmail の上限の応答は quota（応答の形は未確認。M-13 の docs で確かめる）
function unsubscribeUrlFor(n: Pick<Notice, "farmId" | "uid">, deps: NotifyDeps): string; // ${appUrl}/unsubscribe?farm=&uid=&sig=
function handleCaseWrite(deps: NotifyDeps, before: Case | null, after: Case | null, geo: GeoStore): Promise<void>;
const onCaseWritten; // 300s / 512MiB、secrets: GMAIL_APP_PASSWORD、UNSUBSCRIBE_SECRET
```

- [ ] **Step 1: 失敗する試験を書く**
  - 宛先（f1 IN_A → ①、f2 FAR_B、B → ②、f3 IN_D、D、`frequent:[A]` → ③、f4 IN_D、D → ④）: 疑い、確定、否定は ① `immediate`、②③ `morning`、④ なし。解除は ①②③ `morning`、④ なし。
  - 否定: `alreadySent` に疑いか確定があれば `isCorrection:true`、今 ④ でも `morning`、設定を切っていても届く。受け取っていない ① は `isCorrection:false`。
  - 確認中: 同じ県へ `immediate`、他県へ送らず、設定で止めず、`level:null`。
  - 境目: A を lng 133.5〜（FAR_B の中心から西へ km 分）に替え、メッシュ FAR_B、市町村 C の農場で見る。10.4km → ①、`immediate`。11.1km → 送らない。
  - 配信停止に届かない／切った段階に届かない／朝のまとめを切ると ②③ は届かず ① は届く／記録のある知らせは出ない。
  - `diffCaseEvents`: `(null,疑い)=[suspected]`、`(null,疑いと確定)=[confirmed]`、`(疑い,確定)=[confirmed]`、`(確定,確定)=[]`、`(疑い,candidate)=[]`、`(candidate,negated)=[negated]`、`(null,reviewing)=[reviewing]`、解除はそれぞれの出来事、`control_done` の追加は `[]`、`replay` は `[]`。
  - 文面（`suspected`〜`movement_lifted`、`reviewing`）: 県の連絡が正ですと配信停止があり禁止語がない／**本文の URL は `sourceUrl`、`appUrl`、配信停止だけで、農場や販売の案内がない**／件名は下の表／確定に「疑い」がない／確認中は市町村を書かない。
  - 段階の文: ① `区域に入っている可能性があります。県の連絡を確かめてください`／② `隣町で発生しました`（疑い `隣町で疑いの発表がありました`）／③ `登録した町で発生しました`（疑い `登録した町で疑いの発表がありました`）。**`level:2`、`relationKind:"same_muni"` は `FIXED_TEXT.sameMuniLifted` で「隣町」を含まない**。解除に段階の文を出さず、① の搬出解除は `搬出制限は解除されました。区域に入っている可能性の表示は、移動制限の解除まで続きます`。
  - 朝のまとめ: 全件の事実と配信停止 1 回／同じ事例は疑い、確定、否定の順／件名 `【朝のまとめ】2 件`。署名は組が違えば通らず、長さ違いでも例外にならない。
  - 送信: ① はすぐ `sent`／② は `queued`／④ は記録なし／同じ書き込みの 2 回目で 1 通のまま／否定で全員へ【訂正】／`after` null と再現で何もしない／**1 回の `mailer` の宛先は 1 人**／1 人の失敗（宛先の不備）で他へ送り続け `failed` に残す／**認証と上限のエラーは残りへ送らず `failed` に残し（連打しない）、`mail_failing` が 1 日 1 件入り、戻り値は `mailStopped:true`（他は false）**／宛先が取れない会員は `failed`／ログにメールアドレスがない。
  - **通数**（`describeFixture`、岡山の 1 事例の控え。第 2〜15 報の 14 本を含む。控えは `data/private/fixtures/okayama/` に置き、公開しない。県の常設ページから事例ページをたどった報の PDF を `politeFetch` で控える。判定は題と本文の両方に対して行う）: `hasOutbreakWords` が true の本数だけ `rev-` の事例を流すと、同じ農場の会員 1 人に同じ通数が届く（索引 Q3 の既定）。数は Step 4 で報告し、M-13 が `docs/mail-operation.md` に書く。上限は Q3 の回答で決める。
  - **冷えた状態**: `ensurePrefs` の前の `fakeGeo` でも通る。`negated` の事例でも距離を計算できる。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装**
  - 段階は `relationToCase` だけで得る。`facts.date` は出来事の段階の日付（`reviewing` は `updatedAt`）、`facts.sourceUrl` は `sourceUrls` の最後。
  - `reviewing` は `notify` を見ない。`unsubscribedUids` は全出来事で除く。他は `notify.level{1,2,3}`、`morning` は `morningDigest` でも切る。
  - `dispatchNotices` は固定: `create()`（gRPC コード 6 なら何もしない）→ `immediate` は送って `sent`、失敗は `failed`／`morning` は `queued`。`isMailStopError` が値を返したら、その実行の残りの `immediate` は送らず `failed` にし、`noteMailStop` を呼ぶ（運営者へのメールも同じ Gmail なので画面に出す）。
  - `handleCaseWrite` は先に `await geo.ensurePrefs([after.prefCode])`（`prefsToLoad` は否定を除くので使わない）。
  - `renderNotice` は他の 3 出来事を M-13 が足すまで例外。本文の順: 事実／段階の文／固定の文／`sourceUrl`／県の連絡が正です／`くわしく: ${appUrl}`／`配信停止: ${unsubscribeUrl}`。

| 出来事 | 件名（P 県名、M 市町村） |
|---|---|
| suspected | `【疑い】PMで鳥インフルエンザの疑い` |
| confirmed | `【確定】PMで鳥インフルエンザの発生` |
| negated | `【訂正】PMの疑いは否定されました`（`isCorrection` が false なら `【お知らせ】`） |
| reviewing | `【確認中】Pの発表を確認しています` |
| 解除 | `【解除】Mの搬出制限が解除されました`、`【解除】Mの移動制限が解除されました` |

- [ ] **Step 4: 通ることを確かめる**、`npm run bundle -w functions`（`@hpai/shared` が残らない）
- [ ] **Step 5: Commit** `feat(notify): 誰にいつ知らせるかを決め、事例の変化でメールを送る`

---

### Task M-03: 解除の見込み、確認リスト、やること

読む節: 2.4、3.1、3.2、3.10、W-03 Interfaces

**Day:** 11/6 / **Depends on:** M-01、W-03 / **Human:** 下の表の言い換えだけを利用者が確かめる（原文は e-Gov で確認済み）

**Files:** Create `shared/src/lift.ts`、`shared/src/checklist.ts`、`shared/src/checklist/items.ts`、`web/src/pages/todo/LiftEstimateBlock.tsx`、`web/src/pages/record/DisinfectionPanel.tsx`。Modify `web/src/pages/todo/TodoPage.tsx`。Test `shared/test/lift.test.ts`、`shared/test/checklist.test.ts`、`web/src/pages/todo/todo.test.tsx`

**Interfaces:**
- Consumes: `useSpot`（`web/src/data/spotContext.tsx`）、`useAuthUser`（M-01）、`loadWebGeoStore`（`web/src/geo/loadGeo.ts`）、`computeLevel`、`prefsToLoad`、`isAdjacent`、`isZoneActive`
- Produces: `TodoPage`、`DisinfectionPanel`（経路に依存しない。M-04 と X-08 が包む）

```ts
// shared/src/lift.ts — §7
const MOVEMENT_DAYS: 21; const SURVEILLANCE_DAYS: 28;
interface LiftEstimate {
  status: "undetermined" | "published" | "calculated" | "lifted";
  movement: IsoDate | null; surveillance: IsoDate | null; basisControlDone: IsoDate | null;
  extendedByChain: boolean; // true なら「続発があると延びます」
  shipmentText: string;
}
function liftDate(controlDone: IsoDate, days: number): IsoDate; // addDays(controlDone, days + 1)
function computeLiftEstimate(target: Case, all: readonly Case[], geo: GeoStore): LiftEstimate; // 同じシーズンで isZoneActive かつ同じ市町村か隣
// shared/src/checklist.ts — §7。Claude を使わない
interface ChecklistSource { title: string; url: string; note: string | null }
interface ChecklistItem { id: string; class: ChecklistClass; text: string; source: ChecklistSource; rank: number; disinfectionLoggable: boolean }
interface ChecklistSection { class: ChecklistClass; heading: string; items: ChecklistItem[] }
function buildChecklist(i: { level: Level; production: Production | null; housing: FarmHousing | null }): ChecklistSection[];
function shortReminder(level: Level): string[];
const CHECKLIST_ITEMS: readonly ChecklistItem[];
```

- [ ] **Step 1: 失敗する試験を書く**
  - `liftDate`: `2025-12-30,21` → `2026-01-21`／`2025-12-21,21` → `2026-01-12`／`2026-01-11,21` → `2026-02-02`／`2025-12-30,28` → `2026-01-28`。
  - 見込み: 完了前は `undetermined`／完了 12/30 は 1/21、1/28、`calculated`／12/21（A）と隣 12/30（B）は 1/21、1/28、`extendedByChain:true`／隣に完了がなければ `undetermined`、`true`／遠い、否定、解除済み、別シーズンの隣は見ない／`prefEstimates.movement` は `published` でそのまま、監視強化は計算／解除後は `lifted`／`shipmentText` は `検査の結果を受けて県が解除します`、解除後は `搬出制限は解除されました`。
  - 確認リスト: 段階 1 は 3 分類、2 と 3 は `always`、`good_to_check`、4 は `always`／always は段階で変わらない／全項目に `https://` の出典／always に「義務ではない」がない／採卵は `good-egg`、肉用は `good-broiler`、未設定は両方／`open`、`free_range` は先頭が `good-walls`、`good-rats`、他は `good-visitor-clothes`／`STANDARD` の note に `2025-10-01`／全文に禁止語がない。
  - 短い確認: 4 行以内／`shortReminder(4)` に `riskAnywhere` と「自己点検」／段階 1 に `県の連絡を確かめてください`。
  - 画面: `getFarm` の `production`、`housing` を `buildChecklist` に渡し、農場がなければ null／ふだんは短い確認だけで「くわしく」で開く／段階 2、3 に区域の見出しがない／段階 2、3、4 に日付がない／段階 1 の未定、見込み、続発、県の発表、搬出の文／`inSurveillanceNote` のときだけ監視強化の説明／「やった」は `saveCheck({kind:"disinfection",date,itemId})`（Panel も同じ）／`/todo` は `RequireMember` で包まない。`getFarm` が null なら Panel は「やった」を出さず `saveCheck` を呼ばない。案内は claim がなければ `招待コードで登録すると記録できます`（§8）、会員なら `農場を設定すると記録できます` と `/settings/farm` へのリンク／地点がなければ町を選ぶ案内／いつ時点かを出す／全文に禁止語がない。
  - **リンク**: `/todo` の自己点検のリンクは `/record/self-check`、`/sample/todo` では `/sample/record/self-check`。sample で `/record` で始まる href がない。
  - **冷えた状態**（契約 3.2）: `data/geo/` を読む `createGeoStore` で、津山市の center のメッシュ（`latLngToMesh3(35.146,133.995)`、33203）と鳥取市（31201）の疑いの事例を未読み込みから描くと、例外なく段階 2、`kind:"adjacent"`。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装** 計算の前に `await geo.ensurePrefs(prefsToLoad(cases))`。解除の見込みは `reasons` の `level===1` の事例ごと。`disinfectionLoggable` は `always-17`、`always-19`、`always-22`、`zone-entry`、`zone-lime`、`zone-inside`。`rank` は表の順に 10、20、…（`open`、`free_range` は `good-walls` を 1、`good-rats` を 2）。

| 出典 | title | url |
|---|---|---|
| `STANDARD` | 飼養衛生管理基準（家畜伝染病予防法施行規則 別表第二 三）。note の既定 `2025-10-01 に番号が変わりました（施行 2026-10-01 の版で確認）。古い資料は別の番号です` | `https://laws.e-gov.go.jp/law/326M50010000035` |
| `GUIDELINE` | 高病原性鳥インフルエンザ及び低病原性鳥インフルエンザに関する特定家畜伝染病防疫指針（令和 7 年 10 月 1 日一部変更） | `https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/` |
| `REPORT` | 国の疫学調査報告書（2025/26） | `https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf` |
| `OLD_CASE` | 鳥インフルエンザ発生時の家きん卵早期出荷に向けての取り組み（和歌山県の家畜保健衛生所の報告）。note `平成 24 年度ごろの古い資料の事例です` | `https://www.pref.wakayama.lg.jp/prefg/070400/d00209378_d/fil/24-6.pdf` |

| id | 文 | 出典 |
|---|---|---|
| `always-17` | 衛生管理区域（消毒して入る範囲）の入口で、立ち入る人に手指の洗浄と消毒をしてもらう | STANDARD 項目 17 |
| `always-18` | 衛生管理区域専用の衣服と靴を用意し、立ち入る人に着けてもらう | 項目 18 |
| `always-19` | 衛生管理区域に入る車両を、入口で消毒する | 項目 19 |
| `always-22` | 鶏舎に出入りするたびに、手指の洗浄と消毒をする | 項目 22 |
| `always-23` | 鶏舎ごとの専用の靴を用意し、履き替える | 項目 23 |
| `always-25` | 防鳥ネットなどを設け、鶏舎の屋根や壁とあわせて破損を定期的に確かめ、破損はすぐ直す | 項目 25 |
| `always-27` | ねずみと、はえなどの害虫を駆除する | 項目 27 |
| `always-32` | 特定症状（告示で決められた、通報する症状）を見つけたら、直ちに家保へ通報し、出荷と移動を止める | 項目 32 |
| `always-33` | それ以外の異状で死亡率の急な上昇などがあれば、直ちに獣医師か家保の指導を受け、確認されるまで出荷と移動をしない | 項目 33 |
| `zone-daily` | 毎日、その日の死亡羽数などを、区域が解除されるまで県へ報告する（監視強化区域の一部では省略できる場合があります） | GUIDELINE 第 9 の 1(5)、留意事項 48 |
| `zone-visitors` | 鶏舎などへの、関係者以外の出入りを控える | 留意事項 48 |
| `zone-entry` | 農場の関係者の入出場時の消毒を徹底する | 留意事項 48 |
| `zone-lime` | 鶏舎の出入口、鶏舎の周り、衛生管理区域の外縁部を、消石灰などで消毒する | 留意事項 48 |
| `zone-inside` | 鶏舎の中を、このウイルスに効果のある消毒薬で消毒する | 留意事項 48 |
| `zone-abnormal` | 次を見つけたら直ちに報告する: 同じ鶏舎で 1 日の死亡率が平均の 2 倍以上／鶏冠や肉垂のチアノーゼ、沈うつ、産卵率の低下など／5 羽以上のまとまった死亡やうずくまり | 第 9 の 1(5) |
| `good-visitor-clothes` | 外部事業者が衛生管理区域に入るときの専用の衣服や靴（国の報告書で、半数以上の農場で不備） | REPORT |
| `good-rats` | ねずみの死体や痕跡（国の報告書で、半数以上の農場） | REPORT |
| `good-walls` | 鶏舎の壁やネットの破損（国の報告書で、複数の農場） | REPORT |
| `good-worker` | 働く人への声かけ: 発生地の近くに行かない、出勤前後の消毒や着替え | STANDARD 項目 3（周知）。文は作者の経験から |
| `good-pref` | 区域に入ったときの備え: 県からの連絡を確かめる | GUIDELINE 第 9 の 1 |
| `good-plan` | 区域に入ったときの備え: 出荷先と移動の予定を書き出す | GUIDELINE 第 9 の 5 |
| `good-egg` | 卵の出荷は、検査の結果を受けて県と国の協議で決まります（`layer`） | GUIDELINE 第 9 の 5(2) |
| `good-broiler` | 肉用の鶏の食鳥処理場への出荷は、検査の結果を受けて県と国の協議で決まります（`broiler`） | GUIDELINE 第 9 の 5(1) |
| `good-records` | 区域に入ったときの備え: 出荷や導入の記録と伝票を残す（補償に要ることがあります） | OLD_CASE |

  - 見出し: `いつも求められていること`／`区域に入っていれば求められること`（`区域に入っているかは県の連絡が正です` を添える）／`確かめておくとよいこと（義務ではありません。関係が深そうな順）`。
  - `shortReminder`: 4 は `[riskAnywhere, "今月の自己点検を確かめましょう"]`。2、3 は `近くの町で発表がありました。県の発表を確かめましょう`／`消毒と着替えを確かめましょう`／`働く人に声をかけましょう`／`prefContactIsAuthority`。1 は `区域に入っている可能性があります。県の連絡を確かめてください`／`毎日の死亡羽数の報告があるか確かめましょう`／`消毒と出入りの制限を確かめましょう`／`prefContactIsAuthority`。
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: Commit** `feat: 解除の見込みと確認リストとやることの画面を作る`

---

### Task M-04: 報告文、記録の画面、全データの削除

読む節: 2.3、3.10、4.1、索引 Q2、Q10、Q12、M-03、M-07 Interfaces

**Day:** 11/6 / **Depends on:** M-01、M-03、M-07 / **Human:** 手元の非公開の資料の項目と報告文の順を利用者が見比べる

**Files:** Create `shared/src/reports.ts`、`functions/src/farm/deleteFarmData.ts`、`web/src/pages/record/{RecordTabs,DeathsPanel,SelfCheckPanel,ExportPanel}.tsx`。Modify `functions/src/farm/index.ts`、`web/src/pages/record/{RecordPage,DeathsPage,SelfCheckPage,DisinfectionPage}.tsx`。Test `shared/test/reports.test.ts`、`functions/test/emul/delete-farm.test.ts`、`web/src/pages/record/record.test.tsx`

**Interfaces:**
- Consumes: `RequireMember`、`computeMortality`、`toMortalityDays`、`MORTALITY_TEXT`、`DisinfectionPanel`
- Produces: `*Page` は `RequireMember` と `*Panel` を包むだけ。`RecordTabs`、`DeathsPanel`、`SelfCheckPanel`、`ExportPanel` は `RecordStore` だけを使い、X-08 が包む。`deleteFarmData`（`{farmId, confirmName}`、300s / 256MiB）、`handleDeleteFarmData(db, uid, input)`

```ts
// shared/src/reports.ts — §8
const SELF_CHECK_ITEMS: ReadonlyArray<{ no: SelfCheckItemNo; label: string }>;
const SELF_CHECK_SOURCE_NOTE: string; // `ある家保の様式の例です。項目と期限は県や家保で違います`（索引 Q12 の既定）
function buildSelfCheckReport(i: { farmName: string; month: string; answers: Record<SelfCheckItemNo, "ok" | "ng" | null> }): string;
function buildWeeklyDeathReport(i: { farmName: string; weekStart: IsoDate; houses: ReadonlyArray<House & { id: string }>; records: readonly DeathRecord[];
  extras: { culledShipped: number | null; introduced: number | null; healthNote: string; mortalityNote: string } }): string; // extras は保存しない
function deathsToCsv(records: readonly DeathRecord[], houses: ReadonlyArray<House & { id: string }>): string;
function checksToCsv(checks: readonly CheckRecord[]): string;
```

- [ ] **Step 1: 失敗する試験を書く**
  - 自己点検の報告文（`2026-11`、19 が ng、27 が null）は次の行のまま: `自己点検の報告`／`農場名: 見本農場`／`対象の月: 2026年11月`／`17 衛生管理区域に立ち入る者の手指消毒等: ○`／`18 衛生管理区域専用の衣服及び靴の設置並びに使用: ○`／`19 衛生管理区域に立ち入る車両の消毒等: ×`／`22 家きん舎に立ち入る者の手指消毒等: ○`／`23 家きん舎ごとの専用の靴の設置及び使用: ○`／`25 野生動物の侵入防止のためのネット等の設置、点検及び修繕: ○`／`27 ねずみ及び害虫の駆除: 未記入`。農場名が空なら `農場名: 未記入`。
  - 週の報告文: 採卵 1000、500、肉用 300、採卵の空舎 900 で採卵の飼養羽数 1500。同じ日の 1 羽と 2 羽で 3。記録のない日は `未入力`、合計は入力のある日だけ。順は鳥の種類、飼養羽数、日別 7 日、合計、廃鶏出荷羽数、導入羽数、健康状態の特記事項（産卵率の推移など）、死亡率の変動や偏りの特記事項。null は `未記入`。入力者を出さない。
  - CSV: BOM と CRLF／`日付,鶏舎,鳥の種類,飼養羽数,死亡羽数,除外の理由,メモ`／`日付,種類,項目,結果`／`= + - @` で始まる値の前に `'`、カンマと改行を引用。
  - 死亡数: `saveDeath` に `{date,houseId,deaths,flockSizeAt,exclusion}` だけ（`toEqual`）／**文字、負の数、小数、羽数を超える値は保存せず `入力を確かめてください`。`invalid_input` の日付を出す**／鶏舎がなければ `/settings/farm` へ案内する（M-05）／空舎は `empty`／理由は設備の故障、急な気温変化、災害、その他／21 日未満は `まだ計算できません` と日数／当たれば `hit` と登録した家保の連絡先。連絡先が空なら `hit` を残し、`家保の連絡先が未登録です` と `/settings/farm` への案内を出す／当たらない日も `symptoms`、`exceptions`、`reading`／`問題ありません`、`安全` がない／記録のない日数を出し、窓が 30 日より長く広がったら `N 日前まで遡って計算しました`（索引 Q2）／`入力を直すと画面の表示は消えます。送ったメールは取り消せません`／週の報告文はコピーでき保存を呼ばない／`様式の項目に合わせた下書きです`。
  - 自己点検: 農場がなければ保存を出さず `/settings/farm` へ案内する／7 項目を番号つきの ○× で保存／コピーでき送信のボタンがない／未設定は `期限を設定してください`／`SELF_CHECK_SOURCE_NOTE` を出す。
  - **リンク**: `RecordTabs` の href は `/record/deaths`、`/sample/record` の下では `/sample/record/deaths`。sample で `/record` で始まる href がない。
  - **`RecordTabs` の 2 行**（4 画面すべて）: `最後の記録`（死亡数と点検の最新の `date`、なければ `なし`。§15）／`isMailStopped` が true なら常に `メールは止まっています。基準に当たっても届きません`（§6、索引 Q10）。
  - 出力: 印刷と CSV のボタン／削除は農場名を入れるまで押せず、sample に出さない／全画面に禁止語がない。
  - 削除: 農場とサブコレクション、その農場の `sentNotices` と招待を消す／他の農場、公開の事例、`caseDrafts` は残る／会員でなければ `permission-denied`／農場名が違えば `failed-precondition`。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装** `listDeaths(addDays(today,-120), today)` を鶏舎で分ける【計】。CSV の消毒の項目は `DISINFECTION_LABELS` で言葉にし、知らない id はそのまま: `always-17` 入口の手指消毒、`always-19` 車両の消毒、`always-22` 鶏舎の手指消毒、`zone-entry` 入出場時の消毒、`zone-lime` 消石灰の消毒、`zone-inside` 鶏舎内の消毒。削除は `db.recursiveDelete(farmRef)`。
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: Commit** `feat: 記録と報告の画面と全データの削除を作る`

---

### Task M-13: 朝のまとめ、野鳥、期限、配信停止、基準の知らせ、通し

読む節: 2.1、2.3、3.2、4.1、6.3、8、索引 Q3、Q10、I-02（`enqueueReview`）、M-02 Interfaces、M-07 Interfaces

**Day:** 11/6 / **Depends on:** M-02、M-04、M-05 / **Human:** deploy の承認と自分宛ての通し（Step 5）。Gmail と Secret は人の作業 5、6 で済んでいる

**Files:** Create `functions/src/notify/{digest,retryFailed,onWildBirdWritten,onDeathWritten,unsubscribe,resumeMail}.ts`、`docs/mail-operation.md`。Modify `shared/src/notices.ts`、`functions/src/notify/index.ts`、`web/src/pages/settings/NotifySettingsPage.tsx`。Test `shared/test/notices-more.test.ts`、`functions/test/emul/notify-digest.test.ts`、`notify-death.test.ts`、`unsubscribe.test.ts`、`scripts/test/mail-operation-doc.test.ts`

**Interfaces:**
- Consumes: `wildBirdsNotifiable`、`verifyUnsubscribe`、`loadGeoStore`、`create-invite`、`dispatchNotices`、`isMailStopError`、`noteMailStop`
- Produces:

```ts
// shared/src/notices.ts に足す
function wildBirdNotices(i: { bird: WildBird; farms: ReadonlyArray<Farm & { id: string }>; geo: GeoStore }): Notice[];
function selfCheckDueNotices(farm: Farm & { id: string }, today: IsoDate, answeredMonths: readonly string[]): Notice[];
function mortalityNotices(farm: Farm & { id: string }, recordId: string, date: IsoDate): Notice[];
// functions/src/notify/
function runMorningDigest(deps: NotifyDeps, geo: GeoStore): Promise<void>;
function runRetryFailed(deps: NotifyDeps, geo: GeoStore): Promise<void>; // retryFailedNotices の本体
function handleWildBirdWrite(deps: NotifyDeps, before: WildBird | null, after: WildBird | null, geo: GeoStore): Promise<void>;
function handleDeathWrite(deps: NotifyDeps, farmId: string, recordId: string, after: DeathRecord | null): Promise<void>;
function handleUnsubscribe(db: Firestore, query: Record<string, string>, secret: string): Promise<{ status: number; html: string }>;
function handleResumeMail(db: Firestore, uid: string, farmId: string): Promise<void>;
// morningDigest、retryFailedNotices 540s / 512MiB、onDeathWritten 120s / 256MiB: secrets は GMAIL_APP_PASSWORD、UNSUBSCRIBE_SECRET
// unsubscribe invoker "public" 60s / 256MiB: secrets は UNSUBSCRIBE_SECRET
// onWildBirdWritten 120s / 512MiB（queued のみ）、resumeMail onCall: secrets なし
```

- [ ] **Step 1: 失敗する試験を書く**
  - 文面: 3 出来事に県の連絡が正です、配信停止、禁止語なし、許された URL だけ。件名 `【野鳥】Mで野鳥の高病原性鳥インフルエンザが確定しました`、`【自己点検】Dが期限です`、`【死亡数】Dの死亡率が基準に当たりました`。野鳥は段階を上げないと書き、環境省の重点区域と防疫指針の区域は別と書く。基準は `hit`、`${appUrl}/record/deaths`、`入力を直しても、このメールは取り消せません` があり、`感染しています`、`鳥インフルエンザです` を含まない。期限は `${appUrl}/record/self-check`。
  - 野鳥: A の鳥は NEAR_B の農場に `level:null`、`morning` で届き FAR_B に届かない／検査中、否定、既に確定だった書き込みで足さない／朝のまとめを切った会員に届かない。
  - 期限（`{"2026-11":"2026-11-05"}`、3 日前）: 11/1 なし、11/2 と 11/5 あり、11/6 なし、記録済みはなし／`selfCheckRemindDays:null` はなし。
  - 朝のまとめ: 何もない日は送らない／同じ会員の 2 件を 1 通にして両方 `sent`／再実行で二度送らない／止めた会員に送らず `queued` を消す／段階は朝の時点で計算し直す／事例が消えていれば `failed`、他は送る／`failed`（`immediate`、`morning` とも）と 10 分以上の `queued` の `immediate` を送り、10 分未満は残す／**認証か上限のエラーで残りに送らず、残りの `queued` の `morning` も `failed` にして次の送り直しで届く。期限の知らせの `dispatchNotices` で止まったときも同じ。`mail_failing` は 1 件入り、同じ日の 2 回目でも 1 件、翌日は新しく 1 件。宛先の不備では入らない。**
  - **組み立て直し**（§6）: ②の `queued` の `negated` は先の送信を見て【訂正】の件名になる／今④でも設定を切っていても訂正が届く／`mortality_hit` と `self_check_due` の `failed` は事例を読まずに送り直しで届く（`subjectId` は事例でない）／欄 `selfCheckDue` のない農場が 1 つあっても朝の送信は止まらない。
  - **送り直し**（§6）: `runRetryFailed` は `failed` の `morning` と `immediate`、10 分以上の `queued` の `immediate` を会員ごとに 1 通で送る。否定の訂正の `failed` も届く。`queued` の `morning` は朝まで送らない。認証か上限のエラーで残りに送らず `failed` のままで、**`mail_failing` が朝の経路と同じ id で 1 日 1 件入り**、ログは件数だけ、次の 1 時間まで送らない（連打しない）。**予定は `30 0-5,7-23 * * *` に固定する**（朝のまとめと同時に動くと同じ知らせを 2 度送るため。5:30 の実行は 540s で 6:00 の前に終わる）。
  - **冷えた状態**（契約 3.2）: `loadGeoStore` の未読み込みから、津山市の center のメッシュの農場と鳥取市（31201）の事例の `queued` が例外なく送られ、`level:2`、`relationKind:"adjacent"`。`fakeGeo` で `negated` の `queued` と野鳥の判定も落ちない。
  - 基準（過去 1、当日 5、1000 羽はどの読みでも当たる。会員 2 人）: 2 通すぐ届く／同じ記録を直しても 1 人 1 通／当たらない、21 日未満、除外の日、`invalid_input`、削除で送らない／別の鶏舎と混ぜない／昨日より古い日付で送らない【計】。
  - 配信停止: 正しいリンクで止まり、画面に `基準に当たった知らせと期限の知らせも止まります。画面の表示は止まりません` と `知らせの設定で戻せます`／署名が違えば 403／2 回開いても 1 回分／農場が消えていても 200／止めた後は事例でも基準でも届かない／`resumeMail` は自分だけを戻せる／止めていれば知らせの設定に `配信を止めています` と戻すボタン。
  - `mail-operation-doc`: 500 と確認日があり、`/(該当しません|対象外です|適法です)/` がない。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装**
  - `runMorningDigest`: (1) 全農場の `selfCheckDueNotices`（`checks` の `where("month","==",m)`）を `dispatchNotices` へ。(2) `queued` の `morning`、`failed` のすべて、`queuedAt < now-10分` の `queued` の `immediate` を読む（索引は F-05）。`runRetryFailed` は (2) から `queued` の `morning` を除き、(3)〜(5) を共用する。(3) 読んだ事例と野鳥の `prefCode` すべてで `ensurePrefs`（`prefsToLoad` は否定を除くので足りない）。(4) `farmId` と `uid` の組で 1 通にし、`Notice` を組み立て直す。`negated` は同じ事例の先の送信が `sentNotices` にあれば訂正とし、段階と設定で落とさない。事例でない `subjectId` は `kind` ごとに組み立てる。(5) 送って `sent`、失敗は `failed`。`isMailStopError` が値を返すか (1) が `mailStopped` を返したら、残りを送らず `failed` にして `noteMailStop` を呼ぶ。
  - `handleWildBirdWrite` は判定の前に `ensurePrefs(prefsToLoad([], [after]))`。`handleDeathWrite` は `where("date",">=",addDays(date,-120))` で読み、メモリで `houseId` を絞る。`subjectId` は `recordId`。
  - 配信停止は GET（§12）。HTML は固定で受け取った値を埋め込まない。基準と期限の知らせも止まる（索引 Q10）。`mortality_hit` は `notify` を見ず `unsubscribedUids` だけ除く。
  - `docs/mail-operation.md`（書く前に公式のページで値を確かめ直し、確認日と URL を書く。計画の時点の結果は次のとおり）:
    - Gmail（`https://support.google.com/mail/answer/22839`）: 1 日 500 通、1 通の宛先合計 500 件、制限は 1〜24 時間で回復。SMTP だけの上限は未確認。1 人 1 通で送る。
    - アプリパスワード（`https://support.google.com/accounts/answer/185833`）: 2 段階認証が必須、セキュリティキーだけでは作れないことがある、パスワードの変更で取り消される、Google は推奨していない。
    - 通数: 1 人 1 日で朝 1 通とすぐの知らせ。確認中は索引 Q3 の既定で 1 人に 1 事例最大 24 通（M-02 の実測で置き換える）。招待 5 人で 120 通、20 人で 480 通。上限に当たると `failed` に残り、1 時間ごとに送り直し、`mail_failing` を運営者の画面に出す。運営者へのメールも同じ経路で止まる。Gmail の認証と上限のエラーの応答の形を確かめ、`isMailStopError` と合わなければ直す。
    - 特定電子メール法: 定義の原文と、広告を含まない知らせは対象外と読めるが例示がなく断定できないこと、送信者の立場が分かれ目であることを分けて書く。知らせに宣伝、農場、販売の案内を入れない。
- [ ] **Step 4: 通ることを確かめる**、`npm run bundle -w functions`
- [ ] **Step 5: Human: deploy と自分宛ての通し** 承認の後、`npm run build` と次を実行する。`hosting` を含むのは、ログインと `/unsubscribe` が Hosting を通るため。他の領域の途中の画面も出ることを承認のときに伝える。

```bash
npx firebase --account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT" deploy --only hosting,functions:redeemInvite,functions:createFarmInvite,functions:deleteFarmData,functions:unsubscribe,functions:resumeMail,functions:onCaseWritten,functions:onWildBirdWritten,functions:morningDigest,functions:retryFailedNotices,functions:onDeathWritten
```

  `npx tsx scripts/ops.ts create-invite --kind signup --max-uses 5` のコードでログインし（同じコードで Google のボタンからも入れることを確かめる）、1000 羽の鶏舎を 2 つ作る。1 つ目に過去 21 日を毎日 1 羽、今日を 5 羽 → `【死亡数】` が 1 通届く。そのリンクで止め、2 つ目に同じ値を入れても届かず、設定から戻せることを確かめる。全データの削除で農場を消す。
- [ ] **Step 6: Commit** `feat(notify): 朝のまとめ、野鳥、期限、配信停止、基準の知らせを送る`

---

### Task M-18: 声かけ文

読む節: 2.6、2.7、3.10、4.1、I-03 Interfaces

**Day:** 11/7 午前 / **Depends on:** M-03、I-03

**Files:** Create `shared/src/drafts.ts`、`functions/src/drafts/{claude,workerDraft}.ts`、`web/src/pages/todo/WorkerMessagePanel.tsx`。Modify `functions/src/drafts/index.ts`、`web/src/pages/todo/TodoPage.tsx`。Test `shared/test/drafts.test.ts`、`functions/test/worker-draft.test.ts`、`functions/test/emul/worker-draft.test.ts`、`web/src/pages/todo/worker-message.test.tsx`

**Interfaces:**
- Consumes: `decodeMessage`、`recordUsage`、`readRuntimeSettings`、`readUsageMonth`、`decideReadBudget`（I-03）、`zodOutputFormat`、`RecordStore.getCaseDraft`、`ANTHROPIC_API_KEY`
- Produces: `draftOnCaseWritten`（300s / 256MiB、secrets: `ANTHROPIC_API_KEY`）、`WorkerMessagePanel`（`TodoPage` に置く。X-08 はこの画面を包む）

```ts
// shared/src/drafts.ts — §7
function workerMessageTemplate(f: { muniName: string; date: IsoDate; stage: "suspected" | "confirmed" }): string;
function checkWorkerMessage(text: string, f: { muniName: string; date: IsoDate; allowedNumbers: readonly string[] }): { ok: boolean; failures: string[] };
function checkNeighborText(text: string, allowedNumbers: readonly string[]): { ok: boolean; failures: string[] };
function dateNumbers(date: IsoDate): string[]; // ["2025","12","19"]
// functions/src/drafts/claude.ts
const DRAFT_MODEL = "claude-sonnet-5-5";
function callDraft(client: Anthropic, system: string, user: string): Promise<ReadAttempt<{ message: string }>>;
```

- [ ] **Step 1: 失敗する試験を書く**
  - 検査（津山市、`2025-12-19`）: 雛形は合格／`１２ 月 １９ 日` は日付として通る／不合格の値は `missing_muni`、`missing_date`、`missing_core_avoid`、`missing_core_disinfect`、`約43万羽です。` → `unknown_number:43`、`三キロ以内です。` → `unknown_kanji_number:三キロ`、`大変危険です。` → `sensational:危険`、`卵は安全です。` → `forbidden:安全`。説明文の検査は `人には感染しません`、`受診してください` を `health:...` で落とす。
  - 呼び出し: 渡すのは市町村、県、日付、段階だけ／`temperature`、`thinking`、`tool_choice`、`citations` を送らず、`messages.parse` を呼ばない／合格で `source:"claude"`／**`refusal`、`max_tokens`、`format_error`、`api_error` のすべてで雛形**／検査に落ちれば雛形／疑いなのに `疑い` がなければ雛形／`stop` の予算では呼ばず雛形。
  - 書き込み: 疑いで一度だけ作り確定で作り直さない／確定から始まる事例も一度／確認中、再現、否定、市町村なしで作らない／Claude が使えなくても雛形で残る／農場を読まない／**下書きの費用が `usage/{YYYY-MM}` の `estimatedJpy` に積まれる**。
  - 画面: 直してコピーでき保存しない／雛形か Claude かを示す／確定の事例の下書きに `疑い` があれば直すよう添える／`getCaseDraft` が null（sample、再現、農場のない人）か reject なら雛形に戻り例外にしない。sample と再現は Firestore を呼ばない。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装**
  - 雛形（D は `formatJaDate`）: 疑い `D、Mで鳥インフルエンザの疑いの発表がありました（確定ではありません）。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`／確定 `D、Mで鳥インフルエンザの発生が確認されました。発生地の近くに行かないでください。出勤の前後に消毒と着替えをお願いします。`
  - 検査は `normalizeForMatch` の後。煽る語 `危険 危ない 緊急事態 非常事態 パニック 恐怖 壊滅 猛威 爆発 まん延 蔓延 大流行 絶対 ホットスポット また発生しやすい`。健康の断定 `感染しません 感染しない うつりません うつらない 受診 病院 発症`。核 1 は `近く` と `/行かない|行かず|立ち寄らない|近づかない/`。核 2 は `消毒` と `着替え`。数字は `/\d+/g` が `allowedNumbers` にある。`/[〇一二三四五六七八九十百千万億]+(?:羽|キロ|km|件|例|割|%|人)/` は不合格。
  - `callDraft`: `client.messages.create({model:DRAFT_MODEL,max_tokens:16000,system,messages,output_config:{format:{type:"json_schema",schema:zodOutputFormat(z.object({message:z.string()})).schema},effort:"medium"}})` を `decodeMessage` に渡す。
  - system は固定: `あなたは養鶏場の経営者が働く人へ送る短い声かけ文を下書きします。渡された事実だけを使います。伝えることは「発生地の近くに行かない」「出勤の前後に消毒と着替え」の 2 つです。3 文以内で、やさしい言葉で書きます。市町村名と日付（M月D日）を入れます。疑いの段階なら「疑い」と書きます。数字を足しません。人の健康について書きません。不安をあおる語を使いません。`。user は `{"prefecture","municipality","date","stage"}` の JSON だけ。
  - `draftOnCaseWritten`: `after` が null、`reviewing` か `replay`、`negated`、`muniCode` が null、`suspected` も `confirmed` もない、`caseDrafts/{id}` がある、のどれかなら戻る。`create()`（既にあれば捨てる）の前に `recordUsage(DRAFT_MODEL, usage, now, settings)`。
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: Commit** `feat: 声かけ文を下書きして検査する`

---

### Task M-19: 説明文

読む節: 2.6、3.9、4.1、M-18 Interfaces、W-07 Interfaces

**Day:** 11/7 午後 / **Depends on:** M-18、W-07

**Files:** Create `functions/src/drafts/neighborDraft.ts`。Modify `shared/src/drafts.ts`、`functions/src/drafts/index.ts`、`web/src/pages/settings/ExplainerPage.tsx`。Test `functions/test/neighbor-draft.test.ts`、`web/src/pages/settings/explainer.test.tsx`

**Interfaces:**
- Consumes: `OFFICIAL_GUIDANCE`、`callDraft`、`checkNeighborText`、M-18 と同じ予算の関数
- Produces: `draftNeighborExplainer`（`onCall`、120s / 256MiB、secrets: `ANTHROPIC_API_KEY`）、`ownOutbreakNoticeTemplate(): string`

```ts
interface NeighborDraftResult {
  farmPart: string; // Claude か雛形
  officialPart: Array<{ text: string; sourceTitle: string; sourceUrl: string; checkedOn: IsoDate }>; // OFFICIAL_GUIDANCE のまま
  source: "claude" | "template"; failures: string[];
}
```

- [ ] **Step 1: 失敗する試験を書く** 人への感染は公式の文のまま（`officialPart[0].text === "公式の文"`）で、prompt に健康の説明を頼まない／入力にない数字、健康の断定、煽る語、禁止語は雛形に戻して `failures` に残す／雛形は入力の文を入れ検査に通る／Claude が使えないときと `stop` は雛形／費用が `estimatedJpy` に積まれる／claim がなければ `permission-denied`／2000 字超は `invalid-argument`／入力をログに出さない／handler は `db` を受け取らない／発生時の雛形に日付と問い合わせ先の空欄があり、農場に近づかないよう書く／ボタンの前に `入力した文を Claude に送ります`（§10.1）／直してコピーでき出典の確認リストが付く／発生時の雛形は Claude を呼ばない／`配るのは農場で、作品からは送りません`。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装** 入力は `{measures: string; audience: "meeting" | "circular"}`。話題は `approach`、`human_infection`、`food`、`burial`、`rumor` をプログラムで組み合わせる（§2）。`allowedNumbers` は入力の数字だけ。検査は `farmPart` だけ。system は固定: `あなたは養鶏場が近隣の住民へ配る説明文の、農場の対策の部分だけを下書きします。入力された対策だけを使います。入力にない数字と事実を足しません。人の健康、感染、卵や肉について書きません。不安をあおる語を使いません。`
- [ ] **Step 4: 通ることを確かめる**
- [ ] **Step 5: Commit** `feat: 近隣への説明文を下書きする`
