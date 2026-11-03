// やること画面の文言。「区域の外です」「安全」「安心」は書かない（設計書 §15）。
// 条文の文は shared/src/checklist/items.ts の決まりから出す。ここには画面の案内だけを置く。

export const TODO_TEXT = {
  title: "やること",
  loading: "読み込んでいます。読めるまで、発生がないとは言えません",
  loadFailed: "読めませんでした。ページを読み込み直してください。読めるまで、発生がないとは言えません",
  noSpot: "町を選ぶと、近くの発生に合わせた確認を出せます。いまは、ふだんの確認だけを出しています",
  pickTown: "地図で町を選ぶ",
  /** 見回りで県の発表を確認できていないとき（段階 4 を「何もない」と読ませない） */
  prefUnconfirmed: "この県の発表を確認できていません。県の連絡を確かめてください",
  selfCheckLink: "今月の自己点検を開く",
  more: "くわしく",
  less: "くわしくを閉じる",
  // 解除の見込み（段階 1 だけ）
  liftHeading: "解除の見込み",
  liftUndetermined: "未定です。防疫措置（殺処分と消毒などの作業）が終わると、見込みの日を計算します",
  liftUndeterminedChain: "同じ町と隣の町の発生も含めて、すべての防疫措置が終わってから計算します",
  liftCalculated: "防疫措置の完了日から数えた見込みです",
  liftPublished: "県が見込みを発表しています。県の発表のとおりに出しています",
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
