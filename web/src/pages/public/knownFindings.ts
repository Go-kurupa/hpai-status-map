// 「分かっていること」の文（設計書 §11）。研究の知見で、決まり（公式の文）ではない。
//
// - 文は固定。AI は答えない。各文に、研究の地域と時期、確からしさ、限界、出典を付ける。
// - 論文や国の文書の文を写さず、確かめた事実を短くまとめ、元のページへのリンクを付ける。
// - verifiedOn は、DOI か公式の URL の原本で確かめた日（日本時間）。null の行は画面に出さない。
// - 研究の知見は決まりではない。「発生歴のある町は再び発生しやすい」「隣の町から広がる」といった予測や、
//   感染の確率、渡り鳥の数や野鳥の陽性の有無から警報を出す言い方は、根拠がないので書かない（設計書 §11、§2）。
// - 確かめの記録（2026-11-04）:
//   国の文書は maff.go.jp の PDF を取得して本文を読んだ。論文は DOI で指す。出版社のサイトが閲覧を許さなかったので、
//   同じ論文の全文を Europe PMC（PMC12629688、PMC12287441、PMC1853123、PMC12397219）で読んだ。
//   Yamaguchi 2024 と Yoo 2022 は、Europe PMC の要旨だけを読んだ（該当の行の限界に「要旨で確かめた」と書いてある）。
// - 出典の URL は、公開前の検査（電話番号の形の検出）に当たらないものにする。0 で始まる「数字-数字-数字」は避ける。
import type { IsoDate } from "@hpai/shared/types";

export interface KnownFinding {
  id: string;
  /** 短い見出し。各行の先頭と、ページの目次に出す */
  heading: string;
  /** カードの先頭に太字で出す結論 1 文。本文から取り、本文にない事実を足さない */
  summary: string;
  text: string;
  /** 研究の地域 */
  region: string;
  /** 研究の時期 */
  period: string;
  certainty: "高い" | "中くらい" | "低い";
  /** 確からしさが何についての評価かの補足 */
  certaintyNote: string | null;
  /** この文が言えないこと。1 行が 1 つの点。画面では改行で区切って箇条書きにする */
  limit: string;
  sources: Array<{ title: string; url: string }>;
  /** 原本で確かめた日。null の文は画面に出さない */
  verifiedOn: IsoDate | null;
  /** 確からしさが何についての評価か（一覧表に出す短い語）。「低い＝効かない」と読ませないため、確からしさの隣に必ず出す */
  scope: string;
  /** どの読む人の入口に並べるか。表示を隠す絞り込みには使わない（深いリンクを空振りさせない） */
  audiences: readonly Audience[];
  /** limit のうち、畳まずに常に出す 1 行の位置（結論の読み違いを防ぐ行） */
  leadLimit: number;
  /** 本文の数を図にする（同じ分母の記録と、比べた農場の数だけ。差がはっきりしない割合や距離は図にしない） */
  figure: KnownFigure | null;
  /** 作品のほかの画面へのリンク。名前はメニューの項目名か、リンク先の画面の題と同じ */
  related: ReadonlyArray<{ to: string; label: string }>;
}

export type Audience = "farm" | "small" | "neighbor";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  farm: "農場を営む方",
  small: "数羽〜数百羽を飼う方",
  neighbor: "近所にお住まいの方",
};

export type KnownFigure =
  /** whole 事例のうち part 事例。本文に同じ数が書いてあること（試験で確かめる） */
  | { kind: "share"; part: number; whole: number; caption: string }
  /** 比べた農場の数。棒の長さは数に比例する */
  | { kind: "groups"; caption: string; groups: ReadonlyArray<{ name: string; bars: ReadonlyArray<{ label: string; count: number }> }> };

const TO_COMPARE = { to: "/compare", label: "過去の発生" } as const;
const TO_TRENDS = { to: "/trends", label: "発生傾向" } as const;
const TO_TODO = { to: "/todo", label: "対策項目" } as const;
const TO_EXPLORE = { to: "/explore", label: "条件で見る過去の発生" } as const;

const VERIFIED_ON: IsoDate = "2026-11-04";

const MAFF_REPORT = {
  title: "農林水産省「2025年～2026年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書」（2026年7月7日）",
  url: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf",
} as const;
const MAFF_CASE_LIST = {
  title: "農林水産省「高病原性鳥インフルエンザの防疫措置の進捗状況」（令和7年シーズンの事例の一覧）",
  url: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/r7_hpai_kokunai-240.pdf",
} as const;
const MAFF_GUIDELINE = {
  title: "農林水産省「特定家畜伝染病防疫指針（高病原性鳥インフルエンザ及び低病原性鳥インフルエンザ）」（令和7年10月1日一部変更）",
  url: "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/attach/pdf/index-75.pdf",
} as const;
const EGOV_RULE = {
  title: "e-Gov 法令検索「家畜伝染病予防法施行規則」（別表第2。飼養衛生管理基準）",
  url: "https://laws.e-gov.go.jp/law/326M50010000035",
} as const;
const YAMAGUCHI_2025 = {
  title: "Yamaguchi ほか 2025「Risk factors for highly pathogenic avian influenza outbreaks in Japan during 2022-2023 season…」Scientific Reports",
  url: "https://doi.org/10.1038/s41598-025-13003-5",
} as const;
const YAMAGUCHI_2024 = {
  title: "Yamaguchi ほか 2024「A case-control study of the infection risk of H5N8 highly pathogenic avian influenza in Japan during the winter of 2020-2021」Research in Veterinary Science",
  url: "https://doi.org/10.1016/j.rvsc.2024.105149",
} as const;
const KONDO_2025 = {
  title: "Kondo ほか 2025「Risk Factors for Introduction of H5N1 Highly Pathogenic Avian Influenza Virus in Japanese Commercial Layer Farms During the 2022-2023 Epidemic」Transboundary and Emerging Diseases",
  url: "https://doi.org/10.1155/tbed/2658633",
} as const;
const YOO_2022 = {
  title: "Yoo ほか 2022「Preventive effect of on-farm biosecurity practices against highly pathogenic avian influenza (HPAI) H5N6 infection on commercial layer farms in the Republic of Korea during the 2016-17 epidemic」Preventive Veterinary Medicine",
  url: "https://doi.org/10.1016/j.prevetmed.2021.105556",
} as const;
const BOENDER_2007 = {
  title: "Boender ほか 2007「Risk Maps for the Spread of Highly Pathogenic Avian Influenza in Poultry」PLoS Computational Biology",
  url: "https://doi.org/10.1371/journal.pcbi.0030071",
} as const;
const GUINAT_2025 = {
  title: "Guinat ほか 2025「Poultry farm density and proximity drive highly pathogenic avian influenza spread」Communications Biology（フランス南西部 2020/21 の H5N8）",
  // 公開全文（Europe PMC）。DOI の番号は公開前の検査が電話番号と見誤るため、こちらを使う
  url: "https://europepmc.org/article/PMC/PMC12397219",
} as const;

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    id: "recurrence",
    heading: "再発した農場がある",
    summary: "2025/26 シーズンの 24 事例のうち 8 事例は、過去にも発生した農場での再発でした。共通の再発要因は見いだせていません。",
    text:
      "2025/26 シーズンに農場で発生が確認された 24 事例のうち、8 事例は、過去のシーズンにも発生を経験した農場での再発でした（そのうち 2 事例は 3 回目）。国の報告書は、再発した農場の所在地、周辺環境、飼養規模、飼い方はさまざまで、今のところ共通の再発要因は見いだせていないとしています。",
    region: "日本全国（国の疫学調査報告書。16 道府県の 24 事例）",
    period: "2025/26 シーズン（2025 年 10 月〜2026 年 4 月）。再発は、2020/21〜2024/25 に発生のあった農場",
    certainty: "高い",
    certaintyNote: null,
    limit: [
      "1 つのシーズンの記録です。発生しなかった農場と比べて、再発のしやすさを示したものではなく、これからの発生を予測するものでもありません。",
      "同じ報告書は、再発した農場の立地などが感染リスクの高い環境だったと推察する一方で、共通の要因は見いだせないと書いています。",
    ].join("\n"),
    sources: [MAFF_REPORT],
    verifiedOn: VERIFIED_ON,
    scope: "1 シーズンの国の記録",
    audiences: ["farm", "neighbor"],
    leadLimit: 0,
    figure: {
      kind: "share",
      part: 8,
      whole: 24,
      caption: "2025/26 シーズンに農場で発生した 24 事例のうち、過去にも発生した農場での再発 8 事例",
    },
    related: [TO_COMPARE, TO_TRENDS],
  },
  {
    id: "basic-management",
    heading: "基本の管理をしていても発生している",
    summary: "基本の衛生管理をしていた農場でも、発生は確認されています。発生した農場に落ち度があったとは限りません。",
    text:
      "国の報告書は、飼養衛生管理基準を守るよう努めていた農場や、基本的な衛生管理がされていると考えられる農場でも、発生が確認されたと書いています。家きん舎に野生動物が入った痕跡がなく、人や物の出入りの衛生対策が相当に徹底されていた農場も、少数ですが、ありました。発生した農場に落ち度があったとは限りません。",
    region: "日本全国（国の疫学調査報告書。16 道府県の 24 事例）",
    period: "2025/26 シーズン（2025 年 10 月〜2026 年 4 月）",
    certainty: "高い",
    certaintyNote:
      "2025/26 シーズンに発生した 24 農場についての、国の調査の記述の評価です。発生しなかった農場との比較ではなく、ほかのシーズンや、数字で言える確かさは含みません。",
    limit: [
      "同じ報告書は、半数以上の農場で外部の業者の専用の衣服や靴に不備があったなど、見直す点が見つかった農場もあったと書いています。落ち度がなかったと言っているわけではありません。",
      "原因が 1 つに決まったわけではありません。徹底していた農場について、報告書は、従来考えられてきた衛生対策の不備や野生動物による持ち込みに加えて、ウイルスで汚れたほこりや羽毛など、さまざまな可能性を調べる必要があるとしています。",
      "野鳥の羽毛やふん、ほこりを通じて鶏舎にウイルスが入った可能性も否定できない、と書かれています。",
    ].join("\n"),
    sources: [MAFF_REPORT],
    verifiedOn: VERIFIED_ON,
    scope: "発生した 24 農場の国の調査の記述",
    audiences: ["farm", "neighbor"],
    leadLimit: 0,
    figure: null,
    related: [TO_TRENDS, TO_TODO],
  },
  {
    id: "water-and-flock-size",
    heading: "水辺が近い農場、羽数の多い農場に発生が多い傾向",
    summary: "発生した農場には、羽数の多い農場や、水辺が近い農場が多い傾向がありました。調べたのは主に大きな農場です。",
    text:
      "2020/21 と 2022/23 の 2 つのシーズンの調査で、発生した農場と、半径 5 km 以内で発生しなかった農場を比べました。発生した農場には、飼っている羽数が多い農場や、水辺が近い（周りに水辺が多い）農場が多い傾向がありました。採卵鶏の農場の発生が目立ちました。",
    region: "日本全国。商業規模の採卵鶏と肉用鶏の農場が中心",
    period: "2020/21 シーズンと 2022/23 シーズン",
    certainty: "中くらい",
    certaintyNote: "傾向についての評価です。小さな農場にも当てはまるかは、確かめられていません。",
    limit: [
      "調べられた農場は、商業規模の大きな農場が中心です。2022/23 の調査（Yamaguchi 2025）は、1,000 羽未満の農場は調べていません（商業規模ではないとして除きました）。",
      "同じ調査（2022/23）で、1,000〜6,999 羽の小さな農場は 430 農場のうち 35 農場で、著者は小規模な農場の影響について結論を出していません。",
      "発生した農場に多かったという傾向で、その特徴のある農場で何倍発生するかを示すものではありません。",
      "同じ 2022/23 の採卵鶏の別の調査（Kondo 2025）では、鶏舎から 150 m 以内の水辺は、はっきりした差になりませんでした。発生しなかった比較の農場が 26 と少なく、差が見えにくかった可能性があると、著者が述べています。",
      "2020/21 の調査（Yamaguchi 2024）は、論文の要旨だけで確かめました。下限の羽数は、確かめられていません。",
    ].join("\n"),
    sources: [YAMAGUCHI_2025, YAMAGUCHI_2024, KONDO_2025],
    verifiedOn: VERIFIED_ON,
    scope: "傾向。小さな農場は確かめられていない",
    audiences: ["farm"],
    leadLimit: 0,
    figure: null,
    related: [TO_EXPLORE],
  },
  {
    id: "small-flock",
    heading: "約 6,000 羽の農場でも発生している",
    summary: "約 6,000 羽の農場でも発生しています。羽数が少ないと発生しにくいかどうかは、分かっていません。",
    text:
      "羽数が少ない農場でも、発生は起きています。2025/26 シーズンの 24 事例のうち、2 事例は約 6,000 羽の農場でした（どちらも平飼いと記載）。日本の比較調査でも、小さな農場への影響には結論が出ておらず、羽数が少ないから大丈夫とは言えません。",
    region: "日本全国（国の事例の一覧）と、日本の比較調査",
    period: "2025/26 シーズン（事例の一覧）、2022/23 シーズン（比較調査）",
    certainty: "中くらい",
    certaintyNote: "発生が起きている事実は、国の一覧のとおりです。羽数が少ないと発生しにくいかどうかは、調べた農場が少なく、分かっていません。",
    limit: [
      "約 6,000 羽の事例は 2 つだけで、小さな農場の発生のしやすさを比べられる数ではありません。",
      "約 6,000 羽は、数羽から数百羽ほどの小さな飼育とは別の規模です。比較調査（Yamaguchi 2025）は、1,000 羽未満の農場は調べていません（商業規模ではないとして除きました）。数羽から数百羽の飼育で何が言えるかは、この調査からは分かりません。",
      "同じ調査（2022/23）で、1,000〜6,999 羽の農場は 430 農場のうち 35 農場でした。羽数が少ないことが守りになるとも、危ないとも、このデータからは言えません。",
    ].join("\n"),
    sources: [MAFF_CASE_LIST, YAMAGUCHI_2025],
    verifiedOn: VERIFIED_ON,
    scope: "発生した事実。発生しやすさは分からない",
    audiences: ["small", "farm"],
    leadLimit: 0,
    figure: { kind: "share", part: 2, whole: 24, caption: "2025/26 シーズンの 24 事例のうち、約 6,000 羽の農場 2 事例" },
    related: [{ to: "/public#small_flock", label: "数羽飼っている方へ（国の文）" }, TO_EXPLORE],
  },
  {
    id: "changing-shoes",
    heading: "靴の履き替えは、発生しなかった農場に多い",
    summary: "鶏舎の入口での靴の履き替えは、近くで発生しなかった農場に多い傾向でした。効果の大きさは言えません。",
    text:
      "日本の 2022/23 シーズンの採卵鶏の調査では、鶏舎の入口で専用の靴に履き替えること、裏口で履き替えるか裏口を使わないことが、近くで発生しなかった農場に多い傾向でした。韓国の 2016/17 シーズンの採卵鶏の調査でも、同じ農場の鶏舎の間で長靴を替えることが、発生の少なさと関連していました。",
    region: "日本（採卵鶏の発生 58 農場と、近くで発生しなかった 26 農場）と、韓国（採卵鶏の発生 114 農場と、発生しなかった 129 農場）",
    period: "日本は 2022/23 シーズン、韓国は 2016/17 シーズン",
    certainty: "中くらい",
    certaintyNote: "傾向についての評価です。数字で効果を言えるほどの確かさはありません。",
    limit: [
      "日本の調査は、発生しなかった比較の農場が 26 と少ないことを、著者自身が限界に書いています。",
      "比較の農場は、聞き取りで、発生の季節が終わって数か月後に調べられました。発生した農場は、発生の直後に現地で調べられていて、調べ方と時期が違います。",
      "韓国の調査は、結果の幅が広い推定です。論文の要旨で確かめました。",
      "どちらも、履き替えると何割減る、とは言えません。見ているのは鶏舎の入口と裏口、鶏舎の間で、衛生管理区域の入口については確かめていません。",
      "家きん舎ごとの専用の靴は、飼養衛生管理基準で求められています。",
    ].join("\n"),
    sources: [KONDO_2025, YOO_2022, EGOV_RULE],
    verifiedOn: VERIFIED_ON,
    scope: "傾向。効果の大きさは言えない",
    audiences: ["farm", "small"],
    leadLimit: 0,
    figure: {
      kind: "groups",
      caption: "比べた農場の数（発生しなかった比較の農場が少ないことも、限界の 1 つです）",
      groups: [
        {
          name: "日本（2022/23 シーズン、採卵鶏）",
          bars: [
            { label: "発生した農場", count: 58 },
            { label: "近くで発生しなかった農場", count: 26 },
          ],
        },
        {
          name: "韓国（2016/17 シーズン、採卵鶏）",
          bars: [
            { label: "発生した農場", count: 114 },
            { label: "発生しなかった農場", count: 129 },
          ],
        },
      ],
    },
    related: [TO_TODO],
  },
  {
    id: "standard-measures",
    heading: "基準の対策は、効果の大きさを比べにくい",
    summary: "防鳥ネットやねずみ対策は、基準で求められている対策です。効果の大きさは、調査からは分かりませんでした。",
    text:
      "防鳥ネットの設置と修繕、ねずみなどの駆除は、飼養衛生管理基準で家きん農場に求められています。消石灰の散布は、防疫指針に、発生した農場とその周りの農場で行う措置として書かれています。日本の 2022/23 シーズンの採卵鶏の調査は、ねずみ対策と網目の細かい金網を調べましたが、効果の大きさは分かりませんでした。実施を勧めないという意味ではありません。",
    region: "日本全国（基準と指針）。調査は日本の採卵鶏農場",
    period: "現行の基準と指針（指針は令和 7 年 10 月 1 日の一部変更）。調査は 2022/23 シーズン",
    certainty: "低い",
    certaintyNote: "対策の効果の大きさについての評価です。対策が必要かどうかの評価ではありません。",
    limit: [
      "ねずみ対策: 発生した農場の鶏舎 58 棟のうち 52 棟、発生しなかった比較の農場の鶏舎 26 棟のうち 24 棟（農場ごとに 1 棟を選んだ集計の 1 例）で行われていて、この項目では差は分かりません。",
      "網目の細かい（2 cm 未満の）金網: 設置している割合は、発生した農場の鶏舎で 71%（58 棟中 41 棟）、比較の農場で 85%（26 棟中 22 棟）でした。差ははっきりしません。",
      "消石灰は、この調査の項目にありません。消石灰の散布の効果は、この調査からは言えません。",
      "差がはっきりしないことは、効果がないという意味ではありません。著者も、統計上はっきりしなかった項目を、関係がないと読まないでほしいと書いています。比較の農場は聞き取りで調べられ、壁の破損の修繕などは、実際より良く答えられた可能性があるとも述べています。",
      "国の報告書は、ネズミやイタチなどが入った痕跡や防鳥ネットの破損があった農場や、発生した農場のネズミからウイルスが見つかった例を挙げ、定期的な駆除と破損の点検を求めています。",
      "対策ごとの効果の大きさは、このページでは示せません。",
    ].join("\n"),
    sources: [EGOV_RULE, MAFF_GUIDELINE, MAFF_REPORT, KONDO_2025],
    verifiedOn: VERIFIED_ON,
    scope: "効果の大きさ。対策の要否ではない",
    audiences: ["farm", "small"],
    // 「差がはっきりしないことは、効果がないという意味ではありません」の行を常に出す
    leadLimit: 3,
    figure: null,
    related: [TO_TODO, TO_TRENDS],
  },
  {
    id: "neighbor-cases",
    heading: "近くの農場で続いた例と、その範囲",
    summary: "近くの農場で続いて発生した例はあります。農場の間でうつったのか、別々に入ったのかは、明らかではありません。",
    text: [
      "近くの農場で続けて発生した例はあります。国の報告書は、2024/25 シーズンに 3 つの県で、短期間のうちに狭い地域で連続して発生し、一部は農場間の感染拡大の結果である可能性があるとされたと書いています。2025/26 シーズンについては、そのような事例は認められなかったとしつつ、同じ道県内で 1 か月以内に、家きん飼養施設の間が 11 km 以内で、同じ遺伝子型のウイルスが見つかった組を 3 組挙げています（新潟県の 3・4 例目、千葉県の 18・19 例目、北海道の 21・22 例目）。",
      "海外の研究では、オランダの 2003 年の H7N7 の流行で近い農場ほど感染しやすかったと推定され、フランス南西部の 2020/21 年の H5N8 の流行（主にアヒルの農場）では、地域の中を週に平均 10.5 km ずつ広がったと推定されています。",
    ].join("\n"),
    region: "日本全国（国の報告書）と、オランダ、フランス南西部（海外の研究）",
    period: "2024/25 と 2025/26 シーズン（国）、2003 年（オランダ）、2020/21 年（フランス）。それぞれひとつの流行の間",
    certainty: "中くらい",
    certaintyNote: "近くの農場で続いた例がある、という点の評価です。町や県をまたぐ、長い期間の話は含みません。",
    limit: [
      "この 3 組について、報告書は、ウイルスの配列がそれぞれかなり近縁で、農場間の伝播の可能性は否定できないとする一方、地域の野鳥や野生の哺乳類から別々に入った可能性も考えられるとしています。農場間の伝播か、別々の侵入かは、明らかではないとも書いています。",
      "新潟県の組（約 500 m 離れ、通報日が 5 日違い）は、相次いで野鳥などに由来するウイルスに触れた可能性が考えられるとしつつ、先の農場から感染した可能性も否定できないとされています。千葉県の組（約 1 km 離れ、防疫措置の完了から次の通報まで 20 日ほど）は、先の農場が直接の感染源になったとは考えにくいとされています。",
      "海外の 2 つの研究は、家きん農場が密集した地域の、ひとつの流行の間（数週間から数か月）の話です。日本の 2025/26 シーズンの発生はすべて H5N1 亜型で、オランダの H7N7、フランスの H5N8 とは型が違います。オランダでは、感染が起こりえた農場の組のほとんどが 25 km 以内でした。",
      "フランスの流行は主にアヒルの農場で、広がる速さは週に平均 10.5 km、多い週は 27.8 km でした。論文は、アヒルのほうが鶏よりウイルスに感染しやすく広げやすいことが背景にあると考えられると述べています。鶏の農場にそのまま当てはまるとは限りません。",
      "ここに挙げた距離や速さは、研究が推定した値で、区域や対策を決める基準ではありません。去年や一昨年の発生や、数十 km 離れた町の発生との関係を調べたものでもありません。",
      "2025/26 に農場で発生があった 11 府県では野鳥などでの感染報告がなく、報告書は、近くでの発生の有無によらず、シーズン中はどこでも感染のリスクがあると述べています。",
    ].join("\n"),
    sources: [MAFF_REPORT, BOENDER_2007, GUINAT_2025],
    verifiedOn: VERIFIED_ON,
    scope: "近くで続いた例があること",
    audiences: ["neighbor", "farm"],
    leadLimit: 0,
    figure: null,
    related: [{ to: "/", label: "今季の発生" }, TO_COMPARE],
  },
];

/**
 * 「過去の発生は記録で、これからを予測しない。ただし他人事ではない」の根拠にする、国の報告書の一文（原文の連続した引用）。
 * 報告書自身が「推察される」と書く文なので、断定として扱わない。
 */
export const PAST_BASIS: { text: string; sourceTitle: string; sourceUrl: string; verifiedOn: IsoDate | null } = {
  text: "再発農場は、立地等が感染リスクの高い環境であると推察されることから、発生歴のある農場はもちろん、環境を共有する周辺農場を含め、地域としての感染予防対策の重要性が改めて認識された。",
  sourceTitle: "農林水産省「2025年～2026年シーズンにおける高病原性鳥インフルエンザの発生に係る疫学調査報告書」（2026年7月7日）",
  sourceUrl: "https://www.maff.go.jp/j/council/seisaku/eisei/kakin/kakin_98/attach/pdf/kakin_98-12.pdf",
  verifiedOn: VERIFIED_ON,
};
