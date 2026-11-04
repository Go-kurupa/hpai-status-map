# 領域 W: 地図と公開の画面 実装計画

正は設計書（§）。名前と依存は共通の取り決め（契約）に従う。ここは契約にない W の宣言と試験の主張だけを書く。段階、解除、死亡率の計算は F と M、全画面の文言の巡回と本番の build の検査は X-20 の担当で、W は表示だけを試験する。

**【確】実物で確かめたこと（2026-11-03）**

- `maplibre-gl@6.16.0` は `vite@8.3.5` の build で `Worker failed to load` になる。`import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"` と `setWorkerUrl(workerUrl)` で動く。jsdom では動かない。
- headless Chromium の WebGL は `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` が要る。`@playwright/test@1.64.1`。
- 淡色地図は国の一覧ページに、日本周辺の ZL5〜18 と全球の ZL2〜8（ZL5〜8 の日本周辺を除く）の 2 節がある。ZL5〜8 と全球の ZL2〜8 の**両方**が同じ VMAP0 の出所の明示を求める。360px の全国の倍率は ZL5 未満を使うので `minzoom:2` にする。
- 防疫指針は `index-75.pdf` が全体版。家保の一覧 `k_kaho/` は取得できる。`press/syouan/douei/260422.html` に取材と噂の定型文がある。

**試験**: 単体は `npx vitest run --project <web|shared> --passWithNoTests=false <file>`。E2E は `web/` で `browser-guard run -- npx playwright test <file>`。`dist-e2e` の画面で `window.__HPAI_FIXTURE__` を `DataSource` にし、地理院タイルは `page.route` で 1×1 の PNG を返す。全画面に「いつ時点か」を出す（§15）。

---

### Task W-01: 画面の骨格、共通部品、データの口

読む節: 1.4、1.5、2.1〜2.3、3.10、6.2、6.3、F-05 Interfaces

**Day:** 11/4 / **Depends on:** F-05

**Files:**
- Create（`web/src/` の下）: `main.tsx`、`routes.tsx`、`firebase.ts`、`data/{types,context,source,fixture,live}`、`ui/{theme.css,AppShell,Button,Tag,AsOf,SourceLine,ClassBlock,Placeholder}`、`pages/auth/firestoreRecordStore.ts`（仮）、全経路の仮の画面
- Create: `web/playwright.config.ts`、`web/e2e/fixtures.ts`
- Modify: `web/package.json`（`@playwright/test@1.64.1`、`topojson-client@3.1.0`、dev `@types/topojson-client@3.1.5`）、`.gitignore`（`web/test-results/`、`web/playwright-report/`、`web/dist-e2e/`）
- Test: `web/src/{routes.test.tsx,ui/ui.test.tsx,firebase.test.ts,data/live.test.ts}`、`web/e2e/shell.spec.ts`

**Interfaces:** 契約 3.10 に足すもの。

```ts
export function createDataSource(): DataSource;     // MODE==="e2e" かつ __HPAI_FIXTURE__ があれば fixture、他は live
export function resolveFirebaseMode(search: string, isDev: boolean): "emulator" | "hosting";
export function formatAsOf(iso: IsoDateTime): string;
// web/src/ui の部品の props。Button は高さ 48px 以上
// Tag: { tone: "lv1" | "lv2" | "lv3" | "lv4" | "neutral"; children }
// AsOf: { iso: IsoDateTime | null }  null は「確認できていません」
// SourceLine: { title: string; url: string; checkedOn?: IsoDate }
// ClassBlock: { cls: ChecklistClass; heading: string; children }
```

画面は既定 export の関数。`routes.tsx` は `React.lazy` で読み、他の領域はファイルを置き換えるだけで `routes.tsx` を触らない。

| 経路 | `web/src/pages/` の下 | 所有 |
|---|---|---|
| `/` | `map/MapPage.tsx` | W |
| `/public`、`/area/:muniCode`、`/poster`、`/known` | `public/{Public,Area,Poster,Known}Page.tsx` | W |
| `/todo` | `todo/TodoPage.tsx` | M |
| `/record`、`/record/deaths`、`/record/self-check`、`/record/disinfection` | `record/{Record,Deaths,SelfCheck,Disinfection}Page.tsx` | M |
| `/settings/farm`、`/settings/notify`、`/settings/explainer` | `settings/{FarmSettings,NotifySettings,Explainer}Page.tsx` | M |
| `/login`、`/join/:code` | `auth/{Login,Join}Page.tsx` | M |
| `/operator` | `operator/OperatorPage.tsx` | I |
| `/replay`、`/replay/backstage` | `replay/{Replay,Backstage}Page.tsx` | X |
| `/sample`、`/sample/todo`、`/sample/record`、`/sample/record/{deaths,self-check,disinfection}` | `sample/{Sample,SampleTodo,SampleRecord}Page.tsx`（下の 4 つは `SampleRecordPage`） | X |
| `/results`、`/trends`、`/privacy` | `results/ResultsPage.tsx`、`trends/TrendsPage.tsx`、`privacy/PrivacyPage.tsx` | X |

**M-01 への制約**: 根が読む `firestoreRecordStore.ts` は `firebase/*` を動的にだけ import する（型は `import type`）。静的に読むと公開の画面に Firebase が載る。

- [ ] **Step 1: 失敗する試験を書く**
  - `routes.test.tsx`: nav の link が `["地図","やること","記録"]`、header に「設定」／全経路が `matchRoutes` で当たる／`routes`、`data/source`、`data/live`、`data/context`、`ui/*`、`firestoreRecordStore` に `firebase/` の静的 import がない。
  - `ui.test.tsx`: `formatAsOf("2025-12-21T09:00:00+09:00")` が `"12 月 21 日 9:00 時点"`／「義務ではありません」は `good_to_check` だけ（§2）／`theme.css` に `box-shadow|text-shadow|drop-shadow|gradient|backdrop-filter` がなく本文 18px 以上／段階の色は白とのコントラスト 4.5 以上。
  - `firebase.test.ts`: `("?emulator=1",false)` と `("",true)` は emulator、`("",false)` は hosting。
  - `live.test.ts`（firestore を mock）: `where season` で絞る／初期化の前の解除で購読が残らない／error で cases の `cb` を呼ばない（§2）／`includeMetadataChanges:true` で受け、`fromCache:true` では空でも行ありでも cases の `cb` を呼ばず、`false` で呼ぶ／watchStatus は error と `fromCache` で `cb([])`。
  - `shell.spec.ts`: 幅 360px で `scrollWidth <= 360`、「やること」で `/todo`／fixture なしで `/public`、`/poster`、`/known` を開き、JS の本文に `FirebaseError` がなく googleapis への要求が 0 件。
- [ ] **Step 2: 確かめる** 単体。期待: import の失敗。
- [ ] **Step 3: 実装**
  - `playwright.config.ts`: `copy-web-data` の後に `vite build --mode e2e --outDir dist-e2e`、`vite preview` の `--port 5174`。`fixtures.ts` の `installFixture(page, { now, cases, wildBirds, watch })`。
  - `firebase.ts`: emulator は `projectId:"demo-hpai"`、接続先は `location.hostname` の 8080、9099、5001（利用者は別の機械から開く）。hosting は `/__/firebase/init.json`。`getFunctions(app,"asia-northeast1")`。
  - `theme.css`: `--lv1 #B3261E`、`--lv2 #8A5A00`、`--lv3 #00639B`、`--lv4 #4A4F57`、`--muted #5C6168`、`--font-base 18px`、`--tap 48px`。
  - `ClassBlock`（§7）: `always` は `--fg` の実線、`if_in_zone` は `--lv1` の太線、`good_to_check` は `--muted` の破線と Tag「義務ではありません」。
  - 仮の `firestoreRecordStore`: `getFarm` は null、一覧は空、`isMailStopped` は false、保存は `throw new Error("準備中")`。
- [ ] **Step 4: 確かめる** 単体と `shell.spec.ts`。
- [ ] **Step 5: Commit** `feat(web): 画面の骨格、共通部品、データの口を作る`

---

### Task W-02: 地図（入口）、シーズン、バッジ、地図の出典

読む節: 2.1、3.1、3.2、5、F-06、F-07、F-08 Interfaces、W-01 Interfaces、索引 Q16

**Day:** 11/4 / **Depends on:** W-01、F-07、F-08
**Human:** 人の作業の「11/4 夜」

**Files:**
- Create: `web/src/geo/{maplibre,attribution,loadGeo}.ts`、`web/src/pages/map/{seasonView,hatch,mapStyle,applyView,useSeasonData}.ts`、`web/src/pages/map/{MapView,SeasonBar,MonthBars,MapLinks}.tsx`、`docs/map-acceptance.md`
- Modify: `web/src/pages/map/MapPage.tsx`、`docs/data-sources.md`（「地理院タイル」の節。N03 の節に混ぜない）
- Test: `web/src/geo/attribution.test.ts`、`web/src/pages/map/{seasonView,applyView}.test.ts`、`SeasonBar.test.tsx`、`web/e2e/map.spec.ts`

**Interfaces:** X-02 と M-01 が使う。

```ts
// geo/maplibre.ts は MlMap、Marker、AttributionControl を再 export。geo/loadGeo.ts は loadWebGeoStore()
export const MAP_ATTRIBUTION: string[]; export const VMAP0_NOTICE: string;  // geo/attribution.ts
export interface SeasonView {
  season: Season; label: string; isCurrent: boolean; loaded: boolean; cases: readonly Case[];
  suspectedMuniCodes: MuniCode[]; confirmedMuniCodes: MuniCode[];
  countByPref: Record<PrefCode, number>; reviewingPrefCodes: PrefCode[]; total: number; months: MonthBar[];
}
export function buildSeasonView(i: { season: Season; current: Season; currentCases: readonly Case[] | null; history: readonly HistoryCase[] }): SeasonView;
export function listSeasonBars(i: Omit<Parameters<typeof buildSeasonView>[0], "season">): Array<{ season: Season; label: string; count: number | null }>;
export function badgeStates(view: SeasonView, zoom: number): Array<{ prefCode: PrefCode; text: string }>;
export const MUNI_ZOOM = 7;  // 未満は県のバッジ、以上は市町村の塗り（§15）
export const JAPAN_BOUNDS = [[122.9, 24.0], [146.0, 45.6]];
export interface MapViewProps {  // MapView.tsx の既定 export
  view: SeasonView; wildBirds: readonly WildBird[]; failedPrefCodes: readonly PrefCode[];
  myMuniCode: MuniCode | null; nearMuniCodes: readonly MuniCode[];
  focus: { kind: "japan" | "muni"; codes: MuniCode[]; nonce: number } | null;
  pickMode?: boolean; onSelectMuni?: (code: MuniCode) => void; onMapReady?: (map: MlMap) => void;
}
```

`countByPref` は `isCountable` かつ同じシーズンを数える。`historyToCase` は F-08 のものを使い、`related:false` だけを渡す。

`MAP_ATTRIBUTION` は常に全文で出す（索引 Q16 の既定）:
1. [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)に行政区域を追記して掲載
2. `VMAP0_NOTICE` = `Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.`
3. [国土数値情報（行政区域データ）（国土交通省）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html)をもとに作成。形を簡略化

- [ ] **Step 1: 失敗する試験を書く**
  - `attribution.test.ts`: 上の 2 つのリンク、`/Vector Map Level 0/`、`/国土交通省/`、`/簡略化/`／`/(不要と確認|手続きは不要|申請不要)/` に当たらない（契約 0）／`docs/data-sources.md` に `VMAP0_NOTICE` と同じ文。README は X-26 が写す。
  - `seasonView.test.ts`（実データ）: 2020〜2025 の `total` が `[52,25,84,11,51,24]`、`related:false` が 247 行（§16）／`related:true` を足しても件数が同じ／県の合計＝シーズンの件数／2025 の月別 `[[10,1],[11,4],[12,7],[1,6],[2,2],[3,3],[4,1],[5,0]]`、羽数 `[459000,1194000,2241000,338000,620000,657000,230000,0]`／9 月の事例は 9 月の棒を足して隠さない／羽数 null は `unknownHeadCases`／`{suspected}` は疑い、`{suspected,confirmed}` は確定／確認中は件数と塗りに入らず `reviewingPrefCodes`／否定は数えず候補は数える／今季 = 2025（再現）で履歴の 2025 を混ぜない／棒は `今季、昨季、2 年前…6 年前`／`currentCases` null は `count` null、`loaded` false。
  - `applyView.test.ts`（偽の map）: 切り替えは `setFilter` だけで `setData` 0 回／読めなかった県は `pref-unwatched` の `["in",["get","p"],["literal",["33"]]]`／野鳥は否定を除き検査中と確定を分ける／`badgeStates` はズーム 6.9 で 1 件以上の県だけ、7 で空、確認中の県は「確認中」。
  - `SeasonBar.test.tsx`: 棒は `aria-pressed` の button。
  - `map.spec.ts`: 地図が読み込まれ `Worker failed` がない／回転と傾きができず、`circle` のレイヤーがない（§2）／昨季を押すと「24 件」、`case-confirmed` に 33203、`japan.topo.json` の要求は 1 回／`case-*` の `minzoom` が 7（§15）／要求が `/xyz/pale/{z}/{x}/{y}.png`、幅 360px で帰属の欄が見え `/地理院タイル/`、`/Vector Map Level 0/`、`/国土数値情報/` がある／今季 0 件で `FIXED_TEXT.riskAnywhere` があり禁止語がない／地図の下のリンクで `/public`、`/known`、`/replay`、`/results`、`/privacy` に着き、タブは 3 つのまま（§3、§11）。
- [ ] **Step 2: 確かめる** 単体。期待: import の失敗。
- [ ] **Step 3: 実装**
  - `dragRotate:false`、`pitchWithRotate:false`、`touchPitch:false`、`touchZoomRotate.disableRotation()`、`maxZoom:13`。`MODE==="e2e"` のときだけ `window.__hpaiMap`。
  - レイヤーは下から `gsi-pale`（raster、`tileSize:256`、`minzoom:2`、`maxzoom:18`）→ `muni-fill`（タップの受け）→ `pref-unwatched` → `case-suspected`（`fill-pattern`）→ `case-confirmed`（どちらも `minzoom: MUNI_ZOOM`）→ `muni-line`（`minzoom:5.5`）→ `near-line` → `pref-line` → `my-town` → `wild-bird-screening`、`wild-bird-confirmed`（symbol）。source `muni` は `tolerance:0.3`。
  - 斜線は疑いが `--lv1`、確認できていない県が `--muted`。バッジの `Marker` は 1 度だけ作る。
  - `MapPage` の並び: 地図、棒、`MonthBars`、`MapLinks`（鶏を飼っていない方へ、分かっていること、去年の再現、試験の結果、プライバシー）、過去のとき `pastDisclaimer`、今季 0 件のとき `riskAnywhere`。棒の前に `dataviz` スキルを読む。
- [ ] **Step 4: 確かめる** 単体と `map.spec.ts`。
- [ ] **Step 5: Human** LAN の開発サーバーで、利用者が普及価格帯のスマホで日本全体から町まで動かす。合格: カクつきで操作を見失わない（§16）。機種、価格帯、回線、合否を `docs/map-acceptance.md` に書く。数字を作らない。不合格なら 11/5 朝に F-06 の簡略化の値、`muni-line` の `minzoom` の順に直す。出典の長さも見る（索引 Q16）。
- [ ] **Step 6: Commit** `feat(web): 地図、シーズン、バッジ、出典を作る`

---

### Task W-03: 過去の 1 文、町の選択、自分の町の 1 文、端末内の地点

読む節: 2.1、2.4、3.1、3.2、3.10、8、W-02 Interfaces

**Day:** 11/5 / **Depends on:** W-02
**Human:** 人の作業の「W-03 の後、遅くとも 11/6」

**Files:**
- Create: `shared/src/past.ts`、`web/src/data/{spot.ts,spotContext.tsx}`、`web/src/pages/map/{townLine,texts}.ts`、`web/src/pages/map/{TownBanner,TownPicker,SpotPicker,PastList}.tsx`
- Modify: `web/src/pages/map/MapPage.tsx`、`web/src/routes.tsx`（根に `SpotProvider`）、`docs/map-acceptance.md`
- Test: `shared/test/past.test.ts`、`web/src/data/spot.test.ts`、`web/src/pages/map/{townLine.test.ts,TownBanner.test.tsx}`、`web/e2e/{town,live-smoke}.spec.ts`

**Interfaces:**

```ts
export interface PastHit extends HistoryCase { ago: string; relation: "same" | "adjacent" }
export interface PastSummary { sentence: string; latest: PastHit | null; hits: PastHit[] }
export function describePast(muniCode: MuniCode, history: readonly HistoryCase[], geo: Pick<GeoStore,"adjacency">, current: Season): PastSummary;
export function spotFromPick(lat: number, lng: number, muniCode: MuniCode, frequent: readonly MuniCode[]): FarmPoint; // data/spot.ts。ほかに parseSpot、loadSpot、saveSpot、clearSpot、loadTown、saveTown。TOWN_KEY = "hpai.town.v1"
export interface TownLine { tone: "lv1" | "lv2" | "lv3" | "lv4" | "none"; main: string; details: string[] }
export function levelLine(result: LevelResult, cases: readonly Case[]): TownLine;
export function areaLine(status: AreaStatus): TownLine;
export function resolveTownLine(i: { spot: FarmPoint | null; town: MuniCode | null; cases: readonly Case[]; birds: readonly WildBird[]; season: Season; geo: GeoStore; asOf: IsoDateTime }): Promise<TownLine>;
export const SURVEILLANCE_NOTE = "監視強化区域は、制限が解除された後も監視を続ける区域です。段階には数えません。県の発表を確かめてください"; // texts.ts
```

`useSpot` は fixed → 会員の農場 → 端末内の順。**`getFarm` は `useSpot` が最初に呼ばれるまで呼ばない**（根の Provider が公開の画面に Firebase を読ませないため）。

- [ ] **Step 1: 失敗する試験を書く**
  - `past.test.ts`: `"2 年前に隣町で発生しました（記録）"`、`"昨季にこの町で発生しました（記録）"`／新しいものを選び、同じ日はこの町を優先／離れた町は入らない／記録なしは `"過去の記録に、この町と隣町の発生はありません（記録）"`／再現の今季 = 2025 で 2025 を数えない／`related:true` は hits に入り、本体があれば sentence は本体から、関連農場だけなら `"2 年前に隣町で関連農場がありました（記録）"`／`/また発生しやすい|危ない|うつる|危険地帯|ホットスポット|確率/` がない（§11）。
  - `spot.test.ts`: `spotFromPick(35.681,139.767,"13101",[])` が `{meshCode:"53394611",muniCode:"13101",frequentMuniCodes:[]}`、保存は 3 キーで緯度経度がない／余計なキーを捨て、形が違えば null／storage の例外で null／`SpotProvider` を置くだけでは `getFarm` を呼ばない。
  - `townLine.test.ts`（§5 の文）: ①`"区域に入っている可能性があります。県の連絡を確かめてください"`、②`"隣町で発生しました"`、③`"登録した町で発生しました"`、④`"全国の動きをお知らせしています"` と `riskAnywhere`／level 2、`same_muni` と `areaLine` の `sameMuniCases` ありは `FIXED_TEXT.sameMuniLifted` で `/隣町/` がない（契約 2.4）／`"津山市で疑い（12 月 19 日）"`、`"津山市で確定（12 月 20 日）"`／`shipmentLifted` は tone lv1 のまま「搬出制限は解除されました」（§5）／`inSurveillanceNote` は `SURVEILLANCE_NOTE` で tone 不変／全文に禁止語がない／**`areaLine` の level 1、2、4 のすべてで `areaNoDistance` と `riskAnywhere`（契約 8）**／偽の GeoStore（`ensurePrefs` の前は `GeoNotLoadedError`）で、津山市の center のメッシュと鳥取市の事例の `resolveTownLine` が投げない（契約 3.2）。
  - `TownBanner.test.tsx`: 色は今季の段階だけで過去の行に `data-tone` がない（§15）／`loaded` false は「読み込んでいます」で段階の文がない（§2）／`/area/{code}` へのリンク（§11）。
  - `town.spec.ts`（実データ、now 2026-11-10）: 33214 を選び事例 33203 で「隣町で発生しました」、過去「昨季に隣町で発生しました（記録）」、`my-town` に 33214、`near-line` に 33203／地点の指定で①、シーズンを変えても `data-tone` は lv1／行き来する町で③／指定の前後の全要求に緯度経度がなく Firestore の書き込み 0 件、再読み込みで残る（§12、§16）／地点の source がない。
  - `live-smoke.spec.ts`（模擬環境）: `cases/x` が `/?emulator=1` の `case-confirmed` に届く／`google.firestore.v1` の通信を abort して 15 秒後に「0 件」と段階の文がなく「読み込んでいます」（§2）。
- [ ] **Step 2: 確かめる** 単体。期待: import の失敗。
- [ ] **Step 3: 実装**
  - `resolveTownLine`: spot があれば `await geo.ensurePrefs(prefsToLoad(cases, birds))` の後に `computeLevel`、なければ town で `computeAreaStatus`、どちらもなければ「町を選んでください」。常に今季の事例で計算する。
  - `TownPicker`: 県 → 市町村の選択と地図のタップの両方を残す。ボタンは「全国」と「自分の町」。
  - `SpotPicker`: 中央の十字の位置を `muni-fill` で市町村にし `spotFromPick` に通し、座標を捨てる。海の上なら「町の上に合わせてください」。
  - `PastList`: `related` は「関連農場」と明示する。
- [ ] **Step 4: 確かめる** 単体と `town.spec.ts`、`web/` で `browser-guard run -- npx firebase emulators:exec --only firestore,auth --project demo-hpai "npx playwright test e2e/live-smoke.spec.ts"`。SDK の挙動は未実測で、違えば `live.ts` と試験を直す。
- [ ] **Step 5: Human** 60 代以上の 1 人が説明なしで自分の町を選ぶ。合格: 迷わず 1 文まで着く（§16）。詰まった箇所を `docs/map-acceptance.md` に書き（氏名なし）、直してもう一度。
- [ ] **Step 6: Commit** `feat(web): 過去の 1 文、町の選択、端末内の地点を作る`

---

### Task W-06: 確認状況と一覧

読む節: 2.1、3.2、6.3、I-08 Interfaces、W-03 Interfaces

**Day:** 11/5 / **Depends on:** W-03、I-08

**Files:** Create: `web/src/pages/map/{watchLine,listRows}.ts`、`web/src/pages/map/{WatchLine,CaseListSheet,Legend}.tsx` / Modify: `MapPage.tsx`、`texts.ts` / Test: `web/src/pages/map/{watchLine,listRows}.test.ts`、`web/e2e/list.spec.ts`

**Interfaces:**

```ts
export function completeWatchStatus(all: readonly WatchStatus[]): WatchStatus[]; // 47 行にする
export function watchLine(all: readonly WatchStatus[], now: Date): { text: string; asOf: IsoDateTime | null; failedPrefCodes: PrefCode[] };
export function listRows(cases: readonly Case[], now: Date): ListRow[];  // 新しい順。label は displayStage
export function wildBirdRows(birds: readonly WildBird[]): WildBirdRow[]; // negative を除く
export const DETECTION_LIMIT_NOTE = "疑いは、県の発表を見つけられた県だけ出ます。見つけられないと、国の発表（約 1 日後）で初めて確定として載ります"; // §9.2
export const WILD_ZONE_NOTE = "環境省の野鳥監視重点区域は、防疫指針の区域とは別のものです"; // §5
```

- [ ] **Step 1: 失敗する試験を書く**
  - `watchLine.test.ts`: `"47 都道府県のうち 45 件を確認、2 件は確認できていません（東京都、岡山県）"`（§9.7）／空でも `/^47 都道府県のうち 0 件を確認、47 件は確認できていません/`（§2）／全県確認で括弧なし／`failedPrefCodes` に "33"／`asOf` は `checkedAt` の最大で `now` に動かされず、行がなければ null（§15）。
  - `listRows.test.ts`: 確認中は県名、確認中、リンクだけ／否定は 7 日残り 8 日目に消える（§10.2）／label が `displayStage(c,now).label`／禁止語なし／野鳥は否定を除き陽性は検査中。
  - `list.spec.ts`: 「一覧」を押すと `aria-expanded` true、昨季 24 行、出典が maff.go.jp／33 を `ok:false` で文に「岡山県」、`pref-unwatched` に "33"、凡例に「確認できていない県」（§16）。I-02 の取得の失敗、TLS の失敗、200 で中身が別物は、どれも同じ `ok:false` でここに出る／一覧に `DETECTION_LIMIT_NOTE`、`WILD_ZONE_NOTE`、`SURVEILLANCE_NOTE`（§5）／地図に `checkedAt` の時点。
- [ ] **Step 2: 確かめる** 単体。期待: import の失敗。
- [ ] **Step 3: 実装** `watchLine` は `summarizeWatch(completeWatchStatus(all), now)` を通す。`CaseListSheet` は閉じると 1 行で、押して開ける。農場の特徴や不備の項目を持たない（§12）。凡例: 疑い（斜線）、確定（単色）、野鳥の検査中、野鳥の確定、確認できていない県。
- [ ] **Step 4: 確かめる** 単体と `list.spec.ts`。
- [ ] **Step 5: Commit** `feat(web): 確認状況と一覧を作る`

---

### Task W-07: 公式の文、市町村の案内、貼り紙

読む節: 2.4、3.2、3.9、7.3、8、索引 Q14、Q15、W-03、W-06 Interfaces

**Day:** 11/6 / **Depends on:** W-06
**Human:** 人の作業 11、人の作業の「11/7 15:00」

**Files:**
- Create: `shared/src/guidance/official.ts`、`web/src/pages/public/{GuidanceSection.tsx,pageNotes.ts,poster.css}`、`docs/official-text-review.md`
- Modify: `web/src/pages/public/{Public,Area,Poster}Page.tsx`、`web/package.json`（`qrcode-generator@2.0.4`）
- Test: `shared/test/official.test.ts`、`web/src/pages/public/{Public,Area,Poster}Page.test.tsx`、`web/e2e/{area,poster}.spec.ts`

**Interfaces:** X-12 と M-19 が `OFFICIAL_GUIDANCE` を import する。

```ts
export type GuidanceTopic = "approach" | "human_infection" | "food" | "burial" | "dead_bird" | "rumor" | "small_flock";
export interface OfficialGuidance {
  topic: GuidanceTopic; heading: string;
  statements: Array<{ text: string; sourceTitle: string; sourceUrl: string; checkedOn: IsoDate }>; // 国の機関の文だけ
  links?: Array<{ title: string; url: string }>;  // 県のページ、家保の一覧。文を写さない（§2）
}
export const OFFICIAL_GUIDANCE: readonly OfficialGuidance[];
export const OFFICIAL_GUIDANCE_REVIEWED_ON: IsoDate | null;  // null の間は「文面は確認中です」
export const PAGE_NOTES: Partial<Record<GuidanceTopic, string[]>>;  // pageNotes.ts。出典のない作品の文。MCP に渡さない
```

**文の元**: 手元の非公開の文面の下書きの 3 章の `>` の行を候補にし、各文を原本で 1 度照合してから写す。`checkedOn` は照合した日。TLS で取得できなければ緩めず（契約 3.7）、その文を入れずに報告する。【出典なし】の行と、県の文だけが根拠の行は `PAGE_NOTES` に回す。

| topic（節の id）、見出し | `statements` の出典（国のみ） | 注意 |
|---|---|---|
| `approach` 農場に近づかないでください | https://www.maff.go.jp/j/syouan/douei/tori/know.html 、https://www.maff.go.jp/j/press/syouan/douei/260422.html | 農場を探さない（§11）は `PAGE_NOTES` |
| `human_infection` 人への感染 | https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000144461.html 、同 0000144523.html、know.html、https://www.env.go.jp/content/900490305.pdf | **受診の案内を写さない（§2）。**発表元を文に残し、断定を足さない |
| `food` 卵や鶏肉 | know.html、https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kekkaku-kansenshou/avian-influenza_qa.html （出典名に 2016 年更新） | 「安全」と書かない |
| `burial` 埋却と地下水 | https://www.maff.go.jp/j/syouan/douei/tori/r7_hpai_maual.pdf 、https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/attach/pdf/index-75.pdf 、https://laws.e-gov.go.jp/law/326AC1000000166 | 要点と明記（§11）。県の調査は 2 県のリンクだけ |
| `dead_bird` 死んだ鳥を見つけたら | 平成 29 年版 900490305.pdf、https://www.env.go.jp/content/900490557.pdf 、know.html | 県の窓口はリンク |
| `rumor` 噂に注意 | 260422.html、index-75.pdf | 農場を責めない（§11）は `PAGE_NOTES`。県の呼びかけはリンク |
| `small_flock` 数羽飼っている方へ | know.html、https://laws.e-gov.go.jp/law/326M50010000035 、法 | 通報先は国の文のまま併記。https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_kaho/ （取れるか確かめ直し、取れなければ県のページ）と `/` へのリンク。特定症状の中身は現行の告示を確かめるまで書かない |

農場のある県のページは `links` にも入れない（索引 Q14 の既定。どの県かをソースに書かず、Step 6 で確かめる）。食品安全委員会の文書は題に「安全」を含むので使わない。

**貼り紙**: 手元の下書きの 4 章を候補にする。平時に貼る文、A4、白地に黒。見出しは「防疫のため立入禁止」（§11）で、難しい漢字に `<ruby>`。目安は見出し 100pt、小見出し 48pt、本文 32pt、1 行 18 文字以内。収まらなければ本文を 24pt まで下げる【計】。連絡先は手書きの空欄。端に `印刷日 YYYY 年 M 月 D 日`（`dataSource.now()`。§15）。QR は `${origin}/public`（`qrcode(0,"M")`、`createSvgTag({scalable:true,margin:0})`）。

- [ ] **Step 1: 失敗する試験を書く**
  - `official.test.ts`: 7 項目が上の順／各文に text、sourceTitle、https の URL、YYYY-MM-DD（§16）／文も出典名も禁止語なし／`/受診|治療|医師に|病院へ|保健所/` がない（§2）／全 `sourceUrl` のホストが maff.go.jp、mhlw.go.jp、env.go.jp、e-gov.go.jp だけ（§2【決定】）。
  - `PublicPage.test.tsx`: input と textarea がない（§11）／各節に出典、確認日、id／`PAGE_NOTES` は「このページからのお願い」の下だけ／確認の前は「文面は確認中です」。
  - `AreaPage.test.tsx`: `areaLine`、過去の 1 文、`/public#topic` のリンク 7 つ（§11）／段階 1、2、4 のすべてに `areaNoDistance` と `riskAnywhere`（契約 8）／解除の後の同じ市町村は `sameMuniLifted`／`useRecordStore` を使わず本文に meshCode がない／未知のコードと区のコード 33101 は「この市町村は見つかりません」／読み込み前に 0 件と見せない／時点と確認状況が出る。
  - `PosterPage.test.tsx`: 見出しの `rt` を除いた文字が「防疫のため立入禁止」、QR の `data-url` が `${origin}/public`／`印刷日` がある／input がなく、貼り紙の要素（印刷される部分）の文字に `/発生|鳥インフルエンザ|告|法律|罰則|安全|安心|心配/` がない。
  - `area.spec.ts`: `/area/33203` で identitytoolkit、securetoken への要求 0 件／段階 1、2、4 で禁止語なし。
  - `poster.spec.ts`: 794x1123、`emulateMedia` print でタブが消え `scrollHeight <= 1123`、`@page` が A4／見出しが 2 行以内ではみ出さない。
- [ ] **Step 2: 確かめる** 単体。期待: import の失敗か仮の画面で失敗。
- [ ] **Step 3: 実装** 上のとおり。`/area` は `computeAreaStatus` だけを呼び、今季は `currentSeason(dataSource.now())`。`poster.css` は `@page { size: A4; margin: 15mm }`、「印刷する」の `Button`。
- [ ] **Step 4: 確かめる** 単体と `area.spec.ts`、`poster.spec.ts`。
- [ ] **Step 5: Commit** `feat(public): 公式の文、市町村の案内、貼り紙を作る`
- [ ] **Step 6: Human（11/7 15:00 の確認の後。W-07 の完了はこの Step を待たない）** 作者と共同経営者の確認の結果を反映し、確認日を `OFFICIAL_GUIDANCE_REVIEWED_ON` と `docs/official-text-review.md` に書く（氏名なし）。Claude は代行しない。文面の問いは索引 Q15。本番の URL の後に利用者が A4 で印刷し、QR を読む。`docs:` で別に commit する。

---

### Task W-10: 分かっていること（B 群。遅れたら §18 の順で落とす）

読む節: 3.1、7.3

**Day:** 11/7 午後 / **Depends on:** W-07
**Human:** 作者の確認（Step 5）

**Files:** Create: `web/src/pages/public/knownFindings.ts` / Modify: `web/src/pages/public/KnownPage.tsx` / Test: `web/src/pages/public/KnownPage.test.tsx`

**Interfaces:**

```ts
export interface KnownFinding {
  id: string; text: string; region: string; period: string; certainty: "高い" | "中くらい" | "低い"; certaintyNote: string | null; limit: string;
  sources: Array<{ title: string; url: string }>; verifiedOn: IsoDate | null;  // null の文は画面に出さない
}
export const KNOWN_FINDINGS: readonly KnownFinding[];
export const PAST_BASIS: { text: string; sourceTitle: string; sourceUrl: string; verifiedOn: IsoDate | null };
```

- [ ] **Step 1: 失敗する試験を書く** §11 の 7 行（再発 8/24、基本の管理、水辺と羽数、少羽数、靴の履き替え、基準の対策、近所の続発）に地域と時期、確からしさ、限界、出典がそろう／`verifiedOn` null は出ない／出る行ごとに `確認日`（`verifiedOn`）／「研究の知見です。決まりではありません」があり `GuidanceSection` を使わない／`/また発生しやすい|この町も危ない|隣町からうつる|危険地帯|ホットスポット|感染確率|8 割/` と禁止語がない／基準の対策の行に「実施を勧めないという意味ではありません」／入力欄がない。
- [ ] **Step 2: 確かめる** 期待: 仮の画面で失敗。
- [ ] **Step 3: 実装** 文と確からしさは §11 の表。材料は手元の非公開の文献調査のメモと、文面の下書きの 5 章（§22 の未検索の記録）。**メモの文を写さず、DOI か公式の URL を原本で確かめて書く。**確かめられない行は `verifiedOn: null`。`PAST_BASIS` は §11 の国の報告書の一文を原本で確かめる。
- [ ] **Step 4: 確かめる** 同じコマンド。
- [ ] **Step 5: Human** 作者が `/known` を読み、直しを反映する。
- [ ] **Step 6: Commit** `feat(public): 分かっていることのページを作る`

落とすときは `/known` を「準備中です」のままにし、`MapLinks` からリンクを外す。
