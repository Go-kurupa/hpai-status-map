# Claude API の枠の使い方の記録

作品の中で Claude API を呼んだときの用途、モデル、トークン数、推定費用。呼び出したあとに足す。数字は API の応答の使用量と請求画面の実測だけを書き、見積もりは「推定費用」の列に推定と分かる形で書く。測っていないものは空欄にせず、書かない。

| 日付 | 用途 | モデル | トークン数 | 推定費用 |
|---|---|---|---|---|

## 事前の読み取り（舞台裏）: 未計測

去年 12 月の再現の文書 10 本を Claude で事前に読み、照合と二重読みの結果を `/replay/backstage` で見せる。**この読み取りはまだ実行していないので、上の表に行はなく、トークン数も費用も測っていない。** 作った数字は置かない。`data/replay/backstage.json` と `data/replay/measured-usage.json` は、`status` が `unmeasured`（未計測）の形で置いてあり、画面にも「未計測」と出る。

読む文書は `data/replay/docs.json`（津山市の 6 件、米子市、姫路市、亀岡市の国の発表、姫路市のページ 1 件）。各文書を主の読み手（`primaryModel`）と別の読み手（`secondModel`）の 2 つに渡すので、有料の呼び出しは最大で 20 回になる。モデルの既定は `DEFAULT_RUNTIME_SETTINGS`（`shared/src/types.ts`）。

### 計測の手順（人が支払いの上限を置いた後にだけ行う）

1. Anthropic のコンソールで、このキーの支払いの上限を置く。置くまでは次の 2 以降を実行しない。
2. 原本の控えを `data/private/replay-cache/` に置く（公開しない）。ないものは `npx tsx scripts/build-backstage.ts --fetch` で取れる（無料。国・県・市のサイトへ。Claude は呼ばない）。
3. `npx tsx scripts/build-backstage.ts` を引数なしで実行し、計画（文書の数、呼び出しの回数、足りない控え）を確かめる。この実行は何も呼ばず何も書かない。
4. `npx tsx scripts/build-backstage.ts --yes` を **1 回だけ**実行する。止まったときは同じ命令を繰り返さず、出た理由（拒否、形式の誤り、scenario との食い違いの項目名）を見る。読みの結果は控えに残るので、直した後の再実行は支払いが増えない。もう一度読み直したいときだけ `*.reads.json` を消す。
5. 終わったら `data/replay/measured-usage.json` の数（文書の数、モデルごとの入力・出力・キャッシュの読み書きのトークン）を、API の応答の使用量の合計として上の表に足す。**推定費用は `estimateUsd`（`shared/src/budget.ts`）で出し、推定と分かる形で書く。Anthropic の請求画面の実測と照らし、差があればそれも書く。**

`scenario.json` の `backstageId`（舞台裏の項目）も、このときに埋まる。測る前は `null` のまま。
