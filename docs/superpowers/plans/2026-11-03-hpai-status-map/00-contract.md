# 鳥インフル発生状況マップ 共通の取り決め（領域をまたぐ契約）

正は `docs/superpowers/specs/2026-11-03-hpai-status-map-design.md`（`§` は章）。ここは設計書を変えない。複数の領域で噛み合わせる名前、型、置き場所、値だけを固定する。それ以外は所有のタスクの Interfaces に書く（6.5）。日程、判断点、依存の一覧、人の作業、未決の問いは索引 `docs/superpowers/plans/2026-11-03-hpai-status-map.md` だけに書く。

各タスクの先頭に `読む節: 2.1、3.2、M-02 Interfaces` の 1 行を書く。実装者とレビュアーはそこだけを読む。領域の計画に型を写さない。

印: 【確】実物で確かめた（2026-11-03）／【計】計画の判断で、利用者が直せる。

## 0. 領域をまたぐ事実

- 【確】Node 24。開発機に gcloud がない。CLI は `npx firebase`。本番の操作はすべて `--account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT"` を付け、値を計画にも docs にも書かない。
- 【確】国の PDF の文字層は部首用の文字で出る。**照合と語の検索はすべて `normalizeForMatch` を通す。**
- 【確】古い TLS: `www.gsi.go.jp` は `node:https` で `EPROTO`（unsafe legacy renegotiation disabled）、`fetch` では `UND_ERR_CONNECT_TIMEOUT` で原因が見えない。`maps.gsi.go.jp`、`cyberjapandata.gsi.go.jp`、`nlftp.mlit.go.jp` は `fetch` で 200。国と県のホストと Cloud Functions からは未測定で、F-03 で測る。
- 【確】飼養衛生管理基準の番号は、家畜伝染病予防法施行規則 別表第二 三（e-Gov の現行版、施行 2026-10-01）で 17、18、19、22、23、25、27、32、33 と一致する。2025-10-01 に振り直されたので、それ以前の資料の番号は別の項目を指す。
- 【確】過去の資料は本体 247 行で `(season, no)` が一意、関連農場 58 行は本体と `no` を共有する。
- N03 の測量法の手続きは原本から読み切れない。**どの文書にも「手続き不要と確認した」と書かない。** F-06、X-26 の試験で、N03 の節に `/(不要と確認|手続きは不要|申請不要)/` がないことを確かめる（地理院タイルの公式の文「出典の明示のみで申請不要」は別の節に置く）。

## 1. リポジトリ

### 1.1 構成

```
shared/     純粋関数と型。Firebase も fetch も import しない。"@hpai/shared"、exports {"./*":"./src/*.ts"}
web/        Vite + React。src/pages/<領域>/、e2e/
functions/  src/<領域>/index.ts が barrel。src/index.ts は全 barrel を export * するだけ
data/       公開してよい事実。geo/ history/ sources.json replay/ trends/。private/ は gitignore
evals/      answers/（事実のみ）、run.ts、results/
scripts/    tsx で実行
firestore-tests/  docs/  .claude/（settings.json の hook は追加だけ。既存を消さない）
```

`copy-web-data.ts` のコピー先: `data/geo/` → `web/public/geo/`、`data/history/cases.json` → `web/public/history/`、`data/replay/*` → `web/public/replay/`、`evals/results/summary.json` → `web/public/evals/`、`data/trends/summary.json` → `web/public/trends/`。無い入力は飛ばす。依存の版は F-01 が exact で固定し、足す領域も exact で足す。

### 1.3 同梱【確】

`functions/scripts/bundle.mjs` が `shared` を `lib/index.js` に同梱し、`data/geo/`、`data/history/cases.json`、`data/sources.json` を `lib/data/` へコピーする。実行時は `path.join(__dirname, "data", ...)`。`functions/package.json` に `"type":"module"` と `@hpai/shared` を書かない。

### 1.4 試験

`shared/test/**`（`shared`）、`functions/test/*.test.ts`（`functions`）、`functions/test/emul/*.test.ts`（`functions-emul`）、`web/src/**/*.test.{ts,tsx}` だけ（`web`。`web/test/` を作らない）、`scripts/test/**`（`scripts`）、`firestore-tests/**`（`rules`）。

`passWithNoTests:true` なので、**対象を指定した実行は `--passWithNoTests=false` を付ける**。原文を要る試験は `data/private/fixtures/` を読み `describeFixture`（I-01）を通す。受け入れの実行は `REQUIRE_FIXTURES=1` を付ける（付けないと控えの試験が飛んでも緑になる）。公開の試験は作った短い文書を使う。

### 1.5 コマンド

略記: `vt <p> <絞り込み>` は `npx vitest run --project <p> --passWithNoTests=false <絞り込み>`（`p` が複数なら `--project` を繰り返す）。`pw <spec>` は `web/` で `browser-guard run -- npx playwright test <spec>`。

`npm test`（shared、functions、web、scripts。ネットワークなし）／`npm run test:rules`／`npm run test:emul`（`demo-hpai` の模擬環境）／`npm run typecheck`／`npm run bundle -w functions`／`npm run build`／`npm run dev -w web`（`--host 0.0.0.0`。示す URL は開発機の LAN の IP）／E2E は `web/` で `browser-guard run -- npx playwright test`（busy なら再試行せず待つ）。本番の deploy は `--only <対象>` で利用者の確認の後だけ。

Hosting は `web/dist`。rewrite: `/api/v1/**` → `api`、`/mcp` → `mcp`、`/unsubscribe` → `unsubscribe`。

### 1.7 本番のデータを手元から触る道

サービスアカウントの鍵を置かない【計】。`opsAdmin`（F-02）に集め、`scripts/ops.ts` が `~/.config/hpai/ops-token` を読んで呼ぶ（表示しない）。呼び先は https で、ホスト名が `.cloudfunctions.net` か `.run.app` のものだけ（`scripts/lib/opsUrl.ts`。模擬環境の `http://localhost` と `http://127.0.0.1` は除く）。既定の URL は `FIREBASE_PROJECT`（小文字の英数字とハイフンだけ）から組み、リダイレクトでは転送しない。

| 操作 | 内容 |
|---|---|
| `set-claims --email <利用者が入れる> --operator` | claim を足す。既存を消さない |
| `create-invite --kind signup --max-uses 5` | 平文を 1 度だけ返す。保存は `invites/{sha256(code.trim()) の 16 進小文字}` |
| `seed-sources` | 同梱の `data/sources.json` から足す。既存を上書きしない |
| `set-setting <キー> <値>` | `usage/settings`。無ければ `DEFAULT_RUNTIME_SETTINGS` で作る |
| `usage-status`（`{ op: "usage-status" }`。読むだけで何も書かない。`opsAdmin` の Bearer の内側） | 今月（日本時間）の費用と止める線を返す。返す値は `{ ok: true, op: "usage-status", month: "YYYY-MM", estimatedJpy, hardLimitJpy }` の 3 つだけ（Secret も個人情報もない）。`setup-agent.ts --unpause` が、費用が上限以上のときに戻さないために呼ぶ。`scripts/ops.ts` の `fetchUsageStatus` が読む |
| `probe --permanent <tsv> --entrances <tsv>`、`probe --from-sources` | `probeEntrances` を呼び `docs/reachability.md` を更新 |

## 2. 型と Firestore

`shared/src/types.ts`（F-01）。すべて export する。**日時は Timestamp を使わず JST の ISO 8601 文字列**。

### 2.1 基本と公開データ

```ts
type PrefCode = string;    // "01"〜"47"
type MuniCode = string;    // 5 桁。政令市は市のコード。区のコードを保存しない
type MeshCode = string;    // 3 次メッシュ 8 桁
type Season = number;      // 2025 = 2025-06-01〜2026-05-31
type IsoDate = string;     // "2025-12-20"
type IsoDateTime = string; // "2025-12-20T09:00:00+09:00"
interface StageStamp { date: IsoDate; time: string | null } // null は「時刻の記載なし」
type CaseStage = "suspected" | "confirmed" | "culling_done" | "control_done"
  | "shipment_lifted" | "movement_lifted" | "surveillance_lifted"; // §10.2 は枝分かれするので順序のある 1 値にしない
type StageDates = Partial<Record<CaseStage, StageStamp>>;
type NegationState = "none" | "candidate" | "negated";
// reviewing 県名とリンクだけ公開／auto 照合と二重読みに合格／national 国の定型文か過去の資料／operator 運営者が確定／replay 再現
type ConfirmState = "reviewing" | "auto" | "national" | "operator" | "replay";
interface Case {
  id: string; // 確認中は `rev-${documentId}`、過去は `h${season}-${no}`
  season: Season; nationalNo: number | null; prefNo: number | null; prefCode: PrefCode;
  muniCode: MuniCode | null; muniName: string | null; // reviewing のときだけ null
  birdUse: string | null; housing: string | null;     // 公表どおりの語
  headCount: number | null; stages: StageDates;
  radiiKm: number[]; // 空なら既定 10km
  prefEstimates: { shipment: IsoDate | null; movement: IsoDate | null; surveillance: IsoDate | null };
  negation: NegationState; negatedAt: IsoDateTime | null;
  confirmState: ConfirmState; sourceUrls: string[]; updatedAt: IsoDateTime;
}
type WildBirdTest = "screening_positive" | "hpai_confirmed" | "negative";
interface WildBird {
  id: string; season: Season; date: IsoDate; prefCode: PrefCode;
  muniCode: MuniCode | null; muniName: string | null; species: string | null; test: WildBirdTest;
  focusZone: { from: IsoDate | null; to: IsoDate | null }; // 読まないので今は null
  sourceUrl: string;
}
interface WatchStatus { // watchStatus/{prefCode}。全入口が成功のときだけ ok
  prefCode: PrefCode; checkedAt: IsoDateTime | null; ok: boolean; lastOkAt: IsoDateTime | null; failingSince: IsoDateTime | null;
}
interface WatchSummary { asOf: IsoDateTime; okCount: number; failedCount: number; failedPrefCodes: PrefCode[] }
interface HistoryCase { // data/history/cases.json
  season: Season; no: number; prefCode: PrefCode; muniCode: MuniCode; muniNameThen: string; date: IsoDate;
  birdUse: string | null; housing: string | null; headCount: number | null; sourceUrl: string;
  related: boolean; // 関連農場。件数（52、25、84、11、51、24）に入れない
}
```

`related:true` を見るのは `describePast`（町の履歴に「関連農場」と明示）だけ。棒、バッジ、校正、API は `related:false` だけを使う。

### 2.2 サーバーのデータ

```ts
type SourceKind = "maff_press" | "maff_season" | "moe" | "pref_fixed" | "pref_rss" | "pref_press_list";
interface SourceSeed { prefCode: PrefCode | null; url: string; kind: SourceKind; confirmedOn: IsoDate; note: string | null }
interface RuntimeSettings { // usage/settings
  softLimitJpy: number; hardLimitJpy: number; jpyPerUsd: number;
  autoPublishEnabled: boolean; // I-06 の合格と利用者の確認の後に true
  primaryModel: string; primaryEffort: "low" | "medium" | "high" | "xhigh" | "max"; secondModel: string;
}
const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings; // 8000、10000、150、false、"claude-opus-5-5"、"medium"、"claude-haiku-5-5"（2026-11-04 変更。当初は 2000、2500。予算の通知は月 3,000 円で、設定の値ではない）
interface EvalSummary { // evals/results/summary.json。I-06 が書き、X-09 が読む
  measuredAt: IsoDateTime;
  metrics: Array<{ name: EvalMetricName; value: number; denominator: number | null; unit: string; note: string | null }>;
  unmeasured: string[]; // 測っていないものはここに入れ、0 と書かない
  costPerDocumentUsd: number | null;
}
type EvalMetricName = "documents" | "read_refusals" | "format_errors" | "primary_muni_errors" | "primary_stage_errors" | "primary_date_errors" | "primary_headcount_errors"
  | "published_mandatory_errors" | "published_headcount_errors" | "auto_published_documents" | "review_documents"
  | "second_reader_mismatches" | "tamper_rejected"
  | "detection_prev_season"           // 前季 24/24。I-01 の国の判定の結果から
  | "detection_title_classification"; // 国の題 70 件の分類
```

### 2.3 会員のデータ

```ts
type Production = "layer" | "broiler";
type FarmHousing = "windowless" | "open" | "free_range";
interface NotifySettings { level1: boolean; level2: boolean; level3: boolean; morningDigest: boolean; selfCheckRemindDays: number | null } // 5 つのキーがすべて必須。selfCheckRemindDays は 0〜7 の整数か null（画面の選択は 1、2、3、5、7）。サーバーは 0〜7 に丸める
interface Farm { // farms/{farmId}
  name: string; memberUids: string[];
  unsubscribedUids: string[]; // サーバーだけが書く
  meshCode: MeshCode;         // 緯度経度のフィールドを持たない
  muniCode: MuniCode; prefCode: PrefCode; frequentMuniCodes: MuniCode[]; // 20 件まで。各要素は 5 桁の町のコード
  production: Production | null; housing: FarmHousing | null; // M-05 で入れる。null は未設定
  kahoContact: string; notify: NotifySettings;
  selfCheckDue: Record<string, IsoDate>; // "YYYY-MM"（月は 01〜12）→ "YYYY-MM-DD"（期限日、§8）。40 件まで。コンマで詰めた形は規則が拒否する。期限の知らせの対象は今季の月（10〜5 月）と、6〜9 月のときの前季の 5 月分だけで、ほかのキーは読み飛ばす
  updatedAt: IsoDateTime;
}
interface House { name: string; birdType: string; flockSize: number; empty: boolean }
type ExclusionKind = "disease" | "equipment" | "temperature" | "disaster" | "empty" | "other";
interface DeathRecord { // farms/{farmId}/deaths/{date}_{houseId}。入力者を持たない
  date: IsoDate; houseId: string; deaths: number;
  flockSizeAt: number; // 羽数の変更で過去の率が動かない【計】
  exclusion: { kind: ExclusionKind; note: string } | null;
}
type SelfCheckItemNo = "17" | "18" | "19" | "22" | "23" | "25" | "27";
type CheckRecord = // farms/{farmId}/checks/{id}。入力者を持たない
  | { kind: "disinfection"; date: IsoDate; itemId: string }
  | { kind: "self_inspection"; date: IsoDate; month: string; answers: Record<SelfCheckItemNo, "ok" | "ng" | null> };
interface CaseDraft { caseId: string; workerMessage: string; source: "claude" | "template"; createdAt: IsoDateTime } // caseDrafts/{caseId}
```

### 2.4 段階

```ts
type Level = 1 | 2 | 3 | 4;
type LevelReasonKind = "within_radius" | "same_muni" | "adjacent" | "frequent";
interface LevelReason { caseId: string; level: Level; kind: LevelReasonKind; distanceKm: number | null; radiusKm: number | null }
interface LevelResult {
  level: Level; reasons: LevelReason[]; // reasons は当たった事例すべて、段階の高い順
  shipmentLifted: boolean;              // ① の事例で搬出制限が解除済み
  inSurveillanceNote: boolean;          // 監視強化区域の説明を出す（段階に数えない）
}
interface FarmPoint { meshCode: MeshCode; muniCode: MuniCode; frequentMuniCodes: MuniCode[] }
interface AreaStatus { // /area/{code} と API。地点がないので距離を見ない
  muniCode: MuniCode; muniName: string; prefCode: PrefCode; asOf: IsoDateTime; level: 1 | 2 | 4;
  sameMuniCases: Case[]; adjacentCases: Case[]; wildBirds: WildBird[]; sourceUrls: string[];
}
type ChecklistClass = "always" | "if_in_zone" | "good_to_check";
```

**同じ市町村の文【必ず守る】**: 移動制限の解除の後の同じ市町村（`level 2`、`kind "same_muni"`、`AreaStatus` は `sameMuniCases` あり）は `FIXED_TEXT.sameMuniLifted` を出す。発生したその町に「隣町」と出さない。M-02 の `Notice` に `relationKind: LevelReasonKind | null` を持たせ、F-07、W-03、M-02 に同じ試験を置く。

### 2.6 Claude の呼び方

- **`client.messages.create` と `decodeMessage` だけ。** SDK の `messages.parse` は `refusal`、`max_tokens`、enum 違反で throw するので使わない【確】。Batch の `params` も同じ形。
- 構造化出力の制約【確】: Citations と併用で 400、`additionalProperties:false` 必須、数値と長さの制約は不可、union（`anyOf` と type 配列）は 16 まで（超えると 400。細則は未確認）。Opus 5.5 は `thinking:{type:"disabled"}` と forced `tool_choice` で 400。サンプリング引数、`citations`、道具を送らない。
- **主と別の読み手のスキーマは手書きの JSON Schema**（`shared/src/read/schema.ts` の `READ_RESULT_JSON_SCHEMA`、`SECOND_READ_RESULT_JSON_SCHEMA`）。enum を残し、全項目 required。`Quoted` の 8 項目は `facts: Array<{field: enum; value: string; quote: string}>` に畳み、値のない項目は行を出さない（主の union 24 → 8、別の読み手は 7）。同じファイルの zod `ReadResultSchema`、`SecondReadResultSchema` が受信を検証して `ReadResult` などへ変換するので、`verifyRead` の署名は変わらない。web から import しない。
- I-03 に「`anyOf` と type 配列の合計が 16 以下」「JSON Schema と zod が同じ見本を通す」の試験を置く。スキーマ、`claude.ts`、`scripts/smoke-read.ts` は **I-03 の試行で 1 回だけ実呼び出し**する（開発の鍵）。API が拒むときは残りの nullable を空文字列に替える。
- M-18、M-19、X-27 の小さなスキーマは `zodOutputFormat(schema).schema` でよい。
- 鍵は handler の中で読む。開発は環境から読む。表示しない。

```ts
// functions/src/read/claude.ts（I-03）。他は I-03 Interfaces
type ReadAttempt<T> = { ok: true; value: T; usage: Anthropic.Usage }
  | { ok: false; reason: "refusal" | "format_error" | "max_tokens" | "api_error"; detail: string; usage?: Anthropic.Usage }; // 拒否も課金されることがある
function decodeMessage<T>(message: Anthropic.Message, schema: z.ZodType<T>): ReadAttempt<T>; // throw しない
```

### 2.7 Firestore の全コレクション

| まとまり | 型 | 読む | 書く |
|---|---|---|---|
| `sources` | `Source` | サーバー | I、`seed-sources` |
| `documents` | I-03 の `DocumentRecord` | サーバー | I |
| `cases`、`wildBirds`、`watchStatus` | `Case`、`WildBird`、`WatchStatus` | 全員 | I（`cases` は `upsertCase` のみ） |
| `caseDrafts` | `CaseDraft` | `member` | M |
| `reviewQueue` | I-03 の `ReviewItem` | `operator` | I-02 の `enqueueReview` だけを通す: I、M（`mail_failing`）、X（提案と `agent_run_failed`）。解決は `resolveReviewItem` のみ |
| `invites` | `Invite`。試行回数は `invites/_attempts/uids/{uid}` | サーバー | M、`create-invite` |
| `farms/{id}` と `houses`、`deaths`、`checks` | 2.3 | 会員 | 会員、M の callable |
| `sentNotices` | M-02 の `SentNotice`（会員単位）。朝の待ち行列を兼ねる | サーバー | M |
| `usage` | `{YYYY-MM}`、`settings`、`agent` と `agent-calls-{YYYY-MM-DD}`（X）、`operatorNotice`（I-18） | サーバー | I、F、X、M（M-18、M-19 が `recordUsage` を通す） |

役割は custom claim（`member`、`operator`）で持つ。Storage は全拒否で、サーバーだけが `raw/{id}.{html,pdf,txt}`、`state/pages/{sourceId}.json`、`state/maff/national-index.json` を使う。

## 3. 領域をまたぐ関数

純粋関数。Firestore、fetch、時計を中で呼ばず、`now` は引数で受ける。

### 3.1 基本【F-01】

```ts
// shared/src/text.ts
function normalizeForMatch(s: string): string; // NFKC、⻘⻲⻑ の変換表、空白と改行の除去、ヶ→ケ
function hasHpaiWord(text: string): boolean;    // 正規化の後に 鳥インフル|高病原性|疑似患畜|HPAI を探す。語の判定はこれだけ
// shared/src/season.ts、dates.ts、pref.ts
function seasonOf(date: IsoDate): Season;
function currentSeason(now: Date): Season;
function seasonAgoLabel(season: Season, current: Season): string; // 今季 / 昨季 / 2 年前
function toJstIso(d: Date): IsoDateTime;
function addDays(date: IsoDate, days: number): IsoDate;
function diffDays(later: IsoDate, earlier: IsoDate): number;
const PREFS: ReadonlyArray<{ code: PrefCode; name: string }>;
function prefCodeOfName(name: string): PrefCode | null;
// shared/src/wording.ts
const FORBIDDEN_PHRASES: readonly string[]; // 「区域の外です」「安全」「安心」
function findForbiddenPhrases(text: string): string[];
const FIXED_TEXT: {
  prefContactIsAuthority: string; // 「県の連絡が正です」
  riskAnywhere: string;           // 国の報告書の言葉（出典つき）
  pastDisclaimer: string;         // 「過去の記録です。これからの発生を予測するものではありません」
  replayBanner: string;           // 「去年の再現です」
  areaNoDistance: string;         // 「距離は見ていません。地点を登録すると区域の可能性が分かります」。/area、API、MCP の全段階
  sameMuniLifted: string;         // 「この町で発生しました（移動制限は解除されました）」
};
// shared/src/history.ts（F-08）。related:false だけを受ける。id `h${season}-${no}`、confirmState "national"。埋め方は F-08
function historyToCase(h: HistoryCase): Case;
```

### 3.2 地図の計算【F-06、F-07】

```ts
// shared/src/mesh.ts
function latLngToMesh3(lat: number, lng: number): MeshCode;
function mesh3Center(code: MeshCode): { lat: number; lng: number };
// shared/src/geo.ts
interface MuniEntry { code: MuniCode; name: string; prefCode: PrefCode; center: [number, number]; bbox: [number, number, number, number] }
type MuniGeometry = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { c: MuniCode }>;
interface GeoStore {
  index: Readonly<Record<MuniCode, MuniEntry>>;
  adjacency: Readonly<Record<MuniCode, readonly MuniCode[]>>;
  ensurePrefs(prefCodes: readonly PrefCode[]): Promise<void>;
  geometry(code: MuniCode): MuniGeometry; // 未読み込みは GeoNotLoadedError
}
class GeoNotLoadedError extends Error {}
function createGeoStore(input: { index: GeoStore["index"]; adjacency: GeoStore["adjacency"]; loadPrefTopo: (p: PrefCode) => Promise<unknown> }): GeoStore;
function isAdjacent(a: MuniCode, b: MuniCode, geo: GeoStore): boolean;
function distanceToMuniKm(mesh: MeshCode, muni: MuniCode, geo: GeoStore): number; // 内側は 0
function findMuniByName(prefCode: PrefCode, name: string, geo: GeoStore): MuniCode | null; // normalizeForMatch で比べ、同名が複数なら null
// functions/src/geo/loadGeo.ts の loadGeoStore(baseDir?)、scripts/lib/geoStore.ts の loadScriptGeoStore()、web/src/geo/loadGeo.ts の loadWebGeoStore(): Promise<GeoStore>
// shared/src/level.ts — §5
function isCountable(c: Case): boolean;  // reviewing と negated を除く。candidate は数える
function isZoneActive(c: Case): boolean; // isCountable かつ movement_lifted がない
function prefsToLoad(cases: readonly Case[], birds?: readonly WildBird[]): PrefCode[]; // isCountable の事例と野鳥の県
function relationToCase(p: FarmPoint, c: Case, geo: GeoStore): { level: Level; reason: LevelReason | null }; // 時期を見ない
function computeLevel(p: FarmPoint, cases: readonly Case[], season: Season, geo: GeoStore): LevelResult;
function computeAreaStatus(i: { muniCode: MuniCode; cases: readonly Case[]; wildBirds: readonly WildBird[]; geo: GeoStore; asOf: IsoDateTime; season: Season }): AreaStatus;
function wildBirdsNotifiable(p: FarmPoint, birds: readonly WildBird[], geo: GeoStore): WildBird[]; // hpai_confirmed、メッシュ中心から 10.85km 以内
function summarizeWatch(all: readonly WatchStatus[], now: Date): WatchSummary; // ok かつ 6 時間以内を確認済みと数える
```

- ①は同じ市町村か `distanceToMuniKm <= Math.max(10, ...radiiKm) + 0.85` で、`isZoneActive` の間。②③は否定を除き今季ずっと（§7【決定】）。解除の後の同じ市町村は 2.4（索引 Q5）。
- **距離の前に必ず `await geo.ensurePrefs(prefsToLoad(cases, birds))`。** 全領域の試験の偽の `GeoStore` は、その前に `GeoNotLoadedError` を投げる。冷えた状態から県をまたぐ試験（津山市の center のメッシュと鳥取市の事例）を F-07、W-03、M-03、M-13 に置く。

### 3.7 取得

```ts
// functions/src/watch/politeFetch.ts（F-03。以後の所有者は I）。取得はすべてこれを通す
type FetchOutcome =
  | { kind: "ok"; status: number; finalUrl: string; contentType: string; body: Buffer; etag: string | null; lastModified: string | null; fetchedAt: IsoDateTime }
  | { kind: "not_modified" } | { kind: "robots_denied" } | { kind: "not_allowed"; url: string }
  | { kind: "http_error"; status: number; code?: string } // code は robots.txt の取得の失敗のときだけ "robots_unavailable"。本体の失敗には付けない
  | { kind: "network_error"; message: string; code: string | null; tls: boolean };
function politeFetch(url: string, opts?: { etag?: string | null; lastModified?: string | null; timeoutMs?: number; allowUrl?: (url: URL) => boolean }): Promise<FetchOutcome>;
const USER_AGENT: string; // "hpai-status-map/0.1 (+<公開リポジトリの URL>)"。同じホストの間隔 1.2 秒以上
// functions/src/watch/extract.ts（F-03）
function decodeBody(body: Buffer, contentType: string): string; // Shift_JIS と EUC-JP
function extractHtml(html: string, baseUrl: string): { title: string; text: string; links: Array<{ href: string; text: string }> };
// functions/src/ops/auth.ts（F-02）。mcpInternal も使う
function checkBearer(header: string | undefined, expected: string): boolean;
```

- `allowUrl` は最初の URL と各リダイレクトの先を**取得する前**に、robots.txt の取得より先に呼ぶ。拒否は `not_allowed` で外へ 1 度も要求しない。F-03 に「拒否した先への要求 0 回」の試験を置く。
- `code` は `cause` をたどった最も深い code。TLS の握手の失敗（`EPROTO`、`ERR_SSL_*`、証明書の code）で `tls:true`。再試行も緩和もしない。`fetch` は原因を隠すので、`probeEntrances` は `network_error` の入口に `node:https` で握手を 1 回だけ試して分類する。`ProbeVerdict` に `tls_error`、`ProbeRow` に `errorCode` を足し、`docs/reachability.md` の別の欄に出す。
- **`rejectUnauthorized:false`、`secureOptions`、legacy renegotiation を許す設定を黙って入れない。** ソースを検査する試験を F-03 に置く。判断は F-03 Step 6 と索引 Q7。全体に効く設定は入れない。

### 3.9 公開の文と API

`OFFICIAL_GUIDANCE` は W-07 が持ち、X の MCP が import する。API は `ApiCases = ApiEnvelope<ApiCase[]>`（X-12。`ApiCase` は公開してよい項目だけの許可リストで、確認中の事例は `updatedAt` が null。正は `shared/src/api.ts`）。`ApiEnvelope` は任意の `watch`（確認状況）を持ち、今季の答えには必ず添える。`notices` に `prefContactIsAuthority`、`riskAnywhere`、`/areas` と `get_area_status` には `areaNoDistance` も必ず含める。

### 3.10 画面のデータの口【W-01、W-03】

地図と記録の画面は Firestore を直接呼ばない。再現と見本の農場が同じ画面を使うためである。

```ts
// web/src/data/types.ts
type Unsubscribe = () => void;
interface DataSource {
  mode: "live" | "replay";
  now(): Date; // 公開の画面の時計はこれだけ
  subscribeCases(season: Season, cb: (cases: Case[]) => void): Unsubscribe;
  subscribeWildBirds(season: Season, cb: (birds: WildBird[]) => void): Unsubscribe;
  subscribeWatchStatus(cb: (all: WatchStatus[]) => void): Unsubscribe;
  loadHistory(): Promise<HistoryCase[]>;
}
interface RecordStore {
  mode: "firestore" | "sample";
  getFarm(): Promise<(Farm & { id: string }) | null>;
  saveFarm(patch: Partial<Omit<Farm, "memberUids" | "unsubscribedUids">>): Promise<void>;
  listHouses(): Promise<Array<House & { id: string }>>;
  saveHouse(h: House & { id?: string }): Promise<void>;
  listDeaths(from: IsoDate, to: IsoDate): Promise<DeathRecord[]>;
  saveDeath(r: DeathRecord): Promise<void>;
  listChecks(from: IsoDate, to: IsoDate): Promise<Array<CheckRecord & { id: string }>>;
  saveCheck(c: CheckRecord): Promise<void>;
  getCaseDraft(caseId: string): Promise<CaseDraft | null>; // sample、未ログイン、claim なし（拒否を変換）は null。画面は雛形に戻る
  isMailStopped(): Promise<boolean>; // 自分の uid が unsubscribedUids にある。sample は false
}
// web/src/data/context.tsx: DataSourceProvider({value,children})、useDataSource()、RecordStoreProvider({value,children})、useRecordStore()
// web/src/data/spotContext.tsx: SpotProvider({fixed?,children})（再現は fixed に defaultSpot）、useSpot(): FarmPoint | null、useTown()
// web/src/firebase.ts。db の直の export はない。動的に import し、公開の画面に Firebase を載せない
interface FirebaseHandles { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions }
function getFirebase(): Promise<FirebaseHandles>;
// web/src/pages/auth/firestoreRecordStore.ts。W-01 が仮を置き M-01 が置き換える。routes.tsx の根が使う
function createFirestoreRecordStore(): RecordStore; // 各メソッドの中で getFirebase() と uid を読む。未ログインの getFarm は null
function createFirestoreRecordStoreWith(db: Firestore, uid: string): RecordStore; // 試験用
```

- 記録とやることの画面の内部リンクは相対にする（`/sample/*` の中で動くため）。M-01 の E2E で「農場を保存し、再読み込みで残る」を確かめる。
- `/todo` は会員でなくても開ける。`getFarm` が null なら `saveCheck` を呼ばない（M-03）。
- 端末内の地点は `FarmPoint` だけを保存し（`hpai.spot.v1`）、緯度経度を保存せず送らない。
- `ReplayDataSource` は `pages/replay/`、`SampleRecordStore` は `pages/sample/`（X）。

## 4. Cloud Functions と Firestore ルール

### 4.1 関数の一覧

第 2 世代、`asia-northeast1`、定義は `functions/src/secrets.ts`（F-01）。Secret は `defineSecret`、設定は `defineString`【計】。タイムアウト、メモリ、関数ごとの Secret は所有のタスクに書く。予定起動は `timeZone "Asia/Tokyo"`。

Secret: `ANTHROPIC_API_KEY`、`GMAIL_APP_PASSWORD`、`UNSUBSCRIBE_SECRET`、`OPS_TOKEN`、`INTERNAL_MCP_TOKEN`。**deploy は全 param を解決するので、最初の deploy の前に人の作業で全部を入れる。本番に仮の値を入れない。**
設定（`functions/.env.<project>`）: `GMAIL_USER`、`OPERATOR_EMAIL`、`APP_URL`、`AGENT_DEPLOYMENT_ID`、`AGENT_EVAL_HIDE_PREFS`。後の 2 つは最初は空でよい。
模擬環境（`demo-hpai`）: 値のない設定は CLI が入力を待ち（`emulators:exec` が進まない）、`functions/.secret.local` にない Secret は本物を読みに行く【確】（firebase-tools 15.34.2 のソース。この構成での実行は未確認）。functions を起動する前に、`functions/.secret.local` に上の Secret 5 つを仮の値で、`functions/.env.demo-hpai` に設定 5 つ（`GMAIL_USER`、`OPERATOR_EMAIL` は `dummy@example.com`、`APP_URL` は `http://127.0.0.1:5174`、後の 2 つは空）を置く。どちらも gitignore で公開されず Files に入れない。人の作業 4 の本番の設定とは別。Write で作る（Bash で `.env*` の名前に触れると hook が止める）。

| 所有 | 関数 |
|---|---|
| F-02、F-03 | `opsAdmin`、`probeEntrances`（HTTPS、Bearer `OPS_TOKEN`） |
| I-01 | `watchTick`（`every 60 minutes`） |
| I-05 | `readOnDocument`（`documents/{docId}` の作成、`retry:false`） |
| I-07 | `resolveReviewItem`、`getReviewDetail`（`onCall`、`operator`。引用を返さない） |
| I-18 | `reconcileNational`（`0 */6 * * *`） |
| M-01 | `redeemInvite`、`createFarmInvite`（`onCall`） |
| M-02 | `onCaseWritten`（`cases/{caseId}` の書き込み。`after` がない削除は無視） |
| M-04 | `deleteFarmData`（`onCall`、農場の会員） |
| M-13 | `onWildBirdWritten`、`onDeathWritten`、`morningDigest`（`0 6 * * *`）、`retryFailedNotices`（`30 0-5,7-23 * * *`。朝のまとめと重ねない）、`unsubscribe`（HTTPS、HMAC）、`resumeMail`（`onCall`、自分だけ） |
| M-18、M-19 | `draftOnCaseWritten`、`draftNeighborExplainer`（`onCall`、`member`） |
| X-01 | `mcpInternal`（HTTPS、Bearer `INTERNAL_MCP_TOKEN`） |
| X-12 | `api`、`mcp`（認証なし、毎分 60 回のメモリ内の制限） |
| X-14 | `runEntranceAgent`（`operator`）、`checkAgentRuns`（`0 8 * * *`）、`entranceAgentWeekly`（`0 7 * * 1`。X-01 が `decision: cloud_functions` のときだけ） |

`sendMail(to, {subject, text})`（`functions/src/notify/send.ts`）だけでメールを送る。`fetch_pref_page` は `politeFetch` に `allowUrl` を渡し、試験は「県のドメインの外への要求 0 回」（§13、§16）。

### 4.2 Firestore ルール（F-05）

- 既定は全拒否。`cases`、`wildBirds`、`watchStatus` は read 全員、write 拒否。
- `caseDrafts` は read `request.auth.token.member == true`、`reviewQueue` は read `operator`。どちらも write 拒否。`sources`、`documents`、`invites`、`sentNotices`、`usage` は全拒否。
- `farms/{id}`: read は `uid in memberUids`／create は `member`、`memberUids == [uid]`、`unsubscribedUids == []`、かつ `farmId == request.auth.uid`（農場を作れるのは自分の uid の 1 つだけ。招待で他の農場に入った人は、その農場がある間、自分の農場を作れない）／update は会員で、この 2 つを変えない／delete 拒否。全書き込みで `keys().hasOnly([Farm の全キー])`、`meshCode.matches('^[0-9]{8}$')`。
  - `notify` は 5 つのキー（`level1`、`level2`、`level3`、`morningDigest`、`selfCheckRemindDays`）がすべて必須で、ほかのキーは持てない。`selfCheckRemindDays` は 0〜7 の整数か null。
  - `selfCheckDue` は 40 件まで。キーは `YYYY-MM`（月は 01〜12）、値は `YYYY-MM-DD`。コンマで 1 つに詰めた形は拒否する。
  - `frequentMuniCodes` は 20 件まで。各要素は 5 桁の文字列。
  - 正本は `firestore.rules`。
- `houses`、`deaths`、`checks`: 親の `memberUids` で判定。`hasOnly` で `uid`、`createdBy` を持てない。`deaths.deaths`、`deaths.flockSizeAt`、`houses.flockSize` は `is int` かつ `>= 0`。
- `operator` でも `farms` は読めない。claim の付与の後に画面が `getIdToken(true)` を呼ぶ。

## 5. 地図のデータ

`data/geo/`（F-06、commit する）: `japan.topo.json`（全国、`1.5%`、表示用）／`pref/NN.topo.json`（県ごと、`interval=30`。**距離の計算は画面でもサーバーでもこれだけ**）／`adjacency.json`（`Record<MuniCode, MuniCode[]>`、簡略化の前の全国の形から）／`muni-index.json`／`pref-anchors.json`／`build-info.json`。オブジェクト名は `muni`、properties は `{c, n, p}`。簡略化の誤差（実測の最大約 41m、幅 100m 以上の面）は 0.85km に含み（半対角の最大約 0.786km と合わせて 829m）、§19 の限界として README と `docs/data-sources.md` に書く。

W-02 が作り、M-01、再現が使う部品:

- `web/src/geo/maplibre.ts`: `setWorkerUrl` と CSS。`maplibre-gl` はここから import する。ないと vite の build で地図が出ない【確】。
- `web/src/geo/attribution.ts` の `MAP_ATTRIBUTION`: 地理院タイル（一覧ページへのリンク）、淡色地図の小縮尺で要る VMAP0 の文、国土数値情報（加工の表示）。文は国の原ページから写す。E2E で `/Vector Map Level 0/` を確かめ、README と docs にも同じ文を書く。
- 地図の下に固定のリンク（`/public`、`/known`、`/replay`、`/results`、`/privacy`）、`TownBanner` から `/area/{code}`。タブは 3 つのまま。

## 6. タスク ID と領域

### 6.1 ID の規則

**形式は `<前置き>-<2 桁の連番>`（`F-01`）だけ。** `F1`、`F-1` と書かない。

### 6.2 領域の所有

所有者だけが触る。barrel は `functions/src/<領域>/index.ts`。

| 前置き | `shared/src/` | `functions/src/` | `web/src/` |
|---|---|---|---|
| **F** 基盤とデータ | `types` `text` `season` `dates` `pref` `wording` `mesh` `geo` `level` `history` | `index` `options` `secrets` `admin` `geo/` `probe/` `ops/` | なし |
| **I** 取得と読み取り | `cases` `read/*` `budget` | `watch/` `read/` `review/` `usage/` | `pages/operator/` |
| **W** 地図と公開の画面 | `past` `guidance/official` | なし | `main` `routes` `firebase` `data/*` `geo/` `ui/` `pages/{map,public}/` |
| **M** 会員、記録、通知 | `jaDate` `lift` `mortality` `checklist*` `reports` `notices` `drafts` | `notify/` `farm/` `drafts/` | `pages/{todo,record,settings,auth}/` |
| **X** 再現、API、エージェント、公開準備 | `api` `replay` | `api/` `mcp/` `agent/` | `pages/{replay,sample,results,trends,privacy}/` |

### 6.3 境界の決まり

| 境目 | 決まり |
|---|---|
| `cases` の書き込み | I だけ。否定の確定も `resolveReviewItem`。M と X は読むだけ |
| 発表 → メール | I が `cases` を書く → M の `onCaseWritten`。I はメールを呼ばない（運営者への知らせを除く） |
| 確認中の公開 | I-08 の `makeReviewingCase` だけ（id、season、prefCode、sourceUrls、confirmState、updatedAt 以外は null か空）。W は県の単位で描き、M は同じ県へ送る。解決したら I が消し本物を書く |
| 段階 | F が計算。W は文、M は宛先に使い、判定を複製しない。町の 1 文は W |
| 運営者の画面 | I が画面と承認で `sources` を書く。提案を書くのは X。手動実行のボタンは I-07 が `runEntranceAgent` を呼ぶ |
| `politeFetch`、`decodeBody`、`extractHtml` | F-03 が作り、以後の所有者は I。F-09、X-14 は import する |
| `sendMail` | 6.2 の例外。I-18 が作り、以後の所有者は M。M-02 は import する |
| `routes.tsx`、`functions/src/index.ts` | W-01、F-01 が全部を先に書く。他の領域は自分のファイルを置き換えるだけで触らない |
| 見本の農場 | M の画面を X が `SampleRecordStore` で包む。複製しない |
| 運営者名 | ソースに書かない。`VITE_OPERATOR_NAME` と、提出前に利用者が入れる README の 1 行 |

経路（ファイルは `pages/<領域>/<名前>Page.tsx`、W-01 の表）: W `/`、`/public`、`/area/:muniCode`、`/poster`、`/known`／M `/todo`、`/record`、`/record/{deaths,self-check,disinfection}`、`/settings/{farm,notify,explainer}`、`/login`、`/join/:code`／I `/operator`（試験は `pages/operator/operator.test.tsx`）／X `/replay`、`/replay/backstage`、`/sample`、`/sample/{todo,record/*}`、`/results`、`/trends`、`/privacy`。

### 6.5 所有のタスクに置く宣言

使う他の領域は、読む節にそのタスクの Interfaces を書く。

| 先 | 宣言 |
|---|---|
| F-01 | 依存の版、同梱の命令、TS と `firebase.json` の全文、試験のコマンド |
| F-02 | `Source`、`Invite` |
| F-05 | 索引 |
| F-06 | N03 の属性、手続き、`DESIGNATED_CITIES` |
| F-07 | `ZONE_BASE_KM`、`MESH_MARGIN_KM`、`zoneRadiusKm` |
| I-01 | `extractPdfText`、`fingerprint`（X-07、X-14 が使う）、`isMaffOutbreakTitle`、`parseMaffPress` |
| I-02 | `enqueueReview`、`reviewAlertId`（M-02、M-13、X-14 が使う） |
| I-03 | `shared/src/read/types.ts` の全部（`DocumentRecord`、`ReadState`、`ReviewItem`、`VerifyReport`、`CompareReport`、`NormalizedRead`、`PublishDecision`）、`ReadInput`、`readPrimary`、`readSecond`、`UsageMonth`、`decideReadBudget`（X-07、M-18 が使う）、`looksLikeProgressTitle` |
| I-04 | `verifyRead`、`compareReads`（X-07 が使う）、`hasOutbreakWords`、`decidePublication` |
| I-08 | 事例の純粋関数と `upsertCase`。`displayStage` は W-06 が使う。`matchCase` の任意の `stage`（疑いと確定は最初の日付から 7 日、後の段階は候補が 1 件なら同じ事例、2 件以上なら確認中） |
| W-02 | 地図の部品と `MapViewProps` |
| W-03 | `PastSummary`、`describePast` |
| W-07 | `GuidanceTopic`、`OfficialGuidance`、`OFFICIAL_GUIDANCE` |
| M-02 | `Notice`、`NoticeEvent`、`renderNotice`、`renderMorningDigest`（X-20 が使う）、`SentNotice`、`planCaseNotices`、`isMailStopError`、`noteMailStop` |
| M-03 | `ChecklistItem`、`buildChecklist`（X-20 が使う）、`LiftEstimate`、`shortReminder` |
| M-04 | 報告文と CSV |
| M-07 | `MortalityDay`、`MortalityResult`、`computeMortality`、`toMortalityDays`（X-08 が使う） |
| M-18 | `workerMessageTemplate`、`WorkerMessagePanel`（X-08 が包む）、`checkWorkerMessage`、`checkNeighborText` |
| X-01 | エージェントの設定の関数、`AgentHeartbeat` |
| X-02 | `ReplayEvent`、`ReplayScenario` |
| X-07 | `BackstageEntry` |
| X-12 | `ApiEnvelope`、`ApiArea`、`ApiWatch`、`ApiWildBirds` |
| X-14 | `listEntranceTargets`、`fetchPrefPage`、`proposeEntrance`、手数の上限（県 60、全体 300） |

## 7. 共通の決まり

### 7.3 全タスクに共通

- commit は実行時に利用者の確認の後。push しない。メッセージは日本語の conventional 形式。
- 秘密の値を計画、コード、試験、ログに書かない。`.env*` の中身を表示しない。
- 既存アプリのコード、画面、データ構造を持ち込まない。農場の所在地、社名、家保の連絡先、個人名、メールアドレス、`private/` の内容をリポジトリに転記しない。`private/` は経路だけを示す。
- Claude Code だけで完結する。Codex とローカル LLM を使わない。

## 8. 計画の判断

次は計画の判断【計】で、回答を待たない。

- `AreaStatus` は同じ／隣／他。`areaNoDistance` と `riskAnywhere` を全段階で出し、特に level 4 を W-03、W-07、X-12 で試験する（§2、§14）。
- 関連農場は件数に入れず町の履歴に出す（§1、§15）。廃鶏出荷羽数などは保存せず、報告文の画面で入れる（§10.1、§21）。
- エージェントは `claude-sonnet-5-5`、1 セッション 1 ドル、週 1 回。`AGENT_EVAL_HIDE_PREFS` は環境変数のまま（`set-setting` は知らないキーを拒む）で、消すのは X-26 の deploy に載せる。
- 下書きは `claude-sonnet-5-5`。招待コードの試行は 1 時間に失敗 10 回まで。`/privacy` は X-19 が持ち、M は設定の画面からリンクする。
- 配信の再開は `resumeMail` で本人だけが行う（運営者が戻す形は §12 と合わないので作らない）。記録とやることの sample は相対リンクで動かす。
- React と React Router／シーズン外の `watchTick` を止めない／再現の `watchStatus` は「説明のための例です」、再現は 4 事例だけと画面に書く／`TrendSummary` は §7 の 3 項目／県の文章は転載せずリンクだけ、受診の案内を入れない。
