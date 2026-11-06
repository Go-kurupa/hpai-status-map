// 対策の相談の話題。画面の話題のボタンと、関数 consultAsk の topicId が使う。
// 話題を押すと、question の文がそのまま聞く文になる（Claude に渡るのもこの文）。
// question は短く、禁句（wording.ts）と範囲外の語（scope.ts）を含めない。

export interface ConsultTopic {
  /** 英小文字とハイフン */
  id: string;
  /** ボタンの文字 */
  label: string;
  /** 押すと決まる聞く文 */
  question: string;
}

export const CONSULT_TOPICS: readonly ConsultTopic[] = [
  { id: "boots-clothes", label: "長靴・服", question: "長靴と服の履き替え・消毒で、まず見直すとよいことは？" },
  { id: "net-house", label: "防鳥ネット・鶏舎の破れ", question: "防鳥ネットや鶏舎の破れの点検で、まず見直すとよいことは？" },
  { id: "pests", label: "ネズミ・ネコ・ハエ", question: "ネズミ・ネコ・ハエを入れない工夫で、まず見直すとよいことは？" },
  { id: "water-birds", label: "水辺と野鳥", question: "水辺や野鳥を鶏舎に近づけない工夫で、まず見直すとよいことは？" },
  { id: "visitors-vehicles", label: "人と車の出入り", question: "人や車の出入りの管理で、まず見直すとよいことは？" },
  { id: "dead-birds-compost", label: "死んだ鶏・堆肥", question: "死んだ鶏や堆肥の扱いで、まず見直すとよいことは？" },
  { id: "daily-check", label: "毎日の観察と家保", question: "毎日の観察と家畜保健衛生所への連絡で、まず見直すとよいことは？" },
];

/** id から話題を引く。自前の id だけ（"__proto__" や "toString" は見つからない）。 */
export function findTopic(id: string): ConsultTopic | undefined {
  return CONSULT_TOPICS.find((t) => t.id === id);
}
