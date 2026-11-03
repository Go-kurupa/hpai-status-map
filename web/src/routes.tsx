// 全経路をここに先に書く（契約 6.3）。他の領域は pages/<領域>/ のファイルを置き換えるだけで、このファイルを触らない
// （W-04 が根に SpotProvider を足す例外あり）。画面は既定 export の関数で、React.lazy で読む。
import { lazy, Suspense, useState } from "react";
import { Outlet, type RouteObject } from "react-router";
import { DataSourceProvider, RecordStoreProvider } from "./data/context";
import { createDataSource } from "./data/source";
import { createFirestoreRecordStore } from "./pages/auth/firestoreRecordStore";
import { AppShell } from "./ui/AppShell";

const MapPage = lazy(() => import("./pages/map/MapPage"));
const PublicPage = lazy(() => import("./pages/public/PublicPage"));
const AreaPage = lazy(() => import("./pages/public/AreaPage"));
const PosterPage = lazy(() => import("./pages/public/PosterPage"));
const KnownPage = lazy(() => import("./pages/public/KnownPage"));
const TodoPage = lazy(() => import("./pages/todo/TodoPage"));
const RecordPage = lazy(() => import("./pages/record/RecordPage"));
const DeathsPage = lazy(() => import("./pages/record/DeathsPage"));
const SelfCheckPage = lazy(() => import("./pages/record/SelfCheckPage"));
const DisinfectionPage = lazy(() => import("./pages/record/DisinfectionPage"));
const FarmSettingsPage = lazy(() => import("./pages/settings/FarmSettingsPage"));
const NotifySettingsPage = lazy(() => import("./pages/settings/NotifySettingsPage"));
const ExplainerPage = lazy(() => import("./pages/settings/ExplainerPage"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const JoinPage = lazy(() => import("./pages/auth/JoinPage"));
const OperatorPage = lazy(() => import("./pages/operator/OperatorPage"));
const ReplayPage = lazy(() => import("./pages/replay/ReplayPage"));
const BackstagePage = lazy(() => import("./pages/replay/BackstagePage"));
const SamplePage = lazy(() => import("./pages/sample/SamplePage"));
const SampleTodoPage = lazy(() => import("./pages/sample/SampleTodoPage"));
const SampleRecordPage = lazy(() => import("./pages/sample/SampleRecordPage"));
const ResultsPage = lazy(() => import("./pages/results/ResultsPage"));
const TrendsPage = lazy(() => import("./pages/trends/TrendsPage"));
const PrivacyPage = lazy(() => import("./pages/privacy/PrivacyPage"));

function Root() {
  // 作っただけでは Firebase を読まない（購読や保存を始めたときに初めて読む）
  const [dataSource] = useState(createDataSource);
  const [recordStore] = useState(createFirestoreRecordStore);
  return (
    <DataSourceProvider value={dataSource}>
      <RecordStoreProvider value={recordStore}>
        <AppShell>
          <Suspense fallback={<p role="status">読み込んでいます</p>}>
            <Outlet />
          </Suspense>
        </AppShell>
      </RecordStoreProvider>
    </DataSourceProvider>
  );
}

function NotFound() {
  return (
    <div>
      <h1>ページが見つかりません</h1>
      <p>アドレスをお確かめください。上の題をおすと地図にもどります。</p>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <MapPage /> },
      { path: "public", element: <PublicPage /> },
      { path: "area/:muniCode", element: <AreaPage /> },
      { path: "poster", element: <PosterPage /> },
      { path: "known", element: <KnownPage /> },
      { path: "todo", element: <TodoPage /> },
      { path: "record", element: <RecordPage /> },
      { path: "record/deaths", element: <DeathsPage /> },
      { path: "record/self-check", element: <SelfCheckPage /> },
      { path: "record/disinfection", element: <DisinfectionPage /> },
      { path: "settings/farm", element: <FarmSettingsPage /> },
      { path: "settings/notify", element: <NotifySettingsPage /> },
      { path: "settings/explainer", element: <ExplainerPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "join/:code", element: <JoinPage /> },
      { path: "operator", element: <OperatorPage /> },
      { path: "replay", element: <ReplayPage /> },
      { path: "replay/backstage", element: <BackstagePage /> },
      { path: "sample", element: <SamplePage /> },
      { path: "sample/todo", element: <SampleTodoPage /> },
      { path: "sample/record", element: <SampleRecordPage /> },
      { path: "sample/record/deaths", element: <SampleRecordPage /> },
      { path: "sample/record/self-check", element: <SampleRecordPage /> },
      { path: "sample/record/disinfection", element: <SampleRecordPage /> },
      { path: "results", element: <ResultsPage /> },
      { path: "trends", element: <TrendsPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
