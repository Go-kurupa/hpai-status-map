// 審査員用のリンク（2026-11-08 豪さんとの相談）。提出フォームの 1 本のリンクで、審査員は全員この会員・この農場に入る。
// 会員と農場は関数 judgeSignIn が用意する（functions/src/farm/judgeFarm.ts）。画面はこの id で削除と招待の節を出さない。
/** 審査員の会員の uid（メールアドレスを持たないので、知らせのメールは届かない） */
export const JUDGE_UID = "judge-demo";
/** 審査員用の見本の農場の id */
export const JUDGE_FARM_ID = "judge-demo-farm";
/** 農場の名前（画面に出る） */
export const JUDGE_FARM_NAME = "審査員用の見本の農場";
