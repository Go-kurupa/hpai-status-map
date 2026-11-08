# 審査員用のリンク Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提出フォームに書く 1 本のリンクを開くと、審査員用の見本の農場（鶏舎と記録入り）の会員としてログイン済みで、トップ画面（今季の発生）が開く。

**Architecture:** 関数 `judgeSignIn` が、リンクの秘密の文字列を Secret と照らし、審査員用の会員（決まった uid）と農場を用意して（記録の足りない日を足す）、カスタムトークンを返す。画面の `/judge` はそれでログインし、会員の印を付けてトップへ移る。審査員の農場では、削除・招待を止め、メールは宛先がないので届かない。`/sample` と `/consult?judge=1` は外す。

**Tech Stack:** Firebase Functions v2（onCall、defineSecret、firebase-admin の Auth と Firestore）、React（react-router）、Vitest、Playwright、Firebase エミュレーター。

**Spec:** この文書の「決まり」（2026-11-08 豪さんとの相談: 全員で 1 つの農場を共有、鶏舎と死亡・消毒の記録を最初から入れ追加もできる、トップから見せる、見本の農場と審査員の試しの入口は外す、人数や回数は分からない）。

## Global Constraints

- 決まった名前: 審査員の uid `judge-demo`、農場の id `judge-demo-farm`、Secret `JUDGE_LINK_TOKEN`。`shared/src/judge.ts` に `JUDGE_UID`・`JUDGE_FARM_ID` を置き、関数と画面はこれを使う。
- 秘密の文字列は、リポジトリ・README・HANDOFF・台帳・ほかのセッションへのメッセージに書かない（公開リポジトリ）。豪さんにだけ伝え、提出フォームの審査員向けの欄に入れてもらう。
- リンクの形は `https://hpai-status-map.web.app/judge#<秘密の文字列>`（# の後ろはサーバーに送られない）。画面は読んだらすぐ `history.replaceState` で # を消す。
- 審査員の会員はメールアドレスを持たない（カスタムトークンの利用者）。知らせのメールは宛先がないので送られない。
- 農場の名前は「審査員用の見本の農場」。地点は作者の村の中心付近のマス目（去年の再現と同じ。農場の場所ではない）。鶏舎: 1 号舎 採卵鶏 1,200 羽、2 号舎 採卵鶏 800 羽、3 号舎 空舎。記録は作り物で、画面にそう書く。
- 記録を足すのは「記録がない日」だけ（審査員が入れた記録を上書きしない）。範囲は今日の前日までの 28 日。死亡数は日ごとに 0〜3 羽の決まった数（日付から作る。乱数を使わない）。届け出の基準には達しない数にする。
- データの形・保存の規則（firestore.rules）は変えない。文の決まり（「足す」「つける」「おして」を使わない、日付は「11月7日」）は今までどおり。

## Review Focus

1. 秘密の文字列が違う・空・長すぎる → `permission-denied`。会員も農場も作らない（試験: Task 2）。
2. 2 人の審査員が同時に開く → 農場と記録が二重にできない（記録の文書 id を日付と鶏舎から決める。試験: Task 1）。
3. 審査員が入れた今日の記録・過去の記録を、次の審査員のログインが上書きしない（試験: Task 1）。
4. 審査員の農場の削除・招待を、画面を通さず関数を直接呼んでも止める（試験: Task 3）。
5. 審査員がすでに本物の会員としてログインしている端末で `/judge` を開く → 審査員に切り替わり、本物の会員の農場は見えない（試験: Task 4）。

---

### Task 1: 審査員の会員と農場を用意する（ensureJudgeFarm）

**Files:**
- Create: `shared/src/judge.ts`（`JUDGE_UID`・`JUDGE_FARM_ID`・`JUDGE_FARM_NAME`）
- Create: `functions/src/farm/judgeFarm.ts`
- Test: `functions/test/emul/judge-farm.test.ts`

**Interfaces:**
- Produces: `ensureJudgeFarm(deps: { db: Firestore; auth: Auth; now: () => Date }): Promise<void>`

- [ ] 試験: 空のエミュレーターで呼ぶと、`farms/judge-demo-farm`（memberUids = [judge-demo]、notify はすべて false、selfCheckDue あり）、鶏舎 3 つ、死亡数 28 日 × 飼育中の 2 鶏舎、自己点検（前の月）、消毒（直近 14 日のうち 10 日）ができ、利用者 judge-demo に `{member: true, judge: true}` が付く。
- [ ] 試験: 2 回呼んでも文書の数が変わらない。審査員が入れた記録（ある日の 1 号舎 9 羽）は 2 回目で変わらない。同時に 2 回呼んでも同じ。
- [ ] 試験: 翌日に呼ぶと、前日の分だけが足される。
- [ ] 実装。文書 id は死亡数 `{date}_{houseId}`、点検は `self_{month}`・`dis_{date}_{itemId}` のように決めて、`create`（あれば飛ばす）で書く。羽数は保存の形（DeathRecord の flockSizeAt など）を shared の型に合わせる。

### Task 2: 関数 judgeSignIn

**Files:**
- Modify: `functions/src/secrets.ts`（`JUDGE_LINK_TOKEN = defineSecret("JUDGE_LINK_TOKEN")`）
- Modify: `functions/src/farm/index.ts`（`judgeSignIn` を export）
- Create: `functions/src/farm/judgeSignIn.ts`
- Test: `functions/test/judge-sign-in.test.ts`（単体）、エミュレーターの試験は Task 1 のファイルに 1 件

**Interfaces:**
- Consumes: `ensureJudgeFarm`
- Produces: callable `judgeSignIn({token: string}) → {customToken: string}`。`handleJudgeSignIn(deps: { secret: string; ensure: () => Promise<void>; createToken: (uid: string) => Promise<string> }, token: unknown): Promise<{ customToken: string }>`

- [ ] 試験: 一致 → ensure を 1 回呼び、`createToken("judge-demo")` の値を返す。不一致・空・数字・200 文字超・secret が空 → `permission-denied` で ensure も createToken も呼ばない。比べ方は sha256 の timingSafeEqual。ログに文字列を出さない。
- [ ] 実装。onCall の options に `secrets: [JUDGE_LINK_TOKEN]`、`timeoutSeconds: 60`。createToken は `getAuth().createCustomToken(uid, { judge: true })`。

### Task 3: 審査員の農場の削除・招待を止め、相談の上限を審査員用にする

**Files:**
- Modify: `functions/src/farm/deleteFarmData.ts`、`functions/src/farm/createFarmInvite.ts`
- Modify: `functions/src/consult/handler.ts`（`Who` から「ログインなしの judge」を外し、caller.uid === JUDGE_UID なら `reserveJudge` を使う）、`functions/src/consult/limit.ts` は名前そのまま
- Test: 既存の `functions/test/` の削除・招待・相談の試験に追加

**Interfaces:**
- Produces: なし（振る舞いだけ）

- [ ] 試験: `judge-demo-farm` の削除 → `failed-precondition`（「審査員用の見本の農場は消せません」）。招待の作成 → `failed-precondition`。
- [ ] 試験: `data.judge === true` でログインなし → `unauthenticated`（今までの試しの入口は使えない）。uid が judge-demo → 1 日の上限は `CONSULT_JUDGE_DAILY_LIMIT`（60 に上げる）を全員で共有、農場の条件は付けられる。
- [ ] 試験: 審査員の農場で基準に達する死亡数を記録しても、メールは 0 通（宛先がない）。`functions/test/emul/notify-death.test.ts` に 1 件。
- [ ] 実装。

### Task 4: 画面 /judge と、審査員の農場での表示

**Files:**
- Create: `web/src/pages/auth/JudgePage.tsx`
- Modify: `web/src/pages/auth/callables.ts`（`judgeSignInCall(token)`）、`web/src/routes.tsx`（`/judge`）
- Modify: `web/src/pages/settings/FarmSettingsPage.tsx`（農場の id が JUDGE_FARM_ID なら、会員の追加と削除の節を出さず、1 行「審査員用の見本の農場です。記録は作り物です。削除と招待は止めています。」）
- Modify: `web/src/pages/consult/ConsultPage.tsx` と文の置き場（`?judge=1` の分を外す）
- Test: `web/src/pages/auth/auth.test.tsx`、`web/src/pages/settings/settings.test.tsx`、`web/src/pages/consult/consult.test.tsx`

**Interfaces:**
- Consumes: callable `judgeSignIn`
- Produces: `/judge#<token>` の画面

- [ ] 試験: # の文字列で callable を呼び、`signInWithCustomToken` → 会員の印を true → `/` へ replace で移る。# は消える。別の人がログイン中なら、先に signOut する。失敗 → 「このリンクは使えません。提出フォームのリンクをもう一度開いてください。」と、トップへのリンク。# がない → 同じ文。
- [ ] 試験: 審査員の農場の設定の画面に「会員を追加する」「農場の全データを削除する」が出ず、上の 1 行が出る。
- [ ] 試験: `/consult?judge=1` はログインしていなければ会員の確認（ログインの案内）になる。
- [ ] 実装。

### Task 5: 見本の農場（/sample）を外し、案内を直す

**Files:**
- Modify: `web/src/routes.tsx`（`/sample` 以下を外す。開かれたら `/` へ）、`web/src/ui/AppShell.tsx`（見本の項目）、`web/src/pages/about/`（利用上のご案内の `/sample` のリンク）
- Delete: `web/src/pages/sample/` のうち、ほかから使われていないもの（`grep -rn "pages/sample\|/sample/" web/src` で確かめる。去年の再現が使う部品は残す）
- Modify: `README.md`（審査員の方へ: 表の 8・9 の行を外し、会員の画面は「提出フォームの審査員向けの欄のリンクで、審査員用の見本の農場の会員として開けます」に）、`docs/demo-script.md`（場面 5 を審査員の農場の記録に）、`web/e2e/demo-walkthrough.spec.ts`（場面 5 の中身を審査員のリンクで。題名は台本と合わせて変える）、`web/e2e/` の `/sample` を使う試験
- Test: `web/src/routes.test.tsx`、e2e

- [ ] 試験: `/sample`・`/sample/record/deaths` は `/` へ移る。メニューと「このサイトについて」に `/sample` のリンクがない。
- [ ] e2e: エミュレーターで `functions/.secret.local` の `JUDGE_LINK_TOKEN`（試験用の値）を使い、`/judge#…?emulator=1` → トップ → 死亡・消毒の記録で札と表に数字 → 1 号舎を記録できる。
- [ ] 実装。

### Task 6: 検証と反映（PM）

- [ ] 写しで全部の検証（単体・型・build・規則・模擬環境・precommit・e2e）と撮影。Fable のレビュー。
- [ ] 豪さんの了承 → 豪さんが自分で 32 文字以上の文字列を決め、`! npx firebase functions:secrets:set JUDGE_LINK_TOKEN --project hpai-status-map --account <個人用のアカウント>` で入れる（Claude は文字列を作らない・見ない。会話と記録に残さないため）→ 関数すべて → 画面。リンクは豪さんが `https://hpai-status-map.web.app/judge#<その文字列>` の形で作る。
- [ ] Secret の登録は対話入力（`firebase functions:secrets:set` を実行して値を入力）で、`echo` の流し込みはしない。
- [ ] 大会の後に Secret を入れ替えて無効にする。
- [ ] 本番で `/judge#…` を開いて確かめる。カスタムトークンを作る権限（iam.serviceAccounts.signBlob）が足りず失敗したら、豪さんに権限の追加を頼む（未確認の点）。
- [ ] 前に発行した招待コード（20 回まで）は、使われていなければ消す（豪さんに確かめる）。
