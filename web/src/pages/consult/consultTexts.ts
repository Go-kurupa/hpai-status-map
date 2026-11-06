// 対策の相談の画面の文言。「安全」「安心」は書かない（shared/src/wording.ts）。
import { CONSULT_DAILY_LIMIT, type ConsultSourceInfo } from "@hpai/shared/consult/types";
import { OUT_OF_SCOPE_TEXT } from "@hpai/shared/consult/validate";

export const CONSULT_TEXT = {
  title: "鳥インフルの対策の相談",
  intro: "話題を選ぶか、聞きたいことを書いてください。",
  topicsLabel: "話題",
  questionLabel: "聞きたいこと",
  placeholder: "例: 平飼いで 500 羽。長靴の消毒はどうしたら？",
  ask: "聞く",
  asking: "聞いています…",
  judgeBanner: "審査員の方向けの試しの画面です。1 日の回数に上限があり、相談は保存しません。",
  advice: "おすすめ（下書き）",
  /** 範囲外の決まった文（関数が返す文と同じ） */
  outOfScope: OUT_OF_SCOPE_TEXT,
  dailyLimit: `今日の相談の回数（${CONSULT_DAILY_LIMIT} 回）を使い切りました。明日また使えます。`,
  dailyLimitJudge: "今日の試しの回数を使い切りました。",
  budgetStop: "いまは相談を受け付けていません。しばらくしてからお試しください。",
  /** Claude を呼んだが答えを作れなかったとき。回数を使ったことは書かない */
  unavailable: "答えを作れませんでした。時間をおいて、もう一度お試しください。",
  /** 入力欄の近く。農場を特定する情報を送らせない */
  inputHint: "農場の名前や場所は書かないでください。",
  failed: "相談を送れませんでした。もう一度お試しください。",
  foreign: "日本と飼い方が違う可能性があります。",
  add: "＋ 対策項目に足す",
  adding: "足しています…",
  added: "対策項目に足しました",
  addFailed: "対策項目に足せませんでした。もう一度お試しください。",
  /** 農場がなくて足せないとき。「農場と通知の設定」はリンクにする */
  noFarmBefore: "対策項目に足すには、先に『",
  noFarmLink: "農場と通知の設定",
  noFarmAfter: "』で農場を登録してください。",
  reviewsLoadFailed: "足した項目を読めませんでした。足し済みの印が出ないことがあります。",
  /** 画面の下の 1 行の前。カードの文が資料の要約・加工であること */
  processed: "カードの対策・効く条件・注意書きは、資料を要約・加工したものです。引用は原文のままです。",
  footer:
    "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。",
} as const;

/** カードの資料の行に添える、許可証ごとの短い帰属の文（文面は作者が確認する）。 */
export function attributionText(source: ConsultSourceInfo): string {
  switch (source.license) {
    case "PDL1.0":
      return `出典: ${source.publisher}『${source.title}』を加工して作成`;
    case "CC BY 4.0":
      // 題は上の「資料:」の行にあるので、ここには入れない
      return "CC BY 4.0（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しは当サイト";
    case "CC BY":
      return "CC BY（https://creativecommons.org/licenses/by/4.0/ ）。要約と抜き出しは当サイト";
    case "OGL v3.0":
      return "Contains public sector information licensed under the Open Government Licence v3.0.";
    case "US Gov":
      return "米国政府の著作物";
  }
}
