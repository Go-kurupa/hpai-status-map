# 条件で見る過去の発生と、重ねて比べる地図 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 過去 6 シーズンと今季の事例を、用途・羽数・地方のボタンで絞って見られる新しいタブを足す。「過去シーズンとの比べ」を 1 枚の地図の重ね合わせに替える。

**Architecture:**
- 絞り込みと数え方は純粋関数 `web/src/pages/explore/exploreData.ts` に置く。新しい画面 `ExplorePage` はそれを使うだけ。
- 地方は `web/src/geo/regions.ts` に置き、「条件で見る」と比べの両方が使う。
- 重ね合わせは地図の新しい 3 つの層（`cmp-one`／`cmp-two`／`cmp-both`）と純粋関数 `overlayStyle` で塗る。MapView と SvgMap は同じ決まりを読む。
- `CompareMaps` は地図を 1 枚にし、今の「2 つのシーズンの事例の欄」をそのまま使う。

**Tech Stack:** React 19 + TypeScript、maplibre（WebGL の地図）、SVG の代わりの地図、vitest + Testing Library、Playwright

**Spec:** `docs/superpowers/specs/2026-11-06-data-explore-design.md`

## Global Constraints

- 基点は `feat/hpai-map` の先頭（11/6 夜は `075a64c`）。始める前に `git log -1` と `git status` を確かめる。
- 別のセッションが触る範囲には入らない。
  - 相談機能: `shared/src/consult/`、`functions/src/consult/`、`scripts/consult/`、`data/consult/`、`web/src/pages/consult/`
  - README.md
- `SectionTabs.tsx` と `routes.tsx` に 1 行ずつ足す前に、別のセッションへ知らせる。
- 件数は今の画面と同じ数え方にする。過去は関連農場を除く（`!h.related`）。今季は `isCountable(c)`。
- 文言は `texts.ts`（地図）か `web/src/pages/explore/texts.ts`（新）に置く。禁句（安全、安心、区域の外です）を使わない。
- 守る文は `FIXED_TEXT.riskAnywhere` をそのまま使う。
- 割合、順位、「多い・少ない」の言葉は出さない。
- 色は設計書 E9 の値（作者が別の組み合わせを選んだら、`mapStyle.ts` の `PAINT.cmpOne`／`cmpTwo`／`cmpBoth` の 3 つだけを替える）。
- commit は作者の確認の後。`git add` はファイル名を名指しする。

## Review Focus

1. 今季の事例で用途・羽数が null のものを、絞り込みで黙って落とす → 記載なしの数を出す（Task 1 の試験 `記載なしは数えずに数だけ返す`）。
2. 比べる 1 と 2 に同じシーズンを選ぶ → 全部が「両方」に見える。案内の 1 文を出し、凡例は「両方」だけにする（Task 5 の試験 `同じシーズンを選ぶと案内を出す`）。
3. `?region=` に知らない値が来る → 全国のまま。落ちない（Task 6 の試験 `知らない地方は全国のまま`）。
4. 重ね合わせの層の上で町を押す → 塗りの層でなく `muni-fill` で町を拾う。押した町の欄が出る（Task 5 の試験 `重ねた地図で町を押すと欄が出る`）。
5. 今季の事例をまだ読めていない間に今季を比べに選ぶ → 塗りを出さず、「今季の発生をまだ読めていません」を出す（Task 5 の試験 `今季を読めていない間は塗らない`）。
6. 確認できていない県がある日に今季を比べる → 県の印を消さず、灰色の薄い塗りで出す（Task 5 の試験 `重ねる間も確認できていない県を示す`）。
7. 確認できていない県がある日の「条件で見る」の今季 → 「確認できた範囲では N 件」の断り（Task 2 の試験 `今季は確認できていない県の断り`）。

**区切り:** Task 1〜2 が終わったら commit し、作者に見せ、README の行を別のセッションへ渡す。ここで単独で本番に出せる状態にする。11/7 が押したら、削るのは重ね合わせ（Task 3〜7 の一部）で、「条件で見る」は削らない。

---

### Task 1: 地方と、絞り込みの純粋関数

**Files:**
- Create: `web/src/geo/regions.ts`、`web/src/geo/regions.test.ts`
- Create: `web/src/pages/explore/exploreData.ts`、`web/src/pages/explore/exploreData.test.ts`

**Interfaces:**
- Produces（regions.ts）:
  - `export type RegionId = "hokkaido" | "tohoku" | "kanto" | "chubu" | "kinki" | "chugoku" | "shikoku" | "kyushu"`
  - `export const REGIONS: ReadonlyArray<{ id: RegionId; name: string; prefCodes: readonly PrefCode[] }>`（設計書 4 章の順）
  - `export function regionOf(prefCode: PrefCode): RegionId`
- Produces（exploreData.ts）:
  - `export type UseBucket = "採卵鶏" | "肉用鶏" | "あひる" | "その他"`
  - `export type HeadBand = "1,000 羽未満" | "1,000〜1 万" | "1 万〜10 万" | "10 万以上"`
  - `export function useBucket(birdUse: string | null): UseBucket | null`（null は記載なし）
  - `export function headBand(headCount: number | null): HeadBand | null`
  - `export interface ExploreRow { key: string; season: Season; current: boolean; date: string | null; prefCode: PrefCode; muniCode: MuniCode | null; place: string; birdUse: string | null; headCount: number | null; url: string | null }`
  - `export function exploreRows(p: { history: readonly HistoryCase[]; currentCases: readonly Case[] | null; current: Season }): ExploreRow[]`（過去は関連農場を除く。今季は isCountable のみ。place は「岡山県 津山市」。今季で町が null なら県名だけ）
  - `export interface ExploreFilter { use: UseBucket | null; band: HeadBand | null; region: RegionId | null }`（null は「すべて」「全国」）
  - `export function filterRows(rows: readonly ExploreRow[], f: ExploreFilter): { hits: ExploreRow[]; missingUse: number; missingBand: number }`（missing は今季の記載なしで、条件に入れなかった数）
  - `export function countBySeason(hits: readonly ExploreRow[], seasons: readonly Season[]): Array<{ season: Season; count: number }>`

- [ ] **Step 1: 失敗する試験を書く**
  - regions: `regionOf("33") === "chugoku"`、`regionOf("01") === "hokkaido"`、`regionOf("47") === "kyushu"`。47 県がちょうど 1 回ずつ現れる。
  - `useBucket`: 「採卵鶏等」→ 採卵鶏、「育雛(肉用種鶏)」→ 肉用鶏、「あひる(あいがも)」→ あひる、「うずら」→ その他、null → null。
  - `headBand`: 999 → 1,000 羽未満、1000 → 1,000〜1 万、99999 → 1 万〜10 万、100000 → 10 万以上、null → null。
  - `exploreRows`: 関連農場を除く。今季の否定・確認中を除く。place が「岡山県 津山市」。
  - `記載なしは数えずに数だけ返す`: 今季で birdUse null の 1 件は、use が採卵鶏のとき hits に入らず、missingUse が 1。use が null のときは hits に入る。
  - `本物のデータで見本と同じ数`: `data/history/cases.json` を読み、region 中国 → 19 件、use 採卵鶏 → 171 件、band 1,000 羽未満 → 12 件（今季なし）。
  - `countBySeason`: 件数のないシーズンも 0 で返す。

- [ ] **Step 2: 落ちることを確かめる**
  Run: `npx vitest run web/src/geo/regions.test.ts web/src/pages/explore/exploreData.test.ts`（リポジトリ直下から。`web/` の中で流すと jsdom が効かない）
  Expected: FAIL（モジュールがない）

- [ ] **Step 3: 実装する**（上の名前と型のとおり）

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(explore): 地方の区分と、用途・羽数・地方で事例を絞る関数を足す`

### Task 2: 「条件で見る」の画面とタブ

**Files:**
- Create: `web/src/pages/explore/ExplorePage.tsx`、`web/src/pages/explore/ExplorePage.test.tsx`、`web/src/pages/explore/texts.ts`、`web/src/pages/explore/explore.css`
- Modify: `web/src/routes.tsx`（`{ path: "explore", element: <ExplorePage /> }`）、`web/src/ui/SectionTabs.tsx`（past の 2 番目に `{ to: "/explore", label: "条件で見る", match: (p) => under(p, "/explore") }`）
- Test: `web/src/routes.test.tsx`、`web/src/ui/ui.test.tsx`（タブの数と並び）

**Interfaces:**
- Consumes: Task 1 の全部。`useSeasonData()`（history、currentCases、current、historyFailed、retryHistory）
- Produces: `export default function ExplorePage()`

- [ ] **Step 1: 失敗する試験を書く**（ExplorePage.test.tsx。データは試験用の DataSource で渡す。MapPage.test の rig の作り方に倣う）
  - `問いのボタンで条件が入る`: 「中国地方の過去は？」を押す → 地方の「中国」が aria-pressed="true"、用途と羽数は「すべて」。
  - `件数と棒と一覧が同時に変わる`: 1 文に「N 件」、棒がシーズン 7 本（過去 6＋今季）、一覧の行数が N。
  - `3 件以下なら守る文`: 3 件の条件で `FIXED_TEXT.riskAnywhere` が件数の後にある。4 件では出ない。
  - `割で割らない断りがいつもある`: 「件数は農場の数で割っていません」の文がある。
  - `記載なしを伝える`: 今季に用途 null の事例があり、用途で絞ると「用途の記載がない今季の事例 1 件は、この条件に入れていません」。
  - `今季は確認できていない県の断り`: failedPrefCodes が 2 県のとき、今季の棒の数が `countText({ count, unchecked: 2 })` の文（「確認できた範囲では」）。
  - `地方を選ぶと地図への口が出る`: 中国を選ぶ → リンク「地図で中国を見る」の href が `/compare?region=chugoku`。全国では出ない。
  - `過去を読めないとき`: historyFailed で「過去の記録を読めませんでした」と［もう一度読む］。件数の 1 文は出さない。
  - `禁句がない`: `findForbiddenPhrases(document.body.textContent)` が空。
  - routes / ui の試験: `/explore` が開ける。過去の発生のタブが 3 つで、並びが「全国とシーズン」「条件で見る」「選択地域のまわり」。

- [ ] **Step 2: 落ちることを確かめる**
  Run: `npx vitest run web/src/pages/explore web/src/routes.test.tsx web/src/ui/ui.test.tsx`
  Expected: FAIL

- [ ] **Step 3: 実装する**。ボタンは `aria-pressed` で選択を示す。棒は `MonthBars` と同じ見た目の横棒（表と幅で描き、図の読み上げは表で足りる）。一覧は新しい順で、資料のリンクは `target="_blank" rel="noopener noreferrer"`。見出しは「条件で見る過去の発生」。

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(explore): 過去の発生に「条件で見る」のタブを足し、用途・羽数・地方のボタンで事例を絞って数と一覧を出す`

### Task 3: 重ね合わせの塗りの決まりと層

**Files:**
- Modify: `web/src/pages/map/hatch.ts`（`hatchImage` に向きの引数、網目の関数）、`web/src/pages/map/mapStyle.ts`（PAINT に 3 色、層 3 つ＋確認できていない県の灰色の層 `pref-unwatched-flat`）、`web/src/pages/map/applyView.ts`（`overlayStyle`、`applyOverlay`）、`web/src/ui/theme.css`（`--cmp-one`／`--cmp-two`／`--cmp-both`）
- Test: `hatch.test.ts`、`mapStyle.test.ts`、`applyView.test.ts`

**Interfaces:**
- Produces:
  - `hatchImage(color: Rgb, period?, stripe?, dir?: "up" | "down"): RgbaImage`（既定 "up" で今と同じ画素）
  - `crossHatchImage(color: Rgb, period?, stripe?): RgbaImage`
  - `PAINT.cmpOne = "#d97a00"`、`PAINT.cmpTwo = "#00857a"`、`PAINT.cmpBoth = "#3b3b8f"`、画像の id `hatch-cmp-one`／`hatch-cmp-two`／`hatch-cmp-both`
  - 層 `cmp-one`／`cmp-two`／`cmp-both`（type fill、fill-pattern、filter は空で始める。**minzoom なし**（設計書 E13）。`case-confirmed` の上、`muni-line` の下）
  - 層 `pref-unwatched-flat`（type fill、fill-color `PAINT.muted`、fill-opacity 0.25、filter は空で始める。設計書 E14）
  - `OverlayState` に `unwatchedPrefCodes: readonly PrefCode[]` を足す。`applyOverlay` は overlay があるとき `pref-unwatched` を空にし、`pref-unwatched-flat` にこの県を入れる。null なら `pref-unwatched-flat` を空にする
  - `export type OverlayShow = "both" | "one" | "two"`
  - `export interface OverlayState { first: readonly MuniCode[]; second: readonly MuniCode[]; show: OverlayShow }`
  - `export function overlayStyle(s: OverlayState): { one: MuniCode[]; two: MuniCode[]; both: MuniCode[] }`
  - `export function applyOverlay(map: ViewTarget, s: OverlayState | null): void`（null なら 3 層を空にする）

- [ ] **Step 1: 失敗する試験を書く**
  - hatch: `dir: "down"` の画像は "up" の左右反転。網目は 2 つの和。既定の画素は今と同じ（今の試験が通ったまま）。
  - mapStyle: 3 層が `case-confirmed` と `muni-line` の間にあり、minzoom を持たない。PAINT の 3 色が設計書 E9 の値で、theme.css の `--cmp-*` と同じ（今の色の突き合わせの試験に 3 行足す）。
  - `applyOverlay` で、overlay の unwatchedPrefCodes が `pref-unwatched-flat` に入り、`pref-unwatched` は空になる。
  - `overlayStyle`: first [A,B]、second [B,C]、show both → one [A]、two [C]、both [B]。show one → one [A,B]、two と both は空。show two → two [B,C]。
  - `applyOverlay(null)` で 3 層の filter が空。

- [ ] **Step 2: 落ちることを確かめる**
  Run: `npx vitest run web/src/pages/map/hatch.test.ts web/src/pages/map/mapStyle.test.ts web/src/pages/map/applyView.test.ts`
  Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 通ることを確かめる**（同じコマンド。PASS）

- [ ] **Step 5: Commit** `feat(map): 2 つのシーズンを重ねる 3 つの模様（／、＼、×）の層と塗りの決まりを足す`

### Task 4: MapView と代わりの地図に重ね合わせを渡す

**Files:**
- Modify: `web/src/pages/map/MapView.tsx`（prop `overlay?: OverlayState | null`。3 つの画像を登録し、`applyOverlay` を呼ぶ。overlay があるときは、発生の 2 層（case-suspected、case-confirmed）を空にし、県ごとの件数の札を出さない（設計書 E13）。確認できていない県は `applyOverlay` が灰色の層で出す）
- Modify: `web/src/pages/map/SvgMap.tsx`（同じ prop。3 つの SVG の模様と、`data-fill="cmp-one|cmp-two|cmp-both"` の塗り）
- Test: `SvgMap.test.tsx`、`MapPage.test.tsx`（地図の props を見る既存の作り方で）

**Interfaces:**
- Consumes: Task 3 の `OverlayState`、`applyOverlay`、`overlayStyle`、PAINT の 3 色
- Produces: `MapViewProps.overlay?: OverlayState | null`（SvgMap も同じ名前）

- [ ] **Step 1: 失敗する試験を書く**
  - SvgMap: overlay を渡すと、A だけの町に `data-fill="cmp-one"`、両方の町に `data-fill="cmp-both"`。overlay がないときは今の塗りのまま。確認できていない県は斜線でなく灰色の塗り。
  - MapView は偽の map の試験がないので、applyView.test の偽の map で `applyOverlay` を確かめた Task 3 に任せる。MapPage.test で `lastProps().overlay` が渡ることだけを Task 5 で見る。

- [ ] **Step 2〜4:** 落ちる → 実装 → 通る（`npx vitest run web/src/pages/map/SvgMap.test.tsx`）

- [ ] **Step 5: Commit** `feat(map): 地図と代わりの地図が、2 つのシーズンの重ね合わせを描けるようにする`

### Task 5: 比べを 1 枚の地図の重ね合わせにする

**Files:**
- Modify: `web/src/pages/map/CompareMaps.tsx`（2 枚目と同期の仕組みを外す。1 枚の地図、見せ方の 3 ボタン、凡例と町の数、2 つのシーズンの事例の欄は今の `rowsOf` を使う）
- Modify: `web/src/pages/map/MapPage.tsx`（compare の `renderMap` を 1 枚にし、`overlay` を渡す。凡例は CompareMaps の中）
- Modify: `web/src/pages/map/texts.ts`（見せ方、凡例、同じシーズンの案内、今季は疑いを含む）
- Modify: `web/src/pages/map/map.css`（2 列の比べの規則を 1 枚に）
- Test: `CompareMaps.test.ts`、`MapPage.test.tsx`（比べの試験を書き換える）

**Interfaces:**
- Consumes: Task 4 の `overlay` prop。`buildSeasonView` の `confirmedMuniCodes` と `suspectedMuniCodes`（2 つの和を「発生あり」の町にする）
- Produces: `CompareMapsProps.renderMap(o: { overlay: OverlayState | null; focus; ariaLabel; onInspectMuni })`（index と onMapReady を外す）

- [ ] **Step 1: 失敗する試験を書く**
  - `重ねた地図で町を押すと欄が出る`: `lastProps().onInspectMuni("33203")` → 2 つのシーズンの見出しと事例が 1 つの欄に並ぶ。
  - `見せ方の切り替え`: 「1 だけ」を押すと `lastProps().overlay.show === "one"`。地図は 1 枚だけ（`__hpaiMap2` 相当の 2 枚目の props がない）。
  - `凡例の町の数`: 試験のデータで「〇〇だけ（N 町）」が 3 行出る。
  - `同じシーズンを選ぶと案内を出す`: 1 と 2 が同じ → 「同じシーズンを選んでいます。別のシーズンを選ぶと比べられます。」。
  - `今季を読めていない間は塗らない`: 今季を選び、事例が届く前は `overlay` が null で、「今季の発生をまだ読めていません」が出る。
  - `今季は疑いを含むと添える`: 今季を選ぶと凡例に「今季は疑いを含みます」。
  - `重ねる間も確認できていない県を示す`: 今季を選び failedPrefCodes が 1 県 → `lastProps().overlay.unwatchedPrefCodes` にその県。凡例に「確認できていない県」。過去 2 シーズンどうしでは空。

- [ ] **Step 2〜4:** 落ちる → 実装 → 通る（`npx vitest run web/src/pages/map`）

- [ ] **Step 5: Commit** `feat(map): 過去シーズンとの比べを、1 枚の地図に斜線の向きで重ねる形にする`

### Task 6: 比べの地図を地方の広さに寄せる

**Files:**
- Modify: `web/src/pages/map/MapPage.tsx`（compare のとき、広さのボタンを 1 段にまとめる: ［選択地域付近］［全国］＋8 地方。押された印は最後に押した 1 つ。`?region=` が正しい地方なら最初にそこへ寄せ、`startNear` の動きをしない。設計書 E15）
- Test: `MapPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `REGIONS`、`RegionId`。今の `moveTo("muni", codes)`（地方の県の町を全部渡すと、その外枠に寄る）

- [ ] **Step 1: 失敗する試験を書く**
  - `地方のボタンで寄せる`: 「中国」を押す → `lastProps().focus.kind === "muni"` で、codes が 31〜35 の県の町だけ。「全国」で kind が japan。
  - `?region=chugoku で開くと中国に寄る`: 地域を選んである（TOWN_KEY あり）状態で開いても、町の形が届いた後の最後の focus が中国の町のまま（選択地域付近に上書きされない）。押された印は「中国」。
  - `知らない地方は全国のまま`: `?region=xxx` で focus が japan か null。落ちない。

- [ ] **Step 2〜4:** 落ちる → 実装 → 通る（`npx vitest run web/src/pages/map/MapPage.test.tsx`）

- [ ] **Step 5: Commit** `feat(map): 比べの地図を地方の広さに寄せるボタンを足し、条件で見るからの地方の指定を受ける`

### Task 7: E2E、全部の検証、撮影、README の行の知らせ

**Files:**
- Modify: `web/e2e/map.spec.ts`（比べの試験を 1 枚の地図に合わせる。`__hpaiMap2` を使う試験は書き換える）、`web/e2e/helpers/frame.ts`（VIEWS に条件で見る。別のセッションへ知らせてから）
- Create: `web/e2e/explore.spec.ts`

- [ ] **Step 1: E2E を書く**
  - explore: メニューから過去の発生 → 条件で見る。「中国地方の過去は？」で 1 文が「19 件」を含む（試験の今季の事例がなければ）。一覧の 1 行目の資料のリンクが https。
  - map: 比べで 2024〜25 と 2025〜26 を選ぶと、地図の `cmp-one`／`cmp-two`／`cmp-both` の層の filter に町が入る。「中国」で地図の中心が中国地方に入る。
- [ ] **Step 2: 全部の検証**（HANDOFF「作業の手順」）。単体、型、build、E2E 全部（explore を加える）、公開前の検査。1 件だけ落ちたら全部を流し直す。
- [ ] **Step 3: 撮影**: PC 1280 とスマホ 390 で `/explore`（中国を選んだ状態）と `/compare`（重ねる、中国）。作者に見せる。
- [ ] **Step 4: Commit** `test(e2e): 条件で見るの流れと、重ねた比べの地図を確かめる`
- [ ] **Step 5:** README の審査員の節に足す行（`/explore` の 1 行と、`/compare` の説明の直し）を、別のセッションへ知らせる。HANDOFF.md を更新する。
