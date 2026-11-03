// 公式の文（設計書 §11、契約 3.9）。「鶏を飼っていない方へ」のページと、MCP（X-12、M-19）が読む。
//
// - statements は国の機関（農林水産省、厚生労働省、環境省、e-Gov の法令）の文だけ。原文の連続した引用で、
//   言い換えも、断定の追加もしない。checkedOn は、原本を取得して文を照合した日。
// - 県のページ、家保の一覧は links に入れ、文を写さない（§2）。農場のある県のページは入れない（索引 Q14）。
// - 受診の案内は写さない（§2）。「安全」「安心」と書かない。獣医師への届出の条文は、受診の案内ではないので引用する。
// - 作品側の文（出典のないもの）は PAGE_NOTES（web の pageNotes.ts）に置く。MCP には渡さない。
import type { IsoDate } from "../types";

export type GuidanceTopic = "approach" | "human_infection" | "food" | "burial" | "dead_bird" | "rumor" | "small_flock";

export interface OfficialGuidance {
  topic: GuidanceTopic;
  heading: string;
  /** 国の機関の文だけ */
  statements: Array<{ text: string; sourceTitle: string; sourceUrl: string; checkedOn: IsoDate }>;
  /** 県のページ、家保の一覧。文を写さない（§2） */
  links?: Array<{ title: string; url: string }>;
}

/** 作者と共同経営者が文面を確認した日。null の間は画面に「文面は確認中です」と出す（Step 6 で人が入れる） */
export const OFFICIAL_GUIDANCE_REVIEWED_ON: IsoDate | null = null;

/** 原本を取得して文を照合した日（日本時間）。docs/official-text-review.md に照合の記録がある */
const CHECKED_ON: IsoDate = "2026-11-04";

const MAFF_KNOW = {
  sourceTitle: "農林水産省「鳥インフルエンザについて知りたい方へ」（令和 7 年 11 月 17 日更新）",
  sourceUrl: "https://www.maff.go.jp/j/syouan/douei/tori/know.html",
} as const;
const MAFF_PRESS = {
  sourceTitle: "農林水産省 報道発表（令和 8 年 4 月 22 日）",
  sourceUrl: "https://www.maff.go.jp/j/press/syouan/douei/260422.html",
} as const;
const MHLW_BASIC = {
  sourceTitle: "厚生労働省「鳥インフルエンザについて」",
  sourceUrl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000144461.html",
} as const;
const MHLW_H5N1 = {
  sourceTitle: "厚生労働省「鳥インフルエンザA（H5N1）について」",
  sourceUrl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000144523.html",
} as const;
const MHLW_QA = {
  sourceTitle: "厚生労働省・国立健康危機管理研究機構「鳥インフルエンザに関するQ&A」（2016 年 12 月 12 日更新）",
  sourceUrl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kekkaku-kansenshou/avian-influenza_qa.html",
} as const;
const MOE_WILD = {
  sourceTitle: "環境省「野鳥との接し方について」",
  sourceUrl: "https://www.env.go.jp/content/900490305.pdf",
} as const;
const MOE_DEAD = {
  sourceTitle: "環境省「死亡した野鳥を見つけたら」",
  sourceUrl: "https://www.env.go.jp/content/900490557.pdf",
} as const;
const MAFF_MANUAL = {
  sourceTitle: "農林水産省「高病原性鳥インフルエンザに関する防疫作業マニュアル（一般動員者・民間事業者用）」（令和 7 年 9 月）",
  sourceUrl: "https://www.maff.go.jp/j/syouan/douei/tori/r7_hpai_maual.pdf",
} as const;
const MAFF_GUIDELINE = {
  sourceTitle: "農林水産省「特定家畜伝染病防疫指針（高病原性鳥インフルエンザ及び低病原性鳥インフルエンザ）」（令和 7 年 10 月 1 日一部変更）",
  sourceUrl: "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_bousi/attach/pdf/index-75.pdf",
} as const;
const ACT = "https://laws.e-gov.go.jp/law/326AC1000000166";
/** 第 13 条の 2、第 24 条の位置を直接指す（e-Gov の条のアンカー。アンカーの先は画面の中の位置で、取得では確かめられない） */
const ACT_ART_13_2 = `${ACT}#Mp-At_13_2`;
const ACT_ART_24 = `${ACT}#Mp-At_24`;
const RULE = "https://laws.e-gov.go.jp/law/326M50010000035";

type Statement = OfficialGuidance["statements"][number];
const st = (text: string, source: { sourceTitle: string; sourceUrl: string }): Statement => ({ text, ...source, checkedOn: CHECKED_ON });

export const OFFICIAL_GUIDANCE: readonly OfficialGuidance[] = [
  {
    topic: "approach",
    heading: "農場に近づかないでください",
    statements: [
      st(
        "鳥インフルエンザが発生した現場を見に行ったりするのはやめましょう。病気の鳥と接触したり、フンを吸い込んだりする機会をみずから作ることになります。さらに、知らず知らずのうちに鳥インフルエンザウイルスを発生現場から他の場所へ持ち運び、感染を広げてしまうおそれもあります。",
        MAFF_KNOW,
      ),
      st(
        "現場での取材は、本病のまん延を引き起こすおそれがあること、農家の方のプライバシーを侵害しかねないことから、厳に慎むよう御協力をお願いいたします。特に、ヘリコプターやドローンを使用しての取材は防疫作業の妨げとなるため、厳に慎むようお願いいたします。",
        MAFF_PRESS,
      ),
    ],
  },
  {
    topic: "human_infection",
    heading: "人への感染",
    statements: [
      st(
        "人におけるほとんどの感染者は、感染した家きんやその排泄物、死体、臓器などに濃厚な接触があります。日本では発症した人は確認されていません。",
        MHLW_BASIC,
      ),
      st(
        "2003 年以降、ヒトでの感染事例が東南アジアを中心に、中東など世界各地で報告されています。ヒトが感染した場合には、重篤な症状となることが多く、多くの患者が直接的又は間接的に家きん等との接触があったことが報告されています。",
        MHLW_H5N1,
      ),
      st("これまでのところ、ヒトからヒトへの持続的な感染は確認されておりません。", MHLW_H5N1),
      st(
        "海外では、人から人へ感染したことが疑われる事例が報告されています。患者の世話をした家族が感染するなど、ある程度の期間、密接に患者と接触したことによる感染と考えられています。",
        MAFF_KNOW,
      ),
      st(
        "日本では、この病気にかかったニワトリの処分や施設等の消毒などを徹底的に行っているので、通常の生活では病気の鳥と接触したり、フンを吸い込んだりするようなことはほとんどありません。そのため、人が鳥インフルエンザにかかる可能性はきわめて低いと考えられます。",
        MAFF_KNOW,
      ),
      st("鳥インフルエンザウイルスは、野鳥観察など通常の接し方では、ヒトに感染しないと考えられています。", MOE_WILD),
    ],
  },
  {
    topic: "food",
    heading: "卵や鶏肉",
    statements: [
      st("我が国ではこれまで、家きん肉や家きん卵を食べて、鳥インフルエンザウイルスに感染した例は報告されていません。", MAFF_KNOW),
      st("これまで、鶏肉や鶏卵を食べることによってヒトに感染したという事例の報告はありません。", MHLW_QA),
      st(
        "国内の家きん飼養農場で高病原性鳥インフルエンザ、低病原性鳥インフルエンザが発生した場合、家畜伝染病予防法に基づき、発生した農場の飼養家きんの殺処分、焼却又は埋却、消毒、移動制限など必要な防疫措置を実施します。このため、発生が確認された農場の家きん、鶏卵などが市場に出回ることはありません。",
        MAFF_KNOW,
      ),
      st(
        "加熱するときは、食品全体が70℃以上になるようにしましょう。家きん肉の場合は、ピンク色の部分がなくなるまで加熱するとよいでしょう。",
        MAFF_KNOW,
      ),
      st(
        "家きん卵は、国内では、生で食べることを考えて生産されていますが、不安な方や体調の悪い方は、加熱（WHOの食中毒防止のための加熱条件：中心部70℃、瞬間）することをおすすめします。",
        MAFF_KNOW,
      ),
      st("家きん肉は十分加熱して食べて下さい。未加熱または加熱不十分なままで食べることは、食中毒を予防する観点からもおすすめできません。", MAFF_KNOW),
    ],
  },
  {
    topic: "burial",
    heading: "埋却と地下水",
    statements: [
      st(
        "患畜又は疑似患畜の死体は、原則として、第５の２により患畜又は疑似患畜であると判定された後、１の（３）の発生農場における措置が完了してから72時間以内に焼却し、又は発生農場若しくはその周辺（人家、水源、河川及び道路に近接しない場所であって、日常、人及び家きんが接近しない場所に限る。）において埋却し、又は化製処理を行う。",
        MAFF_GUIDELINE,
      ),
      st("河川、湖、池等に近い場所は避けます。", MAFF_MANUAL),
      st("井戸（飲用水取水池を含む）に近い場所や飲用水源の上流域、さらに、地下水位が高い場所や地下に暗渠が通っている場所は避けます。", MAFF_MANUAL),
      st(
        "埋却地の選定時、埋却に適した土地であるかを最終的に確認するために試掘します。特に、地下水位（掘って地下水が出ないか）や土質（重機で掘削できるか）を確認しておくことが大切です。",
        MAFF_MANUAL,
      ),
      st(
        "掘削完了後、埋却溝の底面と法面（斜面）に消石灰を散布します（散布する量の目安は１kg/m２）。なお、地下水の汚染防止や周辺住民の要望に応じるため、掘削面全面にブルーシートを敷く場合は、ブルーシートが埋却溝に落下しないように杭で固定した上で、消石灰を再度散布します。",
        MAFF_MANUAL,
      ),
      st(
        "第二十一条第一項若しくは第四項又は前条第一項若しくは第三項の規定により家畜の死体又は家畜伝染病の病原体により汚染し、若しくは汚染したおそれがある物品を埋却した土地は、農林水産省令で定める期間内は、掘つてはならない。",
        { sourceTitle: "家畜伝染病予防法 第 24 条（発掘の禁止）", sourceUrl: ACT_ART_24 },
      ),
      st("埋却完了後、病名（高病原性鳥インフルエンザ）、家畜の種類、埋却年月日、発掘禁止期間（３年）を記載した立て看板を設置します。", MAFF_MANUAL),
    ],
    links: [
      { title: "福島県の環境調査の公表（2025 年 12 月 24 日更新）", url: "https://www.pref.fukushima.lg.jp/sec/16035c/2022toriinflu-2.html" },
      { title: "新潟県の環境調査の公表（2023 年 4 月 14 日更新）", url: "https://www.pref.niigata.lg.jp/sec/kankyotaisaku/230314-chousa.html" },
    ],
  },
  {
    topic: "dead_bird",
    heading: "死んだ鳥を見つけたら",
    statements: [
      st("死亡した野鳥は素手で触らないで下さい。野生の鳥は、体内や羽毛などに細菌や寄生虫などの病原体があることがあります。", MOE_DEAD),
      st(
        "野鳥が死んでいるのを見つけたときは、こうしたウイルスや細菌、寄生虫に感染しないよう、死んだ鳥を素手で触らないようにしましょう。死んだ鳥の処分の仕方については、お近くの都道府県や市町村役場にご相談下さい。",
        MAFF_KNOW,
      ),
      st("死亡した野鳥など野生動物の死亡個体を片付ける際には、素手で直接触らず、使い捨て手袋等を使用してください。", MOE_WILD),
      st("同じ場所でたくさんの野鳥などが死亡している場合には、お近くの都道府県や市町村役場にご連絡ください。", MOE_WILD),
      st(
        "野生の鳥は、餌が採れずに衰弱したり、環境の変化に耐えられず死んでしまうこともあります。野鳥が死んでいても、鳥インフルエンザを直ちに疑う必要はありません。",
        MOE_DEAD,
      ),
    ],
  },
  {
    topic: "rumor",
    heading: "噂に注意",
    statements: [
      st("生産者等の関係者や消費者は根拠のない噂などにより混乱することがないよう、御協力をお願いいたします。", MAFF_PRESS),
      st("発生農場に関する情報を公表する場合には、当該農場の所在地までに留め、当該農場の名称等の公表は、差し控える。", MAFF_GUIDELINE),
    ],
    links: [
      { title: "岐阜県「県民の皆様へ」（平成 29 年 1 月 14 日）", url: "https://www.pref.gifu.lg.jp/uploaded/attachment/100376.pdf" },
      { title: "栃木県知事メッセージ（令和 3 年 3 月 13 日）", url: "https://www.pref.tochigi.lg.jp/g06/hpai/2023hpai/documents/10_tizimessage.pdf" },
      { title: "埼玉県の報道発表（令和 6 年 11 月 25 日）", url: "https://www.pref.saitama.lg.jp/documents/261590/news20241125satu.pdf" },
    ],
  },
  {
    topic: "small_flock",
    heading: "数羽飼っている方へ",
    statements: [
      st("ニワトリ等の家きんを飼養されている方は、家畜伝染病予防法で定めている飼養衛生管理基準の遵守が義務づけられています。", MAFF_KNOW),
      st("飼養する家きんが特定症状を呈していることを発見したときは、直ちに家畜保健衛生所に通報すること。", {
        sourceTitle: "家畜伝染病予防法施行規則 別表第二 三（鶏、あひる等の飼養衛生管理基準）32",
        sourceUrl: RULE,
      }),
      st(
        "家畜が農林水産大臣が家畜の種類ごとに指定する症状を呈していることを発見したときは、当該家畜を診断し、又はその死体を検案した獣医師（獣医師による診断又は検案を受けていない家畜又はその死体については、その所有者）は、農林水産省令で定める手続に従い、遅滞なく、当該家畜又はその死体の所在地を管轄する都道府県知事にその旨を届け出なければならない。",
        { sourceTitle: "家畜伝染病予防法 第 13 条の 2（農林水産大臣の指定する症状を呈している家畜の届出義務）", sourceUrl: ACT_ART_13_2 },
      ),
      st("鳥が死んだからといって直ちに鳥インフルエンザを疑う必要はありません。", MAFF_KNOW),
      st(
        "原因がわからないまま、鳥が連続して死んでしまったという場合には、その鳥に素手で触ったり、土に埋めたりせずに、なるべく早く獣医師やお近くの都道府県、市町村役場にご相談下さい。",
        MAFF_KNOW,
      ),
      st(
        "鳥インフルエンザウイルスを運んでくる可能性がある野鳥が近くに来ないようにしましょう。鳥を飼っている場所はこまめに掃除し、フンはすぐ片付けましょう。エサや水はこまめに取り替えましょう。鳥の体やフンに触れた後は、手洗いとうがいをしましょう。口移しでエサをあげたりするのはやめましょう。",
        MAFF_KNOW,
      ),
    ],
    links: [
      { title: "農林水産省「家畜保健衛生所について」（全国の所在地の一覧）", url: "https://www.maff.go.jp/j/syouan/douei/katiku_yobo/k_kaho/" },
    ],
  },
];
