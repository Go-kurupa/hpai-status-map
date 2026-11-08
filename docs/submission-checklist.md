# 提出の確認表

本番に出して、動画を撮り、README を仕上げ、公開して提出するまでの順番です。上から順に行い、できたら印を付けます。**deploy、push、公開、提出は、利用者が確認してから行います。** 秘密の値は、この表にも会話にも書きません。

提出の締切は 2026 年 11 月 8 日 20:00（日本時間）です。目標は 18:00 です。

## 利用者が入れる箇所

提出の前に、次を利用者が入れます。

| 箇所 | 場所 | 入れるもの |
|---|---|---|
| 運営者と地域 | `README.md` の `<!-- 運営者と地域: ここから -->` と `<!-- 運営者と地域: ここまで -->` の間 | 入れ済みの 1 行を確かめる（共同経営者は了承済み）。囲みの外には地名を書かない試験があり、囲みの中は検査の対象外 |
| 本番の URL | `README.md` と `docs/mcp-usage.md` | 入れ済み（`https://hpai-status-map.web.app`）。`--pre-publish` が、`<本番の URL>` と `<サイトの URL>` が残っていれば止める |
| 動画の URL | `README.md`（動画の掲載の後） | 動画の URL |
| 運営者名 | `web/.env.production` の `VITE_OPERATOR_NAME` | 運営者の名前（build に入るので、deploy の前に入れる） |
| 確認日 | `shared/src/guidance/official.ts` の `OFFICIAL_GUIDANCE_REVIEWED_ON`、`web/src/pages/privacy/privacyNotice.ts` の `PRIVACY_REVIEWED_ON`、`docs/official-text-review.md`、`web/src/pages/auth/LoginPage.tsx` の `LOGIN_TEXT_CHECKED_ON` | 作者と共同経営者が文面を確認した日（Claude は代わりに決めない。`LOGIN_TEXT_CHECKED_ON` は下の公開前の確認の対象外で、空のままだとログイン画面に「文面は確認中です」と出る） |
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
   FUNCTIONS_DISCOVERY_TIMEOUT=120 npx firebase deploy --only firestore,storage,functions,hosting --account "$FIREBASE_ACCOUNT" --project "$FIREBASE_PROJECT"
   ```

   この deploy には `FUNCTIONS_DISCOVERY_TIMEOUT=120` が要ります（関数の読み込みの待ち時間を延ばす設定）。

3. `autoPublishEnabled` を true にするのは、読み取りの試験に合格し（[docs/read-eval-log.md](read-eval-log.md)）、利用者が確認したあとだけです。それまでは全件が確認中のままです。

## 3. 本番の動作確認

```
npx tsx scripts/smoke-prod.ts
```

`/`、`/replay`、`/sample`（2 本目の審査員用の URL。去年 12 月の再現の中で、近くで発生した場合の見え方）、`/results`、`/public`、`/privacy`、`/geo/japan.topo.json` が 200、`/api/v1/cases?season=2025` が 24 件、公開の `/mcp` の道具が 4 つ、内部用の MCP が Bearer なしで 401、を確かめます。1 つでも落ちれば終了コード 1 です。

次は人が確かめます。

- [ ] 本番で Google ログインが通る
- [ ] `/` の応答に `X-Frame-Options` と `X-Content-Type-Options` が付き、`/__/auth/iframe` には付かない（`curl -sI https://hpai-status-map.web.app/` と `curl -sI https://hpai-status-map.web.app/__/auth/iframe`）
- [ ] 配信停止の POST が、Hosting の rewrite を通って関数に届く
- [ ] 本番で規則が読み込まれ、よく行き来する町 20 件と期限 16 件を持つ農場の保存が通る（規則は模擬環境でしか確かめていない）
- [ ] 回数の制限が数える IP の位置（[docs/mcp-usage.md](mcp-usage.md) の「デプロイの後に確かめること」）

## 4. 本番の MCP

```
claude mcp add --transport http hpai https://hpai-status-map.web.app/mcp
```

登録したら、Claude Code で「今週の<県名>の状況は」と聞きます（県名は利用者が決めます）。結果は [docs/mcp-usage.md](mcp-usage.md) の「本番での確認」に書きます（日付、聞いた文、呼ばれた道具、答えに `notices` と確認状況が入っていたか）。

## 5. 撮影（11/8 の正午までに開始）

[docs/demo-script.md](demo-script.md) のとおりに撮ります。

- [ ] `cd web && browser-guard run -- npx playwright test demo-walkthrough` を通し、**場面 7 が skip でない**
- [ ] 台本を 1 回通す。メールは送信先を作者に限る。場面 2 の語りの件数は `/area` の表と照らす
- [ ] 場面 7 の毎朝の全国まとめは、変化があった朝に届いたメールがあれば本文だけを映す。なければ語りだけにする
- [ ] MCP の場面は本番の接続で撮る
- [ ] 見返して、映さないものが映っていない。「去年の再現です」の帯と「仮の地点」がある。数字が実測か未実測かが明示されている
- [ ] 本物の発生が今週あれば、再現で撮り、本物の動きは別に見せる

**本番が正午までに動かなければ、利用者に相談します。**

## 6. README を仕上げる

- [ ] 動画の URL を入れる（本番の URL と、運営者と地域の 1 行は入れ済み。実物を確かめる）
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
- [ ] **履歴の書き換え（push の前に 1 回だけ）。** 公開しない文書（大会の決まりのまとめ `docs/rules.md`）が、最初の commit から履歴に残っている。次の順で行う（予行演習の結果を反映）。
  1. 利用者が、公開しない語の一覧（非公開のフォルダの `public-denylist.txt`）を作る。
  2. **書き換えの前に**、全履歴を、上の鍵の形と、一覧の語の両方で検査する。語の検査は、語ごとに `git log --all -S"<語>" --format='%h'` を回し、commit の短い名前だけを出す（語そのものは出さない）。書き換えの後では、消えた語が見つからないだけで、検査にならない。
  3. バックアップを取る: `git clone --mirror <このフォルダ> <別の場所>/backup.git`。書き換えは戻せないので、取ってから進む。
  4. 作業ツリーがきれいであること（`git status` に何も出ない）と、もう一方のセッションが止まっていることを確かめる。**filter-repo は全 branch を書き換える**（`main` 以外の branch の hash も変わる）。
  5. filter-repo を入れる。`pip install --user` は PEP 668 で拒否される。専用の venv に入れる: `python3 -m venv <場所> && <場所>/bin/pip install git-filter-repo`。以後は `<場所>/bin/git-filter-repo` で呼ぶ。
  6. `docs/rules.md` と、2 で見つかったものを、**1 回の書き換え**でまとめて消す: `<場所>/bin/git-filter-repo --invert-paths --path docs/rules.md`（見つかったものが他にもあれば `--path` を足す）。写し（clone）で行うなら `--force` が要る。filter-repo は commit の文の中の hash を自動で直し、古い hash と新しい hash の対応を `.git/filter-repo/commit-map` に残す。
  7. 書き換えると、すべての commit の hash が変わる。追跡中の文書（`docs/security-review.md` など）の中の hash は、ファイルの中身なので自動では直らない。**台本で直す**: `bash scripts/remap-hashes.sh <書き換え後のリポジトリ>`（`commit-map` を使い、`README.md` と `docs/` のバッククォート囲みの 7 桁 hash を新しい hash に置き換える。対応が 1 つに決まらないものは「要確認」と出して触らない）。そのあと、次の検査で、文書の中の hash がすべて実在することを確かめる（出力がないこと。数字だけの 7 桁は番号なので見ない）:

     ```
     grep -rhoE '`[0-9a-f]{7}`' README.md docs | tr -d '`' | grep '[a-f]' | sort -u | while read h; do git cat-file -e "$h^{commit}" 2>/dev/null || echo "missing $h"; done
     ```
  8. 再検査: 1 と 2 の検査、`--all-tracked`、試験をもう一度回す。加えて、次が **0** であること（履歴のどこにも `docs/rules.md` が残っていない）:

     ```
     git log --all --name-only --format= | grep -c "docs/rules.md"
     ```
  9. push の前に、filter-repo が外した origin を付け直す（写しで行った場合）: `git remote add origin <URL>`。
  10. `main` を強制的に上書きして push する。`--force-with-lease` は、**`git fetch origin` の後**に使う（取っていないと、手元が持つ origin の情報が古く、検査が空振りか誤判定になる）。fetch しないなら、旧 `origin/main` の hash を明示する: `git push --force-with-lease=main:<旧 origin/main の hash> origin main`。旧 hash は、書き換えの前に `git rev-parse origin/main` で控えておく。
  - **もう一方のアカウントとの段取り:** 同じフォルダと同じ `.git` を使っている。書き換えの間は、もう一方のセッションを止めておく。書き換えの後は、作業ツリーに書きかけがないことを確かめてから再開する。
- [x] `CLAUDE.md` は「Codex は使わない」の行だけを公開し、参加者ガイドの写しは公開しない（2026-11-04 利用者の決定）
- [ ] 利用者の確認のあとに push し、リポジトリを公開にする

## 9. 手順の確認

- [ ] 登録なしの別のブラウザで、README の手順を上から試す（`/` から `/public` まで）

## 10. 提出（18:00 を目標）

- [ ] 動画を掲載し、提出する
- [ ] 提出した時刻と、受付の表示を、手元に残す
