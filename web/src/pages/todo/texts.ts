// やること画面の文言。「区域の外です」「安全」「安心」は書かない（設計書 §15）。
// 条文の文は shared/src/checklist/items.ts の決まりから出す。ここには画面の案内だけを置く。

export const TODO_TEXT = {
  title: "対策項目",
  loading: "読み込んでいます。読み込めるまで、発生がないとは言えません",
  loadFailed: "読み込めませんでした。ページを読み込み直してください。読み込めるまで、発生がないとは言えません",
  noSpot: "地域を選択すると、近くの発生に合わせた確認を出せます。いまは、ふだんの確認だけを出しています",
  pickTown: "地図で地域を選択",
  /** 見回りで県の発表を確認できていないとき（段階 4 を「何もない」と読ませない） */
  prefUnconfirmed: "この県の発表を確認できていません。県の連絡を確かめてください。",
  selfCheckLink: "今月の自己点検を開く",
  disinfectionLink: "消毒・対策の記録を開く",
  doneNoUndo: "押した記録を取り消す操作はありません",
  /** 確認リストを開くボタン。n は開くと出る確認項目の数（農場の種類で変わる） */
  more: (n: number): string => `確認リストを開く（${n} 項目）`,
  less: "確認リストを閉じる",
  /** ボタンの直前の 1 行。開くと何が並ぶか */
  moreLead: "国の指針から、この農場で確かめることを出典つきで並べています",
  /** 確認リストの群の見出し（見本と会員でない人の画面。目次の飛び先にもなる） */
  checklistHeading: "確認リスト",
  // 目次（見出しのある節が 4 つ以上のときだけ。段階 1）
  tocLabel: "目次",
  /** 目次の札に添える、確認リストの枠の項目数 */
  tocItems: (n: number): string => `${n} 項目`,
  /** 目次の「解除の見込み」に添える町の名前。発生が複数の町なら「津山市ほか」 */
  tocTowns: (names: string[]): string => (names.length > 1 ? `${names[0]}ほか` : (names[0] ?? "")),
  /** 枠の中の項目がすべて同じ出典のとき、項目ごとの位置の前に灰色で置く語（リンクは位置の部分だけ）。何の位置かを示す */
  sourcePositionLead: "出典の",
  /** 枠の中の項目がすべて同じ出典のとき、項目ごとの位置のリンクの読み上げの名前（同じ位置の文が並ぶため、資料名を入れる） */
  sourcePositionLabel: (title: string, position: string): string => `出典: ${title}（${position}）`,
  // 解除の見込み（段階 1 だけ）
  liftHeading: "解除の見込み",
  liftUndetermined: "未定です。防疫措置（殺処分と消毒などの作業）が終わると、見込みの日を計算します",
  liftUndeterminedChain: "同じ町と隣の町の発生も含めて、すべての防疫措置が終わってから計算します",
  /** 計算した日があるときの前提。日付は「早まらず、検査しだいで遅れる日」 */
  liftEarliest:
    "計算した日は、防疫指針の条件（完了からの日数と、検査で区域内の全農場が陰性と確かめられること）がそろった場合の、最も早い日です。検査の結果によっては遅れます",
  liftSourcePref: "県の発表",
  liftSourceCalculated: "防疫指針の日数から計算",
  liftEarliestDay: "最も早い日",
  liftChain: "続発があると延びます",
  liftAuthority: "解除は県が決めます。正式な情報は県の連絡です",
  liftLifted: "移動制限は解除されました",
  movement: "移動制限",
  surveillance: "監視強化",
  shipment: "搬出制限",
  // 記録
  done: "やった",
  doneSaved: "今日は記録しました",
  doneSaving: "記録しています",
  doneFailed: "記録できませんでした。もう一度押してください",
  recordNeedInvite: "招待コードで登録すると記録できます",
  recordNeedFarm: "農場を設定すると記録できます",
  recordSampleNone: "見本の農場を読み込めませんでした",
  recordAuthError: "ログインの状態を確かめられませんでした。ページを読み込み直してください",
  farmFailed: "農場の情報を読み込めませんでした。記録はできません。ページを読み込み直してください",
  setFarmLink: "農場を設定する",
  loginLink: "ログインする",
  // 消毒の記録
  panelLevelFailed: "近くの発生を読み込めなかったので、ふだんの項目だけ出しています",
  // 相談から足した見直し（会員だけ。AIに対策を相談の「対策項目に足す」で足したカード）
  reviewsHeading: "AI の相談から足した見直し",
  reviewsEmpty: "相談の画面で『対策項目に追加する』を押すと、ここに並びます。",
  reviewsLink: "AIに対策を相談する",
  /** 足した見直しの各項目から、その対策について相談の画面を開く */
  reviewsAsk: "この対策を AI に聞く",
  reviewsRemove: "外す",
  reviewsLoadFailed: "足した見直しを読み込めませんでした。ページを読み込み直してください。",
  reviewsRemoveFailed: "外せませんでした。もう一度お試しください。",
  reviewsGone: "このカードは今の資料にありません。",
  // 実施の記録（人が付ける。AI は付けない）。状態の名前は shared/src/consult/review.ts の REVIEW_STATUS_LABEL
  /** 状態のボタンのまとまりの名前（読み上げ用。後ろに対策の文を付ける） */
  reviewsStatusGroup: "実施の状態",
  reviewsNoRecord: "記録なし",
  reviewsUpdated: "更新: ",
  reviewsByMe: "（あなた）",
  reviewsByMember: "（同じ農場の会員）",
  reviewsNoteLabel: "メモ（40 字まで）",
  reviewsNoteSave: "メモを保存",
  reviewsSaving: "保存しています",
  reviewsSaveDenied: "保存できませんでした。この対策が外されたか、権限がありません。ページを読み込み直してください。",
  reviewsSaveFailed: "保存できませんでした。通信を確かめて、もう一度お試しください。",
  reviewsNoteNewline: "メモに改行は入れられません。",
  reviewsNoteTooLong: "メモは 40 字までです。",
} as const;

/**
 * 今日のやること（会員で農場があるときだけ。2026-11-07 A。F3 の「けさの確認」を置き換えた）。
 * 記録できるものだけを 1 本のリストにする: 死亡数（鶏舎ごと）、消毒、AI の相談から追加した対策、自己点検。
 * 毎日の義務に見せない（死亡数は週の報告まで、消毒の記録は任意）。前回との比べ、安全・危険の判定は書かない。
 * 読めないを「変化なし」「済み」、未入力を「0 羽」と書かない。状態の語（まだ・後でやる・やった・記録なし）は F1 のまま。
 */
export const TODAY_TEXT = {
  /** 見出しの横の時点の主語（B）。「発表の確認: 11 月 8 日 6:10 時点」「発表の確認: 未確認」 */
  asOfSubject: "発表の確認",
  outbreakLink: "発生の地図を見る",
  heading: "今日のやること",
  loading: "読み込んでいます",
  failed: "読み込めませんでした",
  /** 集計の 1 行。読めない行・期限なし・今の資料にないカードは数えない */
  summary: (todo: number, later: number, done: number): string => `まだ ${todo} ・ 後でやる ${later} ・ 済み ${done}`,
  /** 読めない行があるとき、集計の後ろに添える（0 件や済みに見せない） */
  summaryUnread: (n: number): string => ` ・ 読み込めなかった ${n}`,
  /** 印の名前（読み上げ用。文字の印と色の両方で示す） */
  mark: { todo: "まだ", later: "後でやる", done: "済み", unknown: "読み込めませんでした", dueNone: "期限なし", gone: "今の資料にありません" },
  // 1 死亡数（鶏舎ごと。空舎は出さない）
  deathsRow: (houseName: string): string => `${houseName}の死亡数`,
  /** 鶏舎がない・読めないときの 1 行の名前 */
  deathsAll: "死亡数",
  deathsMissing: "今日の分は未入力（週の報告までに）",
  deathsRecorded: (n: number): string => `${n} 羽を記録`,
  deathsRecord: "記録する",
  // 2 消毒（記録できる項目だけ）。「記録は任意」と取り消しの断りは、リストの中で 1 回だけ
  disinfectionOptional: "記録は任意",
  disinfectionUnread: "今日の記録を読み込めませんでした",
  /** 行末の小さな出典のリンク。読み上げの名前には資料と項目を入れる（同じ「出典」が並ぶため） */
  source: "出典",
  sourceLabel: (title: string, item: string): string => `出典: ${title}（${item}）`,
  // 3 AI の相談から追加した対策
  reviewFrom: "AI の相談から追加",
  reviewMemo: (note: string): string => `メモ: ${note}`,
  details: "くわしく",
  // 4 自己点検
  selfRow: "自己点検",
  selfDue: (date: string, daysLeft: number): string => `期限 ${date}（${daysLeft === 0 ? "今日" : `あと ${daysLeft} 日`}）`,
  selfDone: (month: number): string => `${month} 月の分を記録済み`,
  selfOpen: "自己点検を開く",
  selfUnread: "今月の記録を読み込めませんでした",
  dueNone: "期限は登録されていません",
  // 登録はあるが、今日以降の期限がない（期限は 10〜5 月だけ入れられる）。「今季」と書かず日付で示す
  dueAllPast: (lastDate: string): string => `登録した期限（最後は ${lastDate}）はすべて過ぎました`,
  dueSetLink: "通知の設定で期限を入れる",
  // 下の参照（国の指針の一覧。記録の仕組みのない項目は、リストに混ぜずここに出典つきで残す）
  refHeading: "参照",
  refLead: "国の指針で確かめること（出典つき）",
  refMore: (n: number): string => `一覧を開く（${n} 項目）`,
  refLess: "一覧を閉じる",
} as const;

/** 働く人への声かけ文（M-18）。「安全」「安心」「区域の外です」は書かない。人の健康を断定しない。 */
export const WORKER_MESSAGE_TEXT = {
  heading: "働く人への声かけ文",
  lead: "近くの発生に合わせた下書きです。読んで、直してから、LINE などに貼ってください",
  /** Claude に渡した事実と、渡していないもの */
  basis: "文の元にした事実は、市町村と日付と段階（疑いか確定か）だけです。農場の名前や記録は使っていません",
  label: "声かけ文（直せます）",
  sourceClaude: "Claude（AI）の下書きです。文を読んで、事実と合っているか確かめてください",
  sourceTemplate: "定型の文です（Claude の下書きではありません）。必要なら直してください",
  loading: "声かけ文を読み込んでいます",
  copy: "コピーする",
  copied: "コピーしました",
  copyFailed: "コピーできませんでした。文を選んで、手でコピーしてください",
  notSaved: "ここで直した文は保存しません。画面を閉じると元に戻ります",
  /** 下書きを作った後に確定になったとき */
  staleSuspected: "この発生は確定になっています。文に「疑い」が残っているので、直してください",
} as const;
