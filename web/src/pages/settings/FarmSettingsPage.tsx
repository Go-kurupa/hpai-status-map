import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { Farm } from "@hpai/shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useRecordStore } from "../../data/context";
import { useOptionalSpotState } from "../../data/spotContext";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { Button } from "../../ui/Button";
import { createFarmInviteCall } from "../auth/callables";
import { MultipleFarmsError } from "../auth/firestoreRecordStore";
import { RequireMember } from "../auth/RequireMember";
import { Fold } from "../../ui/Fold";
import { StatRow, StatTile, type StatValue } from "../../ui/StatRow";
import { RECORD_TEXT } from "../record/recordTexts";
import { DeleteFarmForm } from "./DeleteFarmForm";
import { savedAtLabel } from "./farmForm";
import { FarmBasicsForm, KahoContactForm } from "./FarmProfileForm";
import { HouseList, type HouseSummary } from "./HouseList";
import { MeshPicker, type FarmPick } from "./MeshPicker";
import { TEXT } from "../map/texts";
import { MuniMultiPicker } from "./MuniMultiPicker";
import { SettingsTabs } from "./SettingsTabs";
import "./settings.css";

type Saved = Farm & { id: string };
type Load = { state: "loading" } | { state: "error"; message: string | null } | { state: "ok"; farm: Saved | null };
/** メールの配信を止めているか。確かめられなければ unknown（札を出さない） */
type Mail = "loading" | "on" | "stopped" | "unknown";

/**
 * 次にすること（1 行）。農場がない（会員になった直後）→ 鶏舎が 0 件 → 鶏舎が 1 件以上の 3 段階。
 * 鶏舎の件数が分からない間（読み込み中、読めなかった）は出さない（ないと思って重ねて登録しないため）。
 */
function NextStep({ farm, houses }: { farm: Saved | null; houses: HouseSummary }) {
  let text: string;
  let link: { to: string; label: string } | null = null;
  if (!farm) {
    text = "まず農場の地点を決めます。住所は聞きません。";
  } else if (houses.status !== "ok") {
    return null;
  } else if (houses.count === 0) {
    text = "次は鶏舎の登録です。死亡数は鶏舎ごとに記録します。";
    link = { to: "/settings/farm#houses", label: RECORD_TEXT.addHouseLink };
  } else {
    text = "登録はそろっています。";
    link = { to: "/record/deaths", label: "死亡数を記録する" };
  }
  return (
    <p className="settings-next">
      <strong>次にすること:</strong> <span>{text}</span>
      {link ? (
        <>
          {" "}
          <Link to={link.to} className="tap-link">
            {link.label}
          </Link>
        </>
      ) : null}
    </p>
  );
}

const ok = (value: string, unit?: string): StatValue => ({ status: "ok", value, unit });

/** 登録の状況の札。値は保存済みの農場（入力途中の値ではない）。押すとその節へ移る */
function RegisterStatus({
  farm,
  pointName,
  houses,
  mail,
}: {
  farm: Saved | null;
  /** 登録した地点の市町村名の札の値。町の一覧を読む前は loading、読めなかったら failed（市町村コードは出さない） */
  pointName: StatValue;
  houses: HouseSummary;
  mail: Mail;
}) {
  const houseValue: StatValue = !farm
    ? ok("0", "件")
    : houses.status === "ok"
      ? ok(String(houses.count), "件")
      : { status: houses.status };
  const houseZero = !farm || (houses.status === "ok" && houses.count === 0);
  return (
    <StatRow label="登録の状況">
      <StatTile
        label="地点"
        value={farm ? pointName : ok("未登録")}
        tone={farm ? "normal" : "alert"}
        href="#point"
      />
      {/* 札の幅は 4 文字ほど。農場名は短くても折れるので、値は「登録済み／未登録」（家保の札とそろえる）にし、名前は下の小さな行に出す */}
      <StatTile
        label="農場名"
        value={ok(farm && farm.name !== "" ? "登録済み" : "未登録")}
        note={farm && farm.name !== "" ? farm.name : undefined}
        href={farm ? "#farm-info" : undefined}
      />
      <StatTile
        label="鶏舎"
        value={houseValue}
        note={houses.status === "ok" && houses.total > 0 ? `合計 ${houses.total.toLocaleString("ja-JP")} 羽` : undefined}
        tone={houseZero ? "alert" : "normal"}
        href={farm ? "#houses" : undefined}
      />
      <StatTile
        label="家保の連絡先"
        value={ok(farm && farm.kahoContact.trim() !== "" ? "登録済み" : "未登録")}
        href={farm ? "#kaho" : undefined}
      />
      {farm && mail !== "unknown" ? (
        <StatTile
          label="通知"
          value={mail === "loading" ? { status: "loading" } : ok(mail === "stopped" ? "止めています" : "届きます")}
          note={
            mail === "stopped" ? (
              <Link to="/settings/notify">再開する</Link>
            ) : undefined
          }
        />
      ) : null}
    </StatRow>
  );
}

/**
 * 農場の設定（2026-11-07 業務画面の作り直し）。題と 1 文 → 切り替え → 登録の状況の札 → 次にすること（と最終保存）→ 各節。
 * 節の順（農場があるとき）は札の順にそろえる: 農場の地点（登録後は 1 行と「地点を変える」）、農場の情報、鶏舎、家保の連絡先、
 * 行き来する町、会員を追加する、関連の画面へのリンク、全データの削除（畳む。summary が節の見出しの役）。
 * 農場がない間（地点を保存する前）は地点の欄だけを一番上に開いて出す。ほかの欄は農場がないと保存できない（ルールが meshCode を要る）。
 */
function FarmSettings() {
  const store = useRecordStore();
  // 発生状況の画面と同じ地点の置き場（根の Provider）。保存したら読み直させ、端末の場所は引き継ぎに使う
  const spotState = useOptionalSpotState();
  const deviceSpot = spotState?.deviceSpot ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [geo, setGeo] = useState<GeoStore | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [prefCode, setPrefCode] = useState("");
  const [muniCode, setMuniCode] = useState("");
  const [pick, setPick] = useState<FarmPick | null>(null);
  const [mapless, setMapless] = useState(false); // 地図が描けない端末（MeshPicker が代わりのボタンを出す）
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // 登録済みの地点を変える欄（市町村の選択と地図）を開いているか。農場がない間は常に開いている
  const [pointOpen, setPointOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  // 鶏舎の件数と合計（札と次にすることに使う）。HouseList が読んだものを受け取る
  const [houses, setHouses] = useState<HouseSummary>({ status: "loading" });
  const [mail, setMail] = useState<Mail>("loading");
  const location = useLocation();
  const housesRef = useRef<HTMLElement>(null);
  const housesHeadingRef = useRef<HTMLHeadingElement>(null);
  const deleteRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    store.getFarm().then(
      (farm) => {
        if (cancelled) return;
        setLoad({ state: "ok", farm });
        if (farm) {
          setPrefCode(farm.prefCode);
          setMuniCode(farm.muniCode);
        }
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: e instanceof MultipleFarmsError ? e.message : null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    loadWebGeoStore().then(
      (g) => {
        if (!cancelled) setGeo(g);
      },
      () => {
        if (!cancelled) setGeoFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 通知の札。農場があるときだけ確かめる。確かめられなければ札を出さない（止めているとも届くとも言わない）
  const farmId = load.state === "ok" && load.farm ? load.farm.id : null;
  useEffect(() => {
    if (farmId === null) return;
    let off = false;
    setMail("loading");
    Promise.resolve()
      .then(() => store.isMailStopped())
      .then(
        (stopped) => {
          if (!off) setMail(stopped ? "stopped" : "on");
        },
        () => {
          if (!off) setMail("unknown");
        },
      );
    return () => {
      off = true;
    };
  }, [store, farmId]);

  // 農場がなく、発生状況の画面で場所を決めていれば、県と市町村をその町にして開く（地図もその町に寄る）
  const farmMissing = load.state === "ok" && load.farm === null;
  const deviceMuni = deviceSpot && geo ? (geo.index[deviceSpot.muniCode] ?? null) : null;
  // 入れるのは 1 回だけで、県と市町村が両方とも空のときだけ（一覧を読む前に県を選んでいたら、その選択を残す）
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !farmMissing || !deviceMuni) return;
    prefilled.current = true;
    if (prefCode !== "" || muniCode !== "") return;
    setPrefCode(deviceMuni.prefCode);
    setMuniCode(deviceMuni.code);
  }, [farmMissing, deviceMuni, prefCode, muniCode]);

  const munis = useMemo(
    () =>
      geo
        ? Object.values(geo.index)
            .filter((m) => m.prefCode === prefCode)
            .sort((a, b) => a.code.localeCompare(b.code))
        : [],
    [geo, prefCode],
  );
  const muni: MuniEntry | null = geo && muniCode ? (geo.index[muniCode] ?? null) : null;

  // #houses（死亡数の画面と次にすることのリンク）と #delete（プライバシーの説明の消し方のリンク）で開いたら、
  // その節へ送り、見出しに焦点を移す。#delete は畳んだ削除の欄も開き、その見出し（summary）に焦点を移す。
  // 札（地点の名前）は町の一覧を読んでから形が決まるので、それも待つ
  const sectionsShown = load.state === "ok" && load.farm !== null && (geo !== null || geoFailed);
  useEffect(() => {
    const target = location.hash === "#houses" ? housesRef : location.hash === "#delete" ? deleteRef : null;
    if (!target || !sectionsShown) return;
    // 画面の替わり目に、骨格（AppShell）が題（h1）へ焦点を移す。その後に送るため少し待つ（AboutPage と同じ）
    const id = window.setTimeout(() => {
      let heading: HTMLElement | null | undefined = housesHeadingRef.current;
      if (location.hash === "#delete") {
        const details = deleteRef.current?.querySelector("details");
        if (details) details.open = true;
        heading = details?.querySelector("summary");
      }
      target.current?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
    }, 150);
    return () => window.clearTimeout(id);
  }, [location.hash, location.key, sectionsShown]);

  if (load.state === "loading") return <p role="status">読み込んでいます</p>;
  if (load.state === "error") {
    // 読めなかったときは何も出さない（農場がないと思い込んで、重ねて作らないため）
    return (
      <section className="settings-page">
        <h1>農場の設定</h1>
        <p className="settings-error" role="alert">
          {load.message ?? "農場の情報を読み込めませんでした。通信を確かめて、ページを読み込み直してください。"}
        </p>
      </section>
    );
  }
  if (deleted) {
    // 消した農場の欄（保存、招待）を残さない。地図へは読み込み直して戻る（会員の状態を読み直すため）
    return (
      <section className="settings-page">
        <h1>農場の設定</h1>
        <p role="status">{RECORD_TEXT.deleted}</p>
        <p>
          <a href="/" className="tap-link">
            {RECORD_TEXT.deletedTop}
          </a>
        </p>
      </section>
    );
  }

  const farm = load.farm;
  const registered = farm && geo ? geo.index[farm.muniCode] : undefined;
  // 町の一覧を読めなかったとき（一覧に町がないときも）は、5 桁の市町村コードを出さず「読み込めませんでした」と言う
  const pointState: "ok" | "loading" | "failed" = registered ? "ok" : geo || geoFailed ? "failed" : "loading";
  const pointName: StatValue = registered ? ok(registered.name) : { status: pointState === "failed" ? "failed" : "loading" };
  const saved = savedAtLabel(farm?.updatedAt);
  const editingPoint = !farm || pointOpen;

  async function savePoint(point: FarmPick) {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await store.saveFarm(point);
      spotState?.refreshFarm(); // 発生状況の地図も、読み込み直さずに農場の場所にする
      const next = await store.getFarm();
      setLoad({ state: "ok", farm: next });
      setPick(null);
      setPointOpen(false);
    } catch {
      setSaveFailed(true);
    }
    setSaving(false);
  }
  const save = () => (pick ? savePoint(pick) : Promise.resolve());
  // 発生状況の画面で決めた場所（約 1km のマス目と町）を、そのまま農場の地点にする
  const handover: FarmPick | null = !farm && deviceSpot && deviceMuni ? { meshCode: deviceSpot.meshCode, muniCode: deviceMuni.code, prefCode: deviceMuni.prefCode } : null;
  const handoverName = deviceMuni ? `${PREFS.find((p) => p.code === deviceMuni.prefCode)?.name ?? ""} ${deviceMuni.name}`.trim() : "";

  /** 地点以外の欄の保存。渡した項目だけを保存し、保存の後に読み直して『最終保存』を進める */
  async function saveProfile(patch: Partial<Farm>) {
    await store.saveFarm(patch);
    spotState?.refreshFarm(); // 行き来する町も地図の判定に使う
    try {
      setLoad({ state: "ok", farm: await store.getFarm() });
    } catch {
      // 保存は済んでいる。読み直せなかっただけなので、保存の失敗にはしない
    }
  }

  async function makeInvite() {
    if (!farm || inviting) return;
    setInviting(true);
    setInviteFailed(false);
    try {
      const { url } = await createFarmInviteCall(farm.id);
      setInviteUrl(url);
    } catch {
      setInviteFailed(true);
    }
    setInviting(false);
  }

  // 地点の欄。農場がない間は一番上に全開で、登録の後は「地点を変える」で開く
  const pointSection = (
    <section id="point">
      <h2>農場の地点</h2>
      {farm ? (
        <div className="settings-point-line">
          <p>
            登録した地点:{" "}
            {registered ? registered.name : pointState === "failed" ? "町の名前を読み込めませんでした" : "町の名前を読み込んでいます"}（約 1km のマス目）
          </p>
          <Button aria-expanded={pointOpen} aria-controls="point-edit" onClick={() => setPointOpen(!pointOpen)}>
            地点を変える
          </Button>
        </div>
      ) : null}
      {handover ? (
        <div className="settings-handover">
          <p>
            <strong>発生状況の画面で決めた場所があります</strong>
          </p>
          <p>{handoverName}の約 1km のマス目</p>
          <Button variant="primary" disabled={saving} onClick={() => void savePoint(handover)}>
            この場所を農場の地点にする
          </Button>
          <p className="settings-note">押すと、約 1km のマス目と市町村だけを保存します。別の場所にするときは、下で選んでください。</p>
        </div>
      ) : null}
      {editingPoint ? (
        <div id="point-edit" className="settings-point-edit">
          <p>市町村を選び、地図で農場のあたりを押してください。約 1km のマス目で保存します。{farm ? "住所は聞きません。" : ""}</p>
          <p className="settings-note">正確な地点は保存せず、端末からも送りません。</p>
          <div className="settings-form">
            <label htmlFor="pref">都道府県</label>
            <select
              id="pref"
              value={prefCode}
              onChange={(e) => {
                setPrefCode(e.target.value);
                setMuniCode("");
                setPick(null);
              }}
            >
              <option value="">選んでください</option>
              {PREFS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
            <label htmlFor="muni">市町村</label>
            <select
              id="muni"
              value={muniCode}
              disabled={prefCode === "" || !geo}
              onChange={(e) => {
                setMuniCode(e.target.value);
                setPick(null);
              }}
            >
              <option value="">選んでください</option>
              {munis.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
            {geoFailed ? (
              <p className="settings-error" role="alert">
                市町村の一覧を読み込めませんでした。ページを読み込み直してください。
              </p>
            ) : null}
          </div>
          <MeshPicker muni={muni} onPick={setPick} onUnsupported={() => setMapless(true)} />
          <p role="status">
            {pick
              ? "地点を選びました。保存すると、約 1km のマス目で登録されます。"
              : mapless
                ? muni
                  ? TEXT.meshPressCenter
                  : TEXT.meshPickMuniFirst
                : muni
                  ? farm
                    ? "替えるときは、地図で別の場所を押してください。"
                    : "地図で、農場のあたりを押してください。"
                  : "市町村を選ぶと、地図がその町に寄ります。"}
          </p>
          {/* 主のボタンは、農場がないとき（することが地点を決めることだけ）に限る。登録の後に変えるときは普通のボタン */}
          <Button variant={farm ? "secondary" : "primary"} disabled={!pick || saving} onClick={() => void save()}>
            地点を保存
          </Button>
          {saveFailed ? (
            <p className="settings-error" role="alert">
              保存できませんでした。通信を確かめて、もう一度試してください。
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="settings-page">
      <h1>農場の設定</h1>
      <p>この画面では、記録と知らせに使う農場の情報を登録します。</p>
      <SettingsTabs />
      {/* 農場がない最初の画面では札を出さない（することは地点を決めることだけ。地図を上に置く） */}
      {farm ? <RegisterStatus farm={farm} pointName={pointName} houses={houses} mail={mail} /> : null}
      {/* 最終保存は、次にすることの行の後ろに小さく（札と次にすることの間に挟まない） */}
      <div className="settings-next-block">
        <NextStep farm={farm} houses={houses} />
        {saved ? <p className="settings-saved">{saved}</p> : null}
      </div>

      {farm ? (
        <>
          {/* 節の順は札の順（地点 → 農場名 → 鶏舎 → 家保 → 通知）にそろえる */}
          {pointSection}

          <section id="farm-info">
            <h2>農場の情報</h2>
            <FarmBasicsForm farm={farm} save={saveProfile} />
          </section>

          {/* 記録に要る鶏舎は、農場の情報のすぐ後（2026-11-07 精査 D） */}
          <section id="houses" ref={housesRef}>
            <h2 ref={housesHeadingRef} tabIndex={-1}>
              鶏舎
            </h2>
            <HouseList store={store} onSaved={() => saveProfile({})} onSummary={setHouses} />
          </section>

          <section id="kaho">
            <h2>家畜保健衛生所の連絡先</h2>
            <KahoContactForm farm={farm} save={saveProfile} />
          </section>

          <section>
            <h2>行き来する町</h2>
            <MuniMultiPicker
              geo={geo}
              geoFailed={geoFailed}
              farmMuniCode={farm.muniCode}
              initial={farm.frequentMuniCodes}
              save={(codes) => saveProfile({ frequentMuniCodes: codes })}
            />
          </section>

          <section>
            <h2>会員を追加する</h2>
            <p>同じ農場の会員を追加するには、招待リンクを作って送ります。</p>
            <Button onClick={() => void makeInvite()} disabled={inviting}>
              招待リンクを作る
            </Button>
            {inviteUrl ? (
              <div className="settings-form">
                <label htmlFor="invite-url">招待リンク</label>
                <input id="invite-url" className="invite-url" type="text" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
                <p className="settings-note">このリンクは 7 日で切れ、1 回だけ使えます。送る相手を確かめてください。</p>
              </div>
            ) : null}
            {inviteFailed ? (
              <p className="settings-error" role="alert">
                招待リンクを作れませんでした。もう一度試してください。
              </p>
            ) : null}
          </section>
        </>
      ) : (
        pointSection
      )}

      {/* ほかの画面へのリンク。節の間に浮かないよう、小さな見出しの下にまとめる（h2 にしない。農場がない画面の見出しは地点だけのまま） */}
      <nav className="settings-related" aria-labelledby="settings-related-title">
        <p id="settings-related-title" className="settings-related-title">
          関連
        </p>
        <ul>
          <li>
            <Link to="/settings/explainer" className="tap-link">近隣への説明文を作る</Link>
          </li>
          <li>
            <Link to="/privacy" className="tap-link">プライバシーの説明</Link>
          </li>
        </ul>
      </nav>

      {/* 取り消せないので一番下に畳んで置く。見本の農場には出さない。見出しは置かず、畳んだ欄の summary が節の見出しの役 */}
      {farm && store.mode !== "sample" ? (
        <section id="delete" ref={deleteRef} className="settings-delete-section">
          <Fold summary="農場の全データを削除する">
            <DeleteFarmForm farm={farm} onDone={() => setDeleted(true)} />
          </Fold>
        </section>
      ) : null}
    </div>
  );
}

export default function FarmSettingsPage() {
  return (
    <RequireMember>
      <FarmSettings />
    </RequireMember>
  );
}
