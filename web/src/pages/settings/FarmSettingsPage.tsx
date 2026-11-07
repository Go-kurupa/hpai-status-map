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
import { savedAtLabel } from "./farmForm";
import { FarmBasicsForm, KahoContactForm } from "./FarmProfileForm";
import { HouseList } from "./HouseList";
import { MeshPicker, type FarmPick } from "./MeshPicker";
import { TEXT } from "../map/texts";
import { MuniMultiPicker } from "./MuniMultiPicker";
import "./settings.css";

type Saved = Farm & { id: string };
type Load = { state: "loading" } | { state: "error"; message: string | null } | { state: "ok"; farm: Saved | null };

/**
 * 見出しの直下の、次にすることの帯。農場がない（会員になった直後）→ 鶏舎が 0 件 → 鶏舎が 1 件以上の 3 段階。
 * 鶏舎の件数が分からない間（読み込み中、読めなかった）は出さない（ないと思って重ねて足さないため）。
 */
function NextStep({ farm, houseCount }: { farm: Saved | null; houseCount: number | null }) {
  if (!farm) {
    return (
      <div className="settings-next">
        <p>会員になりました。まず農場の地点を決めてください。</p>
      </div>
    );
  }
  if (houseCount === null) return null;
  if (houseCount === 0) {
    return (
      <div className="settings-next">
        <p>次は鶏舎を足してください。死亡数の記録は鶏舎ごとにつけます。</p>
        <p className="settings-next-links">
          <Link to="/settings/farm#houses" className="tap-link">
            鶏舎を足す
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="settings-next">
      <p>記録を始められます。</p>
      <p className="settings-next-links">
        <Link to="/record/deaths" className="tap-link">
          死亡数を記録する
        </Link>
        <Link to="/todo" className="tap-link">
          対策項目を見る
        </Link>
      </p>
    </div>
  );
}

/**
 * 農場の設定。地点、農場名、採卵か肉用か、鶏舎の造り、飼い方、行き来する町、鶏舎、家保の連絡先、招待の順。
 * 農場がない間（地点を保存する前）は地点の欄だけ。ほかの欄は農場がないと保存できない（ルールが meshCode を要る）。
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
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [inviting, setInviting] = useState(false);
  // 鶏舎の件数（上の帯の段階に使う）。HouseList が読んだ数を受け取る。読み込み中と読めなかったときは null
  const [houseCount, setHouseCount] = useState<number | null>(null);
  const location = useLocation();
  const housesRef = useRef<HTMLElement>(null);
  const housesHeadingRef = useRef<HTMLHeadingElement>(null);

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

  // #houses で開いたら（死亡数の画面と上の帯のリンク）、鶏舎の欄へ送り、見出しに焦点を移す。
  // 上の欄（行き来する町）は町の一覧を読んでから高さが決まるので、それも待つ
  const housesShown = load.state === "ok" && load.farm !== null && (geo !== null || geoFailed);
  useEffect(() => {
    if (location.hash !== "#houses" || !housesShown) return;
    // 画面の替わり目に、骨格（AppShell）が題（h1）へ焦点を移す。その後に送るため少し待つ（AboutPage と同じ）
    const id = window.setTimeout(() => {
      housesRef.current?.scrollIntoView({ block: "start" });
      housesHeadingRef.current?.focus({ preventScroll: true });
    }, 150);
    return () => window.clearTimeout(id);
  }, [location.hash, location.key, housesShown]);

  if (load.state === "loading") return <p role="status">読み込んでいます</p>;
  if (load.state === "error") {
    // 読めなかったときは何も出さない（農場がないと思い込んで、重ねて作らないため）
    return (
      <section className="settings-page">
        <h1>農場の設定</h1>
        <p className="settings-error" role="alert">
          {load.message ?? "農場の情報を読めませんでした。通信を確かめて、ページを読み込み直してください。"}
        </p>
      </section>
    );
  }

  const farm = load.farm;
  const registered = farm && geo ? geo.index[farm.muniCode] : undefined;
  const saved = savedAtLabel(farm?.updatedAt);

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

  return (
    <div className="settings-page">
      <h1>農場の設定</h1>
      <NextStep farm={farm} houseCount={houseCount} />
      {saved ? <p className="settings-saved">{saved}</p> : null}

      <section>
        <h2>農場の地点</h2>
        <p>住所は聞きません。市町村を選び、地図で農場のあたりをおしてください。約 1km のマス目で保存します。</p>
        <p className="settings-note">正確な地点は保存せず、端末からも送りません。</p>
        {farm ? (
          <p>
            登録した地点: {registered ? registered.name : farm.muniCode}（約 1km のマス目）
          </p>
        ) : (
          <p className="settings-note">まだ地点を登録していません。</p>
        )}
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
              市町村の一覧を読めませんでした。ページを読み込み直してください。
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
                  ? "替えるときは、地図で別の場所をおしてください。"
                  : "地図で、農場のあたりをおしてください。"
                : "市町村を選ぶと、地図がその町に寄ります。"}
        </p>
        <Button variant="primary" disabled={!pick || saving} onClick={() => void save()}>
          地点を保存
        </Button>
        {saveFailed ? (
          <p className="settings-error" role="alert">
            保存できませんでした。通信を確かめて、もう一度試してください。
          </p>
        ) : null}
      </section>

      {farm ? (
        <>
          <section>
            <h2>農場の情報</h2>
            <FarmBasicsForm farm={farm} save={saveProfile} />
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

          <section id="houses" ref={housesRef}>
            <h2 ref={housesHeadingRef} tabIndex={-1}>
              鶏舎
            </h2>
            <HouseList store={store} onSaved={() => saveProfile({})} onCount={setHouseCount} />
          </section>

          <section>
            <h2>家畜保健衛生所の連絡先</h2>
            <KahoContactForm farm={farm} save={saveProfile} />
          </section>
        </>
      ) : null}

      {farm ? (
        <section>
          <h2>会員を足す</h2>
          <p>同じ農場の会員を足すには、招待リンクを作って送ります。</p>
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
      ) : null}

      <p>
        <Link to="/settings/explainer" className="tap-link">近隣への説明文を作る</Link>
      </p>
      <p>
        <Link to="/privacy" className="tap-link">プライバシーの説明</Link>
      </p>
      <p>
        <Link to="/settings/notify" className="tap-link">
          通知の設定を開く
        </Link>
      </p>
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
