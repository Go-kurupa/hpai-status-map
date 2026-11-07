// 文書の確認の項目。読み取った値を入力欄の初期値にして、運営者が直して「載せる」か「無関係とする」を決める（設計書 §9.6）。
// 入力欄は最初は畳む（多くの項目は「無関係とする」で済み、欄が全部開いていると下までスクロールが要る）。
// 「直して載せる」を押すと欄が開き、その下に「載せる」が出る。畳んでも入れた値は残す（hidden で隠すだけ）。
// 題、URL、理由は外から来た文字。React の文字として出し、HTML にしない。
import { STAGE_LABELS } from "@hpai/shared/cases";
import { jstDateOf } from "@hpai/shared/dates";
import type { MuniEntry } from "@hpai/shared/geo";
import { muniCoreName } from "@hpai/shared/read/names";
import type { CorrectedCaseValues, ReviewDetail } from "@hpai/shared/read/review";
import type { ReviewItem } from "@hpai/shared/read/types";
import { PREFS, prefCodeOfName } from "@hpai/shared/pref";
import type { CaseStage, MuniCode } from "@hpai/shared/types";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "../../ui/Button";
import { checkLabel, fieldLabel, isAutoDismissed, prefNameOf, reasonText, safeHref } from "./operatorText";
import { useResolver, type ResolveFn } from "./useResolver";

type DocItem = Extract<ReviewItem, { kind: "document" }>;
type MuniIndex = Readonly<Record<MuniCode, MuniEntry>>;

interface Props {
  item: DocItem;
  resolve: ResolveFn;
  getDetail: (itemId: string) => Promise<ReviewDetail>;
  loadMunis: () => Promise<MuniIndex>;
  now: () => Date;
}

interface FormState {
  prefCode: string;
  muniCode: string;
  stage: string;
  date: string;
  time: string;
  nationalNo: string;
  prefNo: string;
  birdUse: string;
  housing: string;
  headCount: string;
  radii: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** 年のない日付は、今日より先にならない直近の年で補う（運営者が直せる初期値） */
function initialDate(d: ReviewDetail["primaryDate"], now: Date): string {
  if (d === null) return "";
  const today = jstDateOf(now);
  let year = d.year;
  if (year === null) {
    year = Number(today.slice(0, 4));
    if (`${pad(d.month)}-${pad(d.day)}` > today.slice(5)) year -= 1;
  }
  return `${year}-${pad(d.month)}-${pad(d.day)}`;
}

function initialTime(t: string | null | undefined): string {
  const m = t === null || t === undefined ? null : /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : "";
}

function initialForm(item: DocItem, detail: ReviewDetail | null, munis: MuniIndex | null, now: Date): FormState {
  const prefCode = (detail?.prefecture ? prefCodeOfName(detail.prefecture) : null) ?? item.prefCode ?? "";
  let muniCode = "";
  if (detail?.municipality && prefCode !== "" && munis !== null) {
    const target = muniCoreName(detail.municipality);
    const hits = Object.values(munis).filter((e) => e.prefCode === prefCode && muniCoreName(e.name) === target);
    if (hits.length === 1) muniCode = hits[0]!.code;
  }
  return {
    prefCode,
    muniCode,
    stage: detail?.primaryStage ?? "",
    date: detail ? initialDate(detail.primaryDate, now) : "",
    time: initialTime(detail?.primaryDate?.time),
    nationalNo: detail?.nationalNo?.toString() ?? "",
    prefNo: "",
    birdUse: detail?.birdUse ?? "",
    housing: detail?.housing ?? "",
    headCount: detail?.headCount?.toString() ?? "",
    radii: (detail?.radiiKm ?? []).join(", "),
  };
}

function parseCount(label: string, s: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const t = s.normalize("NFKC").trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, message: `${label}は数字で入れてください` };
  return { ok: true, value: Number(t) };
}

function toValues(f: FormState): { ok: true; values: CorrectedCaseValues } | { ok: false; message: string } {
  const nationalNo = parseCount("国内の番号", f.nationalNo);
  if (!nationalNo.ok) return nationalNo;
  const prefNo = parseCount("県内の番号", f.prefNo);
  if (!prefNo.ok) return prefNo;
  const headCount = parseCount("羽数", f.headCount);
  if (!headCount.ok) return headCount;
  const radiiKm = f.radii
    .normalize("NFKC")
    .split(/[,、\s]+/)
    .filter((x) => x !== "")
    .map(Number);
  if (radiiKm.some((r) => !Number.isFinite(r) || r <= 0)) return { ok: false, message: "半径は数字で入れてください（例: 3, 10）" };
  const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());
  return {
    ok: true,
    values: {
      prefCode: f.prefCode,
      muniCode: f.muniCode,
      stage: f.stage as CaseStage,
      date: f.date,
      time: f.time === "" ? null : f.time,
      nationalNo: nationalNo.value,
      prefNo: prefNo.value,
      birdUse: text(f.birdUse),
      housing: text(f.housing),
      headCount: headCount.value,
      radiiKm,
    },
  };
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="op-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

interface FormProps {
  item: DocItem;
  detail: ReviewDetail | null;
  munis: MuniIndex | null;
  now: Date;
  disabled: boolean;
  onPublish(values: CorrectedCaseValues): void;
  formError: string | null;
  setFormError(m: string | null): void;
}

function PublishForm({ item, detail, munis, now, disabled, onPublish, formError, setFormError }: FormProps) {
  const [f, setF] = useState(() => initialForm(item, detail, munis, now));
  const set = (k: keyof FormState, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const muniOptions = munis === null ? [] : Object.values(munis).filter((e) => e.prefCode === f.prefCode).sort((a, b) => a.code.localeCompare(b.code));
  const complete = f.prefCode !== "" && f.muniCode !== "" && f.stage !== "" && f.date !== "";

  return (
    <form
      className="op-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const r = toValues(f);
        if (!r.ok) return setFormError(r.message);
        if (f.date > jstDateOf(now)) return setFormError("未来の日付は載せられません。日付を確かめてください");
        setFormError(null);
        onPublish(r.values);
      }}
    >
      <Field label="県">
        {(id) => (
          <select id={id} value={f.prefCode} onChange={(e) => setF((cur) => ({ ...cur, prefCode: e.target.value, muniCode: "" }))}>
            <option value="">選んでください</option>
            {PREFS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="市町村">
        {(id) => (
          <select id={id} value={f.muniCode} onChange={(e) => set("muniCode", e.target.value)}>
            <option value="">選んでください</option>
            {muniOptions.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {munis === null && <p className="op-note">市町村の一覧を読めませんでした。載せるには、ページを開き直してください。</p>}
      <Field label="段階">
        {(id) => (
          <select id={id} value={f.stage} onChange={(e) => set("stage", e.target.value)}>
            <option value="">選んでください</option>
            {(Object.keys(STAGE_LABELS) as CaseStage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="日付">{(id) => <input id={id} type="date" max={jstDateOf(now)} value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
      <Field label="時刻">{(id) => <input id={id} type="time" value={f.time} onChange={(e) => set("time", e.target.value)} />}</Field>
      <Field label="国内の番号">{(id) => <input id={id} inputMode="numeric" value={f.nationalNo} onChange={(e) => set("nationalNo", e.target.value)} />}</Field>
      <Field label="県内の番号">{(id) => <input id={id} inputMode="numeric" value={f.prefNo} onChange={(e) => set("prefNo", e.target.value)} />}</Field>
      <Field label="用途">{(id) => <input id={id} value={f.birdUse} onChange={(e) => set("birdUse", e.target.value)} />}</Field>
      <Field label="飼い方">{(id) => <input id={id} value={f.housing} onChange={(e) => set("housing", e.target.value)} />}</Field>
      <Field label="羽数">{(id) => <input id={id} inputMode="numeric" value={f.headCount} onChange={(e) => set("headCount", e.target.value)} />}</Field>
      <Field label="区域の半径（km。複数ならコンマで区切る）">
        {(id) => <input id={id} value={f.radii} onChange={(e) => set("radii", e.target.value)} />}
      </Field>
      {formError !== null && <p role="alert" className="op-error">{formError}</p>}
      <div className="op-actions">
        <Button type="submit" variant="primary" disabled={disabled || !complete || munis === null}>
          載せる
        </Button>
      </div>
    </form>
  );
}

export function DocumentItem({ item, resolve, getDetail, loadMunis, now }: Props) {
  const r = useResolver(resolve);
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ detail: ReviewDetail | null; munis: MuniIndex | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([getDetail(item.id), loadMunis()]).then(([d, m]) => {
      if (!cancelled) setLoaded({ detail: d.status === "fulfilled" ? d.value : null, munis: m.status === "fulfilled" ? m.value : null });
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, getDetail, loadMunis]);

  const prefName = prefNameOf(item.prefCode);
  const href = safeHref(item.url);
  const detail = loaded?.detail ?? null;

  return (
    <article className="op-item">
      <p className="op-kind">文書の確認</p>
      <h2>{item.title}</h2>
      <p>県: {prefName ?? "県が分かりません"}</p>
      <p>{href !== null ? <a className="tap-link" href={href} target="_blank" rel="noopener noreferrer">原文を開く</a> : <>原文のアドレス: {item.url}</>}</p>
      <p>
        {item.hasOutbreakWords
          ? "公開しています（県名と「確認中」と原文のリンクだけ。同じ県の会員にすぐ知らせています）"
          : isAutoDismissed(item.reasons)
            ? "公開していません（この県の家きんの発生ではないと二人の読み手が読んだので、地図に「確認中」を出していません）"
            : "公開していません（発生を示す語がないので、この画面だけに入れています）"}
      </p>
      {(item.reasons ?? []).length > 0 && (
        <>
          <p className="op-label">確認に回った理由</p>
          <ul>
            {item.reasons.map((code, i) => (
              <li key={`${code}-${i}`}>{reasonText(code)}</li>
            ))}
          </ul>
        </>
      )}
      {loaded === null && <p role="status">読み取りの結果を読み込んでいます</p>}
      {loaded !== null && detail === null && <p className="op-note">読み取りの結果を読めませんでした。入力欄は空のままなので、原文を見て入れてください。</p>}
      {detail !== null && detail.issues.length > 0 && (
        <p className="op-note">
          照合で通らなかった項目: {detail.issues.map((i) => `${fieldLabel(i.field)}（${checkLabel(i.check)}${i.mandatory ? "・必須" : ""}）`).join("、")}
        </p>
      )}
      {detail !== null && detail.mismatches.length > 0 && (
        <p className="op-note">二人の読み手で食い違った項目: {detail.mismatches.map(fieldLabel).join("、")}</p>
      )}
      {detail !== null && detail.error !== null && <p className="op-note">読み取りの失敗: {detail.error}</p>}
      <div className="op-actions">
        <Button
          disabled={r.disabled}
          onClick={() => {
            setFormError(null);
            void r.run({ itemId: item.id, action: "mark_irrelevant" });
          }}
        >
          無関係とする
        </Button>
        <Button aria-expanded={editing} aria-controls={formId} disabled={r.disabled} onClick={() => setEditing((v) => !v)}>
          直して載せる
          <span aria-hidden="true" className="op-chevron">
            {editing ? "▲" : "▼"}
          </span>
        </Button>
      </div>
      {/* 操作の失敗は、欄を開いて読み込みが終わっていれば「載せる」の近く（欄の中）、それ以外は欄の外に出す（失敗を見落とさない） */}
      {(!editing || loaded === null) && r.error !== null && <p role="alert" className="op-error">{r.error}</p>}
      <div id={formId} hidden={!editing}>
        {loaded !== null && (
          <PublishForm
            item={item}
            detail={detail}
            munis={loaded.munis}
            now={now()}
            disabled={r.disabled}
            formError={formError ?? r.error}
            setFormError={setFormError}
            onPublish={(values) => void r.run({ itemId: item.id, action: "publish_corrected", values })}
          />
        )}
      </div>
      {r.phase === "done" && <p role="status">処理しました（一覧から消えます）</p>}
    </article>
  );
}
