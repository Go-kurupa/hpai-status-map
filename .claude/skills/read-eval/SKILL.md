---
name: read-eval
description: Claude の読み取りを自動で載せてよいかを決める試験（evals/）を、見積もり、実行、結果の読み方の順に進める。読み取りのモデルや effort を変えたとき、プロンプトや照合を直したとき、シーズンの前に使う。autoPublishEnabled を変えること自体には使わない（それは利用者の確認の後）。
---

# 読み取りの試験

正解つきの文書（`evals/answers/*.json` と原文の控え）を主と別の読み手に読ませ、プログラムの照合、一致、載せるかの判断まで通して採点する。合格するまで `autoPublishEnabled` は false のまま（全件が確認中）。

## 手順

1. 原文の控えを取る（公式のサイトだけ。名乗り、robots.txt、間隔 1.2 秒以上、再試行しない）:

   ```
   npx tsx evals/fetch.ts
   ```

2. **見積もりを先に出す。API は呼ばない。**

   ```
   npx tsx evals/run.ts --dry-run
   npx tsx evals/run.ts --sync --dry-run
   ```

   件数、見積もり額、合計の大きさ、バッチの数が出る。`--sync` は Batch の 2 倍。**有料の実行は、この見積もりを利用者に示して確認を取ってから行う。**

3. 確認の後に実行する（`--yes` が要る。付けないと API を呼ばず止まる）:

   ```
   npx tsx evals/run.ts --sync --yes                       # 11/5 の合否。通常の API、同時 4 件まで
   npx tsx evals/run.ts --yes --no-summary                 # 比較は Batch（半額、最長 24 時間）。summary.json を上書きしない
   npx tsx evals/run.ts --resume <batchId> --yes           # 保存したバッチの結果を取り直す
   npx tsx evals/run.ts --primary-model claude-sonnet-5-5 --effort high --yes --no-summary
   ```

   - 合否は `--sync` で行い、Batch を待たない。Batch は結果が要る時刻の 24 時間前までに投げる。
   - 鍵は環境から SDK が読む。**鍵を表示しない、貼らない、ログに書かない。** 長さの確認だけなら `echo "len=${#ANTHROPIC_API_KEY}"`。
   - 過去分（Q19）: `npx tsx evals/run.ts --backfill --season 2024 --dry-run` で「疑似患畜の確認」の題をシーズンごとに数える。{2020:52, 2021:25, 2022:84, 2023:11, 2024:51, 2025:24} と合わなければ止めて報告する。

## 結果の読み方

- 公開してよい結果は `evals/results/summary.json`（`EvalSummary`）と `evals/results/runs/<runId>.json`（事実のみ）。実際の応答は `data/private/eval-runs/` にだけある。**原文と引用を結果に書かない。**
- 項目ごとの正解率（誤りの数 ÷ 読めた文書の数）は `metrics` の `value` と `denominator`:
  - `primary_muni_errors`、`primary_stage_errors`、`primary_date_errors`: 0 が合格の条件。
  - `primary_headcount_errors`: 合否に入れない（羽数の誤りは照合で空欄になる）。
  - `published_mandatory_errors`、`published_headcount_errors`: 自動で載せると決めた文書の誤り。0 が合格の条件。
  - `read_refusals`: 1 件でもあれば止めて、文書と件数を報告する（終了コード 1）。
  - `tamper_rejected`: わざと入れ替えた結果と誤った読み手が、すべて落ちること。
  - `unmeasured`: 測っていない項目。0 とは読まない（検知の控えがなければここに入る）。
- 費用の読み方: `costPerDocumentUsd` は 1 文書あたり（主と別の読み手の合計）のドル。Batch は半額、`--sync` は 2 倍。月の上限は 3,000 円（読み取りは 2,500 円で止まる）。
- 合格は「読めた文書が 30 以上、市町村、段階、日付の誤りが 0、公開の誤りが 0、入れ替えがすべて落ちる」。読めた文書に入らないのは、拒否、形式エラー、`max_tokens`、`api_error`。

## 決まり

- **`autoPublishEnabled` を変えるのは利用者の確認の後。** 合格しても、この手順やスクリプトは変えない。確認の後に `set-setting autoPublishEnabled true` と、通ったモデルと effort を利用者が指示する。合格するまで招待を増やさない。
- 不合格なら数字を報告し、設定を変えない。直す前に、誤りの種類（市町村、段階、日付、羽数）と文書の種類を `docs/read-eval-log.md` に書く（原文と引用は書かない）。
- 正解の値は取得した原本を読んで作る。調査メモの値を写さない。確かめられない値は null にして理由を書く。
- 公開リポジトリなので、県の文章を転載しない。正解に入れるのは事実の値と出典の URL だけ。
