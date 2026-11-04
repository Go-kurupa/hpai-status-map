# Managed Agents の試行

県のサイトの見回り先が壊れたときに、新しい入口を**提案する**エージェントを、Claude Managed Agents のスケジュールデプロイメントで動かせるかを試す。提案だけで、見回り先は変えない（運営者が承認する）。

**decision: 未決。** この文書の「実物で試す」を人が行った後に書く（開始から 4 時間で G1〜G6 が揃わなければ `cloud_functions`）。

## できていること（コードと試験。実物の API には未接続）

| もの | 場所 |
|---|---|
| エージェント、環境、vault、credential、定期実行の設定を作る純粋関数 | `scripts/lib/agent-config.ts` |
| 上の順に作り、ID を `~/.config/hpai/agent-ids.json`（mode 600）に控える実行ファイル | `scripts/setup-agent.ts` |
| 内部用の MCP（Bearer が要る。道具は 3 つだけ） | `functions/src/agent/{index,mcpInternal,tools}.ts` |
| 試験 | `scripts/test/agent-config.test.ts`、`functions/test/mcp-internal-auth.test.ts` |

設定の値: モデル `claude-sonnet-5-5`（effort `medium`）／道具は `mcp_toolset` 1 つだけ（`always_allow`）／環境は `cloud` で `limited`＋`allow_mcp_servers`／毎週月曜 07:00（`Asia/Tokyo`）／1 セッションの上限は 1 ドル（`budget` の `amount` は最小単位の `"100"`）。

仮の道具（`tools.ts`。エージェントの実装で本物にする）: 対象は固定の 3 県（33、01、02。`currentUrl` は null）、`propose_entrance` は id を返すだけで何も書かない。`fetch_pref_page` は `politeFetch` を通り、県のドメインの外へは取得の前に拒む（リダイレクトの先も同じ）。手数の上限はまだ無く、1 セッション 1 ドルの上限が止める。

## SDK と公式の資料の確認（2026-11-03）

`@anthropic-ai/sdk` 1.4.0 の型定義（`node_modules/@anthropic-ai/sdk/resources/beta/`）と、claude-api スキルの Managed Agents の資料（スケジュールデプロイメント、MCP と vault、権限の方針、予算）で確かめた。設定を返す関数は SDK の型を返り値に付けてあり、`npm run typecheck` が通る。

| 使うもの | 型定義 | 結果 |
|---|---|---|
| `client.beta.environments.create` | `EnvironmentCreateParams` | 有。`config` は `{type:"cloud", networking:{type:"limited", allow_mcp_servers}}` |
| `client.beta.agents.create` | `AgentCreateParams` | 有。`model` は `{id, effort}`、`mcp_servers`、`tools`（`mcp_toolset`） |
| `client.beta.vaults.create` | `VaultCreateParams` | 有。`display_name` が必須 |
| `client.beta.vaults.credentials.create(vaultId, …)` | `CredentialCreateParams` | 有。`auth` は `{type:"static_bearer", mcp_server_url, token}` |
| `client.beta.deployments.create` / `.run` | `DeploymentCreateParams` | 有。`schedule`、`budget`、`vault_ids`、`initial_events`、`name` |
| `deployment.schedule.upcoming_runs_at` | `BetaManagedAgentsScheduleParams` の周辺 | 有（G1 で見る） |
| `sessions.retrieve(id).usage.list_cost` | `BetaManagedAgentsSessionUsage` | 有。`null` もある（G7） |
| `evaluated_permission`、`stop_reason` | `sessions/events.d.ts` | 有（G3、G4） |

## brief と公式の違い（公式に合わせた点）

1. **環境は `config` の中に入れる、`name` が必須。** brief の `{type:"cloud", networking:{…}}` は `config` の値。`{ name, config: { type:"cloud", networking:{ type:"limited", allow_mcp_servers:true } } }` にした。
2. **エージェントには `mcp_servers` の宣言も要る。** brief の `tools`（`mcp_toolset` だけ）だけでは、`mcp_server_name: "internal"` の指す先が無い。`mcp_servers: [{type:"url", name:"internal", url: MCP_INTERNAL_URL}]` を足した（認証の項目は無い。認証は vault 側）。`tools` は `mcp_toolset` 1 つのまま。`agent_toolset_20260401` は入れず、bash も Web の道具も持たせない。
3. **デプロイメントには `name` が必須。** 日本語の名前を付けた。
4. **vault の credential は、`mcp_server_url` の一致で付く**（ホストの大文字小文字、既定のポート、末尾の `/` は正規化されるが、path が違えば付かない）。agent の `mcp_servers[0].url` と credential の `mcp_server_url` を同じ関数（`mcpInternalUrl`）の同じ文字列から作り、試験で一致を確かめている。
5. **MCP の権限の既定は `always_ask`。** 定期実行は応える相手がいないので止まる（公式: 応えないと実行が待ち続ける）。`default_config.permission_policy` を `always_allow` に明示した。公式は `auto` も勧めるが、`auto` は止まることがあるので使わない。
6. **スケジュールの実行は最大 9 分ほど遅れうる**（公式: 間隔の 15% まで、5 秒以上 9 分以下のばらつき）。「07:00」は「07:00 ごろ」と読む。`upcoming_runs_at` は設定どおりの時刻を返す。
7. **budget は最小単位（セント）の整数の文字列。** `"100"` が 1 ドル。上限に達したセッションは終了せず `idle`（`stop_reason: budget_reached`）で止まる。止める判定は次のモデル呼び出しの前なので、上限を最大で 1 回分超えうる。
8. **vault の credential は作るときに検証されない。** 鍵が違っても `create` は通り、実行中に MCP の認証の失敗として出る。G5（`mcpInternal authed` が内部のログに出る）で初めて確かめられる。
9. **ネットワークは `limited`＋`allow_mcp_servers`。** 公式の注意: これで MCP のホストへの出口が開く。`allowed_hosts` を空にしたので Web の取得はどこにも届かない（Web の道具も持たせていない）。

## 実物で試す（Step 5。人の作業の後。ここまでは実行していない）

前提: 人の作業 6（`bash scripts/set-ops-token.sh`。`~/.config/hpai/internal-mcp-token` ができる）と、運用の鍵を `ANTHROPIC_API_KEY` として**この実行の間だけ**環境に入れること。値は表示しない。

1. 確認の後に `mcpInternal` を deploy（`--only functions:mcpInternal`、`--account` と `--project` を付ける）。deploy が表示する URL が `mcpInternalUrl` の形（`https://asia-northeast1-<project>.cloudfunctions.net/mcpInternal`）と同じか確かめる。**違えば `scripts/lib/agent-config.ts` の `mcpInternalUrl` を直す（未確認）。**
2. `FIREBASE_PROJECT=<project> npx tsx scripts/setup-agent.ts`。出力に `AGENT_DEPLOYMENT_ID: 設定済み` と `upcoming_runs_at` が出る。ID は出ない。途中で止まっても、再実行は作った分を作り直さない。
3. `client.beta.deployments.run(<deploymentId>)` で 1 回動かす（スケジュールを待たない。一時停止中でも手動の実行はできる）。
4. 次を確かめる。

| 印 | 確かめること |
|---|---|
| G1 | すべての create が通り、`upcoming_runs_at` が月曜 07:00 JST |
| G2 | `run` の結果に `session_id` がある |
| G3 | 道具の呼び出しの `evaluated_permission` が `allow`。`agent.tool_use`（組み込みの道具）が 0 件 |
| G4 | 最後の `session.status_idle` の `stop_reason.type` が `end_turn` |
| G5 | `functions:log --only mcpInternal` に `mcpInternal authed` がある |
| G6 | `propose_entrance` の結果が `is_error` でない |
| G7 | `sessions.retrieve(id).usage.list_cost`（null もある）が 100 セント未満 |

## 判断（Step 6。人の作業の後に書く）

- 結果（G1〜G7 の実測）: 未実施
- 費用（`list_cost`、手数）: 未実施
- `decision: managed | cloud_functions`: 未決
- 判断の記録に残すこと: 開始の時刻、G1〜G6 が揃った時刻（開始から 4 時間以内か）、揃わなかった印と原因。
