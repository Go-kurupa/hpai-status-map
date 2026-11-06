# データの出典と利用条件

作品が使う外部のデータと、その出典、加工、利用条件。README と画面の出典の表示はここから写す。元データは公開リポジトリに入れない（`data/private/` は gitignore）。例外は環境省の経路図 5 枚で、改変せずに置く（`data/migration/routes/`）。

## N03 の出典と加工

**出典（表示する文）:** 国土交通省 国土数値情報「行政区域データ N03 2026 年版」をもとに、この作品の作者が形の簡略化、政令市の区の統合、隣り合いの計算を行って作成

- 配布ページ: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html （`KsjTmplt-N03-2026.html`）
- 版: N03-20260101（2026 年 1 月 1 日時点）。取得は `N03-20260101_GML.zip` を 1 回だけ。展開した `N03-20260101.geojson` は `data/private/n03/` に置き、リポジトリに入れない。
- 作る: `NODE_OPTIONS=--max-old-space-size=16000 npx tsx scripts/build-geo.ts`。生成物は `data/geo/`（`japan.topo.json`、`pref/NN.topo.json` 47 県、`adjacency.json`、`muni-index.json`、`pref-anchors.json`、`build-info.json`）。版、簡略化の値、ファイルの大きさ、除いた地物、孤立した市町村の一覧は `data/geo/build-info.json` にある。
- 使う属性: `N03_001` 県、`N03_004` 市区町村（政令市は市名）、`N03_005` 政令市の区、`N03_007` コード（区のコード）。市のコードは属性にないので、`scripts/lib/designated-cities.ts` の表（20 市）で与える。

**加工（原典から変えたところ）**

1. 市町村に属さない地物 `所属未定地` を除く（入力 125130 地物のうち 141）。
2. 政令市の区を市に統合し、市町村コードで束ねる（市町村 1747）。名称、コードの値は変えない。
3. 形を簡略化する。表示用の全国の形（`japan.topo.json`）は `-simplify 1.5% keep-shapes`、県ごとの形（`pref/NN.topo.json`）は `-simplify dp interval=30 keep-shapes`（mapshaper 0.7.101）。距離の計算に使うのは県ごとの形だけ。`dp` は元の点から簡略化した線までの距離が `interval` を超えない方式。mapshaper の既定（重み付き Visvalingam）は面積で点を消すので、入り江や半島の根元でずれが大きく、実測で最大 1.27km（鹿児島市）あったため使わない。
4. 隣り合いは、簡略化の前の全国の形（束ねた直後）から、辺を共有する市町村として求める。
5. 属性は `{c, n, p}`（市町村コード、名称、県コード）だけにする。

**限界:** 簡略化による形のずれを、簡略化の前（束ねた直後の形）と県ごとの形で実測した（測り方は `scripts/lib/simplify-error.ts`。`build-geo.ts` が結果を `data/geo/build-info.json` の `simplifyError` に書く）。測った日 2026-11-03。

- 測り方: 市町村ごとに、前の形の面（幅 100m 以上の「大きな面」2,673 面。幅 = 2 × 面積 ÷ 外周）の外側の輪の頂点 12,075,423 点から、県ごとの形の同じ市町村の輪郭までの最短距離を測り、その最大を取る（前→後）。逆に、後の輪郭の頂点と辺の上の約 50m ごとの点から前の輪郭までも測る（後→前）。穴（飛び地や湖）は、潰れて消えると距離が小さく出る（安全な向き）ので測らない。
- 結果（`dp interval=30`）: 前→後の最大は **40.9m**（小笠原村）。30m を超える頂点は 9,093 点（0.075%）。後→前の最大は 36.6m（江東区）。30m（`interval=30`）を超える分は、県ごとの形を書き出すときの座標の丸め（東京都は小笠原諸島までを含むので粗い）によるもの、と見ている（推測。丸めを細かくした試しはしていない）。比べた元の形にも丸めがあり、半歩で最大 2.2m。大きな面が消えたものはない（消えていれば、この最大が数 km になる）。
- 比べると（mapshaper の既定の重み付き Visvalingam、`interval=30` のとき）: 前→後の最大は 1,268m（鹿児島市）、1km を超えるのは 2 市町村（鹿児島市、武豊町）、30m を超える頂点は 6.1%。
- **`MESH_MARGIN_KM` の 0.85km は、3 次メッシュの半対角（中心から角まで。北緯 35.7 度で 0.730km、農場がある最南端より南の北緯 24 度で 0.786km）に、簡略化の最大のずれ 約 41m と元の形の丸め 約 2m を足した 0.829km を覆う。** 余裕は約 21m。この関係は `scripts/test/build-geo.test.ts` が `build-info.json` の実測値で確かめる。簡略化の値を変えたら、測り直して 0.85km を覆うかを確かめる。
- **覆わないもの: 消える小さな面。** 簡略化は幅がおよそ 60m 未満の面（小さな島、岩、細い砂州）を潰して消す。N03 の面 121,399 のうち 112,672 が県ごとの形から消え、残るのは 8,727（幅 100m 以上の大きな面は、消えたものがない）。消えた面が市町村の最も近い部分だった地点では、距離が大きく出る（区域の判定が甘くなる向き）。市町村の残りの部分から 1km 以上離れた小さな面は 396 面（76 市町村）、10km 以上は 41 面で、最大は神津島村の 35.6km。この分は 0.85km では覆えない。幅が小さく、人が住み家きんを飼う場所にはほぼ当たらないが、そうでないと確かめてはいない。
- 公開情報では区域の内外を判定できないので、判定は「可能性」にとどめる。

## N03 の利用条件

| 項目 | 内容 | 確かめた日 |
|---|---|---|
| 使用許諾条件 | 配布ページに「オープンデータ（CC_BY_4.0）」とある。**CC BY 4.0**（出典の表示と、加工したことの表示が要る） | 確かめた日（2026-11-03）。配布ページを取得して読んだ |
| 原典の表示 | 配布ページに「測量法に基づく国土地理院長承認（複製）R 7JHf 351」とある。原典は国土地理院の「数値地図（国土基本情報）」の行政区画データ | 確かめた日（2026-11-03）。同上 |
| Q1-24（国土地理院の測量成果の申請に関する Q&A） | 承認を得た成果をさらに複製・使用する二次利用について、複製承認を得て複製した成果を更に複製・使用する場合は「申請が必要な場合がある」と書かれている（要旨） | 原文は未確認。`www.gsi.go.jp` は Node から届かないので、利用者がブラウザで原文を確かめる（利用者の作業）。確かめた日は、確かめた後にここへ書く |
| Q1-11（同 Q&A） | Web サイトに地図を挿入する場合は、書籍に挿入する場合と同等と見なす原則がある。ただし、サイトの主な内容が地図であるものは、この挿入の原則の例外に当たる（要旨）。本作品は地図が主な内容なので、この原則には頼れない | 原文は未確認。上と同じ |

| 国土数値情報の利用規約 | [利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html)は「オープンデータ（CC BY 4.0）一部制限」などを別の扱いとするが、N03 の条件は「オープンデータ（CC_BY_4.0）」。[政府標準利用規約準拠版](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html)は複製、公衆送信、翻案等を認め、出典と加工の記載を求め、国が作成したように見せることを禁じる。利用規約 1.2 が国土地理院の承認を要するものとして挙げるのは国土調査の成果で、行政区域データは挙げていない（「特に」として示された例） | 確かめた日 2026-11-05 |

**問い合わせの状況:** 問い合わせ済み（2026-11-05）。作者が国土地理院へ電話し、国土数値情報ダウンロードサイトのデータであることを案内したところ、その利用規約に則って使うようにとの回答を得た（口頭で、書面はない）。地図が主な内容のサイトであることを踏まえた回答かは確かめていない。国土数値情報の運営事務局には問い合わせていない。

**判断:** 上の回答と利用規約に沿い、明記された CC BY 4.0 に従って公開する判断をした。地図が主な内容のサイトでの手続きの要否は確認できていない。手続きが要ると分かれば、公開を止めて相談する。

## 地理院タイル

背景の地図は、国土地理院の地理院タイルをその場で（リアルタイムに）読み込んで表示する。タイルの画像を保存してリポジトリに入れない。

- 公式の文（https://maps.gsi.go.jp/development/ichiran.html、確かめた日 2026-11-03）: 「地理院タイルをウェブサイトやソフトウェア、アプリケーション上でリアルタイムに読み込んで利用する場合、地理院タイルは出典の明示のみで申請不要でご利用いただけます。」
- 出典の書き方（同ページ）: 「国土地理院」または「地理院タイル」等と記載し、地理院タイル一覧ページ（`https://maps.gsi.go.jp/development/ichiran.html`）へのリンクを付ける。画面の帰属表示は `web/src/geo/attribution.ts` の `MAP_ATTRIBUTION` に置き、この節と同じ文にする。
- **画面に常に全文で出す出典（3 つ。`web/src/geo/attribution.ts` の `MAP_ATTRIBUTION`。幅 360px のスマホでも畳まず折り返す）:**
  1. 地理院タイルに行政区域を追記して掲載（「地理院タイル」は一覧ページ `https://maps.gsi.go.jp/development/ichiran.html` へのリンク）
  2. Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.
  3. 国土交通省 国土数値情報「行政区域データ N03 2026 年版」をもとに、この作品の作者が形の簡略化、政令市の区の統合、隣り合いの計算を行って作成（「国土数値情報「行政区域データ N03 2026 年版」」は N03 の配布ページ `https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html` へのリンク。CC BY 4.0 が求める加工の表示を含む）
- 淡色地図の ZL5〜8（500 万分の 1 の小縮尺地図）には、出所の明示を追加する（同ページ）。Vector Map Level 0 の文: Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.
- 標準地図の ZL5〜8 を使う場合は、上に加えて GEBCO と海上保安庁許可の文も要る。本作品は淡色地図（`pale`）を使うので、必要なのは上の VMAP0 の文。
- アクセス数の上限: 一覧ページには記載が見つからなかった。アクセス数の上限は未確認（確かめた日 2026-11-03）。

## 国と県の公開文書の利用条件

作品が事実を取り出し、公式の文を引用する、国と県の公開文書の利用条件。README の「外部のデータと素材」の表は、ここから写す。各ページを WebFetch で読んで確かめた（読んだ内容の要旨を書く。原文の写しではない）。

| 機関 | 確かめたページ | 内容 | 確かめた日 |
|---|---|---|---|
| 農林水産省 | https://www.maff.go.jp/j/use/link.html | 特記がなければ農林水産省に帰属し、権利表記がなければ公共データ利用規約（第1.0版）（PDL1.0）で使える。出典の記載を求める。加工したときは、出典とは別に加工したことを書く。あたかも国（又は府省等）が作成したかのように見せて公表・利用してはいけない。画像ファイルは第三者の権利があることが多く、使うときは担当課への確認を求める。ロゴなどは別の扱い。本作品は農林水産省の画像を使わない | 確かめた日 2026-11-04 |
| 環境省 | https://www.env.go.jp/mail.html （ページの題は「著作権・リンクについて」） | 特記がなければ環境省に帰属し、権利表記がなければ PDL1.0 を適用する。出典の記載を求め、加工したときはその旨と主体を別に書く。国土地理院の地図は測量法により複製や一定の二次利用に承認が必要、とも書く。ロゴは対象外。政府標準利用規約（第2.0版）に基づくオープンデータ化の取組を進めている、と述べるが、利用条件として書かれているのは PDL1.0 | 確かめた日 2026-11-04 |
| 厚生労働省 | https://www.mhlw.go.jp/chosakuken/index.html | 権利表記がなければ PDL1.0 に準拠した条件で使える。出典の記載を求め（例は「出典：厚生労働省ホームページ（当該ページの URL）」）、編集・加工したときはその旨を別に書く。国が作成したかのように見せてはいけない。シンボルマークやロゴは対象外 | 確かめた日 2026-11-04 |
| 県（確かめた 1 県） | https://www.pref.okayama.jp/page/detail-4318.html （サイトポリシー） | 特記がなければ県に帰属し、権利表記がなければ PDL1.0 が適用される。出典の記載を求め、加工したときは別に書く。県が作成したかのように見せてはいけない。図画、写真、動画などは掲載元の部署への報告と承認が要る。ほかの県は未確認 | 確かめた日 2026-11-04 |
| 法令（e-Gov 法令検索） | https://laws.e-gov.go.jp/ | e-Gov のサイトの利用規約は未確認（トップページと利用規約のページを読んだが、規約の本文を得られなかった）。条文の扱いは、著作権法第 13 条（e-Gov の法令 API `https://laws.e-gov.go.jp/api/1/articles;lawId=345AC0000000048;article=13` で条文を読んだ）に、憲法その他の法令は権利の目的とならない、とある | 確かめた日 2026-11-04 |

- **CC BY との関係。** 上の 3 つの国の機関のページは、PDL1.0 だけを挙げていて、CC BY との互換については何も書いていない。作品は、互換を前提にしない。それぞれのページが求める条件（出典の記載、加工の記載、国が作ったかのように見せない）を守る。
- **県。** 県ごとにサイトポリシーが違う。確かめたのは上の 1 県だけで、ほかの県は未確認。県のページは、公式の文の出典としてリンクを載せるだけで、文は引用しない（`shared/src/guidance/official.ts`、`shared/src/checklist/items.ts`）。再現と評価の元にした県の発表からは、事実（日付、市町村、段階、羽数）と URL だけを取り出し、原文と引用は持たない。
- **引用のしかた。** 国の機関の公式の文は、原文のまま短く引用し、各文に出典の URL と確認日を付ける（照合の記録は `docs/official-text-review.md`）。国の文章を転載しない。

## 渡り鳥の飛来状況（data/migration/summary.json）

画面の「渡り鳥の飛来（季節の参考）」（`/trends`）の元データ。環境省が全国の定点で数えた水鳥の数を、同じ地点の過去の同じ時期と並べた小さな集計。農場の危険度や警報ではなく、感染の情報は含まず、予測もしない。

**出典（表示する文）:** 出典：環境省「渡り鳥の飛来状況」（https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html）。地点ごとの Excel ファイルから水鳥の合計を求め、過去のシーズンと並べる加工を、この作品の作者が行った。

- 取った原本: 入口のページ（今季と過去 6 シーズンの 7 本）と、地点ごとの Excel（`site_csv/{地点番号}.xlsx`）175 本。取得日 2026-11-04（日本時間）。過去のシーズンのフォルダは `ap_wr_transit{NN}`（`NN` = シーズンの年 - 1999。今季は番号なし）。
- 取り方: `scripts/build-migration.ts`。Claude は呼ばない。取得は `functions/src/watch/politeFetch.ts` を通す（名乗る、robots.txt に従う、環境省のホストへ 1 本ずつ）。さらに 1 本ごとに 2 秒あける。環境省の `robots.txt`（確かめた日 2026-11-04）は `/cgi-bin/` だけを禁止していて、取るパスは対象外。手元の写し（`data/private/migration-cache/`、公開しない）にあるファイルは取り直さない。今季のファイルと入口のページだけ、取得した日が今日でなければ取り直す。失敗した URL は再試行しない。取った本体は、xlsx（入口のページはリンクのあるページ）として読めてから保存し、読めなければ保存せず記録も更新しない。`.xls` は取らない。地点が 0 件、または前回の集計の半分未満になったときは書き出さず、終了コード 1 で終わる。
- 作る: `npx tsx scripts/build-migration.ts`（通信なしで写しだけから作り直すときは `--offline`、取る数だけ見るときは `--plan`）。生成物は `data/migration/summary.json`。`npm run build` の `copy-web-data` が `web/public/migration/` に写す。

**加工（原典から変えたところ）**

1. 地点ごとの Excel の 1 回の調査（1 列）について、水鳥の羽数を足して合計にする。足すのは次の 2 つ。
   - 許可リスト（`WATERBIRD_SPECIES`、39 種）の種の行。全キャッシュ（2020〜2026 年秋期の 175 ファイル）の全行名を見て作った。部分一致では判定しない（ハジロカイツブリ、ハジロコチドリ、ハジロクロハラアジサシ、カモメ類などが混ざるため）。アメリカヒドリ・カリガネ・ビロードキンクロなどの迷鳥は入れた。雑種ガモ（野生のカモ同士の雑種、1 件）とコブハクチョウ（国内では移入個体が多いが、水鳥として数える、27 件）も入れた。アイガモ・アヒル・バリケン・ガチョウ（家禽）は入れない。ツルは入れない。
   - 科レベルの行（「カモ類」「ハクチョウ類」「ガン類」「アイサ類」「カモ科」）。種まで分からなかった羽数なので足す。**二重計上でないことの確認（2026-11-04、全キャッシュ 3,894 回）:** 同じ回に科の行と同じ科の種の行の両方に数がある回を数えた。カモ類は 678 回のうち、科の行が種の合計と等しいのは 3 回だけで、小さいのが 300 回、大きいのが 375 回（例: クッチャロ湖 2020-10-15 は科 32,022 羽・種の合計 562 羽）。ハクチョウ類は 103 回で等しいのは 0 回（小さい 64・大きい 39）、ガン類は 8 回で 0 回、カモ科は 4 回で 0 回。科の行が種の合計なら常に種の合計以上のはずだが小さい回が多いので、種の行と別の「残り」と読んだ。（以前はこの行を捨てていたため、クッチャロ湖などで合計が桁違いに小さく出ていた。）
2. 空欄は 0 羽として足す。ただし、水鳥の行（種と科）に数が 1 つもない回は「数の記録がない回」として、合計を出さない（0 にしない）。水鳥でない行だけに数がある回も同じ。空欄が 0 を意味するかを説明した文は見つかっていない（未確認。霧島の 1 回は「カモ類は渡来してない」と書いて数が空欄だった）。
3. 日付が読めない列（「10月中旬」のような予定の見出しだけの列）は飛ばす。その列には数が入っていないことを、2020〜2026 年の全ファイルで確かめた（32 列、数のある列は 0）。
4. 「今季の最新の調査日」は、数が記録された回のうち最も新しい日。過去 5 シーズン（2021〜2025 年秋期）それぞれについて、同じ月日に最も近い調査日（前後 7 日以内。同じ近さなら早い方）の合計を取り、中央値・最小・最大を出す。比べられた過去のシーズンが 3 つ未満の地点は、過去との並べ方を出さない。
5. 飛来の早さは、1 回の調査で決めた羽数以上になった最初の調査日。過去 6 シーズン（2020〜2025 年秋期）を見る。秋の到着だけを見るので、その年の 12 月末までの調査に限る（翌年の春の調査は混ぜない）。2019 年秋期より前は `.xls` 形式で、この道具は読まない。

**地点と指標の選び方（データで確かめてから絞った）**

- 地点: 今季と過去 6 シーズンの入口のページにすべて載る地点のうち、国指定鳥獣保護区（地点番号 1000 未満）の 24 地点に、岡山県で唯一の調査地（倉敷市岡田大池、1091）を加えた 25 地点を候補にした。そのうち、過去 5 シーズンの同じ時期の中央値が 100 羽以上の 18 地点だけを載せる。外した 7 地点（十和田湖、谷津、中海、和白干潟、霧島、出水・高尾野、漫湖。漫湖は今季まだ数の記録がない）は、数が小さく揺れの大きさも読み取れない。出水・高尾野は主役がツルで、水鳥の合計に入らず、水鳥の中央値は 21 羽。画面にも、載せていない地点があることを書く。
- 飛来の早さ: 4 件。宮島沼のマガン 1,000 羽以上（過去 6 シーズンの初回の幅 9/17〜9/28）、伊豆沼のマガン 1,000 羽以上（9/22〜10/04。長く続く代表的な地点）、伊豆沼のオオハクチョウ 100 羽以上（10/15〜10/28。今季はまだ届いていない）、倉敷市岡田大池のヒドリガモ 100 羽以上（10/10〜11/08。幅が広く、2023 年は最初の調査の回で既に超えていた）。羽数のしきい値は作者が決めた（伊豆沼のマガンは 100 羽でも 1,000 羽でも初回の日がほぼ同じ）。片野鴨池のコガモのように年ごとにぶれが大きいものは外した。
- 揺れ: 同じ地点・同じ時期でも年ごとに桁が変わる（伊豆沼の 10 月中旬は 12,801〜63,962 羽）。そのため地点ごとの比（倍率）は出さず、数と幅を並べるだけにした。画面に「多い」「少ない」の判定はない。

## 渡り鳥の飛来状況の利用条件

| 項目 | 内容 | 確かめた日 |
|---|---|---|
| 環境省のサイト共通の条件 | https://www.env.go.jp/mail.html に、特記されていない限り著作権は環境省に帰属し、権利表記がない限り公共データ利用規約（第1.0版）（PDL1.0）が適用される、とある。出典の記載を求め、編集・加工して使うときは、出典とは別に、編集・加工を行ったことと、その主体を書くことを求める。国が作成した未加工のものであるかのように公表・利用してはいけない | 確かめた日 2026-11-04 |
| 飛来状況のページと Excel の個別の表記 | 入口のページ（今季と過去 6 シーズン）の本文に、著作権や権利、利用規約に触れた語は見つからなかった。Excel の文書情報にも権利の記載はない。つまり個別の権利表記は見つからず、サイト共通の PDL1.0 が適用される、と読める（この読みは作者のもの） | 確かめた日 2026-11-04 |
| 「All Rights Reserved」の併記 | `https://www.env.go.jp/mail.html` の末尾に「Copyright (c) Ministry of the Environment, Japan. All Rights Reserved.」とある。同じページが PDL1.0 の適用を述べていて、この併記との関係を説明した文は見つからなかった | **未確認**（関係が解けていない。解けるまで「PDL1.0 で使える」と断定しない。環境省には問い合わせていない） |

**判断:** PDL1.0 が求める出典の記載と、加工の事実・主体の記載を画面（`web/src/pages/trends/MigrationSection.tsx`）と README に出して公開する。「All Rights Reserved」の併記との関係は未確認のまま残す。個別の許諾が要ると分かれば、この枠を外す。

## 渡りの経路図（data/migration/routes/）

画面の「渡りの経路（環境省の図）」（`/trends`）に載せる図 5 枚。過去の追跡をまとめた固定の図で、今飛んでいる位置でも、これから飛ぶ経路でも、農場の危険度でもない。画面の断りと図の説明に、そのことを書く。

**出典（表示する文）:** 出典：環境省「渡り鳥の飛来経路について」（https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/ap_wr_transit/wataridori_hiraikeiro.html）。

| ファイル | 図の名前（原文） | 注記（原文） | バイト数 | sha256 |
|---|---|---|---|---|
| `zu1.jpg` | 図1．オナガガモの飛来経路 | 秋の渡り開始9～10月頃 | 140309 | f137ef1e54900f28a549ba36699641a59bf42f39d463a7a76d507b8f9a0b8406 |
| `zu2.jpg` | 図2．マガモの飛来経路 | 秋の渡り開始8月下旬～10月頃 | 158761 | e733d2f00d981259c2165cf8afae2ff5b14b0131e5b943d0881ec6ba8506569c |
| `zu3.jpg` | 図3．ヒドリガモの飛来経路 | 秋の渡り開始9月～10月頃 | 166521 | 02b97d67280d08ab04be007c2ab5c0c0627396e86c85a73ff71dc306366ecad1 |
| `zu4.jpg` | 図4．オオハクチョウの飛来経路 | 秋の渡り開始9月下旬～10月頃 | 131387 | 0234c45c02d5407c2b6b19b0ec1fb84ff8b7e284a5439c191238d4c34f316cd3 |
| `zu5.png` | 図5．ユリカモメの飛来経路 | 秋の渡り開始８月～10月頃 | 195351 | 8067ce2ed8123bd883cbe525f0022bf2e631a458b948b03af14d791105632e7f |

- 取り方: 同じページの `images/` にある画像を WebFetch で取った（取得日 2026-11-05）。ファイル名は環境省のままにした。図の中に種の名前はなく、ページの図の順とファイル名で対応を決めた。
- 改変: 画像は再圧縮も切り抜きもせず、取ったままのバイト列を置く（`scripts/test/migration-routes.test.ts` が sha256 を確かめる）。画面では幅に合わせて縮めて表示するだけで、原寸の画像を開くリンクを付ける。加工していないので、加工の記載はしない。
- 配信: `npm run build` の `copy-web-data` が `web/public/migration/routes/` に写す。環境省のサーバーから直接読み込まない（同じ規約が、環境省のページを他のページに組み込むリンクを断っている）。

**利用条件**

| 項目 | 内容 | 確かめた日 |
|---|---|---|
| 環境省のサイト共通の条件 | https://www.env.go.jp/mail.html に、特記されていない限り著作権は環境省に帰属し、権利表記の記載がない限り公共データ利用規約（第1.0版）（PDL1.0）が適用される、とある。出典の記載を求める。適用外として挙げているのは環境省のロゴマークだけで、図画を外す文はない | 確かめた日 2026-11-05 |
| 図 1〜5 の個別の表記 | ページの本文と図の中に、権利の表記や転用の制限は見つからなかった。つまりサイト共通の PDL1.0 が適用される、と読める（この読みは作者のもの） | 確かめた日 2026-11-05 |
| 個別の追跡の図 | https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/migration_route.html の図には、東京大学の研究室からの情報提供という記載とともに「※無断転用不可」とある。PDL1.0 の条件で読めないので載せず、画面からリンクで案内する。同じページは「ここで経路を示すカモ類が高病原性鳥インフルエンザウイルスを運んでいるということを意味するものではありません。」とも書く | 確かめた日 2026-11-05 |
| 図の下絵が国土地理院の地図か | 同じ規約に、国土地理院の地図は複製や一定の二次利用に国土地理院の長の承認が要る、とある。図 1〜5 に国土地理院の表記はなく、簡略な輪郭に見えるが、下絵の出所を書いた文は見つからなかった | **未確認**（環境省には問い合わせていない） |
| 図 1〜5 の元の追跡が東京大学の研究室の情報提供と同じか | 同じならば、個別の追跡の図の「無断転用不可」が図 1〜5 にも及ぶかが問題になる。図 1〜5 のページは、環境省が平成 17 年度から追跡を始めたと書くだけで、作成年も元の情報も書いていない | **未確認**（環境省には問い合わせていない） |
| 「All Rights Reserved」の併記 | https://www.env.go.jp/mail.html の末尾に「All Rights Reserved」とある。上の「渡り鳥の飛来状況の利用条件」と同じく、PDL1.0 との関係を説明した文は見つからなかった | **未確認**（環境省には問い合わせていない） |

**判断:** 図は改変せず、出典の題と URL を画面と README に出して載せる。未確認の 3 点は残す。許諾が要ると分かれば、この枠を外す。

## 過去の事例（data/history/cases.json）

町の過去の発生と、地図の過去シーズンの表示に使う。

- 出典: 農林水産省「鳥インフルエンザに関する情報」の国内の発生事例。過去のシーズンの一覧（https://www.maff.go.jp/j/syouan/douei/tori/ai_domestic_kako.html）と、シーズンごとの国内の発生状況のページ（例: 2025/26 シーズンは https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf の事例一覧）。
- 取得日: 2026-11-02（JST）。各ページを 1 回ずつ取得した。地図の過去シーズンに出す「確認日」はこの日。
- 載せるもの: 事例ごとの日付、市町村、羽数などの事実だけ。国の文章は写さない。農場の名称は国も出していない。
- 関連農場の行のうち、原本に個別の発生日がないものは、本体の事例の日付を借りている。画面では、その日付を関連農場の発生日として見せない。

## 大字・町丁目の目安の点（data/oaza/）

- 出典: 国土交通省「大字・町丁目位置参照情報」令和 7 年（版 19.0b）、47 都道府県。表示は「大字・町丁目位置参照情報　国土交通省」（位置参照情報利用約款 第2条3 の例）。整備年は令和 7 年、ファイルは `{県コード}000-19.0b.zip` の `{県コード}_2025.csv`。編集・加工はこの作品の作者。
- 利用条件（原本で確認、2026-11-06）: 位置参照情報利用約款 https://nlftp.mlit.go.jp/isj/agreement.html 。「本サービスは無償で利用できます。」（利用約款 第2条1）。位置参照情報と、それを編集・加工した成果物の転載・引用は、出典を明記する（位置参照情報利用約款 第2条3）。「公共測量等の高度な精度が要求される測量、各種証明等には使用することができません。」（同 第2条2）。複製・再配布の個別の規定と禁止事項の一覧はない。誤りの可能性がある（第5条4）。
- 取り方: 位置参照情報ダウンロードサービス（https://nlftp.mlit.go.jp/isj/index.html ）で「都道府県単位」→ 県 →「大字・町丁目」令和 7 年 → 利用約款に同意。ファイルは `https://nlftp.mlit.go.jp/isj/dls/data/19.0b/{県コード}000-19.0b.zip`（47 県、合計 3.2MB）。ZIP から CSV（Shift_JIS）を取り出し、`npx tsx scripts/build-oaza.ts --input <CSV のフォルダ>` で `data/oaza/{県コード}.json` を作る（47 県、191,106 地区。地図の市町村の一覧にない市町村があれば書かずに止まる）。元の ZIP と CSV はリポジトリに入れない。
- 加工: 列のうち、市区町村コード、大字町丁目名、緯度、経度だけを使う。緯度経度は小数 4 桁（約 10m）に丸める。政令市の区は、地図と同じく市のコードにまとめ（scripts/lib/designated-cities.ts の表で市の名前から引く）、地区の名前の頭に区の名前を付ける（例「北区 葵町」）。
- 使い方: 場所合わせの「地区（大字）で地図を寄せる」で、選んだ地区の目安の点へ地図を寄せるだけに使う。選択地域の県のファイルだけを端末で読み、地区の名前も位置も保存・送信しない。保存するのは今までどおり十字の下の約 1km のマス目と市町村だけ。目安の点は地区の代表点で、地区の範囲（形）は持たない。
- 地区の一覧がない市町村が 6 ある（2026-11-06 の作成時。どの町かは未確認）。その町では選択欄を出さない。

## 対策の相談の知見のカード（data/consult/cards.json）

「対策の相談」が根拠にする、公的な資料と論文の知見のカード 103 枚（資料 23 件）。画面の「対策の見直し」と相談の答えは、このカードだけを根拠にする。許可された利用条件（PDL1.0、CC BY、CC BY 4.0、OGL v3.0、米国政府の著作物）の資料だけを使う（`shared/src/consult/schema.ts` の `ALLOWED_LICENSES`。ほかの綴りは読み込みで弾く）。作る道具は `npx tsx scripts/consult/build-cards.ts`（毎回同じ出力になる）。

**加工の表示。** カードの `quote`（引用）は資料の原文の抜き出しで、改変しない。カードの `action`（対策）、`appliesTo`（効く条件）、`evidenceNote`、`caveats` の文は、資料を要約したこの作品の加工であり、資料の発行者が作成したものではない。国や県が作成したように見せない。

**照合の方法。** 2026-11-06 に、全資料の原本を、この作品の名乗り（`hpai-status-map/0.1`）で、同じホストへ間隔をあけて取り直した（`scripts/consult/verify-cards.ts`）。本文を取り出し、各カードの引用が本文にあるかを `quoteExists` と同じ正規化（空白や字形の違いを無視）で見た。結果は 105 枚中 105 枚が一致し、うち 103 枚を使う。残る 2 枚は使わない（引用が対策の文でないもの、図の中の文で PDL1.0 の外にあるもの）。公開する `data/consult/verify.json` に、資料ごとの取得先 URL、sha256、取得の状態と、カードごとの照合の結果と引用の sha256 を残す（本文は保存しない）。引用を書き換えると `scripts/test/consult-verify.test.ts` が落ちる。

**利用条件の確かめ方（5 資料の `licenseVerified` を true にした）。**

- `paper-pmid39808886`、`paper-pmid42869858`（Preventive Veterinary Medicine）: Crossref（`https://api.crossref.org/works/<DOI>`）（2026-11-06 に取得）で、出版社 Elsevier が登録した版（content-version が `vor`）の利用条件が CC BY 4.0（http://creativecommons.org/licenses/by/4.0/）。開始日は、デンマークの論文が 2025-01-03、ドイツの論文が 2026-10-12。Europe PMC の登録にはデンマークの論文は cc by とあり、ドイツの論文には許可証の表示がなかった。論文のページそのものは読んでいない。この 2 本は抄録だけで引用を照合し、本文は読んでいない（カードの `caveats` にも書いた）。
- `paper-pmc10408129`、`paper-pmc12629688`、`paper-pmc13423691`: 以前は版を書かず CC BY としていた。Crossref の `vor` の登録（2026-11-06 に取得）で CC BY 4.0（`https://creativecommons.org/licenses/by/4.0/`）と確かめ、`license` を CC BY 4.0 に直した（開始日は順に 2023-07-25、2025-11-12、2026-07-17）。
- `aphis-s1`、`aphis-s2`、`aphis-s5`: PDF をこの作品の名乗りで取り直し（2026-11-06）、著作権や転載の制限の表示がないことを確かめた。米国の連邦政府の職員が職務で作った著作物は、米国の著作権法 105 条（17 U.S.C. § 105）により著作権の対象外。USDA の方針のページは 403、APHIS の website-policies は 404 で、読めなかった。方針のページでの確認は、できていない。

**資料と帰属の文。** 資料の id はカードの `sourceId`。使うカードの数は 103 枚の内訳。

**農林水産省。** 発行者は農林水産省。利用条件は PDL1.0（公共データ利用規約 第1.0版。上の「国と県の公開文書の利用条件」の表で、特記がなければ PDL1.0 と確かめた）。

- `maff-s1` 2025年～2026年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-239.pdf、使うカード 28 枚）
  - 出典の文: 出典: 農林水産省「2025年～2026年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書」（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-239.pdf）を加工して作成
- `maff-s11` 飼養衛生管理マニュアル（例：小規模農家向け）（https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/attach/pdf/index-177.pdf、使うカード 1 枚）
  - 出典の文: 出典: 農林水産省「飼養衛生管理マニュアル（例：小規模農家向け）」（https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/attach/pdf/index-177.pdf）を加工して作成
- `maff-s3` 飼養衛生管理基準遵守指導の手引き（鶏、あひる、うずら、きじ、エミュー、だちょう、ほろほろ鳥及び七面鳥の場合）（https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/attach/pdf/index-284.pdf、使うカード 9 枚）
  - 出典の文: 出典: 農林水産省「飼養衛生管理基準遵守指導の手引き（鶏、あひる、うずら、きじ、エミュー、だちょう、ほろほろ鳥及び七面鳥の場合）」（https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_shiyou/attach/pdf/index-284.pdf）を加工して作成
- `maff-s4` 高病原性鳥インフルエンザの防疫対策の徹底について（8消安第3622号、令和8年9月16日）（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r8_hpai_kokunai-4.pdf、使うカード 3 枚）
  - 出典の文: 出典: 農林水産省「高病原性鳥インフルエンザの防疫対策の徹底について（8消安第3622号、令和8年9月16日）」（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r8_hpai_kokunai-4.pdf）を加工して作成
- `maff-s5` 対策のポイント（高病原性鳥インフルエンザ。令和8年度）（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r8_hpai_kokunai-1.pdf、使うカード 1 枚）
  - 出典の文: 出典: 農林水産省「対策のポイント（高病原性鳥インフルエンザ。令和8年度）」（https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r8_hpai_kokunai-1.pdf）を加工して作成
- `maff-s7` 2024年～2025年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書（https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_94/attach/pdf/kakin_94-10.pdf、使うカード 8 枚）
  - 出典の文: 出典: 農林水産省「2024年～2025年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書」（https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_94/attach/pdf/kakin_94-10.pdf）を加工して作成

**岡山県。** 発行者は岡山県。利用条件は PDL1.0（サイトポリシーで確かめた。上の表）。図画、写真は掲載元の承認が要るので、図の中の文は使わず、本文の文だけを引く。

- `okayama-fly` 秋から冬もハエ対策をしましょう！～ハエがHPAI発生の原因かも?!～（https://www.pref.okayama.jp/uploaded/life/1030753_9970502_misc.pdf、使うカード 2 枚）
  - 出典の文: 出典: 岡山県「秋から冬もハエ対策をしましょう！～ハエがHPAI発生の原因かも?!～」（https://www.pref.okayama.jp/uploaded/life/1030753_9970502_misc.pdf）を加工して作成
- `okayama-lime` 消石灰による消毒（https://www.pref.okayama.jp/uploaded/life/1030753_9970487_misc.pdf、使うカード 1 枚）
  - 出典の文: 出典: 岡山県「消石灰による消毒」（https://www.pref.okayama.jp/uploaded/life/1030753_9970487_misc.pdf）を加工して作成

**論文（10 本）。** 利用条件はすべて CC BY 4.0（ライセンス: https://creativecommons.org/licenses/by/4.0/ ）。確かめ方は上のとおり（出版社の登録を Crossref で見た。論文のページそのものは読んでいない）。帰属の文は「著者. 題. 掲載誌. DOI. ライセンスとその URL」と、要約と原文の抜き出しをした旨。著者名は Europe PMC の登録（2026-11-06 に確かめた）から写した。

- `paper-pmc10408129` Green AL, Branan M, Fields VL, Patyk K, Kolar SK, Beam A, Marshall K, McGuigan R, Vuolo M, Freifeld A, Torchetti MK, Lantz K, Delgado AH. Investigation of risk factors for introduction of highly pathogenic avian influenza H5N1 virus onto table egg farms in the United States, 2022: a case–control study. Frontiers in Veterinary Science, 10, 1229008, 2023 (DOI 10.3389/fvets.2023.1229008). https://doi.org/10.3389/fvets.2023.1229008 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC10408129/ （使うカード 11 枚）
  - 帰属の文: Green AL, Branan M, Fields VL, Patyk K, Kolar SK, Beam A, Marshall K, McGuigan R, Vuolo M, Freifeld A, Torchetti MK, Lantz K, Delgado AH. Investigation of risk factors for introduction of highly pathogenic avian influenza H5N1 virus onto table egg farms in the United States, 2022: a case–control study. Frontiers in Veterinary Science, 10, 1229008, 2023 (DOI 10.3389/fvets.2023.1229008). https://doi.org/10.3389/fvets.2023.1229008 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc10498466` Patyk KA, Fields VL, Beam AL, Branan MA, McGuigan RE, Green A, Torchetti MK, Lantz K, Freifeld A, Marshall K, Delgado AH. Investigation of risk factors for introduction of highly pathogenic avian influenza H5N1 infection among commercial turkey operations in the United States, 2022: a case-control study. Frontiers in Veterinary Science, 10, 1229071, 2023 (DOI 10.3389/fvets.2023.1229071). https://doi.org/10.3389/fvets.2023.1229071 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC10498466/ （使うカード 3 枚）
  - 帰属の文: Patyk KA, Fields VL, Beam AL, Branan MA, McGuigan RE, Green A, Torchetti MK, Lantz K, Freifeld A, Marshall K, Delgado AH. Investigation of risk factors for introduction of highly pathogenic avian influenza H5N1 infection among commercial turkey operations in the United States, 2022: a case-control study. Frontiers in Veterinary Science, 10, 1229071, 2023 (DOI 10.3389/fvets.2023.1229071). https://doi.org/10.3389/fvets.2023.1229071 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc11434905` Usui T, Uno Y, Tanaka K, Tanikawa T, Yamaguchi T. Susceptibility of Synanthropic Rodents (Mus musculus, Rattus norvegicus and Rattus rattus) to H5N1 Subtype High Pathogenicity Avian Influenza Viruses. Pathogens, 13(9), 764, 2024 (DOI 10.3390/pathogens13090764). https://doi.org/10.3390/pathogens13090764 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC11434905/ （使うカード 2 枚）
  - 帰属の文: Usui T, Uno Y, Tanaka K, Tanikawa T, Yamaguchi T. Susceptibility of Synanthropic Rodents (Mus musculus, Rattus norvegicus and Rattus rattus) to H5N1 Subtype High Pathogenicity Avian Influenza Viruses. Pathogens, 13(9), 764, 2024 (DOI 10.3390/pathogens13090764). https://doi.org/10.3390/pathogens13090764 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc12389693` Elbers ARW, Gonzales JL. Identification and Characterization of Biosecurity Breaches on Poultry Farms with a Recent History of Highly Pathogenic Avian Influenza Virus Infection Determined by Video Camera Monitoring in the Netherlands. Pathogens, 14(8), 751, 2025 (DOI 10.3390/pathogens14080751). https://doi.org/10.3390/pathogens14080751 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC12389693/ （使うカード 2 枚）
  - 帰属の文: Elbers ARW, Gonzales JL. Identification and Characterization of Biosecurity Breaches on Poultry Farms with a Recent History of Highly Pathogenic Avian Influenza Virus Infection Determined by Video Camera Monitoring in the Netherlands. Pathogens, 14(8), 751, 2025 (DOI 10.3390/pathogens14080751). https://doi.org/10.3390/pathogens14080751 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc12629688` Kondo S, Yamaguchi E, Hayama Y, Yamamoto T. Risk Factors for Introduction of H5N1 Highly Pathogenic Avian Influenza Virus in Japanese Commercial Layer Farms During the 2022–2023 Epidemic: A Case–Control Study. Transboundary and Emerging Diseases, 2025, 2658633 (DOI 10.1155/tbed/2658633). https://doi.org/10.1155/tbed/2658633 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC12629688/ （使うカード 9 枚）
  - 帰属の文: Kondo S, Yamaguchi E, Hayama Y, Yamamoto T. Risk Factors for Introduction of H5N1 Highly Pathogenic Avian Influenza Virus in Japanese Commercial Layer Farms During the 2022–2023 Epidemic: A Case–Control Study. Transboundary and Emerging Diseases, 2025, 2658633 (DOI 10.1155/tbed/2658633). https://doi.org/10.1155/tbed/2658633 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc13423691` Yoon H, Kim K, Hong K. Biosecurity deficiencies in HPAI-affected poultry farms in Korea, 2020/2021–2024/2025 seasons. Frontiers in Veterinary Science, 13, 1863522, 2026 (DOI 10.3389/fvets.2026.1863522). https://doi.org/10.3389/fvets.2026.1863522 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC13423691/ （使うカード 2 枚）
  - 帰属の文: Yoon H, Kim K, Hong K. Biosecurity deficiencies in HPAI-affected poultry farms in Korea, 2020/2021–2024/2025 seasons. Frontiers in Veterinary Science, 13, 1863522, 2026 (DOI 10.3389/fvets.2026.1863522). https://doi.org/10.3389/fvets.2026.1863522 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc5818671` Shimizu Y, Hayama Y, Yamamoto T, Murai K, Tsutsui T. Matched case-control study of the influence of inland waters surrounding poultry farms on avian influenza outbreaks in Japan. Scientific Reports, 8, 3306, 2018 (DOI 10.1038/s41598-018-21695-1). https://doi.org/10.1038/s41598-018-21695-1 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC5818671/ （使うカード 3 枚）
  - 帰属の文: Shimizu Y, Hayama Y, Yamamoto T, Murai K, Tsutsui T. Matched case-control study of the influence of inland waters surrounding poultry farms on avian influenza outbreaks in Japan. Scientific Reports, 8, 3306, 2018 (DOI 10.1038/s41598-018-21695-1). https://doi.org/10.1038/s41598-018-21695-1 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmc6006767` Artois J, Ippoliti C, Conte A, Dhingra MS, Alfonso P, Tahawy AE, Elbestawy A, Ellakany HF, Gilbert M. Avian influenza A (H5N1) outbreaks in different poultry farm types in Egypt: the effect of vaccination, closing status and farm size. BMC Veterinary Research, 14, 187, 2018 (DOI 10.1186/s12917-018-1519-8). https://doi.org/10.1186/s12917-018-1519-8 。CC BY 4.0。https://pmc.ncbi.nlm.nih.gov/articles/PMC6006767/ （使うカード 1 枚）
  - 帰属の文: Artois J, Ippoliti C, Conte A, Dhingra MS, Alfonso P, Tahawy AE, Elbestawy A, Ellakany HF, Gilbert M. Avian influenza A (H5N1) outbreaks in different poultry farm types in Egypt: the effect of vaccination, closing status and farm size. BMC Veterinary Research, 14, 187, 2018 (DOI 10.1186/s12917-018-1519-8). https://doi.org/10.1186/s12917-018-1519-8 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmid39808886` Jensen HA, Nielsen SS, Kirkeby CT, Denwood M, Kjær LJ, Liang Y, Hjulsager CK, Boklund AE. Risk factors for the incursion of highly pathogenic avian influenza virus into poultry and other captive bird holdings in Denmark from 2020 to 2023: A case-control study. Preventive Veterinary Medicine, 236, 106419, 2025 (DOI 10.1016/j.prevetmed.2025.106419). https://doi.org/10.1016/j.prevetmed.2025.106419 。CC BY 4.0。https://pubmed.ncbi.nlm.nih.gov/39808886/ （使うカード 1 枚）
  - 帰属の文: Jensen HA, Nielsen SS, Kirkeby CT, Denwood M, Kjær LJ, Liang Y, Hjulsager CK, Boklund AE. Risk factors for the incursion of highly pathogenic avian influenza virus into poultry and other captive bird holdings in Denmark from 2020 to 2023: A case-control study. Preventive Veterinary Medicine, 236, 106419, 2025 (DOI 10.1016/j.prevetmed.2025.106419). https://doi.org/10.1016/j.prevetmed.2025.106419 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。
- `paper-pmid42869858` Held J, Sauter-Louis C, Gerdes U, Schulz J, Schulz K. Biosecurity risk factors associated with outbreaks of high pathogenicity avian influenza (HPAI) on poultry farms in Lower Saxony (Germany) - A case-control-study. Preventive Veterinary Medicine, 257, 107049, 2026 (DOI 10.1016/j.prevetmed.2026.107049). https://doi.org/10.1016/j.prevetmed.2026.107049 。CC BY 4.0。https://pubmed.ncbi.nlm.nih.gov/42869858/ （使うカード 1 枚）
  - 帰属の文: Held J, Sauter-Louis C, Gerdes U, Schulz J, Schulz K. Biosecurity risk factors associated with outbreaks of high pathogenicity avian influenza (HPAI) on poultry farms in Lower Saxony (Germany) - A case-control-study. Preventive Veterinary Medicine, 257, 107049, 2026 (DOI 10.1016/j.prevetmed.2026.107049). https://doi.org/10.1016/j.prevetmed.2026.107049 （CC BY 4.0。https://creativecommons.org/licenses/by/4.0/ ）。この作品は論文から原文を短く抜き出し、対策と効く条件の文に要約した。要約・抜き出しは作品が行った。

**米国農務省 動植物検疫局（APHIS）。** 発行者は USDA APHIS。米国政府の著作物として使う（米国の連邦政府の職員が職務で作った著作物は、米国の著作権法 105 条により著作権の対象外。確かめ方と、方針のページが読めなかったことは上に書いた）。帰属の文は「出典: USDA APHIS「題」（URL）。米国政府の著作物。この作品が要約・抜き出しをした」。

- `aphis-s1` Table Egg Layers Case-Control Study Updated Findings（ファクトシート）（https://www.aphis.usda.gov/sites/default/files/hpai-table-egg-layers-case-control-study-updated-findings.pdf、使うカード 6 枚）
  - 帰属の文: 出典: USDA APHIS「Table Egg Layers Case-Control Study Updated Findings（ファクトシート）」（https://www.aphis.usda.gov/sites/default/files/hpai-table-egg-layers-case-control-study-updated-findings.pdf）。米国政府の著作物。この作品が要約・抜き出しをした
- `aphis-s2` Turkey Case-Control Study Updated Findings（ファクトシート）（https://www.aphis.usda.gov/sites/default/files/hpai-turkey-case-control-study-updated-findings.pdf、使うカード 2 枚）
  - 帰属の文: 出典: USDA APHIS「Turkey Case-Control Study Updated Findings（ファクトシート）」（https://www.aphis.usda.gov/sites/default/files/hpai-turkey-case-control-study-updated-findings.pdf）。米国政府の著作物。この作品が要約・抜き出しをした
- `aphis-s5` Status and Epidemiologic Analyses of HPAI-affected Poultry Flocks, December 31, 2025 Interim Report（https://www.aphis.usda.gov/sites/default/files/epi-analyses-avian-flu-poultry-7th-interim-rpt.pdf、使うカード 1 枚）
  - 帰属の文: 出典: USDA APHIS Center for Epidemiology and Animal Health「Status and Epidemiologic Analyses of HPAI-affected Poultry Flocks, December 31, 2025 Interim Report」（https://www.aphis.usda.gov/sites/default/files/epi-analyses-avian-flu-poultry-7th-interim-rpt.pdf）。米国政府の著作物。この作品が要約・抜き出しをした

**英国 Defra。** 利用条件は Open Government Licence v3.0（OGL v3.0。https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ ）。帰属の文は "Contains public sector information licensed under the Open Government Licence v3.0." と、出典の題と URL。

- `defra-s12` Avian influenza prevention zone (AIPZ): checklist for poultry and captive bird keepers（Defra（英国環境・食糧・農村地域省）、https://www.gov.uk/government/publications/avian-influenza-prevention-zone-aipz-checklist-for-poultry-and-captive-bird-keepers、使うカード 4 枚）
  - 帰属の文: Defra「Avian influenza prevention zone (AIPZ): checklist for poultry and captive bird keepers」（https://www.gov.uk/government/publications/avian-influenza-prevention-zone-aipz-checklist-for-poultry-and-captive-bird-keepers）。Contains public sector information licensed under the Open Government Licence v3.0. この作品が要約・抜き出しをした
- `defra-s13` Highly pathogenic avian influenza in Great Britain: evaluation and future actions（Defra Science Advisory Council, HPAI Group（英国）、https://www.gov.uk/government/publications/highly-pathogenic-avian-influenza-in-great-britain-evaluation-and-future-actions/highly-pathogenic-avian-influenza-in-great-britain-evaluation-and-future-actions、使うカード 2 枚）
  - 帰属の文: Defra Science Advisory Council, HPAI Group「Highly pathogenic avian influenza in Great Britain: evaluation and future actions」（https://www.gov.uk/government/publications/highly-pathogenic-avian-influenza-in-great-britain-evaluation-and-future-actions/highly-pathogenic-avian-influenza-in-great-britain-evaluation-and-future-actions）。Contains public sector information licensed under the Open Government Licence v3.0. この作品が要約・抜き出しをした

## デジタル庁デザインシステム（見た目の考え方）

**出典（表示する文）:** デジタル庁デザインシステムの考え方を参考にした。デジタル庁が作成したものではない。出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ をもとに作成

- 利用上の注意: https://design.digital.go.jp/introduction/notices/ （確かめた日 2026-11-05）
- 使うのは考え方（余白、文字の大きさ、線の見え方など）だけ。部品、ロゴ、紋章は同梱せず、使わない。
- 緑は使わない。国や都の紋章も使わない。公式のサイトに見せない。
- 画面には出さない（公開リポジトリの文書だけに書く）。

## 見回り先（data/sources.json）

県の鳥インフルエンザのページと RSS、国と環境省の入口の一覧。設計の「補 1」「補 2」と国の主の入口に当たる。`scripts/ops.ts seed-sources` が、この一覧から本番の `sources` を作る（既にある行は上書きしない）。見回り（`watchTick`）は `sources` を読む。運営者が承認した入口は、`resolveReviewItem` が `sources` に足す。

- 件数: 108 行（35 県 69、12 県 36、国と環境省 3）。47 都道府県のすべてに 1 行以上ある。
- 種類: `pref_fixed`（県の常設の鳥インフルのページ）、`pref_rss`（全庁の新着、報道発表、または部署別の RSS）、`pref_press_list`（RSS がない県の報道発表の一覧）、`maff_press`、`maff_season`、`moe`。
- 作り方: `npx tsx scripts/build-sources.ts --permanent <調査表の TSV>`。35 県は調査表（非公開の `private/research/pref-feeds/` にある。リポジトリに入れない）を `kindOf` で読む。12 県（新潟、富山、福井、岐阜、愛知、滋賀、愛媛、高知、福岡、長崎、熊本、大分）は調査表を使わず、`scripts/lib/sources.ts` の手書きの表だけを使う。`note` は自前の短い文で、調査の資料の文を写さない。
- `confirmedOn` は調査の日（2026-11-03）。Cloud Functions からの到達試験（`docs/reachability.md`。本番の到達試験の後に作る）の結果を反映すると、届いた入口の日付が動き、届かなかった入口の `note` に「クラウドから未到達」か「古い TLS で未到達」と日付が入る。
- 12 県の判定: 確定 10、条件付き 1（福岡）、確定できず 1（福井）。利用者の承認は未了（承認までは本番に入れない）。
- 取得の作法: 名乗り、robots.txt、同じホストへ 1.2 秒以上、再試行なし、TLS の設定を下げない。県の文章は転載せず、事実とリンクだけを使う。
- 点検: `npx tsx scripts/check-entrances.ts`（スキル `entrance-check`）。見回り先の変更は運営者の承認が要る。

## 見回り先の未確認の点

次は今回の調査で確かめられなかった点。確かめたら、確かめた日と方法を添えて書き換える。

1. **新年度のページへの切り替わり（新潟、高知、滋賀、岐阜、愛媛）**: 各県に毎年たどれる上位の入口は確かめた。ただし、年度が替わったときに新しいページへのリンクが足されるか、旧 URL が消えるかは、今季に発生がなく、未確認。
2. **日付や番号を含む URL の再利用（岐阜 `page/338648.html`、愛媛 `page/95900.html`、富山 `…/20260309.html`）**: 次の季節にも同じ記事を更新して使うか、新しい記事に替えるかは未確認。富山は URL に日付が入っているので、替わる可能性が高い（推測）。
3. **発生時に常設ページや RSS が実際に動くか**: 今季は国内の家きんの発生がまだなく、発生時にどの入口が、どの順で、どれだけ早く更新されるかは、最初の発生まで確かめられない。最初の発生が来たら、検知の時刻を入口ごとに記録し、見回り先を直す。部署別 RSS が疑いの段階の項目を流すかも未確認。
4. **福岡と福井は、県の発生を検知できる根拠がない**: 福岡は家きんの節が外部リンクだけで、RSS は robots.txt が禁止している。福井は家畜保健衛生所のページに発生の記録欄がなく、県の報道発表の置き場は 2 経路とも使えない（接続が切れる、robots.txt がサイト全体を禁じている）。この 2 県の確定した発生は国の発表で補う。取得できることと、県の発生を見分けられることは別であり、画面の「N 件を確認」の説明にも、その限界を書く（福井と福岡を「N 件を確認」に数えてよいか、という問いの既定: 説明に限界を書く）。
5. **Cloud Functions からの到達**: 開発機で届いても、クラウドの IP から届くかは未測定（到達試験の本番の実行で測る）。12 県の入口のうち 6 件（高知の新着 RSS、富山の組織ページと報道発表 RSS、熊本と大分の新着 RSS、愛媛の関連情報ページ）は、到達試験の対象に入っていないので、クラウドからは未測定。開発機では、このうち 5 件を調査表で取得できた記録があり、富山の組織ページだけは取得の記録を表で確認できていない。
