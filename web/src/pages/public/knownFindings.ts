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
//   Yamaguchi 2024 と Yoo 2022 は、Europe PMC の要旨だけを読んだ。
import type { IsoDate } from "@hpai/shared/types";

export interface KnownFinding {
  id: string;
  text: string;
  /** 研究の地域 */
  region: string;
  /** 研究の時期 */
  period: string;
  certainty: "高い" | "中くらい" | "低い";
  /** 確からしさが何についての評価かの補足 */
  certaintyNote: string | null;
  /** この文が言えないこと */
  limit: string;
  sources: Array<{ title: string; url: string }>;
  /** 原本で確かめた日。null の文は画面に出さない */
  verifiedOn: IsoDate | null;
}

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
  title: "Guinat ほか 2025（フランス南西部 2020/21 の H5N8 の広がりの解析）Communications Biology",
  // 公開全文（Europe PMC）。DOI の番号は公開前の検査が電話番号と見誤るため、こちらを使う
  url: "https://europepmc.org/article/PMC/PMC12397219",
} as const;

export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    id: "recurrence",
    text:
      "2025/26 シーズンに農場で発生が確認された 24 事例のうち、8 事例は、過去のシーズンにも発生を経験した農場での再発でした（そのうち 2 事例は 3 回目）。国の報告書は、再発した農場の所在地、周辺環境、飼養規模、飼い方はさまざまで、今のところ共通の再発要因は見いだせていないとしています。",
    region: "日本全国（国の疫学調査報告書。16 道府県の 24 事例）",
    period: "2025/26 シーズン（2025 年 10 月〜2026 年 4 月）。再発は、2020/21〜2024/25 に発生のあった農場",
    certainty: "高い",
    certaintyNote: null,
    limit:
      "1 つのシーズンの記録です。発生のなかった農場と比べて、再発のしやすさを示したものではなく、これからの発生を予測するものでもありません。同じ報告書は、再発した農場の立地などが感染リスクの高い環境だったと推察する一方で、共通の要因は見いだせないと書いています。",
    sources: [MAFF_REPORT],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "basic-management",
    text:
      "国の報告書は、飼養衛生管理基準を守るよう努めていた農場や、基本的な衛生管理がされていると考えられる農場でも、発生が確認されたと書いています。発生した農場に落ち度があったとは限りません。",
    region: "日本全国（国の疫学調査報告書。16 道府県の 24 事例）",
    period: "2025/26 シーズン（2025 年 10 月〜2026 年 4 月）",
    certainty: "高い",
    certaintyNote: null,
    limit:
      "同じ報告書は、半数以上の農場で外部の業者の専用の衣服や靴に不備があったなど、見直す点が見つかった農場もあったと書いています。落ち度がなかったと言っているわけではありません。原因が 1 つに決まったわけでもなく、野鳥の羽毛やふん、ほこりを通じて鶏舎にウイルスが入った可能性も否定できないとしています。",
    sources: [MAFF_REPORT],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "water-and-flock-size",
    text:
      "2020/21 と 2022/23 の 2 つのシーズンの調査で、発生した農場と、半径 5 km 以内で発生しなかった農場を比べました。発生した農場には、飼っている羽数が多い農場や、水辺が近い（周りに水辺が多い）農場が多い傾向がありました。採卵鶏の農場の発生が目立ちました。",
    region: "日本全国。商業規模の採卵鶏と肉用鶏の農場が中心",
    period: "2020/21 シーズンと 2022/23 シーズン",
    certainty: "中くらい",
    certaintyNote: "傾向についての評価です。小さな農場にも当てはまるかは、確かめられていません。",
    limit:
      "調べられた農場は、大きな農場が中心です。2022/23 の調査では、7,000 羽未満の農場は 430 農場のうち 35 農場で、著者は小規模な農場の影響について結論を出していません。発生した農場に多かったという傾向で、その特徴のある農場で何倍発生するかを示すものではありません。同じ 2022/23 の採卵鶏の別の調査では、鶏舎から 150 m 以内の水辺は、はっきりした差になりませんでした（対照の農場が少なく、差が見えにくかった可能性を、著者が述べています）。2020/21 の調査は、論文の要旨で確かめました。",
    sources: [YAMAGUCHI_2025, YAMAGUCHI_2024, KONDO_2025],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "small-flock",
    text:
      "羽数が少ない農場でも、発生は起きています。2025/26 シーズンの 24 事例のうち、2 事例は約 6,000 羽の農場でした（どちらも平飼いと記載）。日本の比較調査でも、小さな農場への影響には結論が出ておらず、羽数が少ないから大丈夫とは言えません。",
    region: "日本全国（国の事例の一覧）と、日本の比較調査",
    period: "2025/26 シーズン（事例の一覧）、2022/23 シーズン（比較調査）",
    certainty: "中くらい",
    certaintyNote: "発生が起きている事実は、国の一覧のとおりです。羽数が少ないと発生しにくいかどうかは、調べた農場が少なく、分かっていません。",
    limit:
      "約 6,000 羽の事例は 2 つだけで、小さな農場の発生のしやすさを比べられる数ではありません。2022/23 の比較調査で、7,000 羽未満の農場は 430 農場のうち 35 農場でした。羽数が少ないことが守りになるとも、危ないとも、このデータからは言えません。",
    sources: [MAFF_CASE_LIST, YAMAGUCHI_2025],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "changing-shoes",
    text:
      "日本の 2022/23 シーズンの採卵鶏の調査では、鶏舎の入口で専用の靴に履き替えること、裏口で履き替えるか裏口を使わないことが、近くで発生しなかった農場に多い傾向でした。韓国の 2016/17 シーズンの採卵鶏の調査でも、同じ農場の鶏舎の間で長靴を替えることが、発生の少なさと関連していました。",
    region: "日本（採卵鶏の発生 58 農場と、近くで発生しなかった 26 農場）と、韓国（採卵鶏の発生 114 農場と、発生しなかった 129 農場）",
    period: "日本は 2022/23 シーズン、韓国は 2016/17 シーズン",
    certainty: "中くらい",
    certaintyNote: "傾向についての評価です。数字で効果を言えるほどの確かさはありません。",
    limit:
      "日本の調査は、対照の農場が 26 と少ないことを、著者自身が限界に書いています。韓国の調査は、結果の幅が広い推定です。どちらも、履き替えると何割減る、とは言えません。見ているのは鶏舎の入口と裏口、鶏舎の間で、衛生管理区域の入口については確かめていません。なお、家きん舎ごとの専用の靴は、飼養衛生管理基準で求められています。",
    sources: [KONDO_2025, YOO_2022, EGOV_RULE],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "standard-measures",
    text:
      "防鳥ネットの設置と修繕、ねずみなどの駆除は、飼養衛生管理基準で家きん農場に求められています。消石灰の散布は、防疫指針に、発生した農場とその周りの農場で行う措置として書かれています。これらを実施した農場とそうでない農場で、発生がどれだけ違うかは、日本の比較調査でもほとんどの農場が実施していて、比べられませんでした。実施を勧めないという意味ではありません。",
    region: "日本全国（基準と指針）。調査は日本の採卵鶏農場",
    period: "現行の基準と指針（指針は令和 7 年 10 月 1 日の一部変更）。調査は 2022/23 シーズン",
    certainty: "低い",
    certaintyNote: "対策の効果の大きさについての評価です。対策が必要かどうかの評価ではありません。",
    limit:
      "日本の 2022/23 シーズンの採卵鶏の調査では、ねずみ対策はほとんどの農場が実施していて、実施の有無を比べられませんでした。細かい目の金網の設置は、発生した農場で少ない傾向でしたが、はっきりした差にはなりませんでした。差がはっきりしないことは、効果がないという意味ではありません。国の報告書は、ネズミやイタチなどが入った痕跡や防鳥ネットの破損があった農場や、発生した農場のネズミからウイルスが分離された例を挙げ、定期的な駆除と破損の点検を求めています。対策ごとの効果の大きさは、このページでは示せません。",
    sources: [EGOV_RULE, MAFF_GUIDELINE, MAFF_REPORT, KONDO_2025],
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "neighbor-cases",
    text:
      "近くの農場で続けて発生した例はあります。国の報告書は、2024/25 シーズンに 3 つの県で、短期間のうちに狭い地域で連続して発生し、一部は農場間の感染拡大の結果である可能性が示唆されたと書いています。2025/26 シーズンについては、そのような事例は認められなかったとしています。海外の研究（オランダの 2003 年、フランス南西部の 2020/21 年）は、ひとつの流行の中で、近い農場ほど感染しやすかった、または地域の中を週に平均 10 km ほどずつ広がったと推定しています。",
    region: "日本全国（国の報告書）と、オランダ、フランス南西部（海外の研究）",
    period: "2024/25 と 2025/26 シーズン（国）、2003 年（オランダ）、2020/21 年（フランス）。それぞれひとつの流行の間",
    certainty: "中くらい",
    certaintyNote: "近くの農場で続いた例がある、という点の評価です。町や県をまたぐ、長い期間の話は含みません。",
    limit:
      "これらが見ているのは、同じ流行の中の、数 km から十数 km ほどの距離と、数週間から数か月の間のことで、海外の 2 つは家きん農場が密集した地域の流行です。去年や一昨年の発生や、数十 km 離れた町の発生との関係を調べたものではありません。近い農場で相次いだ 2025/26 の事例（約 500 m 離れ、通報日が 5 日違いの 1 組）について、報告書は、どちらも野鳥などに由来するウイルスに暴露された可能性と、先の農場から感染した可能性の両方が考えられるとしています。農場間の感染と断定できない事例が含まれます。また、2025/26 に農場で発生があった 11 府県では野鳥などでの感染報告がなく、報告書は、近くでの発生の有無によらず、シーズン中はどこでも感染のリスクがあると述べています。",
    sources: [MAFF_REPORT, BOENDER_2007, GUINAT_2025],
    verifiedOn: VERIFIED_ON,
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
