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
  more: "くわしく",
  less: "くわしくを閉じる",
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
