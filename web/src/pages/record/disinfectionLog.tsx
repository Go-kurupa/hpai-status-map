// 消毒の記録の部品。確認リストの「やった」（TodoPage）と DisinfectionPanel が同じものを使う。
// RecordStore だけを使う（再現と見本の農場でも動く）。農場がなければ「やった」を出さず、saveCheck を呼ばない。
import { addDays, jstDateOf } from "@hpai/shared/dates";
import type { Farm, IsoDate } from "@hpai/shared/types";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useDataSource, useRecordStore } from "../../data/context";
import { Button } from "../../ui/Button";
import { TODO_TEXT } from "../todo/texts";

export type FarmState =
  | { status: "loading" }
  /** 読めなかった（通信や権限）。「農場がない」とは言えない */
  | { status: "failed" }
  | { status: "none" }
  | { status: "ready"; farm: Farm & { id: string } };

/** 自分の農場を 1 度だけ読む。reject を「農場なし」に丸めない */
export function useFarmRecord(): FarmState {
  const store = useRecordStore();
  const [state, setState] = useState<FarmState>({ status: "loading" });
  useEffect(() => {
    let off = false;
    setState({ status: "loading" });
    store.getFarm().then(
      (farm) => {
        if (!off) setState(farm ? { status: "ready", farm } : { status: "none" });
      },
      () => {
        if (!off) setState({ status: "failed" });
      },
    );
    return () => {
      off = true;
    };
  }, [store]);
  return state;
}

export interface LoggedCheck {
  key: string;
  date: IsoDate;
  itemId: string;
}

const RECENT_DAYS = 14;

export interface DisinfectionLog {
  doneToday: ReadonlySet<string>;
  saving: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  /** 新しい順 */
  recent: LoggedCheck[];
  recentFailed: boolean;
  log(itemId: string): Promise<void>;
}

/** 「やった」を残す。enabled は農場が読めているとき。同じ日の同じ項目は 1 度だけ */
export function useDisinfectionLog(enabled: boolean): DisinfectionLog {
  const store = useRecordStore();
  const ds = useDataSource();
  const [recent, setRecent] = useState<LoggedCheck[]>([]);
  const [recentFailed, setRecentFailed] = useState(false);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [doneToday, setDoneToday] = useState<ReadonlySet<string>>(new Set());
  const nextLocal = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let off = false;
    const today = jstDateOf(ds.now());
    store.listChecks(addDays(today, -(RECENT_DAYS - 1)), today).then(
      (rows) => {
        if (off) return;
        const list: LoggedCheck[] = [];
        for (const r of rows) if (r.kind === "disinfection") list.push({ key: r.id, date: r.date, itemId: r.itemId });
        list.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
        setRecent(list);
        setDoneToday(new Set(list.filter((r) => r.date === today).map((r) => r.itemId)));
        setRecentFailed(false);
      },
      () => {
        if (!off) setRecentFailed(true); // 読めなくても「やった」は押せる。最近の記録だけ出せない
      },
    );
    return () => {
      off = true;
    };
  }, [enabled, store, ds]);

  const log = useCallback(
    async (itemId: string) => {
      if (!enabled) return; // 農場がなければ保存を呼ばない
      const date = jstDateOf(ds.now());
      setSaving((s) => new Set(s).add(itemId));
      setFailed((s) => without(s, itemId));
      try {
        await store.saveCheck({ kind: "disinfection", date, itemId });
        setDoneToday((s) => new Set(s).add(itemId));
        setRecent((r) => [{ key: `local-${nextLocal.current++}`, date, itemId }, ...r]);
      } catch {
        setFailed((s) => new Set(s).add(itemId));
      } finally {
        setSaving((s) => without(s, itemId));
      }
    },
    [enabled, store, ds],
  );

  return { doneToday, saving, failed, recent, recentFailed, log };
}

function without(s: ReadonlySet<string>, v: string): ReadonlySet<string> {
  const n = new Set(s);
  n.delete(v);
  return n;
}

/** 項目ごとの「やった」。押せるのは農場が読めているときだけ（呼び出し側が決める） */
export function DoneButton({ itemId, label, log }: { itemId: string; label: string; log: DisinfectionLog }) {
  const saved = log.doneToday.has(itemId);
  const saving = log.saving.has(itemId);
  return (
    <div className="done-row">
      <Button variant="primary" disabled={saved || saving} onClick={() => void log.log(itemId)} aria-label={`${TODO_TEXT.done}: ${label}`}>
        {saved ? TODO_TEXT.doneSaved : saving ? TODO_TEXT.doneSaving : TODO_TEXT.done}
      </Button>
      {log.failed.has(itemId) ? <p role="alert">{TODO_TEXT.doneFailed}</p> : null}
    </div>
  );
}

/**
 * 会員のログイン状態を見る部分は別ファイルにして、必要なときだけ読む。
 * useAuthUser は firebase.ts を静的に読むので、ここで静的に import すると、見本の農場と再現の画面にも Firebase が載る。
 */
const MemberGuide = lazy(() => import("./MemberGuide"));

/** 農場の状態に合わせた案内。ready のときは何も出さない */
export function FarmGuide({ farm }: { farm: FarmState }) {
  const store = useRecordStore();
  if (farm.status === "ready" || farm.status === "loading") return null;
  if (farm.status === "failed") return <p role="alert">{TODO_TEXT.farmFailed}</p>;
  if (store.mode === "sample") return <p role="status">{TODO_TEXT.recordSampleNone}</p>;
  return (
    <Suspense fallback={null}>
      <MemberGuide />
    </Suspense>
  );
}
