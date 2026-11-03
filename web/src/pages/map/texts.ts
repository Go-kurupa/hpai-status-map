// 地図の画面の文言。段階の文は設計書 §5 のとおり。「区域の外です」「安全」「安心」は書かない（§15）。

/** 監視強化区域の説明。①の画面に出す。段階には数えない（§5） */
export const SURVEILLANCE_NOTE =
  "監視強化区域は、制限が解除された後も監視を続ける区域です。段階には数えません。県の発表を確かめてください";

export const TEXT = {
  // 自分の町の 1 文（§5）
  zone: "区域に入っている可能性があります。県の連絡を確かめてください",
  adjacent: "隣町で発生しました",
  frequent: "登録した町で発生しました",
  national: "全国の動きをお知らせしています",
  /** 町だけを選んだとき（距離を見ない）の、同じ町で発生した文。「区域に入っている」と断定しない */
  areaSame: "この町で発生しました。県の連絡を確かめてください",
  shipmentLifted: "搬出制限は解除されました",
  noTown: "町を選んでください",
  unknownTown: "この町の情報を読めませんでした。町を選び直してください",
  // 読み込み中と失敗（「何もない」に見せない。§2）
  loading: "読み込んでいます。読めるまで、発生がないとは言えません",
  loadFailed: "読めませんでした。ページを読み込み直してください。読めるまで、発生がないとは言えません",
  // 自分の町の県が、見回りで確認できていない（結果が未着を含む）。④の「全国の動き」だけで済ませない
  prefUnwatched: "この県は、見回りで確認できていません。発生がないとは言えません",
  // 町の選び方（高齢の人が迷わないよう、仕事の言葉で）
  pickTown: "町を選ぶ",
  changeTown: "町を変える",
  japan: "全国",
  myTown: "自分の町",
  prefLabel: "都道府県",
  muniLabel: "市町村",
  prefPlaceholder: "県を選んでください",
  muniPlaceholder: "市町村を選んでください",
  mapTapHint: "地図の町をさわっても選べます",
  decideTown: "この町にする",
  cancel: "やめる",
  // 地点
  spotTitle: "くわしい場所を決める",
  spotWhy: "約 1km のマス目と市町村だけを、この端末の中に保存します。送信はしません。",
  spotStart: "地図で場所を合わせる",
  spotHint: "地図を動かして、中央の十字を自分の鶏舎のある場所に合わせてください",
  spotSet: "ここに決める",
  spotSea: "町の上に合わせてください",
  spotZoom: "もう少し地図を拡大して、十字を町の上に合わせてください",
  spotConfirm: "この場所で決めますか？",
  spotDecide: "決める",
  spotMapWait: "地図を読み込んでいます。少し待ってからもう一度押してください",
  spotSaved: "この端末に保存しています",
  spotRetry: "やりなおす",
  spotClear: "場所を消す",
  spotSaveFailed: "この端末では保存できませんでした。このページを開いているあいだだけ使います",
  spotFromFarm: "登録した農場の場所で見ています",
  spotFixed: "この画面では場所を変えられません",
  townCleared: "町を選び直したので、くわしい場所は消しました",
  // 過去
  pastLabel: "過去の記録",
  pastDetails: "過去の発生をくわしく見る",
  pastLoading: "過去の記録を読み込んでいます",
  pastFailed: "過去の記録を読めませんでした",
  areaLink: "この町のくわしい状況",
  // 確認状況（W-06）
  watchNotLoaded: "見回りの結果をまだ読めていません。どの県も確認できていない扱いです。",
  watchFailedTail: "地図の斜線の県は、発生がないとは言えません。",
  // 一覧（W-06）
  listClosed: "一覧",
  listNotLoaded: "まだ読めていません",
  listLoadingBody: "発生の一覧をまだ読めていません。読めるまで、発生がないとは言えません。",
  listEmpty: "この期間に、一覧にできる発生の報告はありません。",
  listEmptyPartial: "確認できた範囲では、一覧にできる発生の報告はありません",
  listNoneCheckedShort: "まだ確認できていません",
  listNoneChecked: "まだ確認できていません。見回りの結果が出るまで、発生がないとは言えません。",
  listPartialLabel: "確認できた範囲では",
  watchAttemptOnly: "確認できた県はありません。最後に確認を試したのは",
  listAria: "発生の一覧",
  listBirdsAria: "野鳥の一覧",
  listBirdsHeading: "野鳥",
  listSource: "出典",
  // 凡例（W-06）
  legendAria: "地図の見方",
} as const;
