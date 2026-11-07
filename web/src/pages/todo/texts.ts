// やること画面の文言。「区域の外です」「安全」「安心」は書かない（設計書 §15）。
// 条文の文は shared/src/checklist/items.ts の決まりから出す。ここには画面の案内だけを置く。

export const TODO_TEXT = {
  title: "対策項目",
  loading: "読み込んでいます。読めるまで、発生がないとは言えません",
  loadFailed: "読めませんでした。ページを読み込み直してください。読めるまで、発生がないとは言えません",
  noSpot: "地域を選択すると、近くの発生に合わせた確認を出せます。いまは、ふだんの確認だけを出しています",
  pickTown: "地図で地域を選択",
  /** 見回りで県の発表を確認できていないとき（段階 4 を「何もない」と読ませない） */
  prefUnconfirmed: "この県の発表を確認できていません。県の連絡を確かめてください",
  selfCheckLink: "今月の自己点検を開く",
  disinfectionLink: "消毒の記録を開く",
  doneNoUndo: "押した記録を取り消す操作はありません",
  /** 確認リストを開くボタン。n は開くと出る確認項目の数（農場の種類で変わる） */
  more: (n: number): string => `確認リストを開く（${n} 項目）`,
  less: "確認リストを閉じる",
  /** ボタンの直前の 1 行。開くと何が並ぶか */
  moreLead: "国の指針から、この農場で確かめることを出典つきで並べています",
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
  liftAuthority: "解除は県が決めます。県の連絡が正です",
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
  recordSampleNone: "見本の農場を読めませんでした",
  recordAuthError: "ログインの状態を確かめられませんでした。ページを読み込み直してください",
  farmFailed: "農場の情報を読めませんでした。記録はできません。ページを読み込み直してください",
  setFarmLink: "農場を設定する",
  loginLink: "ログインする",
  // 消毒の記録
  panelTitle: "消毒の記録",
  panelLead: "消毒したら「やった」を押すと、日付と項目を残します",
  panelRecent: "最近の記録",
  panelNone: "最近の記録はありません",
  panelListFailed: "最近の記録を読めませんでした",
  panelLevelFailed: "近くの発生を読めなかったので、ふだんの項目だけ出しています",
  // 相談から足した見直し（会員だけ。AIに対策を相談の「対策項目に足す」で足したカード）
  reviewsHeading: "AI の相談から足した見直し",
  reviewsEmpty: "相談の画面で『対策項目に足す』を押すと、ここに並びます。",
  reviewsLink: "AIに対策を相談する",
  /** 足した見直しの各項目から、その対策について相談の画面を開く */
  reviewsAsk: "この対策を AI に聞く",
  reviewsRemove: "外す",
  reviewsLoadFailed: "足した見直しを読めませんでした。ページを読み込み直してください。",
  reviewsRemoveFailed: "外せませんでした。もう一度お試しください。",
  reviewsGone: "このカードは今の資料にありません。",
  // 実施の記録（人が付ける。AI は付けない）。状態の名前は shared/src/consult/review.ts の REVIEW_STATUS_LABEL
  /** 記録のない対策（前に足したまま）があるときだけ、一覧の上に 1 回出す */
  reviewsUnrecordedLead: "「まだ」には、やったかどうかをまだ記録していない対策も入ります。",
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
 * けさの確認（会員だけ。対策項目の見出しの直下）。朝に探し回らずに見るための入口と、記録の状況だけを並べる。
 * 前回との比べ、安全・危険の判定は書かない。読めないを「変化なし」、未入力を「0 羽」と書かない。
 */
export const MORNING_TEXT = {
  heading: "けさの確認",
  loading: "読み込んでいます",
  failed: "読めませんでした",
  // 1 最新の発生
  outbreakHeading: "最新の発生",
  outbreakLink: "発生の地図を見る",
  // 確認できた時点がないとき。ページの上の時点の行（「確認できていません」）とそろえる
  outbreakUnchecked: "確認できていません",
  // 時点は見回り（発生の確認）の時点。発生の時刻と読まれないよう「…時点の確認」と書く
  outbreakAsOf: (asOf: string): string => `${asOf}の確認`,
  // 2 今日の死亡数
  deathsHeading: "今日の死亡数",
  deathsRecorded: (n: number): string => `記録済み（${n} 羽）`,
  deathsMissing: "未入力",
  // 空舎にした鶏舎は記録しないので「未入力」と出さない
  deathsVacant: "空舎",
  deathsLink: "死亡数を記録する",
  // 3 後でやる・まだの対策（相談から足した見直し）
  reviewsHeading: "後でやる・まだの対策",
  reviewsCount: (label: string, n: number): string => `${label} ${n} 件`,
  // 「まだ」のうち、状態を一度も記録していないもの（「まだ」と記録したものと分ける）。0 件なら出さない
  reviewsUnrecorded: (n: number): string => `（うち記録なし ${n} 件）`,
  reviewsNote: (note: string): string => `（メモ: ${note}）`,
  reviewsMore: (n: number): string => `ほか ${n} 件`,
  reviewsNone: "「後でやる」「まだ」の対策はありません",
  reviewsLink: "足した対策の一覧へ",
  // 4 次の報告期限
  dueHeading: "次の報告期限",
  dueLine: (date: string, daysLeft: number): string => `次の自己点検の期限: ${date}（${daysLeft === 0 ? "今日" : `あと ${daysLeft} 日`}）`,
  dueNone: "期限は登録されていません",
  // 登録はあるが、今日以降の期限がない（期限は 10〜5 月だけ入れられる）
  // 「今季」と書かず日付で示す（前の季の日付だけが残っていることがある）
  dueAllPast: (lastDate: string): string => `登録した期限（最後は ${lastDate}）はすべて過ぎました`,
  dueRecordLink: "自己点検を記録する",
  dueChangeLink: "期限を変える",
  dueSetLink: "通知の設定で期限を入れる",
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
