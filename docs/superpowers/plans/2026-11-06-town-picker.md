# 自分の町の選び方と、町の欄の整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自分の町を文字で探して 1 押しで決められるようにする。町を変える口を町の名前の横に移す。「自分の町」と「地図で押した町」の言葉とリンクを分ける。

**Architecture:** 探す処理は純粋関数 `townSearch.ts` に切り出す。`TownPicker` の選ぶ画面（`Chooser`）がそれを使う。`TownBanner` に名前の横の差し込み口 `nameAction` を足す。`MapPage` は町があれば選ぶ部品をそこへ渡し、地図の下の単独の置き場を消す。文言は `texts.ts` に集める。

**Tech Stack:** React 19 + TypeScript、vitest + Testing Library、Playwright（e2e）、maplibre（地図。今回は触らない）

**Spec:** `docs/superpowers/specs/2026-11-06-town-picker-design.md`

## Global Constraints

- 基点は `feat/hpai-map` の `9150ede`（別のセッションの決定 15・16）以降。始める前に `git log -1` で確かめる。
- `web/src/ui/AppShell.tsx`、`web/src/ui/SectionTabs.tsx`、`web/src/pages/about/*` は触らない（別のセッションの担当）。e2e の `helpers/frame.ts` も触らない。
- 文言は設計書 3 章の表どおりに一字一句そろえる。`texts.ts` の `TEXT` から使い、部品に直書きしない（`SvgMap.tsx` の読み上げの文だけは今も直書きなので、その場で書き換える）。
- 禁句（安全・安心・区域の外です）を使わない。
- 地点（くわしい場所）の保存の仕組み（`spotContext.tsx` の `setTown`）は変えない。
- コメントは日本語で、周りのコードの密度に合わせる。
- commit は作者の確認を取ってから。`git add` はファイル名を名指しする（`-A` や変数はフックが止める）。

## Review Focus

1. かな漢字の変換の途中で、ひらがなが入力欄に入る → 「見つかりません」を点滅させない（Task 2 の試験 `変換の途中は見つかりませんを出さない`）。
2. 全角や半角の数字、空白の混じった入力（「西粟倉 」「岡山　西粟倉」）→ 正規化してから当てる（Task 1 の試験 `空白と全角をそろえる`）。
3. 会員の農場や再現で場所を変えられない人 → 名前の横にボタンを出さず、今の説明の文を出す（Task 3 の試験 `読み取り専用では変えるボタンを出さない`）。
4. `/town`（地図がない画面）で町を変える → 地図へ画面を戻そうとして落ちない。新しい町の欄に替わる（Task 3 の試験 `town の画面で町を変えられる`）。
5. 地図が描けない端末（代わりの地図）で選ぶ → 地図の上の文（D6）は出さない。代わりの地図の中の案内が出る（Task 4 の試験 `代わりの地図では上の文を出さない`）。

---

### Task 1: 町を名前で探す関数

**Files:**
- Create: `web/src/pages/map/townSearch.ts`
- Test: `web/src/pages/map/townSearch.test.ts`

**Interfaces:**
- Produces:
  - `export interface TownHit { code: MuniCode; label: string }`
  - `export function searchTowns(index: Readonly<Record<MuniCode, MuniEntry>>, query: string, limit?: number): { hits: TownHit[]; more: number }`（limit の既定は 20）

- [ ] **Step 1: 失敗する試験を書く**（`TownPicker.test.tsx` の `entry` と同じ形の索引を使う。津山市 33203、真庭市 33214、倉敷市 33202、西粟倉村 33643、泊村 01403・01696、鳥取市 31201、府中市 13206・34208）
  - `空の入力は候補なし`: `searchTowns(I, "")` → `{ hits: [], more: 0 }`。`"  "` も同じ。
  - `部分一致で県名を前に付ける`: `searchTowns(I, "粟倉").hits` → `[{ code: "33643", label: "岡山県 西粟倉村" }]`
  - `県名から続けて打っても当たる`: `searchTowns(I, "岡山西粟倉").hits[0].code === "33643"`
  - `空白と全角をそろえる`: `searchTowns(I, " 西粟倉　").hits[0].code === "33643"`
  - `同じ名前が先、始まりが次、ほかはコード順`: 索引に「津山市」と「美津山町（仮のコード 33999）」を置き、`searchTowns(I, "津山市")` の 1 件目が 33203。`"津山"` では 33203（津山で始まる）が 33999（途中に含む）より先。
  - `同じ県の同名だけコードを付ける`: `"泊村"` → `["北海道 泊村（01403）", "北海道 泊村（01696）"]`。`"府中市"` → `["東京都 府中市", "広島県 府中市"]`（県が違うので付けない）
  - `20 件を超えた分は数だけ`: 25 件の「○○町」を置き、`searchTowns(I, "町")` → `hits.length === 20`、`more === 5`

- [ ] **Step 2: 落ちることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/townSearch.test.ts`
  Expected: FAIL（モジュールがない）

- [ ] **Step 3: `searchTowns` を書く**。正規化は `normalizeForMatch`（`@hpai/shared/text`）、県名は `PREFS`（`@hpai/shared/pref`）。並べ方と当て方は設計書 4 章のとおり。

- [ ] **Step 4: 通ることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/townSearch.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**（作者の確認の後）
  `git add web/src/pages/map/townSearch.ts web/src/pages/map/townSearch.test.ts` → `git commit -m "feat(map): 町を名前の一部で探す関数を足す"`

### Task 2: 選ぶ画面に入力欄、予告、新しい文言

**Files:**
- Modify: `web/src/pages/map/TownPicker.tsx`（`Chooser` と `TownPickerProps`）
- Modify: `web/src/pages/map/texts.ts`（設計書 3 章の表の文。`panelLabel`、`areaLink` は Task 5 で変える）
- Modify: `web/src/pages/map/map.css`（`.town-search`、`.town-hits` の見た目。ボタンは `--tap` の高さ、幅いっぱい）
- Test: `web/src/pages/map/TownPicker.test.tsx`

**Interfaces:**
- Consumes: `searchTowns`、`TownHit`（Task 1）
- Produces:
  - `TownPickerProps` に `hasSpot?: boolean` を足す（鶏舎の場所がこの端末にあるとき true）
  - `TEXT` の新しい鍵: `searchLabel`、`searchPlaceholder`、`searchNone`、`searchMore(n: number): string`、`pickingBar`、`pickingCancel`、`spotWillClear`。`pickTown`、`changeTown`、`decideTown`、`mapTapHint` は新しい文に変える

- [ ] **Step 1: 失敗する試験を書く**（今の試験の「町を選ぶ」「町を変える」「この町にする」「地図の町をさわっても選べます」は `TEXT.*` 参照に書き換える）
  - `入力で探して候補を押すとすぐ決まる`: 選ぶ画面を開く → `getByLabelText("町の名前を入力")` に「津山」を入れる → `getByRole("button", { name: "岡山県 津山市" })` を押す → `onChoose` が `"33203"`、`onPickingChange` が `false` で呼ばれる
  - `候補がないと伝える`: 「ああ」を入れる → `getByText("見つかりません。下の県と市町村からも選べます")`
  - `変換の途中は見つかりませんを出さない`: `fireEvent.compositionStart(input)` → 「つ」を入れる → その文がない → `fireEvent.compositionEnd(input)` の後に出る
  - `多いときは数を伝える`: limit を超える索引で `TEXT.searchMore(n)` の文が出る
  - `select は入力欄の下に残る`: 入力欄が県の select より DOM で前（`compareDocumentPosition`）
  - `場所があるときだけ予告を出す`: `hasSpot: true, town: "33214"` で開くと `TEXT.spotWillClear` が出る。`hasSpot` なしでは出ない
  - `新しい文言`: ボタン名が「自分の町を選ぶ」「自分の町を変える」「自分の町にする」。案内が「地図の町を押しても、自分の町にできます」

- [ ] **Step 2: 落ちることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/TownPicker.test.tsx`
  Expected: FAIL

- [ ] **Step 3: `Chooser` を直す**。入力欄は `<input type="search">` と `<label>` で名前を付ける。変換の途中は `onCompositionStart`／`onCompositionEnd` の状態で見る。候補は `<ul className="town-hits">` の中の `Button`。予告は `hasSpot` のとき入力欄の前に `<p className="map-note">`。`hasSpot` は `TownPicker` から `Chooser` へ渡す。

- [ ] **Step 4: 通ることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/TownPicker.test.tsx src/pages/map/townSearch.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit** `feat(map): 町の名前を入力して探し、押すとすぐ自分の町になる。場所が消えることを前もって伝える`

### Task 3: 「自分の町を変える」を町の名前の横へ。スマホは決めた後に地図へ戻す

**Files:**
- Modify: `web/src/pages/map/TownBanner.tsx:150-163`（町の名前の行）
- Modify: `web/src/pages/map/MapPage.tsx`（`picker` の渡し方、`choose`、684 行の単独の置き場を消す。`hasSpot` を渡す）
- Modify: `web/src/pages/map/map.css`（`.town-name-row`: flex、折り返し。選ぶ画面は幅いっぱいで次の行へ）
- Test: `web/src/pages/map/TownBanner.test.tsx`、`web/src/pages/map/MapPage.test.tsx`、`web/src/pages/map/MapPage.nowebgl.test.tsx`

**Interfaces:**
- Consumes: `TownPickerProps.hasSpot`（Task 2）
- Produces: `TownBannerProps.nameAction?: ReactNode`（町の名前の行の右に描く。町がないときは使わない。町がないときは今の `children` のまま）

- [ ] **Step 1: 失敗する試験を書く**
  - TownBanner `名前の横に差し込める`: `nameAction={<button>x</button>}` で、ボタンが `.town-name-row` の中にあり、`.town-name` の後ろにある
  - MapPage（今の 515 行の試験を置き換え）`町を変えるボタンは自分の町の欄の名前の行にある`: `TOWN_KEY` に 33214 → `getByRole("button", { name: TEXT.changeTown })` が `.town-banner .town-name-row` の中にある。ページの中に 1 つだけ
  - MapPage `town の画面で町を変えられる`: `section: "town"` で町あり → 変えるボタンがある → 開いて入力で「津山」→ 候補を押す → `localStorage` の町が 33203 になり、欄の名前が津山市になる（`scrollIntoView` は呼ばれても落ちない）
  - MapPage `スマホでは決めた後に地図の上端へ戻す`: `useNarrow` を true にする（既存の試験の作り方に倣う）。`.map-box` の `scrollIntoView` を spy する → 候補で決める → `{ block: "start" }` で呼ばれる。PC では呼ばれない
  - MapPage `読み取り専用では変えるボタンを出さない`: 会員の農場の場所（既存の readOnly の試験の作り方）で、変えるボタンがない。`TEXT.spotFromFarm` が名前の行にある
  - MapPage `場所があると予告を渡す`: 端末に地点を置く（既存の 446 行の試験の作り方）→ 変えるを押す → `TEXT.spotWillClear` が出る
  - 既存の 392・453 行と nowebgl の 110・128 行は、ボタン名を `TEXT.*` 参照に書き換える

- [ ] **Step 2: 落ちることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/TownBanner.test.tsx src/pages/map/MapPage.test.tsx src/pages/map/MapPage.nowebgl.test.tsx`
  Expected: FAIL

- [ ] **Step 3: 直す**
  - `TownBanner`: 町の名前の `<p className="town-name">` と `nameAction` を `<div className="town-name-row">` で包む。
  - `MapPage`: `banner` と `section === "town"` の `TownBanner` の両方に `nameAction={town !== null ? picker : undefined}` を渡す。`{inMap && town !== null ? picker : null}` は消す。
  - `choose` の最後で、`narrow` が true なら `boxRef.current?.scrollIntoView?.({ block: "start" })` を呼ぶ。`/town` では `boxRef.current` が null なので何もしない。
  - `TownPicker` に `hasSpot={spotState.deviceSpot !== null}` を渡す。
  - 注意: スマホでは自分の町の欄は地図の下にあるので、変えるボタンも地図の下になる。D5 で地図へ戻すので、それでよい。地図で押した町の欄を開いている間は、自分の町の欄ごと隠れる（D11）。

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(map): 自分の町を変えるボタンを町の名前の横に移し、自分の町の過去の画面でも変えられるようにする`

### Task 4: 選ぶ間、地図の上に文と［やめる］を出す

**Files:**
- Modify: `web/src/pages/map/MapPage.tsx`（`.map-box` の直前）
- Modify: `web/src/pages/map/map.css`（`.picking-bar`: 文とボタンを 1 行に並べ、狭いと折り返す）
- Test: `web/src/pages/map/MapPage.test.tsx`、`web/src/pages/map/MapPage.nowebgl.test.tsx`

**Interfaces:**
- Consumes: `TEXT.pickingBar`、`TEXT.pickingCancel`（Task 2）

- [ ] **Step 1: 失敗する試験を書く**
  - `選ぶ間は地図の上に文が出る`: 町あり → 変えるを押す → `getByText(TEXT.pickingBar)` が `.map-box` より DOM で前にある。［やめる］を押すと文が消え、選ぶ画面も閉じる。`lastProps().onSelectMuni` が undefined に戻る
  - `代わりの地図では上の文を出さない`（nowebgl）: 選ぶ画面を開いても `TEXT.pickingBar` がない。`TEXT.mapTapHint` は出る
  - 読み取り専用では出ない（`canEdit` が false）

- [ ] **Step 2: 落ちることを確かめる**
  Run: `cd web && npx vitest run src/pages/map/MapPage.test.tsx src/pages/map/MapPage.nowebgl.test.tsx`
  Expected: FAIL

- [ ] **Step 3: 直す**。`picking && canEdit && !mapless && section !== "compare"` のとき、`<div className="picking-bar" role="status">` に文と `<button type="button" className="btn">`（押すと `setPickingOpen(false)`）を置く。

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(map): 自分の町を選ぶ間、地図の上に地図を押すと決まることと、やめるボタンを出す`

### Task 5: リンクと言葉を分ける

**Files:**
- Modify: `web/src/pages/map/texts.ts`（`panelLabel`、`areaLink`）
- Modify: `web/src/pages/map/TownBanner.tsx:159-161`（`pastBrief` のときは案内ページへのリンクを出さない）
- Modify: `web/src/pages/map/SvgMap.tsx:471`（読み上げの文）
- Test: `web/src/pages/map/TownBanner.test.tsx`、`web/src/pages/map/TownCasesPanel.test.tsx`、`web/src/pages/map/MapPage.test.tsx:306`、`web/src/pages/map/SvgMap.test.tsx`

**Interfaces:**
- Consumes: なし（`CompareMaps.tsx` の `TEXT.panelLabel` と `TEXT.areaLink` も同じ鍵なので、文が自動で変わる。ファイルは直さない）

- [ ] **Step 1: 失敗する試験を書く**（`/この町のくわしい状況/` の当て方は `TEXT.areaLink` 参照に書き換える）
  - TownBanner `最初の画面では案内ページへのリンクを出さない`: `pastBrief` で `TEXT.areaLink` のリンクがない。「自分の町の過去を見る」はある
  - TownBanner `town の画面では案内ページへのリンクを出す`: `pastBrief` なしで `/area/33214` へのリンクがあり、名前が「この町の案内ページ（登録なしで開ける・共有用）」
  - TownCasesPanel: 見出しの札が「地図で押した町」。案内ページへのリンクは残る
  - MapPage 306 行: `section: "now"` の欄に案内ページへのリンクがないことを確かめる形に変える
  - SvgMap: 選ぶ間の町の読み上げが「。押すとこの町を自分の町にします」で終わる

- [ ] **Step 2: 落ちることを確かめる**
  Run: `cd web && npx vitest run src/pages/map`
  Expected: FAIL

- [ ] **Step 3: 直す**（文言は設計書 3 章のとおり）

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(map): 最初の画面の町の欄のリンクを 1 本にし、地図で押した町と案内ページの言葉を分ける`

### Task 6: E2E の文言合わせ、全部の検証、撮影

**Files:**
- Modify: `web/e2e/wording.helper.ts:131-136`、`web/e2e/town.spec.ts:101-117`、`web/e2e/no-exact-location.spec.ts:145-149`、`web/e2e/shell.spec.ts:95`（ボタン名「自分の町を選ぶ」「自分の町にする」、リンク名。`grep -rn "町を選ぶ\|町を変える\|この町にする\|この町のくわしい状況\|選んだ町" web/e2e` で残りを探す。`helpers/frame.ts` は触らない）
- Modify: `web/e2e/town.spec.ts`（試験を 1 つ足す）

- [ ] **Step 1: E2E の試験を 1 つ足す**（town.spec.ts）`入力で探して町を決めると、欄の名前が変わり、地図の輪が動く`: 「自分の町を選ぶ」→「町の名前を入力」に「西粟倉」→「岡山県 西粟倉村」を押す → 欄に「西粟倉村」。続けて「自分の町を変える」が欄の中にある

- [ ] **Step 2: 文言合わせをして、全部の検証を流す**（HANDOFF「作業の手順」）
  - `npm test --silent -- --testTimeout=30000` → 落ちが 0
  - `npm run typecheck` → エラー 0／`cd web && npx vite build` → 成功
  - E2E: `FUNCTIONS_DISCOVERY_TIMEOUT=120 browser-guard run -- npx firebase emulators:exec --only firestore,auth,functions --project demo-hpai "cd web && npx playwright test area demo-walkthrough farm-profile list map member-join migration no-exact-location poster replay shell town wording"` → 全件通過
  - `bash .claude/hooks/public-precommit.sh --all-tracked` → 通過
  - 1 件だけ落ちたら全件を流し直して確かめる

- [ ] **Step 3: 撮影**（browser-guard の下で 1 本だけ）。PC 1280 幅とスマホ 390 幅で `/` と `/town` を撮る。見るのは次の 3 点。撮った画像は作者に見せる。
  - 変えるボタンが名前の横にあるか。
  - 入力で探して決めた後に地図が見えるか。
  - 選ぶ間、地図の上に文が出るか。

- [ ] **Step 4: Commit** `test(e2e): 自分の町の選び方の新しい文言と、入力で探す流れを確かめる`

- [ ] **Step 5: HANDOFF.md を更新**（作ったもの、commit、撮影の結果、残り）
