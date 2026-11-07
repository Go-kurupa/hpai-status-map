// 地図の画面の文言。段階の文は設計書 §5 のとおり。「区域の外です」「安全」「安心」は書かない（§15）。

/** 監視強化区域の説明。①の画面に出す。段階には数えない（§5） */
export const SURVEILLANCE_NOTE =
  "監視強化区域は、制限が解除された後も監視を続ける区域です。段階には数えません。県の発表を確かめてください";

export const TEXT = {
  // 自分の町の 1 文（§5）
  zone: "区域に入っている可能性があります。県の連絡を確かめてください",
  adjacent: "隣町で発生しました",
  frequent: "登録した町で発生しました",
  /** 距離の帯（約 60km 以内）。発表の区域と別物なので「区域」と書かない */
  distanceBand: (km: number): string => `約 ${km} km 先で発生しました`,
  national: "全国の動きをお知らせしています",
  /** 町だけを選んだとき（距離を見ない）の、同じ町で発生した文。「区域に入っている」と断定しない */
  areaSame: "この町で発生しました。県の連絡を確かめてください",
  shipmentLifted: "搬出制限は解除されました",
  noTown: "町を選んでください",
  // 町を選んでいない人の、地図の上の案内
  pickPrompt: "農場のある地域を選ぶと、近くの今季の発生と、過去の発生が分かります。",
  unknownTown: "この町の情報を読めませんでした。町を選び直してください",
  // 読み込み中と失敗（「何もない」に見せない。§2）
  loading: "読み込んでいます。読めるまで、発生がないとは言えません",
  // 15 秒たっても事例が読めないときの案内（SeasonCompare の既存の案内と同じ。状態を言う句は足さない）
  slowLoad: "ページを読み込み直してください。",
  loadFailed: "読めませんでした。ページを読み込み直してください。読めるまで、発生がないとは言えません",
  // 自分の町の県のホームページを読み込めていない（自動の確認の結果が未着を含む）。④の「全国の動き」だけで済ませない
  // 「県から発表がない」ではなく「こちらが読めていない」と分かる言い方にする（2026-11-07 作者の決定、案 B）。時刻は 1 回目に読めなかった時刻
  prefUnwatched: "この県のホームページを読み込めていません。発生がないとは言えません",
  prefUnwatchedSince: (since: string): string => `この県のホームページを、${since} から読み込めていません。発生がないとは言えません`,
  /** スマホで地図の下の行の先頭に添える時刻。name が null なら県名を付けない（1 県のとき） */
  unwatchedSinceNote: (prefs: ReadonlyArray<{ name: string | null; since: string | null }>): string =>
    `読み込めなくなったのは${prefs.map((p) => (p.name === null ? ` ${p.since} から` : `、${p.name}は ${p.since} から`)).join("")}`,
  /** 隣の県。since は県ごとの時刻（分からなければ null） */
  neighborUnwatched: (prefs: ReadonlyArray<{ name: string; since: string | null }>): string => {
    const names = prefs.map((p) => p.name).join("、");
    const times = [...new Set(prefs.map((p) => p.since))];
    if (times.length === 1 && times[0] !== null) return `隣の県（${names}）のホームページを、${times[0]} から読み込めていません。発生がないとは言えません`;
    const dated = prefs.filter((p) => p.since !== null);
    if (dated.length === 0) return `隣の県（${names}）のホームページを読み込めていません。発生がないとは言えません`;
    return `隣の県（${names}）のホームページを読み込めていません（${dated.map((p) => `${p.name}は ${p.since} から`).join("、")}）。発生がないとは言えません`;
  },
  // 町の選び方（高齢の人が迷わないよう、仕事の言葉で）
  pickTown: "地域を選択",
  changeTown: "地域を選択",
  japan: "全国",
  myTown: "選択地域",
  // 地図の見る場所の切り替え
  mapNear: "選択地域付近",
  // 地図で押した町の事例の欄（設計書 2026-11-06-ui-frame 4.1、決定 4）
  panelLabel: "地図で押した町",
  // シーズンは 6 月 1 日から翌年 5 月 31 日。「今季」の始まりを日付で示す（2026-11-06 作者の決定）
  // 見出しと文は、言葉の途中で折れないように塊の並びで持つ（塊の中だけで折れる）
  panelNow: (season: number) => ["今季", `（${season} 年 6 月 1 日から）`],
  panelPast: (range: string | null) => (range ? ["過去 6 シーズン", `（${range}、`, "国の事例一覧）"] : ["過去 6 シーズン", "（国の事例一覧）"]),
  panelPastRange: (from: number, to: number) => `${from} 年 6 月〜${to} 年 5 月`,
  // 塊の頭の普通の空白は詰められるので、件数の前は詰められない空白
  panelSeason: (season: number, n: number) => [`${season} 年 6 月〜${season + 1} 年 5 月`, `\u00a0${n} 件`],
  panelLoading: "読み込んでいます",
  // 記録がない町は短く言う。「これから出ないという意味ではない」は地図のすぐ下の断りが言う（2026-11-06 作者の決定）
  panelNoneNow: (asOf: string | null) => (asOf ? [`${asOf} 時点で、`, "発生記録はありません。"] : ["発生記録はありません。"]),
  panelNonePast: "発生記録はありません。",
  // 地図で押した町の段（2026-11-07 作者の決定）。養鶏場などの発生と野鳥の陽性を、同じ形（印・題・件数）の別々の段にし、混ぜて読ませない
  panelFarmHead: "養鶏場などの発生",
  panelBirdsHead: "野鳥の陽性",
  panelKindCount: (n: number): string => `${n} 件`,
  panelFarmNoneNow: (asOf: string | null) => (asOf ? [`${asOf} 時点で、`, "記録はありません。"] : ["記録はありません。"]),
  panelFarmNonePast: "記録はありません。",
  panelBirdsNone: "この町の発表はありません。",
  panelBirdsNote: "環境省の発表です。見つかって検査された野鳥だけの数で、養鶏場の発生ではありません。",
  panelBirdCollected: (date: string): string => `${date}回収`,
  panelNoSpecies: "種の記載なし",
  panelSuspected: "疑い",
  panelConfirmed: "確定",
  panelNoDate: "日付の記載なし",
  panelNoUse: "用途の記載なし",
  panelNoHousing: "飼い方の記載なし",
  panelNoHead: "羽数の記載なし",
  panelSource: "資料を開く",
  panelNote: "出典: 農林水産省と各県の発表、国の事例一覧。関連農場は件数に入れていません。",
  panelClose: "選択地域に戻る",
  panelCloseNoTown: "閉じる",
  panelPastFailed: "過去の記録をまだ読めていません。",
  panelRetry: "もう一度読む",
  // 最初の画面の過去の記録（2026-11-06 作者の決定）: 近くの自治体ごとの件数のボタン。押すと押した町の欄が開く。件数の多い順、同じなら近い順
  pastNearby: (towns: number, total: number, from: number, to: number) =>
    `約 60 km 以内の ${towns} 自治体で、計 ${total} 件発生しました（${from} 年 6 月〜${to} 年 5 月）`,
  pastPick: (name: string, count: number) => `${name} ${count} 件`,
  pastPickHint: "自治体を押すと、今季と過去の事例が出ます。",
  pastPickAria: "近くで過去に発生のある自治体",
  // 選択地域付近で、約 60 km 以内に今季の発生がないときだけ出す（2026-11-06 作者の決定。あるときと全国の見方では出さない）
  nearNone: "現時点では、付近での発生は確認されていません。",
  // 過去シーズンとの比べの 2 枚の地図（設計書 2026-11-06-ui-frame 4.4、決定 5）。シーズンは日付の範囲でも示す
  compareFirst: "比べる 1",
  compareSecond: "比べる 2",
  compareOption: (label: string, season: number) => `${label}（${season} 年 6 月〜${season + 1} 年 5 月）`,
  compareHead: (name: string, season: number) => [name, `（${season} 年 6 月〜${season + 1} 年 5 月）`],
  compareMapAria: (name: string, season: string) => `発生状況の地図（${name}: ${season}）`,
  compareMapWait:"地図は、画面に入ってから読み込みます",
  compareHint: "地図で町を押すと、2 つのシーズンのその町の発生が、地図の下に並んで出ます。",
  // 町だけ選んだ人の、町の中心からの輪（設計書 2026-11-06-ui-frame 決定 6）
  ringNoteTown: "※ 輪は自治体の中心からの距離の目安で、発表の区域ではありません。",
  // 最初の画面の過去の行から「選択地域の過去」へ（設計書 2026-11-06-ui-frame 4.1）
  townPastLink: "選択地域の過去を見る",
  mapScopeAria: "地図の見る場所",
  // スマホの「選択地域付近」で、地図に印の出ない発表（確認中の県、町の分からない発表）を地図の下の端に 1 行で出す（2026-11-06 作者の決定）。
  // 町の分からない発表は範囲の中かもしれないので「範囲の外」とは書かない
  nearUnmarkedLead: "地図に印のない発表: ",
  nearUnmarkedReviewing: "確認中",
  nearUnmarkedUnplaced: (n: number): string => `${n} 件（町名なし）`,
  nearUnmarkedMore: (n: number): string => `、ほか ${n} 県`,
  nearUnmarkedJapan: "全国で見る",
  // 約 60 km より遠い野鳥の陽性（2026-11-07 作者の決定 C）。地図は輪が入る広さに寄せるので、60 km より遠くても見えることがある。
  // 「地図の外」とは書かず、距離で言う
  nearBirdsLead: "約 60 km より遠い野鳥の陽性: ",
  prefLabel: "都道府県",
  muniLabel: "市町村",
  prefPlaceholder: "県を選んでください",
  muniPlaceholder: "市町村を選んでください",
  mapTapHint: "地図の町を押しても選べます",
  decideTown: "この地域にする",
  // 町の名前を入力して探す（設計書 2026-11-06-town-picker 4 章）
  searchLabel: "町の名前を入力",
  searchPlaceholder: "例: 西粟倉",
  searchNone: "見つかりません。下の県と市町村からも選べます",
  searchMore: (n: number): string => `ほかに ${n} 件あります。もう少しくわしく入力してください`,
  // 選ぶ間、地図のすぐ上に出す（決定 D6）。やめるボタンは cancel を使う
  pickingBar: "地域を選んでいます。地図の町を押すと決まります",
  // 鶏舎の場所が消えることを前もって伝える（決定 D7）
  spotWillClear: "別の町にすると、くわしい場所は消えます（あとで決め直せます）",
  decideHint: "県と市町村を選ぶと押せます",
  openFarmSettings: "農場の設定を開く",
  cancel: "やめる",
  // 地点
  // 鶏舎の場所。選択地域の行のすぐ下に置く（2026-11-07 作者の決定 A。見本 5F5Vywchui4boPbsvnfJRs）
  spotTitle: "鶏舎の場所",
  spotWhy: "約 1km のマス目と市町村だけを、この端末の中に保存します。送信はしません。",
  spotNone: "まだ決めていません。決めると、その場所を中心に距離の輪を描き、約 60 km 以内の件数を出します。約 1km のマス目だけをこの端末に保存し、送信はしません。",
  spotStart: "地図で場所を合わせる",
  spotRestart: "地図で場所を合わせ直す",
  spotSavedNoSend: "この端末に保存しています（送信はしません）",
  spotRegisterNote: "通知を受けたいときは、この場所を農場の設定でそのまま使えます。",
  spotRegister: "この場所で農場を登録する",
  // 地図の印と、場所を決めた後の切り替えの名前（作者 11/7）
  farmMark: "鶏舎の場所",
  legendFarm: "鶏舎の場所（この端末の画面だけ）",
  // 凡例の 3 段（2026-11-07 作者の決定 ア）。赤は養鶏場の発生、墨の鳥は野鳥と読めるように見出しで分ける
  legendGroupFarm: "養鶏場などの発生",
  legendGroupBird: "野鳥（養鶏場の発生ではありません）",
  legendGroupOther: "そのほか",
  legendPrefCount: "県ごとの件数（全国の広さ）",
  mapNearFarm: "鶏舎の付近",
  bandTitle: (km: number): string => `鶏舎から約 ${km} km 以内`,
  spotHint: "地図を動かして、中央の十字を自分の鶏舎のある場所に合わせてください",
  // 地区（大字）で地図を寄せる（2026-11-06 作者の決定）。地区の名前も位置も送信しない
  oazaLabel: "地区（大字）で地図を寄せる",
  oazaChoose: "選んでください",
  oazaNote: "選ぶと、地図がその地区の目安の点へ寄ります。そこから十字を鶏舎に合わせてください。地区の名前は送信しません。",
  oazaSource: "地区の一覧: 国土交通省「大字・町丁目位置参照情報」（令和 7 年）をもとに、この作品の作者が作成",
  spotSet: "ここに決める",
  spotSea: "町の上に合わせてください",
  spotZoom: "もう少し地図を拡大して、十字を町の上に合わせてください",
  spotConfirm: "この場所で決めますか？",
  spotDecide: "決める",
  spotMapWait: "地図を読み込んでいます。少し待ってからもう一度押してください",
  spotRetry: "やりなおす",
  spotClear: "場所を消す",
  spotSaveFailed: "この端末では保存できませんでした。このページを開いているあいだだけ使います",
  spotFromFarm: "登録した農場の場所で見ています",
  spotFixed: "この画面では場所を変えられません",
  townCleared: "町を選び直したので、くわしい場所は消しました",
  // 距離の輪（発表の区域と別物であることを、地図の下に常に出す）
  ringNote: "※ 輪は距離の目安で、発表の区域ではありません。",
  // 毎朝の札。多い少ないを書かない。題に「時点」を入れない（E2E が時刻の表示を「時点」で確かめている）
  // スマホの見出しの題。札の題（養鶏場などの発生）は PC の札に残す。
  // 隣の野鳥の札と分けて読めるよう、養鶏場の数だと題に書く（2026-11-07 作者の決定 イ）
  statHeadline: "今季の養鶏場などの発生（全国）",
  statNational: "養鶏場などの発生",
  // PC の直近 14 日の札の題の頭（スマホは見出しが養鶏場と言うので省く）
  statFarmLead: "養鶏場など ",
  statRecent: "直近 14 日の件数",
  // 札の題のうち、スマホの 1 行で隠す語尾
  statRecentTail: "の件数",
  statPastToDate: (seasons: number, monthDay: string): string => `過去 ${seasons} シーズンの ${monthDay}まで`,
  statBand: (km: number): string => `農場から約 ${km} km 以内`,
  statBandTail: " 以内",
  statBandNow: "今季",
  statBandPast: (seasons: number): string => `過去 ${seasons} シーズン`,
  statFailed: "読めませんでした",
  statFailedNote: "ページを読み込み直してください。読めるまで、発生がないとは言えません。",
  statBandRelated: "過去の件数に関連農場は入れていません。",
  statBandUnplaced: (n: number): string => `町が分からない発表が ${n} 件あり、距離に入れていません。`,
  // PC の札に添える 1 行。距離を区域と読ませない
  statBandWhen: "距離は目安です",
  statFrequent: "登録した町の今季",
  // 野鳥の札。検査中は一覧と同じ語。0 件を「いない」と読ませない断りを常に出す
  statBirds: "野鳥の陽性（今季）",
  statBirdsBreakdown: (confirmed: number, screening: number): string => `高病原性の確定 ${confirmed} 件、検査中 ${screening} 件`,
  statBirdsNote: "環境省の発表から数えています。見つかって検査された野鳥だけの数です。発表がなくても、ウイルスを持つ野鳥がいないとは言えません。",
  statBirdsLink: "定点の水鳥の数を見る",
  // 最初の画面の数字の欄の野鳥の札（2026-11-07 作者の決定）。数は全国。地図を最初の画面に収めるため、PC は出典の 1 行だけ、
  // スマホは題の「（今季）」と出典も省き、数と県名だけにする。「いないとは言えない」の断りの全文は /season の札に置く
  statBirdsShort: "野鳥の陽性",
  statBirdsWhen: "出典: 環境省の発表",
  // 周辺の町の過去の発生。距離は常に「約」。多い少ないを書かない
  nearbyTitle: (km: number, seasons: number): string => `約 ${km} km 以内の町の過去 ${seasons} シーズンの発生`,
  nearbyTotal: (total: number, withCases: number, seasons: number): string => `${seasons} シーズンのうち ${withCases} シーズンで、合わせて ${total} 件（記録）`,
  nearbyNone: (km: number, seasons: number): string => `過去 ${seasons} シーズンの記録に、約 ${km} km 以内の町の発生は載っていません（記録）`,
  nearbyDetails: "町ごとの表を見る",
  nearbyAria: "周辺の町の過去の発生",
  nearbyColTown: "町",
  nearbyColDistance: "距離",
  nearbyColCount: "件数",
  nearbyColSeason: "シーズン",
  nearbySameTown: "この町",
  nearbyDistance: (km: number): string => (km < 1 ? "約 1 km 未満" : `約 ${Math.round(km)} km`),
  nearbyBasisCenter: "距離は、町の中心どうしの距離の目安です。",
  nearbyBasisMesh: "距離は、農場のマス目から町の境までの距離の目安です。",
  nearbyLoading: "周辺の町の過去の発生を読み込んでいます",
  nearbyFailed: "周辺の町の過去の発生を読めませんでした。読めるまで、発生がないとは言えません",
  smallFlocks: (seasons: number, total: number, known: number, small: number): string =>
    `全国の過去 ${seasons} シーズンに、3,000 羽未満の農場で ${small} 件の発生がありました（全 ${total} 件のうち、羽数が分かる ${known} 件で数えた記録）。`,
  // 過去
  pastLabel: "過去の記録",
  pastDetails: "過去の発生をくわしく見る",
  pastLoading: "過去の記録を読み込んでいます",
  /**
   * 過去のシーズンを見ているときの時点。過去の事例（data/history/cases.json）は農林水産省の国内の発生事例の一覧から作った。
   * 確認日は、その一覧を取得した日。docs/data-sources.md の「過去の事例」の節の「取得日」と同じ日で、一致は試験で確かめる
   * （scripts/test/wording-sweep.test.ts）。
   */
  pastAsOf: "時点: 過去の記録（国の事例一覧、確認日 2026-11-02）",
  pastFailed: "過去の記録を読めませんでした",
  areaLink: "この町の案内ページ（登録なしで開ける・共有用）",
  // 確認状況（W-06）
  watchNotLoaded: "各県のホームページの確認の結果を、まだ読めていません。どの県も確認できていない扱いです。",
  watchFailedTail: "地図の斜線の県は、発生がないとは言えません。",
  // スマホの地図の前に出す短い 1 文。確認の行の全文は地図の下に置く
  watchShortRange: "確認できた範囲の件数です。",
  watchShortWho: (who: string): string => `${who}は確認できていません。`,
  watchShortCount: (n: number): string => `${n} 県`,
  // 一覧（W-06）
  listClosed: "一覧",
  listNotLoaded: "まだ読めていません",
  listLoadingBody: "発生の一覧をまだ読めていません。読めるまで、発生がないとは言えません。",
  listEmpty: "この期間に、一覧にできる発生の報告はありません。",
  listEmptyPartial: "確認できた範囲では、一覧にできる発生の報告はありません",
  listNoneCheckedShort: "まだ確認できていません",
  mapLoadFailed: "地図の形を読み込めませんでした。ページを読み込み直してください。それまで地図に色がなくても、発生がないとは言えません。",
  listNoneChecked: "まだ確認できていません。各県のホームページの確認の結果が出るまで、発生がないとは言えません。",
  listPartialLabel: "確認できた範囲では",
  watchAttemptOnly: "確認できた県はありません。最後に確認を試したのは",
  listAria: "発生の一覧",
  listBirdsAria: "野鳥の一覧",
  listBirdsHeading: "野鳥",
  listSource: "出典",
  // 地図が描けない端末（WebGL2 がない、初期化に失敗）の、境の線だけの代わりの地図（SvgMap）
  svgMapNote: "代わりの地図（境の線だけ）を表示しています。",
  svgMapAria: "発生状況の地図（都道府県）",
  svgPrefHint: "県を押すと、その県の市町村の図になります。",
  svgBack: "全国の図へ戻る",
  svgUnwatched: "県のホームページを読み込めていません",
  svgReviewing: "確認中の発表があります",
  svgSuspected: "疑い",
  svgConfirmed: "確定",
  svgNear: "隣の町",
  svgPrefList: "県の一覧から選ぶ",
  svgMuniList: "市町村の一覧から選ぶ",
  // 場所を選んでいないときは、押すとその町の発生を見る（設計書 2026-11-06-ui-frame 決定 4）
  svgMuniListInspect: "市町村の一覧から発生を見る",
  svgLoading: "地図の形を読み込んでいます",
  // 農場の地点（MeshPicker）を、地図なしで決める。座標は送らず、約 1km のマス目と町のコードだけを使う
  meshNoMap: "この端末では地図を表示できないため、選んだ市町村の中心あたりの約 1km のマス目で登録できます。",
  meshUseCenter: "市町村の中心あたりのマス目を使う",
  meshCenterPicked: "市町村の中心あたりのマス目を選びました。",
  /** 農場の設定の案内（地図がない端末）。町を選ぶ前と後 */
  meshPickMuniFirst: "市町村を選ぶと、その町の中心あたりのマス目を使えます。",
  meshPressCenter: "「市町村の中心あたりのマス目を使う」を押してください。",
  /** 地図の画面の「くわしい場所を決める」（地図がない端末）。十字は出さない */
  spotNoMap: "この端末では地図を表示できないため、選んだ町の中心あたりの約 1km のマス目を使えます。",
  // 県ごとと週ごとの棒。多い少ないを書かない
  prefBarsTitle: "県ごとの今季の件数",
  weekBarsTitle: "週ごとの全国の発生（今季）",
  weekBarsAria: "週ごとの全国の発生の棒",
  weekOf: (monthDay: string): string => `${monthDay}の週`,
  weekMax: (n: number): string => `最大 ${n} 件`,
  // 週の棒に当てたときの詳細（2026-11-06 作者の決定）。県と町は県ごとに 1 行
  weekRange: (from: string, to: string): string => `${from}〜${to}`,
  weekPlaceUnknown: "町名なし",
  weekPlaceCount: (name: string, n: number): string => (n > 1 ? `${name}（${n} 件）` : name),
  weekPlacesMore: (n: number): string => `ほか ${n} 県`,
  weekAxisAria: "縦軸の目盛り（件）",
  weekUndated: (n: number): string => `週の棒に置ける日付のない事例が ${n} 件あり、棒には入っていません。`,
  chartsSourceLive: "出典: 農林水産省と各県の発表",
  chartsSourceReplay: "出典: 国の事例一覧",
  // 凡例（W-06）
  legendAria: "地図の見方",
} as const;
