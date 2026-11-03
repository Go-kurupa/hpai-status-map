import type { GeoStore, MuniEntry } from "@hpai/shared/geo";
import { PREFS } from "@hpai/shared/pref";
import type { Farm } from "@hpai/shared/types";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useRecordStore } from "../../data/context";
import { loadWebGeoStore } from "../../geo/loadGeo";
import { Button } from "../../ui/Button";
import { createFarmInviteCall } from "../auth/callables";
import { RequireMember } from "../auth/RequireMember";
import { savedAtLabel } from "./farmForm";
import { MeshPicker, type FarmPick } from "./MeshPicker";
import "./settings.css";

type Saved = Farm & { id: string };
type Load = { state: "loading" } | { state: "error" } | { state: "ok"; farm: Saved | null };

/** 農場の設定。この版は地点と、会員を足す招待リンク。名前や鶏舎などは M-05 が足す */
function FarmSettings() {
  const store = useRecordStore();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [geo, setGeo] = useState<GeoStore | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [prefCode, setPrefCode] = useState("");
  const [muniCode, setMuniCode] = useState("");
  const [pick, setPick] = useState<FarmPick | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteFailed, setInviteFailed] = useState(false);
  const [inviting, setInviting] = useState(false);

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
      () => {
        if (!cancelled) setLoad({ state: "error" });
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

  if (load.state === "loading") return <p role="status">読み込んでいます</p>;
  if (load.state === "error") {
    // 読めなかったときは何も出さない（農場がないと思い込んで、重ねて作らないため）
    return (
      <section className="settings-page">
        <h1>農場の設定</h1>
        <p className="settings-error" role="alert">
          農場の情報を読めませんでした。通信を確かめて、ページを読み込み直してください。
        </p>
      </section>
    );
  }

  const farm = load.farm;
  const registered = farm && geo ? geo.index[farm.muniCode] : undefined;
  const saved = savedAtLabel(farm?.updatedAt);

  async function save() {
    if (!pick || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await store.saveFarm(pick);
      const next = await store.getFarm();
      setLoad({ state: "ok", farm: next });
      setPick(null);
    } catch {
      setSaveFailed(true);
    }
    setSaving(false);
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
        <MeshPicker muni={muni} onPick={setPick} />
        <p role="status">{pick ? "地点を選びました。保存すると、約 1km のマス目で登録されます。" : muni ? "地図で、農場のあたりをおしてください。" : "市町村を選ぶと、地図がその町に寄ります。"}</p>
        <Button variant="primary" disabled={!pick || saving} onClick={() => void save()}>
          地点を保存
        </Button>
        {saveFailed ? (
          <p className="settings-error" role="alert">
            保存できませんでした。通信を確かめて、もう一度試してください。
          </p>
        ) : null}
        {saved ? <p className="settings-saved">{saved}</p> : null}
      </section>

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
        <Link to="/privacy">プライバシーの説明</Link>
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
