# 全国の傾向（/trends）の作り直し 実装計画

- 仕様: `docs/superpowers/specs/2026-11-06-trends-redesign-design.md`（作者の決定: 案 C、要点に割合、段階 2 を足す）
- UI イメージ: https://claude.ai/artifact/EZuFb7uEHgXFRhnnrmdGnS
- 締切: 2026-11-08 20:00 JST。commit と push は作者の確認の後。共有のツリーなので、触るのは下の書き込み範囲だけ

## 完了の条件

1. `/trends` の最初の画面に、割合つきの要点 3 つと断り 1 行が出る
2. 項目の帯（あった / なかった / 触れていない）をシーズンで切り替えられ、押すと PC では右、スマホでは帯の下に詳しい欄が出る
3. 渡り鳥が範囲図（18 地点）と飛来の早さの時間軸で出て、経路の図は小さな見本から開ける
4. `insights.json` が無いときは今の表示に戻る。今の `summary.json` と読み取りは変えない
5. 段階 2: 見積もり（無料）を作者に見せ、了承後に抽出し、「どう気づいたか」の欄が出る
6. 試験（単体、e2e の /trends）、型、公開前の検査が通る

## 作業

| ID | 中身 | 書き込み範囲 | 依存 |
|---|---|---|---|
| T1 | 集計 `insights.json` を作る関数と台本（なかった数、語の表、出どころ、用途・飼い方、伏せ、報告書の文の表） | `scripts/lib/trends-insights.ts`、`scripts/build-trends-insights.ts`、`scripts/test/trends-insights.test.ts`、`data/trends/insights.json`、`scripts/copy-web-data.ts` の 1 行 | なし |
| T2 | 画面の型と読み取り `parseTrendInsights` | `web/src/pages/trends/insightsTypes.ts`（scripts からも読む） | なし（T1 と同時に決める） |
| T3 | 画面（案 C）: 要点、帯、シーズンの切り替え、詳しい欄、戻り | `web/src/pages/trends/TrendsPage.tsx`、新しい部品、`trends.css`、試験 | T2 |
| T4 | 渡り鳥の範囲図・時間軸・経路の見本 | `MigrationSection.tsx`、`MigrationRoutes.tsx`、`migration.css`、試験 | なし |
| T5 | 段階 2 の抽出（新しい 4 項目、照合、見積もり）。**有料の実行は作者の了承後** | `scripts/lib/trends-noticing.ts`、`scripts/build-trends-noticing.ts`、`scripts/test/trends-noticing.test.ts`、`data/private/survey-noticing.json` | なし |
| T6 | 段階 2 の集計を insights に足し、「どう気づいたか」の欄を出す | T1・T2・T3 の範囲 | T1〜T3、T5 の実行 |
| T7 | 確かめ: 単体、型、e2e /trends、公開前の検査、360px | — | 全部 |

T5 は部下に任せ、T1〜T4 は本体が進める（書き込み範囲が重ならない）。
