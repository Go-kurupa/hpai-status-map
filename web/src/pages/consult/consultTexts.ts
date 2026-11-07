// AIに対策を相談の画面の文言。「安全」「安心」は書かない（shared/src/wording.ts）。
import { CONSULT_DAILY_LIMIT, type ConsultSourceInfo } from "@hpai/shared/consult/types";
import type { FarmConflict } from "@hpai/shared/consult/farmCondition";
import { OUT_OF_SCOPE_TEXT } from "@hpai/shared/consult/validate";

export const CONSULT_TEXT = {
  title: "AIに対策を相談",
  /** 最初の AI の吹き出し */
  greeting: "鳥インフルの対策について、公的な資料と論文から答えます。何から見直しますか？",
  topicsLabel: "話題",
  questionLabel: "聞きたいこと",
  /** 最初の入力欄の案内（2026-11-07 作者の文）。話題のボタン以外の問いや、農場ごとの相談を書いてもらう */
  placeholder: "ほかに聞きたいことがあれば、ここに書いてください",
  followPlaceholder: "続けて聞く…",
  ask: "送る",
  asking: "送っています…",
  /** 答えを待っている間の吹き出し */
  thinking: "資料から答えを作っています…",
  judgeBanner: "審査員の方向けの試しの画面です。1 日の回数に上限があり、相談は保存しません。",
  /** 吹き出しの名札 */
  aiName: "AI",
  advice: "AI の下書き",
  /** 根拠のカードを開く・閉じるボタン（件数は組み立てる） */
  /** 記号（▸ ▾ ≡ × ＋ ✓ →）は読み上げないよう、画面で aria-hidden の別の部品にする。ここには言葉だけ */
  sourcesOpen: (n: number) => `根拠の資料 ${n} 件を見る（引用・出典）`,
  sourcesClose: (n: number) => `根拠の資料 ${n} 件を閉じる`,
  actionsHead: "この答えの対策",
  /** 発生の件数の表（数えるのはプログラム。AI は数え方を選ぶだけ） */
  // 数えたのはプログラム（すぐ下の statsCounted と食い違わないように。2026-11-07 作者の指摘）
  statsWho: "AI が条件を選び、プログラムが一覧から数えました",
  /** 表の中にいつも出す。対策の答えと一緒のときも、表の数字を AI の下書きと読ませない */
  statsCounted: "件数は、AI ではなくプログラムが国の一覧から数えました。",
  statsCount: "件数",
  statsRest: (rows: number, count: number) => `ほか ${rows} 都道府県（合わせて ${count} 件）`,
  statsTotal: "合計",
  statsCurrent: "今季の発生は含みません。",
  statsMapLink: "今の発生を地図で見る",
  statsExploreLink: "条件を変えてデータで探す",
  statsSourcePrefix: "出典: ",
  toTodo: "対策項目で見る",
  followUpsLabel: "続けて聞く候補",
  /** やりとりの欄の名前（読み上げ用） */
  logLabel: "AI とのやりとり",
  /** 見出しのボタン */
  historyOpen: "これまでの相談",
  historyClose: "閉じる",
  newChat: "新しい相談",
  historyTitle: "これまでの相談",
  groupToday: "今日",
  groupYesterday: "昨日",
  groupEarlier: "それより前",
  turns: (n: number) => `${n} 往復`,
  addedCount: (n: number) => `足した対策 ${n}`,
  remove: "消す",
  removeAll: "すべて消す",
  removeAllConfirm: "本当にすべて消す",
  removeAllCancel: "やめる",
  historyEmpty: "まだ相談はありません。",
  /** 一覧の検索と札（2026-11-07 作者の決定。パソコンでは左に一覧） */
  searchLabel: "相談を検索",
  tagsLabel: "話題で絞る",
  tagAll: (n: number) => `すべて ${n}`,
  tagStats: "発生の件数",
  tagFree: "自由な相談",
  resultCount: (n: number) => `${n} 件`,
  noMatch: "当てはまる相談はありません。",
  /** 相談の中身の見出しの下（例「今日 15:06 から · 2 往復」） */
  chatSince: (when: string, turns: number) => `${when} から · ${turns} 往復`,
  historyKept: "相談の記録は、この端末のブラウザにだけ残ります。このサイトのサーバーには保存しません。",
  historyNotKept: "ページを離れると消えます。保存しません。",
  historySaveFailed: "この端末に記録を残せませんでした。ページを離れると消えます。",
  /** 範囲外の決まった文（関数が返す文と同じ） */
  outOfScope: OUT_OF_SCOPE_TEXT,
  dailyLimit: `今日の相談の回数（${CONSULT_DAILY_LIMIT} 回）を使い切りました。明日また使えます。`,
  dailyLimitJudge: "今日の試しの回数を使い切りました。",
  budgetStop: "いまは相談を受け付けていません。しばらくしてからお試しください。",
  /** Claude を呼んだが答えを作れなかったとき。回数を使ったことは書かない */
  unavailable: "答えを作れませんでした。時間をおいて、もう一度お試しください。",
  /** 入力欄の近く。農場を特定する情報を送らせない */
  inputHint: "農場の名前や場所は書かないでください。続けて聞くと、この相談の前のやりとりも AI に渡ります。",
  failed: "相談を送れませんでした。もう一度お試しください。",
  /** 登録した条件（飼育目的と飼い方）を相談に付ける欄。質問の欄の前に出す。付けるのは本人が選んだときだけ。
   * 見出しは「条件」。中の「飼い方は未登録」と「飼い方」が重ならないように */
  conditionHead: (label: string) => `登録した条件: ${label}`,
  conditionUse: "この飼い方で相談する",
  /** 選んだときに出す、条件として送る内容（質問の文と前のやりとりのことは入力欄の下の案内が言う） */
  conditionSends: (label: string) => `条件として送るのは「${label}」だけです。鶏舎の造り・農場名・場所・記録は送りません。`,
  /** 未登録のとき。「農場の設定」はリンクにする */
  conditionNoneBefore: "登録した条件: 未登録。",
  conditionSettingsLink: "農場の設定",
  conditionNoneAfter: "で登録すると、条件を付けて相談できます。",
  conditionLoadFailed: "登録した条件を読み込めませんでした。条件を付けずに相談できます。",
  /** 答えの近くに出す、今回使った条件 */
  conditionUsed: (label: string) => `今回の条件: ${label}`,
  /** 質問の文と登録が食い違うとき（食い違い 1 つごとの文と、最後の 1 文）。送らずに、本人に選んでもらう（直す・このまま付けて送る・付けずに送る・やめる） */
  conflictItem: (inQuestion: string, registered: string) => `質問では${inQuestion}、登録は${registered}です。`,
  conflictAsk: "登録を直すか、送り方を選んでください。",
  conflictFix: "登録を直す",
  /** 食い違いを承知で、登録した条件を付けたまま送る（押すのは本人。主のボタンにしない） */
  conflictSendWith: "このまま条件を付けて送る",
  conflictSendWithout: "条件を付けずに送る",
  conflictCancel: "やめる",
  foreign: "日本と飼い方が違う可能性があります。",
  add: "対策項目に追加する",
  adding: "追加しています…",
  added: "対策項目に追加しました",
  addFailed: "対策項目に足せませんでした。もう一度お試しください。",
  /** 農場がなくて足せないとき。「農場と通知の設定」はリンクにする */
  noFarmBefore: "対策項目に追加するには、先に『",
  noFarmLink: "農場と通知の設定",
  noFarmAfter: "』で農場を登録してください。",
  reviewsLoadFailed: "足した項目を読み込めませんでした。足し済みの印が出ないことがあります。",
  /** 画面の下の 1 行の前。カードの文が資料の要約・加工であること */
  processed: "カードの対策・効く条件・注意書きは、資料を要約・加工したものです。引用は原文のままです。",
  footer:
    "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。",
} as const;

/** 食い違いの確認の文（「質問では平飼い、登録はケージ飼いです。登録を直すか、条件を付けずに相談してください。」） */
export function conflictText(conflicts: readonly FarmConflict[]): string {
  return `${conflicts.map((c) => CONSULT_TEXT.conflictItem(c.inQuestion, c.registered)).join("")}${CONSULT_TEXT.conflictAsk}`;
}

/** カードの資料の行に添える、許可証ごとの短い帰属の文（文面は作者が確認する）。 */
export function attributionText(source: ConsultSourceInfo): string {
  switch (source.license) {
    case "PDL1.0":
      return `出典: ${source.publisher}『${source.title}』を加工して作成`;
    case "CC BY 4.0":
      // 題は上の「資料:」の行にあるので、ここには入れない
      return "CC BY 4.0（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しはこのサイト";
    case "CC BY":
      return "CC BY（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しはこのサイト";
    case "OGL v3.0":
      return "Contains public sector information licensed under the Open Government Licence v3.0.";
    case "US Gov":
      return "米国政府の著作物";
  }
}
