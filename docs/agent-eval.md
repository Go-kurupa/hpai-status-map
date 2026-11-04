# 入口を直すエージェントの受け入れ記録

**状態: 未実施。** この文書は手順と記録の欄だけを置く。測った値はまだ無い。実行は有料の Claude API（Managed Agents）を使うので、利用者が支払いの上限を置いた後に、利用者が行う。結果を書くまで、この作品はエージェントの動きを「確認済み」と言わない。

エージェントは県のサイトの見回り先（入口）が壊れたときに、新しい入口の**案**を運営者の画面（`/operator`）に出す。見回り先（`sources`）を直接は変えない。変わるのは運営者が承認したときだけ。

## 守っていること（実装側。試験は模擬で済み）

| 項目 | 内容 | 確かめた試験 |
|---|---|---|
| 取得先 | その県の公式ドメインかつ https だけ。リダイレクトの先も取得の前に判定し、外への要求は 0 回 | `functions/test/agent-tools.test.ts` |
| 回数 | 1 日に県ごと 60 回、全体で 300 回。超えたら取得せず `limit_reached` | 同上、`functions/test/emul/agent-tools.test.ts` |
| 提案 | `reviewQueue` に `entrance_proposal` を入れるだけ。同じ県と URL は 1 件。`sources` は変わらない | `functions/test/emul/agent-tools.test.ts` |
| 1 回の費用 | 1 セッション 1 ドル（Managed Agents の試行で決めた予算）。足りなければ止まる | `scripts/test/agent-config.test.ts` |
| 月の費用 | `checkAgentRuns`（毎朝 08:00）が list cost を `usage/{YYYY-MM}` に足す。同じ実行を 2 度足さない。上限（既定 10,000 円）以上で定期実行を止める | `functions/test/emul/agent-runs.test.ts` |
| 手動の実行 | `runEntranceAgent`（運営者だけ）。5 分に 1 回まで。月の上限以上なら実行しない | 同上 |
| 外の文 | ページの本文はデータとして返すだけ。指示として扱わない（エージェントの説明書きにも明記） | `scripts/test/agent-config.test.ts` |

上限に近いときの計算: 止める線 10,000 円に、週 1 回の実行 150 円（1 ドル × 150 円）が足されても 10,500 円以内に収まる。止めた後は運営者が `--unpause` で戻す。

## 受け入れの手順（人の作業）

対象は `33`（岡山）、`01`（北海道）、`02`（青森）。いずれも `pref_fixed` の固定 URL が `data/sources.json` にある。実行の前に、その 3 つが今も開けるかを確かめ、違えば `data/sources.json` の側を替えて、下の表に記録する。

Firebase の操作は、着手の前に `firebase login:list` で今のアカウントを確かめ、`--account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT"` を明示する（値はこの文書に書かない）。

1. **今の入口を隠す。** `functions/.env.$FIREBASE_PROJECT` に `AGENT_EVAL_HIDE_PREFS=33,01,02` を置く。内容を確認した後で、`mcpInternal` だけを deploy する（`FB deploy --only functions:mcpInternal`）。この県は `currentUrl: null` に見えるので、エージェントは入口を探し直す。`sources` は変わらない。
2. **実行の時刻を替える。** `npx tsx scripts/setup-agent.ts --schedule "<15 分後の cron>"`（日本時間。毎週月曜 07:00 の初回が締切の後になるため）。実行された時刻の後、`deployment_runs` の `trigger_context.type` が `schedule` の実行を選ぶ。実行が出ないときは、cron の書き方と日本時間を疑う。
3. **出来事を読む。** その実行のセッションの出来事（events）を読み、下の表を埋める。
4. **後始末。**
   - `npx tsx scripts/setup-agent.ts --restore-schedule` を実行し、表示された `upcoming_runs_at` が月曜 07:00 JST になっているか確かめる。
   - `/operator` で、試験の提案（3 件）を**却下**する。
   - `AGENT_EVAL_HIDE_PREFS` の値を消す（本番への反映は提出前の本番の deploy）。
   - 翌朝、`functions:log --only checkAgentRuns` で、本番の関数がこの実行を数えたかを確かめる。読めなければ、鍵の違い（運用の鍵と開発の鍵）を疑う。

## 記録（未記入）

実行の日時: （未実施）／ 実行の記録の id: （未実施）／ 実行した人: （未実施）

### (a) 3 県の提案が `data/sources.json` の入口と一致するか

http と https、末尾の `/`、`index.html` の違いは同じとみなす。

| 県 | `data/sources.json` の入口（確かめた日） | エージェントの提案 | 一致 |
|---|---|---|---|
| 33 岡山 | （未確認） | （未実施） | （未実施） |
| 01 北海道 | （未確認） | （未実施） | （未実施） |
| 02 青森 | （未確認） | （未実施） | （未実施） |

### (b) 取得がすべて県のドメインの中か

- `agent.mcp_tool_use` の `fetch_pref_page` の URL がすべて県のドメインの中か: （未実施）
- 組み込みの道具（`agent.tool_use`）が 0 件か（bash、web_search、web_fetch を持たせていない）: （未実施）
- `usage/agent-calls-{YYYY-MM-DD}` の回数（県ごと、全体）: （未実施）

### (c) 提案が `/operator` に届くか

（未実施。届いた件数と、画面の「入口の提案」の表示を書く）

### (d) 承認せず `sources` が変わらないか

実行の前後で `sources` の件数と、3 県の入口の URL・有効の状態が同じか: （未実施）

### 費用と手数

| 項目 | 値 |
|---|---|
| セッションの list cost（ドル） | （未実施） |
| ツールの呼び出し回数（list_entrance_targets / fetch_pref_page / propose_entrance） | （未実施） |
| 停止の理由（`session.status_idle` の `stop_reason`） | （未実施） |
| 1 ドルで足りたか | （未実施） |

1 ドル（セッションの上限）で足りなければ、上の数字を示して、1 回 1 ドルの上限を上げるかどうかを利用者に聞く。上げる場合は、止め線（soft 月 8,000 円、hard 月 10,000 円）までの余裕が減る。聞く前に上限を上げない。

## 戻し先（Cloud Functions で動かす場合）について

`docs/managed-agents-trial.md` の判断（`decision`）は未決。Managed Agents で動かす道を実装した。Cloud Functions の繰り返しで動かす道（`entranceAgentWeekly`、`loop.ts`）は、判断が `cloud_functions` になったときだけ作る。
