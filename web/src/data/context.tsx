import { createContext, useContext, type ReactNode } from "react";
import type { DataSource, RecordStore } from "./types";

const DataSourceContext = createContext<DataSource | null>(null);
const RecordStoreContext = createContext<RecordStore | null>(null);

export function DataSourceProvider({ value, children }: { value: DataSource; children: ReactNode }) {
  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  const v = useContext(DataSourceContext);
  if (!v) throw new Error("DataSourceProvider の中で使ってください");
  return v;
}

export function RecordStoreProvider({ value, children }: { value: RecordStore; children: ReactNode }) {
  return <RecordStoreContext.Provider value={value}>{children}</RecordStoreContext.Provider>;
}

export function useRecordStore(): RecordStore {
  const v = useContext(RecordStoreContext);
  if (!v) throw new Error("RecordStoreProvider の中で使ってください");
  return v;
}
