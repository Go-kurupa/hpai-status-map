# 領域 F: 基盤とデータ 実装計画

正は設計書（`§` は章）。名前と型は契約（`00-contract.md`）に従い、契約 7.3 を全タスクに適用する。Depends on の `*` はその依存のコードだけを待ち（F-02 は Step 3、F-03 は Step 4 まで）、deploy と本番の実行を待たない。各タスクの最後は Commit（Files のすべて、利用者の確認の後）。

---

### Task F-01: 骨格、同梱、試験、shared の型と基本

読む節: 1、2.1〜2.4、3.1、4.1

**Day:** 11/4 朝 / **Depends on:** なし

**Files:** Create ルートの `package.json`、`.nvmrc`、`tsconfig.base.json`、`vitest.config.ts`、`firebase.json`、`.firebaserc`、`firestore.rules`、`firestore.indexes.json`、`storage.rules`（ルールは全拒否、索引は空）／`shared/`（`src/{types,text,season,dates,pref,wording}.ts`）／`functions/`（`scripts/bundle.mjs`、`src/{index,options,secrets,admin}.ts`、`src/{probe,ops,watch,read,review,usage,notify,farm,drafts,api,mcp,agent}/index.ts`）／`web/`（`package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`）／`evals/package.json`／`scripts/`（`check-bundle.ts`、`copy-web-data.ts`）。Modify `.gitignore`（追加のみ: `functions/lib/`、`web/public/{geo,history,replay,evals,trends}/`、`.firebase/`、`.secret.local`）。Test `shared/test/*.test.ts`、`functions/test/shared-import.test.ts`、`scripts/test/skeleton.test.ts`

**Interfaces:** Produces 契約 1 章、2.1〜2.4 の型と `DEFAULT_RUNTIME_SETTINGS`（`shared/src/types.ts`）、3.1 の関数（`hasHpaiWord` を含む。F-03、F-09、I-01、I-02 は import する）、`copyWebData(root: string): void`、`admin.ts` の `db`、`bucket()`。

**依存の版**（exact。2026-11-03 に確認）

| 置き場所 | パッケージ |
|---|---|
| ルート dev | `typescript@7.0.2`、`vitest@5.1.0`、`firebase-tools@15.34.2`、`tsx@4.23.15`、`esbuild@0.28.2`、`@firebase/rules-unit-testing@6.0.0`、`mapshaper@0.7.101`、`topojson-server@3.0.1` |
| shared | `@turf/point-to-polygon-distance@7.4.0`、`@turf/helpers@7.4.0`、`topojson-client@3.1.0`、`zod@4.6.7`／dev `@types/geojson`、`@types/node`（最新を固定） |
| web | `react@19.3.1`、`react-dom@19.3.1`、`react-router@8.5.1`、`firebase@13.2.0`、`maplibre-gl@6.16.0`／dev `vite@8.3.5`、`@vitejs/plugin-react@6.2.1`、`jsdom`、`@testing-library/react`（最新を固定） |
| functions | `firebase-functions@7.4.0`、`firebase-admin@14.5.0`、`@anthropic-ai/sdk@1.4.0`、`@modelcontextprotocol/sdk@1.32.2`、`nodemailer@10.3.1`、`cheerio@1.2.0`、`iconv-lite@0.7.3`、`robots-parser@3.0.1`、`fast-xml-parser@5.11.2`、`unpdf@2.1.0`、shared の依存すべて（同じ版） |

**固定する設定**
- workspaces: `shared`、`web`、`functions`、`evals`、`scripts`。`engines.node` `>=24.12`、`.nvmrc` 24。
- 同梱: `esbuild src/index.ts --bundle --platform=node --format=cjs --target=node24 --packages=external --alias:@hpai/shared=../shared/src --outfile=lib/index.js`。`functions/package.json` は `"main":"lib/index.js"`、`engines.node "24"`、script `bundle`。
- TS: `target ES2023`、`module ESNext`、`moduleResolution bundler`、`strict`、`noUncheckedIndexedAccess`、`noEmit`、`skipLibCheck`。`baseUrl`、`paths`、import の拡張子を使わない。TS の JS API を要る道具を入れない。
- `firebase.json`: `functions` は `runtime nodejs24`、`predeploy ["npm run bundle -w functions"]`、`ignore ["node_modules","src","test","scripts","*.local","tsconfig*.json"]`。Hosting は契約 1.5 に SPA の fallback と `/geo/**`、`/history/**` の `Cache-Control: public, max-age=86400`。rewrite は `{functionId, region:"asia-northeast1"}`。emulators は firestore 8080、auth 9099、storage 9199、functions 5001、hosting 5000、`host "0.0.0.0"`、ui 無効。`.firebaserc` の既定は `demo-hpai`。
- `test`: `vitest run --project shared --project functions --project web --project scripts`。`test:rules`: `firebase emulators:exec --only firestore,auth --project demo-hpai "vitest run --project rules"`。`test:emul`: 同じ形で `--only firestore,auth,storage`、`--project functions-emul`。`typecheck`: 各 workspace で `tsc --noEmit`。`build`: copy-web-data → vite build → bundle。
- `options.ts`: `setGlobalOptions({region:"asia-northeast1", maxInstances:5})`。

- [ ] **Step 1: 失敗する試験を書く**

```ts
expect(normalizeForMatch("⾼病原性⿃")).toBe("高病原性鳥");
expect(normalizeForMatch("⻲岡市")).toBe("亀岡市");  // NFKC で変わらない。⻘ と ⻑ も
expect(normalizeForMatch("津 山\n市　")).toBe("津山市");
expect(normalizeForMatch("金ヶ崎町")).toBe(normalizeForMatch("金ケ崎町"));
expect(hasHpaiWord("⿃インフルエンザに関する相談窓口")).toBe(true);
expect(hasHpaiWord("インフルエンザ様疾患による学校の臨時休業（第39報）")).toBe(false); // §9.1
expect(seasonOf("2026-05-31")).toBe(2025); expect(seasonOf("2026-06-01")).toBe(2026);
expect(currentSeason(new Date("2026-05-31T15:00:00Z"))).toBe(2026); // JST で 6/1
expect([2026, 2025, 2024].map((s) => seasonAgoLabel(s, 2026))).toEqual(["今季", "昨季", "2 年前"]);
expect(toJstIso(new Date("2025-12-20T00:00:00Z"))).toBe("2025-12-20T09:00:00+09:00");
expect(addDays("2025-12-30", 22)).toBe("2026-01-21");
expect(["岡山県", "岡山", "北海道", "京都府", "東北"].map(prefCodeOfName)).toEqual(["33", "33", "01", "26", null]);
expect(FORBIDDEN_PHRASES).toEqual(["区域の外です", "安全", "安心"]);
expect(findForbiddenPhrases("区域の 外です")).toEqual(["区域の外です"]);
expect(DEFAULT_RUNTIME_SETTINGS).toEqual({ softLimitJpy: 2000, hardLimitJpy: 2500, jpyPerUsd: 150, autoPublishEnabled: false,
  primaryModel: "claude-opus-5-5", primaryEffort: "medium", secondModel: "claude-haiku-5-5" });
```

`FIXED_TEXT` は契約 3.1 の文と一致し、禁止の語がない。`riskAnywhere` は「件数が少なくても、シーズン中はどこでも感染のリスクがあります」と `https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf` を含む。骨格: `functions` から `@hpai/shared` を読める／bundle の後に `lib/index.js` に `@hpai/shared` が残らず、`check-bundle` が通る（組み込みでも `dependencies` でもない `require` で exit 1）／`functions/package.json` に `type module` と `@hpai/shared` がない／`firebase.json` の上の値／`copyWebData` は無い入力を飛ばす。

- [ ] **Step 2: 失敗を確かめる** `package.json` 群を置いて `npm install`。`npx vitest run --project shared --project functions --project scripts --passWithNoTests=false`。期待: 失敗。
- [ ] **Step 3: 実装** 変換表は `⺠民 ⻁虎 ⻄西 ⻅見 ⻆角 ⻈言 ⻉貝 ⻊足 ⻋車 ⻑長 ⻘青 ⻝食 ⻣骨 ⻤鬼 ⻨麦 ⻩黄 ⻫斉 ⻭歯 ⻯竜 ⻲亀`。時刻は UTC+9 固定。
- [ ] **Step 4: 通ることを確かめる** `npm test`、`npm run test:rules`、`npm run typecheck`、`npm run bundle -w functions`。期待: exit 0。`data/` がなくても `bundle` が通る。
- [ ] **Step 5: Commit** `chore: リポジトリの骨格、同梱、shared の基本を作る`

---

### Task F-02: Firebase、opsAdmin、ops.ts、Secret のスクリプト

読む節: 0、1.7、2.2、4.1、索引の人の作業

**Day:** 11/4 / **Depends on:** F-01 / **Human:** 人の作業 1〜6、deploy の承認

**Files:** Create `functions/src/ops/{auth,handlers}.ts`、`scripts/ops.ts`、`scripts/set-ops-token.sh`。Modify `functions/src/ops/index.ts`、`shared/src/types.ts`。Test `functions/test/ops-auth.test.ts`、`functions/test/emul/opsAdmin.test.ts`、`scripts/test/set-ops-token.test.ts`

**Interfaces:** Produces `checkBearer`（契約 3.7）、関数 `opsAdmin`（`POST`、本文 `{op, ...}`）、`handleOp(body: OpRequest, opts?: { sourcesPath?: string }): Promise<OpResult>`、`scripts/ops.ts` の 4 操作（契約 1.7）。`shared/src/types.ts` に次を足す。

```ts
interface Source extends SourceSeed { // sources/{sha256(url) 先頭 24 桁}
  id: string; group: 0 | 1 | 2; enabled: boolean; lastCheckedAt: IsoDateTime | null; lastOkAt: IsoDateTime | null;
  etag: string | null; lastModified: string | null; fingerprint: string | null; failureCount: number;
}
interface Invite { kind: "signup" | "farm"; farmId: string | null; maxUses: number; usedBy: string[]; expiresAt: IsoDateTime | null }
```

- [ ] **Step 1: 失敗する試験を書く**
  - `checkBearer`: 一致で true。値違い、長さ違い（例外にしない）、`undefined` で false。
  - 模擬環境: `set-claims` は既存の claim を残す／`create-invite` は平文を 1 度返し、文書は `{kind:"signup",farmId:null,maxUses:5,usedBy:[],expiresAt:null}` で平文を含まない／`seed-sources` は既存の行を上書きせず、`group` は `parseInt(id.slice(0,8),16)%3`、`enabled` true、`failureCount` 0、他は null／`set-setting` は無ければ既定値で作り、知らないキーと型の違う値を拒む。
  - `set-ops-token.sh`（偽の `npx` で引数を記録）: 3 つの Secret を `--account`、`--project` つきで入れ、値を出力しない／控えは mode 600 で、在れば作り直さない／`ANTHROPIC_API_KEY`、`GMAIL_APP_PASSWORD` を入れず、仮の値も入れない。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project functions --project scripts --passWithNoTests=false ops`、`npm run test:emul`。期待: 失敗。
- [ ] **Step 3: 実装** `onRequest({invoker:"public", secrets:[OPS_TOKEN], timeoutSeconds:120, memory:"256MiB"})`。認証の失敗は 401、入力エラーは 400。応答とログに Secret、招待コード、email を出さない。スクリプトは `set -euo pipefail`、`umask 077`、`openssl rand -base64 32`、`functions:secrets:set <名前> --data-file=-`。
- [ ] **Step 4: Human** 人の作業 1〜6。Claude は `npx firebase login:list` の結果を示し、この作業のアカウントで合っているかを確かめる。値の決まらない設定は `KEY=` と空で置ける【確】。
- [ ] **Step 5: deploy（利用者の確認の後）** `npx firebase --account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT" deploy --only functions:opsAdmin`。403 や `Missing permissions` はまずアカウント違いを疑う。
- [ ] **Step 6: 通ることを確かめる** `npm run test:emul`、対象の vitest。本番に認証なしで POST する: `curl -s -o /dev/null -w "%{http_code}" -X POST "https://asia-northeast1-$FIREBASE_PROJECT.cloudfunctions.net/opsAdmin"`。期待: `401`。
- [ ] **Step 7: Commit** `feat(ops): 手元から本番を管理する opsAdmin を足す`

---

### Task F-03: politeFetch、本文の取り出し、到達試験、TLS の判断点

読む節: 0、1.7、3.7、4.1、索引 Q7

**Day:** 11/4（実測は人の作業の後） / **Depends on:** F-02* / **Human:** deploy と本番の実行の承認、Step 6 の判断

**Files:** Create `functions/src/watch/{politeFetch,extract}.ts`、`functions/src/probe/run.ts`、`scripts/lib/{probe-targets,reachability}.ts`、`docs/reachability.md`（生成物）。Modify `functions/src/probe/index.ts`、`scripts/ops.ts`。Test `functions/test/{politeFetch,extract,probe}.test.ts`、`scripts/test/{probe-targets,reachability}.test.ts`

**Interfaces:** Produces 契約 3.7 の全部、関数 `probeEntrances`（`POST {targets}`、応答は 1 行 1 `ProbeRow` の NDJSON）、`data/private/reach/probe-<YYYYMMDD>.ndjson`、`docs/reachability.md`。

```ts
interface ProbeTarget { prefCode: PrefCode | null; url: string; kind: string; dev: { ok: boolean; hasWord: boolean | null } | null }
type ProbeVerdict = "ok" | "reached_no_content" | "not_allowed" | "robots_denied" | "http_error" | "tls_error" | "network_error";
interface ProbeRow { target: ProbeTarget; verdict: ProbeVerdict; status: number | null; finalUrl: string | null; errorCode: string | null;
  bytes: number; ms: number; hasWord: boolean; itemCount: number; outbreakTitleCount: number }
function probeTargets(targets: readonly ProbeTarget[], onRow: (r: ProbeRow) => void,
  deps?: { fetcher?: typeof politeFetch; handshake?: (url: string) => Promise<{ code: string | null; tls: boolean }> }): Promise<void>;
function buildProbeTargets(permanentTsv: string, entrancesTsv: string): ProbeTarget[];
function renderReachability(rows: readonly ProbeRow[], measuredAt: IsoDateTime): string;
```

**200 のときの verdict**: `rss*` は項目が 1 つ以上／PDF は `%PDF` 始まり／`press_list`、`maff_press`、`maff_arc`、`dept_page`、`season_parent`、`reference` は無条件（課のトップは平時に語がない。語の有無は `hasWord` に残す）／他は `hasHpaiWord`。どれも外れれば `reached_no_content`。許可するホストは `.go.jp`、`.lg.jp`、`^(www\d*\.)?pref\.[a-z]+\.jp$`。

- [ ] **Step 1: 失敗する試験を書く**（`node:http` の一時サーバー。外へ出ない）
  - 作法（§9.1）: 受けた順 `["/robots.txt","/page"]`、`USER_AGENT` は `/^hpai-status-map\/0\.1 \(\+https:\/\/github\.com\/[^)]+\)$/`／禁止なら `robots_denied` で本体を取らない／robots が 404 は許可、5xx は本体を取らない、接続切れは `network_error`／間隔は robots と本体の間も含め差 >= 1190ms、`Crawl-delay: 2` で >= 1990ms／304 は `not_modified`／404 は `http_error`／リダイレクトの先も robots を見る／輪は 5 回で `too_many_redirects`。
  - `allowUrl`: 拒む URL は robots も取らず `not_allowed`、受信 0 回／リダイレクトの先を拒むと、その先への要求 0 回。
  - TLS（`fetch` を `vi.stubGlobal`）: `new TypeError("fetch failed",{cause:{cause:{code:"EPROTO"}}})` は `{kind:"network_error",code:"EPROTO",tls:true}`／`ERR_SSL_WRONG_VERSION_NUMBER`、`CERT_HAS_EXPIRED`、`DEPTH_ZERO_SELF_SIGNED_CERT` は `tls:true`／`UND_ERR_CONNECT_TIMEOUT`、`ECONNRESET`、`ENOTFOUND` は `tls:false`／再試行しない（呼び出し 1 回）。
  - ソース検査: `functions/src`、`scripts`（test を除く）、`functions/package.json`、`firebase.json` に `/rejectUnauthorized|secureOptions|UnsafeLegacyRenegotiation|ALLOW_UNSAFE_LEGACY|SSL_OP_|NODE_TLS_REJECT_UNAUTHORIZED|openssl-legacy/i` がない。
  - `decodeBody`: content-type、XML 宣言、meta の順、既定は UTF-8（Shift_JIS、EUC-JP）。`extractHtml`: `script`、`style`、`nav`、`header`、`footer`、`aside` を落とす／本文の容器は `#main_content, main, #main, #contents, #tmp_contents, article` の最初、なければ `body`／リンクは絶対 URL で、`mailto`、`tel`、`javascript`、`#` だけのものを除き重複を除く。
  - `probeTargets`: 語がなければ 200 でも `reached_no_content`（`hpai_fixed`、学校の臨時休業だけの本文）／`dept_page`、`season_parent` は語がなくても `ok` で `hasWord` false／「高病原性鳥インフルエンザの疑似患畜の確認」を `outbreakTitleCount` に数える／許可外（kintoneapp.com を含む）は `not_allowed` で fetcher を呼ばない／`network_error` のときだけ handshake を 1 回呼び、`tls:true` なら `tls_error`／1 件の失敗で止めない。handshake の実物は `node:net` の一時サーバーが平文を返すと `{code:"EPROTO",tls:true}`【確】。
  - `buildProbeTargets`: URL のない行と `blocked` の行を飛ばす（`www2.pref.fukui.lg.jp` は許可の形に通るのでここで落とす）／entrances にある県は permanent の行を使わない（「愛知」と「愛知県」）／URL の重複を除く／国と環境省の 12 件を含む（`www.maff.go.jp/j/` の下の `press/index.html`、`press/arc/{2510,2511,2512,2601,2602,2603,2604}.html`、`press/syouan/douei/251220.html`、`syouan/douei/tori/r8_hpai_kokunai.html`、`syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf`、`https://www.env.go.jp/nature/dobutsu/bird_flu/`）／地図の配布元 4 件を `reference` で別々に含む（`https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html`、`https://maps.gsi.go.jp/development/ichiran.html`、`https://cyberjapandata.gsi.go.jp/xyz/pale/5/28/12.png`、`https://www.gsi.go.jp/LAW/2930-index.html`）。
  - `renderReachability`: 要約に国の月別一覧の題の合計、届いた入口の数、届かなかった県名／`tls_error` を別の欄に `errorCode` つきで／開発機で届きクラウドで届かない行を分ける／47 都道府県すべてが出る／TSV の note を含まず、禁止の語がない。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project functions --project scripts --passWithNoTests=false politeFetch extract probe reachability`。期待: 失敗。
- [ ] **Step 3: 実装**
  - `politeFetch`: `redirect:"manual"`、既定の `timeoutMs` 30000、robots はオリジンごとに 24 時間メモリに持つ、間隔はホストごとの待ち行列。UA の URL は origin の URL。TLS の code は `EPROTO`、`ERR_SSL_*`、`ERR_TLS_*`、`CERT_*`、`*_CERT*`、`UNABLE_TO_*`。
  - `probeEntrances`: `onRequest({invoker:"public", secrets:[OPS_TOKEN], timeoutSeconds:1800, memory:"512MiB"})`。`res.write` で 1 行ずつ返す（Node の `fetch` は応答の頭を 300 秒で打ち切る）。ホストごとに順に、同時に 10 ホストまで。本文を返さず保存しない。
  - handshake: `node:https` で `https://<host>/` に HEAD を 1 回（既定の TLS 設定、`USER_AGENT`、15 秒、ホストの間隔を守る）。
  - Step 6 で B が選ばれるまで緩和のコードを書かない。
  - `ops.ts probe`: `buildProbeTargets` → 関数 → NDJSON → `renderReachability`。dev は `status` が 200 で始まるかと `has_hpai_word`（entrances は null）。`--from-sources` は `data/sources.json` のうち `data/private/reach/` にない URL だけ。
- [ ] **Step 4: 通ることを確かめる** 同じコマンド。
- [ ] **Step 5: deploy と本番の実行（利用者の確認の後）** `deploy --only functions:probeEntrances`（`--account`、`--project` つき）の後、`npx tsx scripts/ops.ts probe --permanent private/research/pref-feeds/permanent-pages-20261103.tsv --entrances private/research/pref-feeds/entrances-12-20261103.tsv` を **1 回だけ**。`www.gsi.go.jp` が `tls_error`（`EPROTO`）なら分類は動いている。見回り先でないので、F-06、W-07 の原本確認は利用者がブラウザで行う。
- [ ] **Step 6: Human（判断点）** `docs/reachability.md` を次の順に示す。
  1. 国の月別一覧 7 ページの題の合計が **24** か。違うか `www.maff.go.jp` が届かなければ止めて知らせる（国は主の入口）。
  2. 届かなかった県。§9.7 のとおり「確認できません」と表示して国で補う。回避しない。
  3. `tls_error` の入口。1 件ずつ選ぶ（索引 Q7）。B のときだけ対象のホストをソース検査の例外に足す。
  4. 開発機で届きクラウドで届かない入口が多ければ、原因を説明して I-02 の前に相談する。
- [ ] **Step 7: Commit** `feat(probe): politeFetch と全入口への到達試験を足す`

---

### Task F-05: ルールと索引、権限の試験

読む節: 2.3、2.7、4.2

**Day:** 11/4 / **Depends on:** F-01 / **Human:** 本番への反映の承認

**Files:** Modify `firestore.rules`、`firestore.indexes.json`。Test `firestore-tests/rules.test.ts`、`scripts/test/indexes.test.ts`

**Interfaces:** Produces 契約 4.2 のルールと索引（`desc` のない列は昇順）: `cases(season,prefCode)`、`wildBirds(season,date)`、`sentNotices(state,timing,queuedAt)`、`sentNotices(subjectId,event)`、`reviewQueue(resolvedAt,createdAt desc)`、`documents(readState,fetchedAt)`。`reviewQueue` の向きは I-07 の `where("resolvedAt","==",null), orderBy("createdAt","desc")` に合わせる。`hasOnly`: `farms` は `Farm` の全 13 キー／`houses` は `name, birdType, flockSize, empty`／`deaths` は `date, houseId, deaths, flockSizeAt, exclusion`／`checks` は `kind, date, itemId, month, answers`。数の型は契約 4.2。

- [ ] **Step 1: 失敗する試験を書く**（`demo-hpai`。`alice` は f1、`bob` は f2 の会員）
  - §16 権限: 他の農場の農場、鶏舎、死亡数、点検を読めない／`operator` でも農場と死亡数を読めない／`member` の claim だけ、未ログインも読めない／`array-contains` で自分の農場を探せ、全件の取得は落ちる。
  - 書き込み: 自分の農場は読み書きできる／作成は `member` が要り、`memberUids` に他人、`unsubscribedUids` が空でないと落ちる／更新で 2 つを変えられない／直接消せない。
  - 地点と入力者: `lat`、`lng`、`latitude`、`longitude`、`address` を持てない／`meshCode` の `5339461`、`533946111`、`abcdefgh` が落ちる／`deaths`、`checks` に `uid`、`createdBy` を持てない。
  - 数の型（§8）: `deaths.deaths`、`deaths.flockSizeAt`、`houses.flockSize` の文字、負の数、小数が落ち、0 は通る。`production`、`housing` の null は通る。
  - 公開と非公開: `cases`、`wildBirds`、`watchStatus` は全員読めて誰も書けない／`caseDrafts` は `member`、`reviewQueue` は `operator` だけ読める／`sources`、`documents`、`invites`、`invites/_attempts/uids/alice`、`sentNotices`、`usage`、書かれていない集合は `operator` でも読めない。
  - 索引: 6 つあり、`reviewQueue` の `createdAt` は `DESCENDING`。
- [ ] **Step 2: 失敗を確かめる** `npm run test:rules`。期待: 「読み書きできる」の行が失敗。
- [ ] **Step 3: 実装** 契約 4.2 のまま。
- [ ] **Step 4: 通ることを確かめる** `npm run test:rules && npx vitest run --project scripts scripts/test/indexes.test.ts`。
- [ ] **Step 5: 本番への反映（F-02 の後、利用者の確認の後）** `deploy --only firestore:rules,firestore:indexes,storage`（`--account`、`--project` つき）。
- [ ] **Step 6: Commit** `feat(rules): Firestore のルールと索引を書く`

---

### Task F-06: mesh、geo、data/geo、N03 の文書

読む節: 0、3.2、5、索引の人の作業 8

**Day:** 11/4 / **Depends on:** F-01 / **Human:** 人の作業 8 の日付を受け取る。`www.gsi.go.jp` は Node から届かないので Q1-24、Q1-11 の原文は利用者がブラウザで確かめる

**Files:** Create `shared/src/{mesh,geo}.ts`、`shared/test/fixtures/geo.ts`、`scripts/build-geo.ts`、`scripts/lib/{designated-cities,geo-build,geoStore}.ts`、`functions/src/geo/loadGeo.ts`、`data/geo/`（生成物）、`docs/data-sources.md`。Test `shared/test/{mesh,geo}.test.ts`、`scripts/test/{geo-build,build-geo,data-sources}.test.ts`、`functions/test/loadGeo.test.ts`

**Interfaces:** Produces 契約 3.2 の `mesh`、`geo`、契約 5 の `data/geo/`、`loadGeoStore(baseDir?: string): Promise<GeoStore>`（既定は `path.join(__dirname,"data","geo")`）、`loadScriptGeoStore(): Promise<GeoStore>`、`muniCodeOf(props): MuniCode`、`buildAdjacency`、`buildMuniIndex`、`largestPolygonCenter`（`MuniEntry.center` と `pref-anchors.json` に使う。最大の面の bbox の中心）、試験用の `makeGeo`、`boxNorthOf`。`docs/data-sources.md`（X-26 が写す）。

**N03 の属性**【確】: `N03_001` 県、`N03_004` 市区町村（政令市は市名）、`N03_005` 政令市の区、`N03_007` コード（区のコード）。市のコードは属性にない。

**`DESIGNATED_CITIES`**（`"岡山県岡山市": "33100"` の形）: 札幌 01100／仙台 04100／さいたま 11100／千葉 12100／横浜 14100／川崎 14130／相模原 14150／新潟 15100／静岡 22100／浜松 22130／名古屋 23100／京都 26100／大阪 27100／堺 27140／神戸 28100／岡山 33100／広島 34100／北九州 40100／福岡 40130／熊本 43100

**作り方**【確】: `curl -A "hpai-status-map-build/0.1" -o data/private/n03/N03-20260101_GML.zip https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip`（1 回だけ）、`N03-20260101.geojson` を展開。`NODE_OPTIONS=--max-old-space-size=16000`。`mapshaper.runCommands` を順に呼ぶ。`EACH` は `var t=<表のJSON>;c=N03_005?t[N03_001+N03_004]:N03_007;n=N03_004;p=c.slice(0,2);`。`adjacency.json` は A の出力に `neighbors` を全国で 1 回。`build-info.json` は版、出典 URL、簡略化の値、大きさ、除いた地物 141、孤立の一覧。

```
A: -i data/private/n03/N03-20260101.geojson -filter "N03_004 !== '所属未定地'" -each '<EACH>' -dissolve c copy-fields=n,p -rename-layers muni -o data/private/geo-work/full.topo.json format=topojson quantization=1000000
B: -i data/private/geo-work/full.topo.json -simplify 1.5% keep-shapes -clean -o data/geo/japan.topo.json format=topojson quantization=10000
C: -i data/private/geo-work/full.topo.json -simplify interval=30 keep-shapes -o data/private/geo-work/mid.topo.json format=topojson quantization=1000000
D（47 回）: -i data/private/geo-work/mid.topo.json -filter "p==='NN'" -rename-layers muni -o data/geo/pref/NN.topo.json format=topojson quantization=100000
```

- [ ] **Step 1: 失敗する試験を書く**
  - mesh: `latLngToMesh3(35.681,139.767)` は `"53394611"`／`(36,140)` は `"54400000"`（角で下にずれない）／`mesh3Center("53394611")` は `35.6791667`、`139.76875`／中心は同じマス目に戻る／不正なコードは throw。
  - geo: 内側は 0／辺まで北へ 10.70km は ≒10.70（`method:"geodesic"`）／MultiPolygon は最も近い面／読み込む前は `GeoNotLoadedError`、同じ県を 2 度読まない／自分とは隣でない／`findMuniByName` は金ヶ崎町と金ケ崎町を同じに扱い、別の県の伊達市を取らず、同じ県の泊村（`01403`、`01696`）と不在は null。
  - 変換: `{岡山県,岡山市,北区,33101}` は `33100`、`{東京都,千代田区,null,13101}` は `13101`、表にない政令市は throw／隣り合いは対称、隣のない形は空。
  - `data/geo`（§5、§10.3）: 市町村 1747、県 47／`33101`、`01101`、`14101` と所属未定地 `13000`、`46000`、`23000`、`12000`、`30000`、`40000`、`47000` がない／政令市 20 市と `13101` がある／`33203` の隣に `33214`、`33606`、`33622`、`33623`、`33666`、`31201`、`31328`／`13421`、`47207` は隣なし、孤立は 49／`japan.topo.json` は 2MB 以下、pref は 47 ファイル／object は `muni`、properties は `{c,n,p}`／`data/` と `web/public/` に `N03-21_210101` がない。
  - `loadGeoStore` で `33203` を読める。bundle の後に `lib/data/geo/muni-index.json` がある。
  - `docs/data-sources.md`。N03 の節だけを切り出す:

```ts
for (const s of ["CC BY 4.0", "簡略化", "KsjTmplt-N03-2026.html", "R 7JHf 351", "Q1-24", "Q1-11"]) expect(sec).toContain(s);
expect(sec).toMatch(/確かめた日（\d{4}-\d{2}-\d{2}）/);
expect(sec).toMatch(/問い合わせ済み（\d{4}-\d{2}-\d{2}）|確認中/);
expect(sec).not.toMatch(/(不要と確認|手続きは不要|申請不要)/);
expect(sec).not.toMatch(/手続き.{0,6}不要/);
```

  地理院タイルの節に `ichiran.html` と `Vector Map Level 0` がある。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project shared --project scripts --passWithNoTests=false mesh geo data-sources`。期待: 失敗。
- [ ] **Step 3: 実装** 関数と `npx tsx scripts/build-geo.ts`。`docs/data-sources.md` は次の 3 節。
  - `## N03 の出典と加工`: 利用規約の例に沿った出典（国土交通省 国土数値情報「行政区域データ N03 2026 年版」をもとに、形の簡略化、政令市の区の統合、隣り合いの計算を行って作成）、簡略化の値、0.75km はメッシュの半対角だけを覆い 30m の誤差を含まないこと（§19）。
  - `## N03 の利用条件`: 明記の条件 CC BY 4.0／配布ページの「測量法に基づく国土地理院長承認（複製）R 7JHf 351」／Q1-24（複製承認の成果の二次利用は「申請が必要な場合がある」）／Q1-11（地図が主な内容の Web サイトは、挿入の原則の例外に当たる）／確かめた日／問い合わせの状況。判断の文は §10.3【決定】のまま: 「手続きの要否は確認できていない。明記された CC BY 4.0 に従って公開する判断をした」。回答が「要る」なら公開の前に止めて相談する。「要らない」なら日付と窓口を添えて書き、試験は利用者の確認の後に直す。
  - `## 地理院タイル`: 公式の文「出典の明示のみで申請不要」、一覧ページへのリンク、淡色地図の ZL5〜8 に要る VMAP0 の文（W-02 の `MAP_ATTRIBUTION` と同じ）、アクセス数の上限は未確認。
- [ ] **Step 4: 通ることを確かめる** `npm run bundle -w functions && npx vitest run --project shared --project scripts --project functions && npm run typecheck`。
- [ ] **Step 5: Commit** `feat(data): N03 2026 から市町村の形と隣り合いを作り、利用条件を記録する`

---

### Task F-07: 段階、解除の後、野鳥の誤差

読む節: 2.1、2.4、3.2、索引 Q5

**Day:** 11/4 / **Depends on:** F-06

**Files:** Create `shared/src/level.ts`。Test `shared/test/level.test.ts`、`scripts/test/level-real.test.ts`

**Interfaces:** Produces 契約 3.2 の `level` の全部、`ZONE_BASE_KM: 10`、`MESH_MARGIN_KM: 0.75`、`zoneRadiusKm(c: Case): number`（`Math.max(10, ...c.radiiKm)`）。文を持たない。索引 Q5 の回答が既定と違えば、解除の後の同じ市町村の期待を直す。

- [ ] **Step 1: 失敗する試験を書く**（偽の `GeoStore` は `ensurePrefs` の前に `GeoNotLoadedError`）
  - §5、§16: 同じ市町村は①（`same_muni`、遠くても）／10.70km は①、10.80km は①でない（理由に `within_radius`、`radiusKm` 10、距離）／`radiiKm` `[3]`、`[3,10]`、`[20]` は 10、10、20、20.70km は①、20.80km は①でない／隣は②、登録は③、他は④で `reasons` 空／複数は最も高い段階で、`reasons` は高い順／否定は外し、候補は数える／確認中と別のシーズンは数えない／搬出制限の解除の後も①で `shipmentLifted` true／完了から 28 日でも移動制限の解除がなければ①／`inSurveillanceNote` は①のときだけ／離島は②にならず距離なら①／`muniCode` なしは④／未読み込みは `GeoNotLoadedError`。
  - 移動制限の解除の後（契約 2.4）: 同じ市町村は②で `same_muni`（`adjacent` にしない）／隣は②、登録は③のまま／10km 以内でも隣でなければ④／否定とシーズン違いは数えない。
  - `prefsToLoad`: `isCountable` の事例と野鳥の県を重複なく。確認中と否定の県を含めない。
  - `computeAreaStatus`: 同じは 1、解除の後の同じは 2 で `sameMuniCases` に残る、隣は 2、他は 4。距離を見ない／否定と確認中を含まない／`wildBirds` は同じと隣の今季で `negative` を除く。
  - `wildBirdsNotifiable`（§5）: `hpai_confirmed` の 10.40km は入り、10.80km は入らない／`screening_positive`、`negative`、`muniCode` なしは入らない。
  - `summarizeWatch`（§9.7）: 6 時間ちょうどは入り、6 時間 1 分は入らない／`summarizeWatch([],now)` は `failedCount` 47。
  - `data/geo`: 岡山市は `33100` で同じ市は①／`13421` に②がない／冷えた状態から県をまたぐ: 津山市の center のメッシュと鳥取市の事例は、`ensurePrefs(prefsToLoad(...))` の前は `GeoNotLoadedError`、後は②（`adjacent`。鳥取市の面まで 17.66km【確】）。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project shared --passWithNoTests=false shared/test/level.test.ts`。期待: 失敗。
- [ ] **Step 3: 実装** 契約 3.2 のまま。`relationToCase` は時期を見ず、同じ市町村で距離を計算しない。
- [ ] **Step 4: 通ることを確かめる** `npx vitest run --project shared --project scripts && npm run typecheck`。
- [ ] **Step 5: Commit** `feat(shared): 警告の段階を計算する`

---

### Task F-08: 過去 6 シーズン、historyToCase、校正

読む節: 0、2.1、3.1

**Day:** 11/4（校正は 11/5 でよい） / **Depends on:** F-03*、F-07

**Files:** Create `shared/src/history.ts`、`scripts/{build-history,check-history-sources,calibrate-levels}.ts`、`scripts/lib/{history,calibrate}.ts`、`data/history/{cases.json,name-map.json,unmatched.md}`、`docs/level-calibration.md`（生成物）。Test `shared/test/history.test.ts`、`scripts/test/{history,history-data,calibrate}.test.ts`

**Interfaces:** Produces `data/history/cases.json`（`HistoryCase[]`。関連農場を含む）、`historyToCase`、`buildHistory(rows: RawCase[], geo: GeoStore): { cases: HistoryCase[]; nameMap: Record<string, MuniCode>; unmatched: RawCase[] }`（キーは `"岩手県|金ヶ崎町"`）、`calibrate(cases: readonly Case[], points: readonly FarmPoint[], geo: GeoStore): CalibrationResult`。

**`historyToCase`**: `id` `h${season}-${no}`、`nationalNo` = `no`、`prefNo` null、`muniName` = `muniNameThen`、`stages` `{confirmed:{date,time:null}}`、`radiiKm` `[]`、`prefEstimates` すべて null、`negation` `"none"`、`negatedAt` null、`confirmState` `"national"`、`sourceUrls` `[sourceUrl]`、`updatedAt` `${date}T00:00:00+09:00`。他は同名の欄を写す。

**校正の単位**【計】: 各市町村の `center` のメッシュを仮の地点にし、`related:false` の事例を `relationToCase` で数える。

- [ ] **Step 1: 失敗する試験を書く**
  - `historyToCase`: 上のとおり／`related:true` で throw。
  - `buildHistory`: `season` は数値、`count` → `headCount`、`bird` → `birdUse`、`source` → `sourceUrl`／`related` を保ち `note` を持ち越さない／対応しない行は `unmatched` に出す／福岡市は `40130`。
  - データ（§16）: `related:false` は 52、25、84、11、51、24、計 247、`no` は各シーズン 1..N／`related:true` は 58 行で、`(season,no)` が本体にある／`muniCode` は `muni-index` にあり `prefCode` と先頭 2 桁が合う／`seasonOf(date)` が合う／`sourceUrl` は `https://www.maff.go.jp/` の下／キーは `HistoryCase` だけ／同じ県、市町村、日付の別の事例が 8 組／金ヶ崎町と金ケ崎町は `03381`、`北海道|伊達市` は `01233`、`福島県|伊達市` は `07213`／コードは本体で 124、関連を含めて 136【確】／`unmatched.md` は「対応づかない事例: 0 件」。
  - 校正（小さな形で手計算）: シーズンごとに地点あたりの①②の回数の中央値、90%、最大／事例ごとに①に入る市町村の数／面積の広い発生市町村の上位 10 件（bbox の対角線の順）／①②④の合計が 地点数 × 事例数／`related:true` を数えない／同じ（地点、市町村）の距離を 2 度計算しない／文書に `FIXED_TEXT.pastDisclaimer` と「農場の位置ではなく市町村の中心」があり、禁止の語と `/危険|ホットスポット|また発生/` がなく、地点ごとの順位を出さない（§11）。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project shared --project scripts --passWithNoTests=false history calibrate`。期待: 失敗。
- [ ] **Step 3: 実装** 入力は手元の `private/research/cases-6seasons.json`（読むだけ）。1 件でも対応しなければ `unmatched.md` に出して exit 1 にし、利用者に聞く。校正は bbox から緯度 0.3 度、経度 0.4 度より離れていれば距離を計算しない。
- [ ] **Step 4: 出典を確かめる** `check-history-sources.ts` は 6 本の PDF を `politeFetch` で 1 回ずつ取り（`data/private/` に置く）、`unpdf` の文字層を `normalizeForMatch` して各行の `muniNameThen` を探す。期待: 全行で見つかる（本体は `pdftotext` で確認済み、`unpdf` と関連農場は未確認）。見つからない行は利用者に示す。
- [ ] **Step 5: 通ることを確かめる** `npx tsx scripts/build-history.ts --input private/research/cases-6seasons.json && npx tsx scripts/check-history-sources.ts && npx tsx scripts/calibrate-levels.ts && npx vitest run --project shared --project scripts`。
- [ ] **Step 6: 校正を利用者に示す** ①が広すぎる市町村があれば数字で報告する。0.75km と 10km は §5 の決まりなので変えない。
- [ ] **Step 7: Commit** `feat(data): 過去 6 シーズンを市町村に対応づけ、段階の回数を数える`

---

### Task F-09: sources.json、12 県の取り込み、入口の点検のスキル

読む節: 1.7、2.2、3.7、§9.2、索引 Q8

**Day:** 11/4 / **Depends on:** F-03* / **Human:** 12 県の表の承認（Step 5 の後）、deploy の承認

§18、§22 の「12 県の入口を探す」は調査済みなので「結果の取り込みと確認」に読み替える。

**Files:** Create `scripts/{build-sources,check-entrances}.ts`、`scripts/lib/{sources,entrance-table}.ts`、`data/sources.json`、`.claude/skills/entrance-check/SKILL.md`、`docs/entrance-check-YYYY-MM-DD.md`。Modify `docs/data-sources.md`、`docs/reachability.md`。Test `scripts/test/{sources,sources-data,entrance-table}.test.ts`

**Interfaces:** Produces `data/sources.json`（`SourceSeed[]`）、本番の `sources`、`kindOf(tsvKind: string): SourceKind | null`、`TWELVE_PREFS`、`formatEntranceTable(rows): string`、`EntranceCheckRow { prefCode: PrefCode; prefName: string; url: string; kind: SourceKind; outcome: FetchOutcome["kind"]; errorCode: string | null; status: number | null; title: string | null; hasHpaiWord: boolean | null; checkedAt: IsoDateTime }`。

**読み替え**: 35 県は `permanent-pages-20261103.tsv` を `kindOf` で読む。**12 県は TSV を使わず、次の手書きの表だけを使う**（`https://www.` を省略）。`note` は自前の短い文で、資料の文を写さない。

| 県（判定） | `pref_fixed` | `pref_rss` | `pref_press_list` |
|---|---|---|---|
| 新潟（確定） | `pref.niigata.lg.jp/site/chikusan/1196180201100.html` | `.../rss/10/site-163.xml`、`.../rss/10/list2.xml` | |
| 高知（確定） | `pref.kochi.lg.jp/soshiki/160000/160901/`、`.../doc/2022041100295/` | `.../category/bunya/shigoto_sangyo/chikusangyo/index.rss`、`.../category/kubun/news/index.rss` | |
| 滋賀（確定） | `pref.shiga.lg.jp/ge00/7137.html` | | `.../cgi-bin/press/index.php` |
| 岐阜（確定） | `pref.gifu.lg.jp/page/120868.html`、`.../page/338648.html`（note「次季も使うか未確認」） | | `.../site/pressrelease/` |
| 富山（確定） | `pref.toyama.jp/1612/kurashi/seikatsu/shokuseikatsu/20260309.html`（note「URL に日付。次季も使うか未確認」）、`.../1612/kensei/kenseiunei/kensei/soshiki/16/1612.html` | `.../shinchaku/shinchaku.xml`、`.../kensei/kouhou/houdou/press.xml` | |
| 熊本（確定） | `pref.kumamoto.jp/soshiki/77/` | `.../rss/10/soshiki-7-77.xml`、`.../rss/10/list1.xml` | |
| 大分（確定） | `pref.oita.jp/soshiki/15450/` | `.../rss/10/soshiki-15-15450.xml`、`.../rss/10/list6.xml` | |
| 愛媛（確定） | `pref.ehime.jp/soshiki/85/`、`.../page/95900.html`（note「次季も使うか未確認」） | `.../rss/20/soshiki-19-85.xml`、`.../rss/20/list5.xml` | |
| 愛知（確定） | `pref.aichi.jp/soshiki/chikusan/chikusan-hpai.html` | `.../rss/10/list7.xml`、`.../rss/10/list1.xml` | |
| 長崎（確定） | `pref.nagasaki.jp/bunrui/shigoto-sangyo/nogyo/chikusan/boueki/infuruenza/` | | `.../press-contents/index.html` |
| 福岡（条件付き） | `pref.fukuoka.lg.jp/contents/kachikueisei-osirase.html`（note「条件付き。家きんの節は外部リンクのみ」）、`.../contents/shizentorifuru.html`（note「野鳥のみ」） | なし（robots が `/rss/` を禁止） | `.../press/` |
| 福井（確定できず） | `pref.fukui.lg.jp/doc/kaho/toriinfluenza.html`（note「確定できず。国の発表で補う」） | `.../news.xml`（note「発生時に流れるか未確認」） | |

- [ ] **Step 1: 失敗する試験を書く**
  - `kindOf`: `hpai_fixed` → `pref_fixed`、`rss_all`、`rss_press` → `pref_rss`、`rss_none` → null、知らない種類は throw（12 県の種類が混ざれば気づく）。
  - `build-sources`: permanent の 12 県の行を使わない／`--reach` なしで作れる／`--reach` があれば未到達の行を残して note に「クラウドから未到達（日付）」か「古い TLS で未到達（日付）」と書き（I-02 が失敗に数える）、届いた行の `confirmedOn` を実行日にする。
  - `data/sources.json`（§9.2）: 国と環境省の 3 行（`maff_press`、`maff_season`、`moe`）／47 都道府県に 1 行以上、計 108 行（35 県 69、12 県 36、国 3）／愛媛に `soshiki/85/`、`soshiki-19-85.xml`／福岡は `kachikueisei-osirase.html` が `pref_fixed`、`press/` が `pref_press_list`、`pref_rss` なし／福井の note に「国の発表で補う」／`www2.pref.fukui.lg.jp`、`kintoneapp.com`、`pref.fukuoka.lg.jp/rss/`、熊本 `/soshiki/77/1401.html`、大分 `tokuteikatiku.html`、新潟 `2025toriinflu.html` がない／県の行のホストは `/(pref\.[a-z]+(\.lg)?\.jp|metro\.tokyo\.lg\.jp)$/`（X-14 が使う）／URL の重複なし／note は null か 60 字以内で禁止の語がなく、手元の資料と一致する文がない（`describe.skipIf`）。
  - `docs/data-sources.md` に節「見回り先の未確認の点」がある。
  - 点検（§13）: 47 都道府県の行を出し、入口がなければ「入口なし」／`ok` 以外は「確認できません」と理由、TLS は code／見出しに 確認できた数 / 47／列は 県、URL、種類、結果、題名、語の有無、時刻 だけ／`check-entrances.ts` は `fetch` を直接呼ばない（静的検査）／`SKILL.md` に `name: entrance-check` と `description` があり、書いたコマンドのファイルが在る。
- [ ] **Step 2: 失敗を確かめる** `npx vitest run --project scripts --passWithNoTests=false sources entrance`。期待: 失敗。
- [ ] **Step 3: 調査結果の取り込み** 表と国の 3 行を `scripts/lib/sources.ts` に書き、`npx tsx scripts/build-sources.ts --permanent private/research/pref-feeds/permanent-pages-20261103.tsv`（`confirmedOn` は調査の日 2026-11-03）。節「見回り先の未確認の点」: 新年度のページへの切り替わり（新潟、高知、滋賀、岐阜、愛媛）／岐阜 338648、愛媛 95900、富山の日付入りの URL の再利用／発生時に常設ページや RSS が動くか（§9.2）／福岡と福井は県の発生を検知できる根拠がなく国で補う（見せ方は索引 Q8）。
- [ ] **Step 4: スキル** `SKILL.md` に、コマンド（`npx tsx scripts/check-entrances.ts`）、作法（名乗り、robots.txt、間隔 1.2 秒以上、再試行しない、TLS を緩めない）、結果の読み方、「見回り先を勝手に変えない。変更は運営者の承認」を書く。
- [ ] **Step 5: 通ることを確かめる** `npx vitest run --project scripts scripts/test/sources.test.ts scripts/test/sources-data.test.ts scripts/test/entrance-table.test.ts`。
- [ ] **Step 6: Human（承認）** 12 県の表を、判定（確定 10、条件付き 1、確定できず 1）、選んだ理由、未確認の点とともに示して承認を取る。
- [ ] **Step 7: 到達の反映（F-03 の本番の実行の後、利用者の確認の後）** F-03 は同じ TSV を読むので再測定は要らない。URL 欄になく未測定の 6 件（高知 `kubun/news/index.rss`、富山 `1612.html`、`press.xml`、熊本 `list1.xml`、大分 `list6.xml`、愛媛 `95900.html`）だけを `npx tsx scripts/ops.ts probe --from-sources` で 1 回測り、`build-sources --reach data/private/reach/<ファイル>` で作り直す。F-03 の判断も反映する。
- [ ] **Step 8: 本番へ（利用者の確認の後）** `deploy --only functions:opsAdmin`（`--account`、`--project` つき。`data/sources.json` を同梱する）→ `npx tsx scripts/ops.ts seed-sources`。期待: 足した数が 108。`npx tsx scripts/check-entrances.ts` を 1 回。期待: 表ができる。
- [ ] **Step 9: Commit** `feat(data): 47 都道府県の見回り先を確定し、入口の点検のスキルを足す`
