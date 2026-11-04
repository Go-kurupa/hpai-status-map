# 提出の確認表

本番に出して、動画を撮り、README を仕上げ、公開して提出するまでの順番です。上から順に行い、できたら印を付けます。**deploy、push、公開、提出は、利用者が確認してから行います。** 秘密の値は、この表にも会話にも書きません。

提出の締切は 2026 年 11 月 8 日 20:00（日本時間）です。目標は 18:00 です。

## 利用者が入れる箇所

提出の前に、次を利用者が入れます。

| 箇所 | 場所 | 入れるもの |
|---|---|---|
| 運営者と地域 | `README.md` の `<!-- 運営者と地域: ここから -->` と `<!-- 運営者と地域: ここまで -->` の間 | 農場名と地域の 1 行（共同経営者は了承済み）。囲みの外には地名を書かない試験があり、囲みの中は検査の対象外 |
| 本番の URL | `README.md` の `<!-- 本番の URL は利用者が入れる -->` の近く。`README.md` と `docs/mcp-usage.md` に残っている `<本番の URL>` と `<サイトの URL>` のすべて | 本番の URL（`--pre-publish` が、残っていれば止める） |
| 動画の URL | `README.md`（動画の掲載の後） | 動画の URL |
| 運営者名 | `web/.env.production` の `VITE_OPERATOR_NAME` | 運営者の名前（build に入るので、deploy の前に入れる） |
| 確認日 | `shared/src/guidance/official.ts` の `OFFICIAL_GUIDANCE_REVIEWED_ON`、`web/src/pages/privacy/privacyNotice.ts` の `PRIVACY_REVIEWED_ON`、`docs/official-text-review.md` | 作者と共同経営者が文面を確認した日（Claude は代わりに入れない） |
| 本番の設定 | `functions/.env.<プロジェクト>` の `AGENT_EVAL_HIDE_PREFS` | 値を消す（入口を直すエージェントの受け入れ試験のあと） |

## 1. 公開前の確認（deploy の前）

```
npx tsx scripts/smoke-prod.ts --pre-publish
```

ファイルを読むだけで、ネットワークへ出ません。値は表示せず、有無だけを出します。次のどれかで落ちます。

- `OFFICIAL_GUIDANCE_REVIEWED_ON` が null
- `docs/official-text-review.md` に、同じ確認日がない
- `PRIVACY_REVIEWED_ON` が null
- 値のある `VITE_OPERATOR_NAME` がない（`web/.env.production` か、シェルの環境変数）
- 値のある `AGENT_EVAL_HIDE_PREFS` がある（本番の設定のファイルと、シェルの環境変数）
- README の運営者と地域の囲みに、空でない 1 行がない
- `README.md` か `docs/mcp-usage.md` に `<本番の URL>`、`<サイトの URL>` が残っている

`OFFICIAL_GUIDANCE_REVIEWED_ON` の確認日は、`docs/official-text-review.md` の、その名前を含む行の中の日付と照らします。`VITE_OPERATOR_NAME` は、シェルの環境変数があればファイルより優先します。

`VITE_OPERATOR_NAME` と確認日は build に入るので、**deploy の前**にここで止めます。

## 2. 本番の deploy（利用者の承認のあと）

1. `npx firebase login:list` で、今のアカウントを確かめます。この作品のプロジェクトで使うアカウントと合っているかを、利用者が確認します。
2. 次を、利用者の確認のあとに実行します。アカウントとプロジェクトは明示します。

   ```
   npx firebase deploy --only firestore,storage,functions,hosting --account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT"
   ```

3. `autoPublishEnabled` を true にするのは、読み取りの試験に合格し（[docs/read-eval-log.md](read-eval-log.md)）、利用者が確認したあとだけです。それまでは全件が確認中のままです。

## 3. 本番の動作確認

```
npx tsx scripts/smoke-prod.ts
```

`/`、`/replay`、`/sample`、`/results`、`/public`、`/privacy`、`/geo/japan.topo.json` が 200、`/api/v1/cases?season=2025` が 24 件、公開の `/mcp` の道具が 4 つ、内部用の MCP が Bearer なしで 401、を確かめます。1 つでも落ちれば終了コード 1 です。

次は人が確かめます。

- [ ] 本番で Google ログインが通る
- [ ] `/` の応答に `X-Frame-Options` と `X-Content-Type-Options` が付き、`/__/auth/iframe` には付かない（`curl -sI https://<本番の URL>/` と `curl -sI https://<本番の URL>/__/auth/iframe`）
- [ ] 配信停止の POST が、Hosting の rewrite を通って関数に届く
- [ ] 本番で規則が読み込まれ、よく行き来する町 20 件と期限 16 件を持つ農場の保存が通る（規則は模擬環境でしか確かめていない）
- [ ] 回数の制限が数える IP の位置（[docs/mcp-usage.md](mcp-usage.md) の「デプロイの後に確かめること」）

## 4. 本番の MCP

```
claude mcp add --transport http hpai https://<本番の URL>/mcp
```

登録したら、Claude Code で「今週の<県名>の状況は」と聞きます（県名は利用者が決めます）。結果は [docs/mcp-usage.md](mcp-usage.md) の「本番での確認」に書きます（日付、聞いた文、呼ばれた道具、答えに `notices` と確認状況が入っていたか）。

## 5. 撮影（11/8 の正午までに開始）

[docs/demo-script.md](demo-script.md) のとおりに撮ります。

- [ ] `cd web && browser-guard run -- npx playwright test demo-walkthrough` を通し、**場面 7 が skip でない**
- [ ] 台本を 1 回通す。メールは送信先を作者に限る
- [ ] MCP の場面は本番の接続で撮る
- [ ] 見返して、映さないものが映っていない。「去年の再現です」の帯と「仮の地点」がある。数字が実測か未実測かが明示されている
- [ ] 本物の発生が今週あれば、再現で撮り、本物の動きは別に見せる

**本番が正午までに動かなければ、利用者に相談します。**

## 6. README を仕上げる

- [ ] 本番の URL、動画の URL、運営者と地域を入れる
- [ ] 提出物の一覧、動画の長さ、提出先を、参加者ガイドで確かめて照らす（公式ページから読めていない項目）
- [ ] `npx vitest run --project scripts --passWithNoTests=false readme demo-script`

## 7. commit

`docs: README とデモの台本、提出の手順を追加する`

## 8. 公開（利用者の確認のあと）

- [ ] `npx tsx scripts/smoke-prod.ts --pre-publish`
- [ ] `bash .claude/hooks/public-precommit.sh --all-tracked`（作業ツリーだけを見る）
- [ ] `cd web && npx vite build` のあと、`REQUIRE_BUILD=1 npx vitest run --project scripts --passWithNoTests=false no-fixture readme wording-sweep` で、README の試験と文言の試験が **skip でない**
- [ ] 全履歴の追加行を、鍵・トークン・個人のメールの形で検査する。場所（コミットの短い名前）だけを出し、値は出さない:

  ```
  git log --all -G'sk-''ant-|AIza[0-9A-Za-z_-]{35}|BEGIN [A-Z ]*PRIVATE KEY' --format='%h %s'
  git log --all -G'[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}' --format='%h %s'
  git log --all --name-only --format= | sort -u | grep -E '^(private/|HANDOFF\.md|CLAUDE\.local\.md|data/private/|\.env)'
  ```

  1 つ目と 3 つ目は出力がないこと。2 つ目に出たコミットは、例示用のドメインだけかを見て確かめる。
- [ ] `.claude/settings.json` の hook の登録と、`.gitignore` の守りの設定が、HEAD に入っている（`git show HEAD:.claude/settings.json`、`git show HEAD:.gitignore`）
- [ ] **履歴の書き換え（push の前に 1 回だけ）。** 公開しない文書（大会の決まりのまとめ `docs/rules.md`）が、最初の commit から履歴に残っている。次の順で行う。
  1. 利用者が、公開しない語の一覧（非公開のフォルダの `public-denylist.txt`）を作る。
  2. 全履歴を、上の鍵の形と、一覧の語の両方で検査する。語の検査は、語ごとに `git log --all -S"<語>" --format='%h'` を回し、commit の短い名前だけを出す（語そのものは出さない）。
  3. `docs/rules.md` と、2 で見つかったものを、**1 回の書き換え**でまとめて消す。道具は `git filter-repo` を使う（この機械には未導入。`pip install --user git-filter-repo` で入れる）。`git filter-repo --invert-paths --path docs/rules.md`。filter-repo は commit の文の中の hash を自動で直し、古い hash と新しい hash の対応を `.git/filter-repo/commit-map` に残す。
  4. 書き換えると、すべての commit の hash が変わる。追跡中の文書（`docs/security-review.md` など）の中の hash は、ファイルの中身なので自動では直らない。`commit-map` を使って直し、次の検査で、文書の中の hash がすべて実在することを確かめる（出力がないこと。数字だけの 7 桁は番号なので見ない）:

     ```
     grep -rhoE '`[0-9a-f]{7}`' README.md docs | tr -d '`' | grep '[a-f]' | sort -u | while read h; do git cat-file -e "$h^{commit}" 2>/dev/null || echo "missing $h"; done
     ```
  5. 1 と 2 の検査、`--all-tracked`、試験をもう一度回す。
  6. `main` を強制的に上書きして push する（`git push --force-with-lease`）。
  - **もう一方のアカウントとの段取り:** 同じフォルダと同じ `.git` を使っている。書き換えの間は、もう一方のセッションを止めておく。書き換えの後は、作業ツリーに書きかけがないことを確かめてから再開する。
- [x] `CLAUDE.md` は「Codex は使わない」の行だけを公開し、参加者ガイドの写しは公開しない（2026-11-04 利用者の決定）
- [ ] 利用者の確認のあとに push し、リポジトリを公開にする

## 9. 手順の確認

- [ ] 登録なしの別のブラウザで、README の手順を上から試す（`/` から `/public` まで）

## 10. 提出（18:00 を目標）

- [ ] 動画を掲載し、提出する
- [ ] 提出した時刻と、受付の表示を、手元に残す
