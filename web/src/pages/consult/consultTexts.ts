// 対策の相談の画面の文言。「安全」「安心」は書かない（shared/src/wording.ts）。
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
  dailyLimit: "今日の相談の回数（10 回）を使い切りました。明日また使えます。",
  dailyLimitJudge: "今日の試しの回数を使い切りました。",
  budgetStop: "いまは相談を受け付けていません。しばらくしてからお試しください。",
  failed: "相談を送れませんでした。もう一度お試しください。",
  foreign: "日本と飼い方が違う可能性があります。",
  add: "＋ 対策項目に足す",
  adding: "足しています…",
  added: "対策項目に足しました",
  addFailed: "対策項目に足せませんでした。もう一度お試しください。",
  reviewsLoadFailed: "足した項目を読めませんでした。足し済みの印が出ないことがあります。",
  footer:
    "根拠は、農林水産省・岡山県・論文・海外の公的機関の資料だけです。人の健康、区域、鶏の診断には答えません。迷ったら管轄の家畜保健衛生所へ。",
} as const;
