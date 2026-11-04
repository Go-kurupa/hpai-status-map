# 到達試験の結果

測った日時: 2026-11-04T15:25:00+09:00

この文書は `scripts/ops.ts probe` が作る。手で直さない。Cloud Functions から各入口へ届くかを、1 件ずつ分類した結果である。

## 要約

- 国の月別一覧（7 ページ）の題の合計: **24**（期待値 24 と一致）
- 届いた入口: 118 / 120（県の入口は 103 / 104。届いたが内容が違うものが 0 件）
- 1 件も届かなかった県（0）: なし
- 一部の入口が届かなかった県（1）: 熊本県
- 古い TLS などで握手に失敗した入口（tls_error）: 1 件
- 開発機で届き、この実行で届かなかった入口: 1 件（届いたが内容が違う、または方針で取らなかった入口は 0 件）

## 古い TLS（tls_error）

握手の段階で失敗した入口。設定は変えない。入口ごとに扱いを決める。

| 県 | 種類 | URL | errorCode |
|---|---|---|---|
| 国など | reference | https://www.gsi.go.jp/LAW/2930-index.html | ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED |

## 開発機で届き、クラウドで届かなかった入口

### クラウドで届かなかった

| 県 | 種類 | URL | 結果 | status | errorCode |
|---|---|---|---|---|---|
| 熊本県 | dept_page | https://www.pref.kumamoto.jp/soshiki/77/ | network_error | - | TIMEOUT |

### 届いたが内容が違う、または方針で取らなかった

なし

## 都道府県ごと

| 県 | 入口 | 届いた | 結果 |
|---|---|---|---|
| 北海道 | 2 | 2 | 全部届いた |
| 青森県 | 2 | 2 | 全部届いた |
| 岩手県 | 2 | 2 | 全部届いた |
| 宮城県 | 2 | 2 | 全部届いた |
| 秋田県 | 2 | 2 | 全部届いた |
| 山形県 | 2 | 2 | 全部届いた |
| 福島県 | 2 | 2 | 全部届いた |
| 茨城県 | 2 | 2 | 全部届いた |
| 栃木県 | 2 | 2 | 全部届いた |
| 群馬県 | 2 | 2 | 全部届いた |
| 埼玉県 | 2 | 2 | 全部届いた |
| 千葉県 | 2 | 2 | 全部届いた |
| 東京都 | 2 | 2 | 全部届いた |
| 神奈川県 | 2 | 2 | 全部届いた |
| 新潟県 | 4 | 4 | 全部届いた |
| 富山県 | 2 | 2 | 全部届いた |
| 石川県 | 2 | 2 | 全部届いた |
| 福井県 | 3 | 3 | 全部届いた |
| 山梨県 | 2 | 2 | 全部届いた |
| 長野県 | 2 | 2 | 全部届いた |
| 岐阜県 | 3 | 3 | 全部届いた |
| 静岡県 | 2 | 2 | 全部届いた |
| 愛知県 | 3 | 3 | 全部届いた |
| 三重県 | 2 | 2 | 全部届いた |
| 滋賀県 | 3 | 3 | 全部届いた |
| 京都府 | 1 | 1 | 全部届いた |
| 大阪府 | 2 | 2 | 全部届いた |
| 兵庫県 | 2 | 2 | 全部届いた |
| 奈良県 | 2 | 2 | 全部届いた |
| 和歌山県 | 2 | 2 | 全部届いた |
| 鳥取県 | 2 | 2 | 全部届いた |
| 島根県 | 2 | 2 | 全部届いた |
| 岡山県 | 2 | 2 | 全部届いた |
| 広島県 | 2 | 2 | 全部届いた |
| 山口県 | 2 | 2 | 全部届いた |
| 徳島県 | 2 | 2 | 全部届いた |
| 香川県 | 2 | 2 | 全部届いた |
| 愛媛県 | 3 | 3 | 全部届いた |
| 高知県 | 3 | 3 | 全部届いた |
| 福岡県 | 3 | 3 | 全部届いた |
| 佐賀県 | 2 | 2 | 全部届いた |
| 長崎県 | 2 | 2 | 全部届いた |
| 熊本県 | 3 | 2 | 一部届かなかった |
| 大分県 | 3 | 3 | 全部届いた |
| 宮崎県 | 2 | 2 | 全部届いた |
| 鹿児島県 | 2 | 2 | 全部届いた |
| 沖縄県 | 2 | 2 | 全部届いた |

## 全入口

| 県 | 種類 | URL | 結果 | status | errorCode | bytes | ms | 語 | 項目 | 題 |
|---|---|---|---|---|---|---|---|---|---|---|
| 国など | reference | https://www.gsi.go.jp/LAW/2930-index.html | tls_error | - | ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED | 0 | 135 | なし | 0 | 0 |
| 国など | reference | https://cyberjapandata.gsi.go.jp/xyz/pale/5/28/12.png | ok | 200 | - | 46323 | 1371 | なし | 0 | 0 |
| 国など | reference | https://maps.gsi.go.jp/development/ichiran.html | ok | 200 | - | 464296 | 2492 | なし | 418 | 0 |
| 青森県 | hpai_fixed | https://www.pref.aomori.lg.jp/soshiki/nourin/chikusan/infuru.html | ok | 200 | - | 101212 | 2740 | あり | 219 | 0 |
| 宮城県 | hpai_fixed | https://www.pref.miyagi.jp/life/toriinfluenza/index.html | ok | 200 | - | 18073 | 2771 | あり | 9 | 0 |
| 秋田県 | hpai_fixed | https://www.pref.akita.lg.jp/pages/archive/64737 | ok | 200 | - | 234532 | 2745 | あり | 8 | 0 |
| 岩手県 | hpai_fixed | https://www.pref.iwate.jp/sangyoukoyou/nougyou/chikusangijutsu/kansenshou/index.html | ok | 200 | - | 38549 | 2944 | あり | 15 | 5 |
| 国など | moe | https://www.env.go.jp/nature/dobutsu/bird_flu/ | ok | 200 | - | 57894 | 2969 | あり | 51 | 0 |
| 国など | maff_press | https://www.maff.go.jp/j/press/index.html | ok | 200 | - | 41234 | 2992 | なし | 26 | 0 |
| 国など | reference | https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html | ok | 200 | - | 1894554 | 5089 | なし | 21 | 0 |
| 北海道 | hpai_fixed | https://www.pref.hokkaido.lg.jp/ns/tss/kachikueisei/aviflu.html | ok | 200 | - | 243276 | 5283 | あり | 373 | 5 |
| 秋田県 | rss_all | https://www.pref.akita.lg.jp/feed/news.xml | ok | 200 | - | 104260 | 2431 | なし | 100 | 0 |
| 福島県 | hpai_fixed | https://www.pref.fukushima.lg.jp/sec/36035d/toriinfluenza.html | ok | 200 | - | 14297 | 2862 | あり | 6 | 0 |
| 岩手県 | rss_all | https://www.pref.iwate.jp/news.rss | ok | 200 | - | 70613 | 2492 | あり | 255 | 0 |
| 青森県 | rss_all | https://www.pref.aomori.lg.jp/rss/feed.rss | ok | 200 | - | 162775 | 2819 | あり | 200 | 0 |
| 山形県 | hpai_fixed | https://www.pref.yamagata.jp/140028/sangyo/nourinsuisangyou/nogyo/chikusan/toriinfluenza.html | ok | 200 | - | 27854 | 4279 | あり | 13 | 0 |
| 宮城県 | rss_all | https://www.pref.miyagi.jp/shinchaku/shinchaku.xml | ok | 200 | - | 8731 | 2886 | なし | 10 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2510.html | ok | 200 | - | 53853 | 2764 | あり | 71 | 1 |
| 茨城県 | hpai_fixed | https://www.pref.ibaraki.jp/nourinsuisan/chikusan/kachiku/infuru/kanrenzyouhoutop.html | ok | 200 | - | 23634 | 3584 | あり | 40 | 0 |
| 北海道 | rss_all | https://www.pref.hokkaido.lg.jp/news/rss.xml | ok | 200 | - | 16131 | 1318 | なし | 50 | 0 |
| 福島県 | rss_all | https://www.pref.fukushima.lg.jp/rss/10/list1.xml | ok | 200 | - | 73356 | 1268 | なし | 100 | 0 |
| 山形県 | rss_all | https://www.pref.yamagata.jp/shinchaku/shinchaku.xml | ok | 200 | - | 38855 | 1163 | なし | 50 | 0 |
| 栃木県 | hpai_fixed | https://www.pref.tochigi.lg.jp/g06/hpai/hpaijyouhou.html | ok | 200 | - | 20161 | 1844 | あり | 11 | 0 |
| 埼玉県 | hpai_fixed | https://www.pref.saitama.lg.jp/b0919/osirase/hpai.html | ok | 200 | - | 20050 | 1546 | あり | 23 | 1 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2511.html | ok | 200 | - | 53977 | 1264 | あり | 69 | 4 |
| 茨城県 | rss_all | https://www.pref.ibaraki.jp/news.xml | ok | 200 | - | 17077 | 1209 | なし | 20 | 0 |
| 群馬県 | hpai_fixed | https://www.pref.gunma.jp/page/9451.html | ok | 200 | - | 26213 | 2538 | あり | 14 | 0 |
| 東京都 | hpai_fixed | https://www.sangyo-rodo.metro.tokyo.lg.jp/nourin/shoku/hpai | ok | 200 | - | 603727 | 2526 | あり | 13 | 0 |
| 神奈川県 | hpai_fixed | https://www.pref.kanagawa.jp/docs/w5c/cnt/avianinfluenza/avianinfluenzatop.html | ok | 200 | - | 23513 | 1590 | あり | 27 | 0 |
| 埼玉県 | rss_all | https://www.pref.saitama.lg.jp/news/news.xml | ok | 200 | - | 14922 | 1240 | なし | 20 | 0 |
| 栃木県 | rss_all | https://www.pref.tochigi.lg.jp/c05/kensei/kouhou/hp/shinchaku.xml | ok | 200 | - | 76041 | 1322 | なし | 100 | 0 |
| 石川県 | hpai_fixed | https://www.pref.ishikawa.lg.jp/tikusan/hpai/index.html | ok | 200 | - | 32604 | 1470 | あり | 17 | 0 |
| 千葉県 | hpai_fixed | https://www.pref.chiba.lg.jp/chikusan/toriinfluenza/index.html | ok | 200 | - | 33933 | 2806 | あり | 23 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2512.html | ok | 200 | - | 56377 | 1451 | あり | 79 | 7 |
| 東京都 | rss_all | https://www.metro.tokyo.lg.jp/index.html/-/asset_publisher/knkg/rss | ok | 200 | - | 470648 | 2146 | なし | 60 | 0 |
| 群馬県 | rss_all | https://www.pref.gunma.jp/rss/10/list1.xml | ok | 200 | - | 66240 | 1324 | なし | 100 | 0 |
| 神奈川県 | rss_all | https://www.pref.kanagawa.jp/news/news.xml | ok | 200 | - | 84746 | 1212 | なし | 100 | 0 |
| 石川県 | rss_all | https://www.pref.ishikawa.lg.jp/shinchaku/shinchaku.xml | ok | 200 | - | 7446 | 1214 | なし | 10 | 0 |
| 山梨県 | hpai_fixed | https://www.pref.yamanashi.jp/kansensho/kansensyou/bird-flu.html | ok | 200 | - | 22706 | 1747 | あり | 9 | 0 |
| 長野県 | hpai_fixed | https://www.pref.nagano.lg.jp/enchiku/sangyo/nogyo/chikusan/influ/index.html | ok | 200 | - | 24716 | 1511 | あり | 16 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2601.html | ok | 200 | - | 54567 | 1292 | あり | 69 | 6 |
| 静岡県 | hpai_fixed | https://www.pref.shizuoka.jp/kenkofukushi/eiseiyakuji/dobutsuaigo/1003147/1025208.html | ok | 200 | - | 25799 | 1597 | あり | 6 | 0 |
| 千葉県 | rss_all | https://www.pref.chiba.lg.jp/homepage/shinchaku/shinchaku.xml | ok | 200 | - | 32006 | 1465 | なし | 100 | 0 |
| 京都府 | hpai_fixed | https://www.pref.kyoto.jp/birdflu/index.html | ok | 200 | - | 22480 | 1347 | あり | 23 | 0 |
| 大阪府 | hpai_fixed | https://www.pref.osaka.lg.jp/o120140/doubutu/tikusaneisei/hpai_top.html | ok | 200 | - | 24615 | 1344 | あり | 65 | 0 |
| 三重県 | hpai_fixed | https://www.pref.mie.lg.jp/common/05/ci500004496.htm | ok | 200 | - | 25976 | 2397 | あり | 110 | 1 |
| 山梨県 | rss_all | https://www.pref.yamanashi.jp/shinchaku/shinchaku.xml | ok | 200 | - | 8502 | 1217 | なし | 10 | 0 |
| 奈良県 | hpai_fixed | https://www.pref.nara.lg.jp/shigoto/nourinsuisangyou/chikusangyou/bouekieisei/torii-influenza/index.html | ok | 200 | - | 16822 | 1366 | あり | 23 | 0 |
| 長野県 | rss_press | https://www.pref.nagano.lg.jp/kensei/koho/pressreleases/pressreleases.xml | ok | 200 | - | 8489 | 1214 | なし | 10 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2602.html | ok | 200 | - | 51057 | 1302 | あり | 57 | 2 |
| 静岡県 | rss_all | https://www.pref.shizuoka.jp/news.rss | ok | 200 | - | 29636 | 1360 | なし | 100 | 0 |
| 和歌山県 | hpai_fixed | https://www.pref.wakayama.lg.jp/prefg/070400/kikikanri/toriinhuruenza/index.html | ok | 200 | - | 16191 | 1456 | あり | 36 | 0 |
| 鳥取県 | hpai_fixed | https://www.pref.tottori.lg.jp/avian_influenza/ | ok | 200 | - | 54485 | 1472 | あり | 60 | 0 |
| 大阪府 | rss_all | https://www.pref.osaka.lg.jp/shinchaku/shinchaku.xml | ok | 200 | - | 40254 | 1205 | なし | 50 | 0 |
| 兵庫県 | hpai_fixed | https://web.pref.hyogo.lg.jp/kf14/hw14_000000026.html | ok | 200 | - | 24394 | 2496 | あり | 10 | 0 |
| 奈良県 | rss_press | https://www.pref.nara.lg.jp/press/press.xml | ok | 200 | - | 46910 | 1214 | なし | 50 | 0 |
| 三重県 | rss_all | https://www.pref.mie.lg.jp/app/rss/new_rss | ok | 200 | - | 4211 | 1432 | なし | 7 | 0 |
| 岡山県 | hpai_fixed | https://www.pref.okayama.jp/page/816850.html | ok | 200 | - | 20685 | 1382 | あり | 19 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2603.html | ok | 200 | - | 57233 | 1315 | あり | 83 | 3 |
| 和歌山県 | rss_all | https://www.pref.wakayama.lg.jp/whatsnew/news.xml | ok | 200 | - | 188580 | 1479 | なし | 607 | 0 |
| 鳥取県 | rss_all | https://www.pref.tottori.lg.jp/services/rdf/rss10/58395.ashx | ok | 200 | - | 6846 | 1301 | なし | 15 | 0 |
| 広島県 | hpai_fixed | https://www.pref.hiroshima.lg.jp/soshiki/85/kachiku-sippei-hasseijyouhou.html | ok | 200 | - | 26543 | 1699 | あり | 11 | 0 |
| 山口県 | hpai_fixed | https://www.pref.yamaguchi.lg.jp/soshiki/105/22593.html | ok | 200 | - | 31978 | 1428 | あり | 33 | 0 |
| 香川県 | hpai_fixed | https://www.pref.kagawa.lg.jp/chikusan/densenbyo/influenza/index.html | ok | 200 | - | 18643 | 1279 | あり | 14 | 0 |
| 岡山県 | rss_press | https://www.pref.okayama.jp/rss/10/site-3.xml | ok | 200 | - | 71022 | 1358 | なし | 100 | 0 |
| 国など | maff_arc | https://www.maff.go.jp/j/press/arc/2604.html | ok | 200 | - | 50288 | 1296 | あり | 57 | 1 |
| 兵庫県 | rss_all | https://web.pref.hyogo.lg.jp/shinchaku.xml | ok | 200 | - | 7149 | 1804 | なし | 10 | 0 |
| 徳島県 | hpai_fixed | https://www.pref.tokushima.lg.jp/anshin/bousai/densen/7246539/ | ok | 200 | - | 23279 | 1860 | あり | 19 | 0 |
| 佐賀県 | hpai_fixed | https://www.pref.saga.lg.jp/kiji00352123/index.html | ok | 200 | - | 135178 | 1484 | あり | 10 | 0 |
| 広島県 | rss_all | https://www.pref.hiroshima.lg.jp/rss/10/list1.xml | ok | 200 | - | 73227 | 1467 | なし | 99 | 0 |
| 宮崎県 | hpai_fixed | https://www.pref.miyazaki.lg.jp/shigoto/chikusangyo/densenbyo/influenza/index.html | ok | 200 | - | 14396 | 1492 | あり | 7 | 0 |
| 山口県 | rss_press | https://www.pref.yamaguchi.lg.jp/rss/10/list10.xml | ok | 200 | - | 71641 | 1273 | なし | 100 | 0 |
| 島根県 | hpai_fixed | https://www.pref.shimane.lg.jp/industry/norin/seisan/kachikueisei/kinkyuu.html | ok | 200 | - | 211793 | 3859 | あり | 22 | 0 |
| 香川県 | rss_all | https://www.pref.kagawa.lg.jp/shinchaku.xml | ok | 200 | - | 22193 | 1248 | なし | 30 | 0 |
| 国など | maff_season | https://www.maff.go.jp/j/press/syouan/douei/251220.html | ok | 200 | - | 41244 | 1291 | あり | 2 | 0 |
| 沖縄県 | hpai_fixed | https://www.pref.okinawa.lg.jp/shigoto/chikusangyo/1022768/1011259.html | ok | 200 | - | 39503 | 1582 | あり | 16 | 1 |
| 鹿児島県 | hpai_fixed | https://www.pref.kagoshima.jp/ag37/sangyo-rodo/nogyo/tikusan/eisei/tyuuikanki.html | ok | 200 | - | 52202 | 1759 | あり | 40 | 0 |
| 佐賀県 | rss_all | https://www.pref.saga.lg.jp/new_list.xml | ok | 200 | - | 16788 | 1165 | なし | 41 | 0 |
| 徳島県 | rss_press | https://www.pref.tokushima.lg.jp/file/rss/kenseijoho_hodoteikyoshiryo_index.rss | ok | 200 | - | 56242 | 1574 | なし | 30 | 0 |
| 宮崎県 | rss_press | https://www.pref.miyazaki.lg.jp/press/pressrelease.xml | ok | 200 | - | 8056 | 1231 | なし | 10 | 0 |
| 愛知県 | hpai_fixed | https://www.pref.aichi.jp/soshiki/chikusan/chikusan-hpai.html | ok | 200 | - | 25667 | 1309 | あり | 55 | 0 |
| 長崎県 | hpai_fixed | https://www.pref.nagasaki.jp/bunrui/shigoto-sangyo/nogyo/chikusan/boueki/infuruenza/ | ok | 200 | - | 59253 | 1363 | あり | 16 | 0 |
| 島根県 | rss_all | https://www.pref.shimane.lg.jp/top_news.rdf | ok | 200 | - | 8564 | 1268 | なし | 10 | 0 |
| 福井県 | dept_page | https://www.pref.fukui.lg.jp/doc/kaho/toriinfluenza.html | ok | 200 | - | 22979 | 1344 | あり | 36 | 0 |
| 国など | maff_season | https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html | ok | 200 | - | 38756 | 1226 | あり | 6 | 0 |
| 沖縄県 | rss_all | https://www.pref.okinawa.lg.jp/news.rss | ok | 200 | - | 40064 | 1315 | なし | 141 | 0 |
| 鹿児島県 | rss_all | https://www.pref.kagoshima.jp/saishin/saishin.xml | ok | 200 | - | 8944 | 1297 | なし | 10 | 0 |
| 新潟県 | hpai_fixed | https://www.pref.niigata.lg.jp/site/chikusan/1196180201100.html | ok | 200 | - | 39625 | 1327 | あり | 13 | 0 |
| 愛知県 | rss_press | https://www.pref.aichi.jp/rss/10/list7.xml | ok | 200 | - | 88586 | 1211 | なし | 100 | 0 |
| 岐阜県 | hpai_fixed | https://www.pref.gifu.lg.jp/page/120868.html | ok | 200 | - | 24118 | 1415 | あり | 13 | 0 |
| 滋賀県 | hpai_fixed | https://www.pref.shiga.lg.jp/ge00/7137.html | ok | 200 | - | 19446 | 1352 | あり | 22 | 0 |
| 長崎県 | press_list | https://www.pref.nagasaki.jp/press-contents/index.html | ok | 200 | - | 55132 | 1238 | なし | 5 | 0 |
| 福井県 | rss_all | https://www.pref.fukui.lg.jp/news.xml | ok | 200 | - | 11003 | 1195 | なし | 19 | 0 |
| 国など | maff_season | https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf | ok | 200 | - | 1044787 | 1277 | なし | 0 | 0 |
| 高知県 | season_parent | https://www.pref.kochi.lg.jp/soshiki/160000/160901/ | ok | 200 | - | 25607 | 1660 | あり | 38 | 0 |
| 富山県 | dept_page | https://www.pref.toyama.jp/1612/kurashi/seikatsu/shokuseikatsu/20260309.html | ok | 200 | - | 23259 | 1257 | あり | 5 | 0 |
| 新潟県 | season_page | https://www.pref.niigata.lg.jp/sec/0/2025toriinflu.html | ok | 200 | - | 33784 | 1242 | あり | 51 | 0 |
| 愛知県 | rss_all | https://www.pref.aichi.jp/rss/10/list1.xml | ok | 200 | - | 83938 | 1211 | なし | 100 | 0 |
| 滋賀県 | dept_page | https://www.pref.shiga.lg.jp/kachikueisei/13582.html | ok | 200 | - | 34855 | 1276 | あり | 74 | 0 |
| 岐阜県 | season_page | https://www.pref.gifu.lg.jp/page/338648.html | ok | 200 | - | 26157 | 1329 | あり | 15 | 0 |
| 福井県 | dept_page | https://www.pref.fukui.lg.jp/doc/kaho/ | ok | 200 | - | 22763 | 1279 | あり | 57 | 0 |
| 大分県 | season_parent | https://www.pref.oita.jp/soshiki/15450/ | ok | 200 | - | 34218 | 1429 | あり | 30 | 1 |
| 高知県 | dept_page | https://www.pref.kochi.lg.jp/doc/2022041100295/ | ok | 200 | - | 75834 | 1405 | あり | 159 | 0 |
| 富山県 | rss_all | https://www.pref.toyama.jp/shinchaku/shinchaku.xml | ok | 200 | - | 8667 | 1201 | なし | 10 | 0 |
| 新潟県 | rss_dept | https://www.pref.niigata.lg.jp/rss/10/site-163.xml | ok | 200 | - | 17561 | 1233 | あり | 20 | 0 |
| 滋賀県 | press_list | https://www.pref.shiga.lg.jp/cgi-bin/press/index.php | ok | 200 | - | 19393 | 1283 | なし | 26 | 0 |
| 岐阜県 | press_list | https://www.pref.gifu.lg.jp/site/pressrelease/ | ok | 200 | - | 30194 | 1267 | なし | 31 | 0 |
| 福岡県 | dept_page | https://www.pref.fukuoka.lg.jp/contents/kachikueisei-osirase.html | ok | 200 | - | 72613 | 2075 | あり | 21 | 0 |
| 大分県 | rss_dept | https://www.pref.oita.jp/rss/10/soshiki-15-15450.xml | ok | 200 | - | 16558 | 1446 | あり | 23 | 1 |
| 高知県 | rss_dept | https://www.pref.kochi.lg.jp/category/bunya/shigoto_sangyo/chikusangyo/index.rss | ok | 200 | - | 15206 | 1283 | あり | 10 | 0 |
| 新潟県 | rss_all | https://www.pref.niigata.lg.jp/rss/10/list2.xml | ok | 200 | - | 45012 | 1244 | なし | 50 | 0 |
| 福岡県 | hpai_wildbird | https://www.pref.fukuoka.lg.jp/contents/shizentorifuru.html | ok | 200 | - | 73254 | 1458 | あり | 10 | 0 |
| 大分県 | dept_page | https://www.pref.oita.jp/soshiki/15450/tokuteikatiku.html | ok | 200 | - | 26154 | 1260 | あり | 23 | 0 |
| 福岡県 | press_list | https://www.pref.fukuoka.lg.jp/press/ | ok | 200 | - | 68594 | 1866 | なし | 62 | 0 |
| 愛媛県 | season_parent | https://www.pref.ehime.jp/soshiki/85/ | ok | 200 | - | 39674 | 8485 | あり | 48 | 0 |
| 愛媛県 | rss_dept | https://www.pref.ehime.jp/rss/20/soshiki-19-85.xml | ok | 200 | - | 9388 | 2773 | あり | 12 | 0 |
| 愛媛県 | rss_press | https://www.pref.ehime.jp/rss/20/list5.xml | ok | 200 | - | 78279 | 3643 | なし | 100 | 0 |
| 熊本県 | dept_page | https://www.pref.kumamoto.jp/soshiki/77/ | network_error | - | TIMEOUT | 0 | 32526 | なし | 0 | 0 |
| 熊本県 | rss_dept | https://www.pref.kumamoto.jp/rss/10/soshiki-7-77.xml | ok | 200 | - | 24884 | 1262 | あり | 35 | 0 |
| 熊本県 | dept_page | https://www.pref.kumamoto.jp/soshiki/77/1401.html | ok | 200 | - | 24314 | 1229 | あり | 6 | 0 |
