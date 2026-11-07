import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DataSource, RecordStore } from "./types";

const DataSourceContext = createContext<DataSource | null>(null);
const RecordStoreContext = createContext<RecordStore | null>(null);

/** 記録（死亡数・自己点検・消毒）を保存した回数。上の「最後の記録」が保存の後に読み直すために使う */
interface RecordSaves {
  version: number;
  saved: () => void;
}
const RecordSavesContext = createContext<RecordSaves>({ version: 0, saved: () => {} });

export function DataSourceProvider({ value, children }: { value: DataSource; children: ReactNode }) {
  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  const v = useContext(DataSourceContext);
  if (!v) throw new Error("DataSourceProvider の中で使ってください");
  return v;
}

export function RecordStoreProvider({ value, children }: { value: RecordStore; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const saved = useCallback(() => setVersion((n) => n + 1), []);
  const saves = useMemo(() => ({ version, saved }), [version, saved]);
  return (
    <RecordStoreContext.Provider value={value}>
      <RecordSavesContext.Provider value={saves}>{children}</RecordSavesContext.Provider>
    </RecordStoreContext.Provider>
  );
}

export function useRecordStore(): RecordStore {
  const v = useContext(RecordStoreContext);
  if (!v) throw new Error("RecordStoreProvider の中で使ってください");
  return v;
}

/** Provider がなくても投げない版。端末内の地点の Provider が、会員の農場を「あれば」読むために使う（再現には記録の口がない） */
export function useOptionalRecordStore(): RecordStore | null {
  return useContext(RecordStoreContext);
}

/** 記録の保存を知らせる。保存できた後に saved() を呼ぶ。version は保存のたびに 1 つ増える */
export function useRecordSaves(): RecordSaves {
  return useContext(RecordSavesContext);
}
