import { describe, expect, it } from "vitest";
import { classifyMaffTitle, filterMaffItems, filterMaffUnclassified, isMaffOutbreakTitle, parseMaffFarm, parseMaffLift, parseMaffPress } from "../src/read/maff";

describe("isMaffOutbreakTitle", () => {
  it("疑似患畜の確認の題は confirmed（国内N例目があってもなくても）", () => {
    expect(
      isMaffOutbreakTitle("岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について"),
    ).toBe("confirmed");
    expect(isMaffOutbreakTitle("北海道における高病原性鳥インフルエンザの疑似患畜の確認及び「農林水産省鳥インフルエンザ防疫対策本部」の開催について")).toBe("confirmed");
  });
  it("全角と半角の空白、記号の違いがあっても同じに判定する", () => {
    expect(isMaffOutbreakTitle("北海道における高病原性鳥インフルエンザの疑似患畜の確認 （国内１例目）及び対策本部の開催について")).toBe("confirmed");
  });
  it("移動制限の解除の題は movement_lifted", () => {
    expect(isMaffOutbreakTitle("岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目）に係る移動制限の解除について")).toBe("movement_lifted");
    expect(isMaffOutbreakTitle("新潟県胎内市で発生した高病原性鳥インフルエンザ（国内3例目、4例目）に係る移動制限の解除について")).toBe("movement_lifted");
  });
  it("遺伝子解析と NA 亜型の確定、野鳥、学校の臨時休業、輸入停止、輸出再開は null", () => {
    expect(isMaffOutbreakTitle("北海道で確認された高病原性鳥インフルエンザの疑似患畜（国内1例目）の遺伝子解析及びNA亜型の確定について")).toBeNull();
    expect(isMaffOutbreakTitle("北海道における野鳥の高病原性鳥インフルエンザウイルスの検出事例について")).toBeNull();
    expect(isMaffOutbreakTitle("インフルエンザ様疾患による学校の臨時休業について（第23報）")).toBeNull();
    expect(isMaffOutbreakTitle("ブラジルからの生きた家きん、家きん肉等の輸入一時停止措置の解除について")).toBeNull();
    expect(isMaffOutbreakTitle("香港向け家きん由来製品の輸出再開について（北海道）")).toBeNull();
  });
  it("高病原性鳥インフルエンザの語がない題は、確認や解除の語があっても null", () => {
    expect(isMaffOutbreakTitle("口蹄疫の疑似患畜の確認について")).toBeNull();
    expect(isMaffOutbreakTitle("豚熱に係る移動制限の解除について")).toBeNull();
  });
  it("患畜の判定の続報は confirmed にしない（疑似患畜の確認の文書だけが confirmed）", () => {
    expect(isMaffOutbreakTitle("岡山県における高病原性鳥インフルエンザの患畜の判定について")).toBeNull();
    expect(isMaffOutbreakTitle("岡山県で発生した高病原性鳥インフルエンザ（国内8例目）の患畜の判定について")).toBeNull();
  });
  it("確認と解除の両方の語があれば解除を優先せず null にする（読み違えより見送る）", () => {
    expect(isMaffOutbreakTitle("高病原性鳥インフルエンザの疑似患畜の確認及び移動制限の解除について")).toBeNull();
  });
});

describe("filterMaffItems", () => {
  const base = "https://www.maff.go.jp/j/press/syouan/douei/";
  it("確認と解除の題だけを、url と type つきで返す", () => {
    const items = filterMaffItems([
      { href: `${base}251220.html`, text: "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について" },
      { href: `${base}251224_1.html`, text: "岡山県で確認された高病原性鳥インフルエンザの疑似患畜（国内8例目）の遺伝子解析及びNA亜型の確定について" },
      { href: `${base}260121_1.html`, text: "岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目）に係る移動制限の解除について" },
      { href: "https://www.maff.go.jp/j/press/shokuhin/wasyoku/251031.html", text: "和食月間について" },
    ]);
    expect(items).toEqual([
      { url: `${base}251220.html`, title: "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について", type: "confirmed" },
      { url: `${base}260121_1.html`, title: "岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目）に係る移動制限の解除について", type: "movement_lifted" },
    ]);
  });
  it("農林水産省の報道発表の外のホストや http は取らない", () => {
    const title = "北海道における高病原性鳥インフルエンザの疑似患畜の確認について";
    expect(filterMaffItems([{ href: "https://evil.example.com/j/press/syouan/douei/1.html", text: title }])).toEqual([]);
    expect(filterMaffItems([{ href: "http://www.maff.go.jp/j/press/syouan/douei/1.html", text: title }])).toEqual([]);
    expect(filterMaffItems([{ href: "https://www.maff.go.jp/j/syouan/douei/tori/attach/pdf/x.pdf", text: title }])).toEqual([]);
  });
  it("同じ url は 1 度だけ", () => {
    const title = "北海道における高病原性鳥インフルエンザの疑似患畜の確認について";
    const link = { href: `${base}251022.html`, text: title };
    expect(filterMaffItems([link, link, { ...link, href: `${base}251022.html#top` }])).toHaveLength(1);
  });
});

// ── 本文（国の定型。農林水産省のページの本文を取り出した形に似せた作り物） ──

function pressBody(o: { date?: string; lead?: string; place?: string | null; farm?: string; tail?: string; extra?: string } = {}): string {
  return [
    "プレスリリース",
    "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について",
    "Tweet",
    "印刷",
    o.date ?? "令和7年12月20日",
    "農林水産省",
    o.lead ?? "本日、岡山県津山市の家きん農場において、家畜伝染病である高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内8例目）されました。",
    "これを受け、農林水産省は、「農林水産省鳥インフルエンザ防疫対策本部」を開催し、今後の対応方針について確認します。",
    "1.農場の概要",
    ...(o.place === null ? [] : [`所在地：${o.place ?? "岡山県津山市"}`]),
    `飼養状況：${o.farm ?? "約43万羽（採卵鶏）"}`,
    o.extra ?? "",
    "2.経緯",
    "（1）令和7年12月19日（金曜日）、岡山県は、同県津山市の農場から、通報を受けて、農場への立入検査を実施しました。",
    "（3）12月20日（土曜日）、当該農場の家きんについて遺伝子検査を実施した結果、高病原性鳥インフルエンザの疑似患畜であることを確認しました。",
    "お問合せ先",
    o.tail ?? "消費・安全局動物衛生課",
  ].join("\n");
}

describe("parseMaffPress", () => {
  it("津山: 県、市町村、N、日付を取り出す", () => {
    expect(parseMaffPress(pressBody())).toEqual({ prefCode: "33", muniName: "津山市", nationalNo: 8, date: "2025-12-20" });
  });
  it("冒頭文に市町村がなくても、所在地から取る（白老町）。Nは疑似患畜の後ろに付く語順でもよい", () => {
    const body = pressBody({
      date: "令和7年10月22日",
      lead: "本日、北海道の家きん農場において、高病原性鳥インフルエンザの疑似患畜（今シーズン国内1例目）が確認されました。",
      place: "北海道白老町",
      farm: "約45.9万羽（採卵鶏）",
    });
    expect(parseMaffPress(body)).toEqual({ prefCode: "01", muniName: "白老町", nationalNo: 1, date: "2025-10-22" });
  });
  it("日付は見出しの日付。経緯の中の前日の日付ではない（米子: 経緯は12/1、発表は12/2）", () => {
    const body = pressBody({ date: "令和7年12月2日", lead: "本日、鳥取県米子市の家きん農場において、家畜伝染病である高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内6例目）されました。", place: "鳥取県米子市" });
    expect(parseMaffPress(body)?.date).toBe("2025-12-02");
  });
  it("問合せ先などの二つ目の所在地（省の住所）は使わない", () => {
    const body = pressBody({ tail: "所在地：東京都千代田区霞が関1-2-1" });
    expect(parseMaffPress(body)?.muniName).toBe("津山市");
  });
  it("全角の数字と西暦の見出しも読む", () => {
    expect(parseMaffPress(pressBody({ date: "２０２５年１２月２０日", lead: "本日、岡山県津山市の家きん農場において、高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内８例目）されました。" }))).toEqual({
      prefCode: "33",
      muniName: "津山市",
      nationalNo: 8,
      date: "2025-12-20",
    });
  });
  it("金ケ崎町と金ヶ崎町は同じ名前に揃えて返す", () => {
    const body = pressBody({ lead: "本日、岩手県金ヶ崎町の家きん農場において、高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内20例目）されました。", place: "岩手県金ヶ崎町" });
    expect(parseMaffPress(body)).toMatchObject({ prefCode: "03", muniName: "金ケ崎町", nationalNo: 20 });
  });
  it("郡の名前は外す", () => {
    const body = pressBody({ lead: "本日、北海道の家きん農場において、高病原性鳥インフルエンザの疑似患畜が確認（今シーズン国内1例目）されました。", place: "北海道白老郡白老町" });
    expect(parseMaffPress(body)?.muniName).toBe("白老町");
  });
  it("定型が崩れていれば null（所在地なし、N なし、日付なし、実在しない日付、県の食い違い、市町村の食い違い）", () => {
    expect(parseMaffPress(pressBody({ place: null }))).toBeNull();
    expect(parseMaffPress(pressBody({ lead: "本日、岡山県津山市の家きん農場において、高病原性鳥インフルエンザの疑似患畜が確認されました。" }))).toBeNull();
    expect(parseMaffPress(pressBody({ date: "" }))).toBeNull();
    expect(parseMaffPress(pressBody({ date: "令和7年2月30日" }))).toBeNull();
    expect(parseMaffPress(pressBody({ place: "鳥取県米子市" }))).toBeNull();
    expect(parseMaffPress(pressBody({ place: "岡山県倉敷市" }))).toBeNull();
    expect(parseMaffPress(pressBody({ place: "岡山県" }))).toBeNull();
    expect(parseMaffPress("")).toBeNull();
    expect(parseMaffPress("本日、天気がよいです。")).toBeNull();
  });
});

describe("parseMaffFarm", () => {
  const farm = (f: string, extra = "") => parseMaffFarm(pressBody({ farm: f, extra }));
  it("万羽と羽、採卵鶏などの用途", () => {
    expect(farm("約43万羽（採卵鶏）")).toEqual({ headCount: 430000, birdUse: "採卵鶏" });
    expect(farm("約0.6万羽（採卵鶏）")).toEqual({ headCount: 6000, birdUse: "採卵鶏" });
    expect(farm("約45.9万羽（採卵鶏）")).toEqual({ headCount: 459000, birdUse: "採卵鶏" });
    expect(farm("約10.8万羽（うずら）")).toEqual({ headCount: 108000, birdUse: "うずら" });
  });
  it("カンマ入りの羽数と、かっこの入れ子（あひる（あいがも））", () => {
    expect(farm("約9,000羽（あひる（あいがも））")).toEqual({ headCount: 9000, birdUse: "あひる(あいがも)" });
  });
  it("関連農場の行の羽数と用途を混ぜない", () => {
    expect(farm("約6万羽（採卵鶏）", "関連農場：千葉県旭市（1農場、約2万羽（採卵鶏））")).toEqual({ headCount: 60000, birdUse: "採卵鶏" });
  });
  it("用途がなければ羽数だけ、飼養状況がなければどちらも null", () => {
    expect(farm("約43万羽")).toEqual({ headCount: 430000, birdUse: null });
    expect(parseMaffFarm("本日、岡山県津山市の家きん農場において")).toEqual({ headCount: null, birdUse: null });
    expect(farm("調査中")).toEqual({ headCount: null, birdUse: null });
  });
});

function liftBody(o: {
  date?: string;
  lead?: string;
  section?: string;
  ref?: string;
} = {}): string {
  return [
    "プレスリリース",
    "岡山県津山市で発生した高病原性鳥インフルエンザ（国内8例目）に係る移動制限の解除について",
    "Tweet",
    "印刷",
    o.date ?? "令和8年1月21日",
    "農林水産省",
    o.lead ??
      "岡山県は、津山市で確認された高病原性鳥インフルエンザ（今シーズン国内8例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年1月21日（水曜日）午前0時（1月20日（火曜日）24時）をもって、当該移動制限を解除しました。",
    "1.経緯及び今後の予定",
    o.section ??
      [
        "（1）岡山県は、令和7年12月20日に津山市の家きん農場において高病原性鳥インフルエンザ（今シーズン国内8例目）が発生したことを受け、家畜伝染病予防法に基づき、移動制限区域及び搬出制限区域を設定しました。",
        "（2）岡山県は、令和8年1月10日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。",
        "（3）今般、岡山県は、国内8例目の防疫措置が完了した令和7年12月30日の翌日から起算して21日が経過する令和8年1月21日（水曜日）午前0時（1月20日（火曜日）24時）をもって、移動制限を解除しました。",
      ].join("\n"),
    "2.その他",
    "3.参考",
    o.ref ?? "岡山県における高病原性鳥インフルエンザの疑似患畜の確認（国内8例目）及び「農林水産省鳥インフルエンザ防疫対策本部」の持ち回り開催について",
    "お問合せ先",
  ].join("\n");
}

describe("parseMaffLift", () => {
  it("津山: 1 例だけの解除は、完了日と搬出制限の解除日も取る", () => {
    expect(parseMaffLift(liftBody())).toEqual({
      prefCode: "33",
      muniName: "津山市",
      nationalNos: [8],
      date: "2026-01-21",
      controlDone: "2025-12-30",
      shipmentLifted: "2026-01-10",
    });
  });
  it("3 例目、4 例目と 18、19 例目の書き方", () => {
    const three = parseMaffLift(
      liftBody({
        lead: "新潟県は、胎内市で確認された高病原性鳥インフルエンザ（今シーズン国内3例目、4例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和7年12月10日（水曜日）午前0時（12月9日（火曜日）24時）をもって、当該移動制限を解除しました。",
        section: "（1）新潟県は、令和7年11月4日および令和7年11月9日に胎内市の家きん農場において高病原性鳥インフルエンザ（今シーズン国内3例目、4例目）が発生したことを受け、設定しました。\n（2）新潟県は、令和7年11月30日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。",
        date: "令和7年12月10日",
        ref: "",
      }),
    );
    expect(three).toEqual({ prefCode: "15", muniName: "胎内市", nationalNos: [3, 4], date: "2025-12-10", controlDone: null, shipmentLifted: null });
    const chiba = parseMaffLift(
      liftBody({
        lead: "千葉県は、旭市で確認された高病原性鳥インフルエンザ（今シーズン国内18、19例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年3月18日（水曜日）0時（3月17日（火曜日）24時）をもって、当該移動制限を解除しました。",
        section: "（1）千葉県は、下記のとおり県内の家きん農場において高病原性鳥インフルエンザが発生したことを受け、設定しました。\n<国内18例目> 令和8年1月27日（火曜日）:旭市\n<国内19例目> 令和8年2月20日（金曜日）:旭市",
        date: "令和8年3月18日",
        ref: "",
      }),
    );
    expect(chiba).toEqual({ prefCode: "12", muniName: "旭市", nationalNos: [18, 19], date: "2026-03-18", controlDone: null, shipmentLifted: null });
  });
  it("日付は見出しの日付ではなく、移動制限を解除した日（白老: 見出し 11/25、解除 11/24）", () => {
    const body = liftBody({
      date: "令和7年11月25日",
      lead: "北海道は、白老町で確認された高病原性鳥インフルエンザ（今シーズン国内1例目）に関し、発生農場から半径3km以内で設定している移動制限区域について、令和7年11月24日（月曜日）午前0時（11月23日（日曜日）24時）をもって、当該移動制限を解除しました。",
      section: "（1）北海道は、令和7年10月22日に白老町の家きん農場において高病原性鳥インフルエンザ（今シーズン国内1例目）が発生したことを受け、設定しました。\n（2）北海道は、令和7年11月14日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。\n（3）今般、北海道は、国内1例目の防疫措置が完了した令和7年11月2日の翌日から起算して21日が経過する令和7年11月24日（月曜日）午前0時をもって、移動制限を解除しました。",
      ref: "",
    });
    expect(parseMaffLift(body)).toMatchObject({ prefCode: "01", muniName: "白老町", nationalNos: [1], date: "2025-11-24", controlDone: "2025-11-02", shipmentLifted: "2025-11-14" });
  });
  it("参考の節に書かれた確認の題の N（国内8例目）は数えない", () => {
    expect(parseMaffLift(liftBody())?.nationalNos).toEqual([8]);
    expect(parseMaffLift(liftBody({ ref: "岡山県で確認された高病原性鳥インフルエンザの疑似患畜（国内7例目）の遺伝子解析について" }))?.nationalNos).toEqual([8]);
  });
  it("午前9時の解除（時刻だけの書き方）も日付を取る", () => {
    const body = liftBody({
      lead: "京都府は、亀岡市で確認された高病原性鳥インフルエンザ（今シーズン国内9例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年1月21日（水曜日）午前9時をもって、当該移動制限を解除しました。",
    });
    expect(parseMaffLift(body)).toMatchObject({ prefCode: "26", muniName: "亀岡市", nationalNos: [9], date: "2026-01-21" });
  });
  it("原本の年の書き間違い（防疫措置の完了が令和7年1月5日）は、発生より前の日付なので null にして直さない", () => {
    const body = liftBody({
      lead: "埼玉県は、嵐山町で確認された高病原性鳥インフルエンザ（今シーズン国内12例目）に関し、発生農場から半径3km以内で設定されていた移動制限区域について、令和8年1月27日（火曜日）0時（1月26日（月曜日）24時）をもって、当該移動制限を解除しました。",
      section: "（1）埼玉県は、令和7年12月30日に嵐山町の家きん農場において高病原性鳥インフルエンザ（今シーズン国内12例目）が発生したことを受け、設定しました。\n（2）埼玉県は、令和8年1月17日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。\n（3）今般、埼玉県は、国内12例目の防疫措置が完了した令和7年1月5日の翌日から起算して21日が経過する令和8年1月27日（火曜日）0時（1月26日（月曜日）24時）をもって、移動制限を解除しました。",
      ref: "",
    });
    expect(parseMaffLift(body)).toMatchObject({ muniName: "嵐山町", date: "2026-01-27", controlDone: null, shipmentLifted: "2026-01-17" });
  });
  it("搬出制限の解除日が解除日より後なら null", () => {
    const body = liftBody({
      section: "（1）岡山県は、令和7年12月20日に津山市の家きん農場において発生したことを受け、設定しました。\n（2）岡山県は、令和8年2月10日に発生農場の半径3kmから10km以内の区域について設定していた搬出制限を解除しました。",
    });
    expect(parseMaffLift(body)?.shipmentLifted).toBeNull();
  });
  it("定型が崩れていれば null（県、市町村、N、解除の日付がない）", () => {
    expect(parseMaffLift("")).toBeNull();
    expect(parseMaffLift(liftBody({ lead: "岡山県は、津山市で確認された高病原性鳥インフルエンザに関し、令和8年1月21日をもって、当該移動制限を解除しました。" }))).toBeNull();
    expect(parseMaffLift(liftBody({ lead: "津山市で確認された高病原性鳥インフルエンザ（今シーズン国内8例目）に関し、令和8年1月21日をもって、当該移動制限を解除しました。" }))).toBeNull();
    expect(parseMaffLift(liftBody({ lead: "岡山県は、津山市で確認された高病原性鳥インフルエンザ（今シーズン国内8例目）に関し、当該移動制限を解除しました。" }))).toBeNull();
  });
});

describe("classifyMaffTitle: 確認にも解除にも当たらない HPAI の題を黙って捨てない（I-01 レビュー Important 4）", () => {
  it("確認と解除の語が両方ある題は unclassified（読み違えを避けて人に回す）", () => {
    expect(classifyMaffTitle("岡山県における高病原性鳥インフルエンザの疑似患畜の確認及び津山市の移動制限の解除について")).toBe("unclassified");
  });
  it("疑似患畜、移動制限、区域の語があるのに確認にも解除にも当たらない題は unclassified", () => {
    expect(classifyMaffTitle("岡山県で発生した高病原性鳥インフルエンザの疑似患畜に係る移動制限区域の変更について")).toBe("unclassified");
    expect(classifyMaffTitle("北海道における高病原性鳥インフルエンザの疑似患畜の判定について")).toBe("unclassified");
  });
  it("確認と解除はこれまでどおり、除外語と無関係な題は null", () => {
    expect(classifyMaffTitle("岡山県における高病原性鳥インフルエンザの疑似患畜の確認について")).toBe("confirmed");
    expect(classifyMaffTitle("岡山県津山市で発生した高病原性鳥インフルエンザに係る移動制限の解除について")).toBe("movement_lifted");
    expect(classifyMaffTitle("北海道で確認された高病原性鳥インフルエンザの疑似患畜の遺伝子解析及びNA亜型の確定について")).toBeNull();
    expect(classifyMaffTitle("北海道における野鳥の高病原性鳥インフルエンザの疑似患畜の検出について")).toBeNull();
    expect(classifyMaffTitle("ブラジルからの家きん肉等の輸入一時停止措置の解除について")).toBeNull();
    expect(classifyMaffTitle("高病原性鳥インフルエンザに関するQ&Aを更新しました")).toBeNull();
    expect(classifyMaffTitle("口蹄疫の疑似患畜の確認と移動制限の解除について")).toBeNull();
  });
  it("isMaffOutbreakTitle は unclassified を null のままにする（既存の分類は変えない）", () => {
    expect(isMaffOutbreakTitle("岡山県における高病原性鳥インフルエンザの疑似患畜の確認及び津山市の移動制限の解除について")).toBeNull();
  });
  it("filterMaffUnclassified は農林水産省の報道発表の url だけを、同じ url は 1 度だけ返す", () => {
    const t = "岡山県における高病原性鳥インフルエンザの疑似患畜の確認及び津山市の移動制限の解除について";
    const links = [
      { href: "https://www.maff.go.jp/j/press/syouan/douei/251220.html", text: t },
      { href: "https://www.maff.go.jp/j/press/syouan/douei/251220.html#top", text: t },
      { href: "https://example.jp/j/press/x.html", text: t },
      { href: "https://www.maff.go.jp/j/press/syouan/douei/251221.html", text: "岡山県における高病原性鳥インフルエンザの疑似患畜の確認について" },
    ];
    expect(filterMaffUnclassified(links)).toEqual([{ url: "https://www.maff.go.jp/j/press/syouan/douei/251220.html", title: t }]);
  });
});
