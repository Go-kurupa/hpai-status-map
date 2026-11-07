// 「このサイトについて」の文（設計書 2026-11-06-ui-frame 3 章、決定 12）。データの出典の節は新しい公開の文で、作者の確認が要る。
// URL は、作品の中ですでに使っているもの（README と docs/data-sources.md の表、画面の出典）だけを載せる。

export const ABOUT_TEXT = {
  title: "このサイトについて",
  lead: "審査員の方への入口と、このサイトの運営者、使っているデータの出典、AI の読み取りの確かさと費用、集める情報と消し方の説明です。",
  tocLabel: "もくじ",
  sections: {
    judges: "審査員の方へ",
    operator: "運営者",
    sources: "データの出典",
    ai: "AI の読み取りの確かさと費用",
    privacy: "集める情報と消し方",
  },
  sourcesLead: "国、県、国土交通省、国土地理院が公開しているデータと、「AIに対策を相談」では海外の公的機関の資料と論文を使っています。県の連絡が正です。",
  sourcesMore: "利用条件と加工の詳しい記録は、この作品のリポジトリの文書（docs/data-sources.md）にあります。",
  judgesLead: "ハッカソンの審査のために、登録なしで見られるものです。再現と記録を試すは見本で、本物の今季の状況とは別のものです。",
} as const;

/** 審査員の方への入口（決定 16）。メニューには並べず、ここと README の「審査員の方へ」から開く */
export const JUDGE_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/replay", label: "去年の再現（2025 年 12 月の 4 事例と全国の流れ）" },
  { to: "/replay/backstage", label: "舞台裏（2 つの Claude の読み取りと、プログラムの検査）" },
  { to: "/sample", label: "記録を試す（架空の農場。数字は作り物）" },
  { to: "/consult?judge=1", label: "AIに対策を相談（試しの入口。公的資料と論文のカードだけで答えます。回数に上限あり、保存しません）" },
  { to: "#about-ai", label: "AI の読み取りの確かさと費用（このページの下の節）" },
];

export interface DataSource {
  name: string;
  use: string;
  url: string | null;
}

/** 使っているデータの出典。名前と、この作品で何に使っているか */
export const DATA_SOURCES: readonly DataSource[] = [
  {
    name: "農林水産省 今季の高病原性鳥インフルエンザの国内発生の一覧と報道発表",
    use: "今季の発生の件数、場所（市町村）、日付、羽数",
    url: "https://www.maff.go.jp/j/syouan/douei/tori/r8_hpai_kokunai.html",
  },
  {
    name: "都道府県の発表",
    use: "県内の発生（疑い、確定）の速報。47 都道府県の発表の入口を見回っています",
    url: null,
  },
  {
    name: "農林水産省 高病原性鳥インフルエンザの国内発生事例の一覧（過去 6 シーズン）",
    use: "過去の発生（日付、市町村、用途、飼い方、羽数）。過去の事例の画面で、事例ごとに国の資料へのリンクを付けています",
    url: null,
  },
  {
    name: "農林水産省 疫学調査報告書",
    use: "「件数が少なくても、シーズン中はどこでも感染のリスクがあります」の文。全国の傾向の画面の出典は、その画面に書いています",
    url: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf",
  },
  {
    name: "環境省 野鳥の情報、「渡り鳥の飛来状況」「渡り鳥の飛来経路について」",
    use: "野鳥の陽性、渡り鳥の数（季節の参考）と経路の図",
    url: "https://www.env.go.jp/nature/dobutsu/bird_flu/migratory/index.html",
  },
  {
    name: "国土交通省 国土数値情報「行政区域データ N03 2026 年版」",
    use: "市町村の形（この作品の作者が、形の簡略化、政令市の区の統合、隣り合いの計算を行って作成）",
    url: "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html",
  },
  {
    name: "国土交通省「大字・町丁目位置参照情報」（令和 7 年）",
    use: "くわしい場所を決めるとき、地区（大字）を選んで地図を寄せる目安の点（この作品の作者が、県ごとの一覧に作成）",
    url: "https://nlftp.mlit.go.jp/isj/index.html",
  },
  {
    name: "国土地理院 地理院タイル",
    use: "地図の下絵（行政区域を追記して掲載）",
    url: "https://maps.gsi.go.jp/development/ichiran.html",
  },
  {
    name: "厚生労働省、環境省、農林水産省の公開の文書",
    use: "「鶏を飼っていない方へ」などに、原文のまま短く引用した文",
    url: null,
  },
  {
    name: "AIに対策を相談の資料 23 件（農林水産省、県、論文 10 本、英国 Defra、米国 USDA APHIS の公開資料）",
    use: "AIに対策を相談の根拠のカード。資料ごとの題と URL は、相談の画面のカードに出しています",
    url: null,
  },
];
