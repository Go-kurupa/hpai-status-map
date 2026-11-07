// 全経路をここに先に書く（契約 6.3）。他の領域は pages/<領域>/ のファイルを置き換えるだけで、このファイルを触らない
// （W-04 が根に SpotProvider を足す例外あり）。画面は既定 export の関数で、React.lazy で読む。
import { lazy, Suspense, useState } from "react";
import { Outlet, type RouteObject } from "react-router";
import { DataSourceProvider, RecordStoreProvider } from "./data/context";
import { createDataSource } from "./data/source";
import { SpotProvider } from "./data/spotContext";
import { createFirestoreRecordStore } from "./pages/auth/firestoreRecordStore";
import { AppShell } from "./ui/AppShell";
import { RouteError } from "./ui/RouteError";

const MapPage = lazy(() => import("./pages/map/MapPage"));
const ExplorePage = lazy(() => import("./pages/explore/ExplorePage"));
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
const ConsultPage = lazy(() => import("./pages/consult/ConsultPage"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const JoinPage = lazy(() => import("./pages/auth/JoinPage"));
const OperatorPage = lazy(() => import("./pages/operator/OperatorPage"));
const ReplayPage = lazy(() => import("./pages/replay/ReplayPage"));
const BackstagePage = lazy(() => import("./pages/replay/BackstagePage"));
const SampleLayout = lazy(() => import("./pages/sample/SampleLayout"));
const SamplePage = lazy(() => import("./pages/sample/SamplePage"));
const SampleTodoPage = lazy(() => import("./pages/sample/SampleTodoPage"));
const SampleRecordPage = lazy(() => import("./pages/sample/SampleRecordPage"));
const TrendsPage = lazy(() => import("./pages/trends/TrendsPage"));
const AboutPage = lazy(() => import("./pages/about/AboutPage"));

function Root() {
  // 作っただけでは Firebase を読まない（購読や保存を始めたときに初めて読む）
  const [dataSource] = useState(createDataSource);
  const [recordStore] = useState(createFirestoreRecordStore);
  return (
    <DataSourceProvider value={dataSource}>
      <RecordStoreProvider value={recordStore}>
        <SpotProvider>
          <AppShell>
            <Suspense fallback={<p role="status">読み込んでいます</p>}>
              <Outlet />
            </Suspense>
          </AppShell>
        </SpotProvider>
      </RecordStoreProvider>
    </DataSourceProvider>
  );
}

function NotFound() {
  return (
    <div>
      <h1>ページが見つかりません</h1>
      <p>アドレスをお確かめください。上の題を押すと地図に戻ります。</p>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <MapPage key="now" section="now" /> },
      // 地図の画面のまとまりを分けた行き先（設計書 2026-11-06-ui-frame 3 章）。key で行き先ごとに作り直し、
      // 選んだシーズンを持ち越さない（/ はいつも今季）
      { path: "town", element: <MapPage key="town" section="town" /> },
      { path: "season", element: <MapPage key="season" section="season" /> },
      { path: "compare", element: <MapPage key="compare" section="compare" /> },
      // 条件で見る過去の発生（設計書 2026-11-06-data-explore E1）
      { path: "explore", element: <ExplorePage /> },
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
      // AIに対策を相談（設計書 2026-11-06-consult-design 14 章）。?judge=1 の審査員の入口は会員の確認を通さない
      { path: "consult", element: <ConsultPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "join/:code", element: <JoinPage /> },
      { path: "operator", element: <OperatorPage /> },
      { path: "replay", element: <ReplayPage /> },
      { path: "replay/backstage", element: <BackstagePage /> },
      // 見本の記録の口と再現の時計は、この層で 1 つだけ作って共有する（SampleLayout）
      {
        path: "sample",
        element: <SampleLayout />,
        children: [
          { index: true, element: <SamplePage /> },
          { path: "todo", element: <SampleTodoPage /> },
          { path: "record", element: <SampleRecordPage /> },
          { path: "record/deaths", element: <SampleRecordPage /> },
          { path: "record/self-check", element: <SampleRecordPage /> },
          { path: "record/disinfection", element: <SampleRecordPage /> },
        ],
      },
      // このサイトについて（設計書 2026-11-06-ui-frame 決定 12）。今までの URL は同じ画面の節へ送る
      { path: "about", element: <AboutPage /> },
      { path: "results", element: <AboutPage key="results" focus="ai" /> },
      { path: "trends", element: <TrendsPage /> },
      { path: "privacy", element: <AboutPage key="privacy" focus="privacy" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
