// /sample の下の共通の層。見本の記録の口と再現の時計を、ここで 1 つだけ作って共有する（入口・やること・記録を移っても記録が残る）。
import { Suspense } from "react";
import { Outlet, useLocation } from "react-router";
import { SampleFrame } from "./SampleFrame";

export default function SampleLayout() {
  const { pathname } = useLocation();
  const isEntry = pathname.replace(/\/+$/, "") === "/sample";
  return (
    <SampleFrame nav={!isEntry}>
      {(data) => (
        <Suspense fallback={<p role="status">読み込んでいます</p>}>
          <Outlet context={data} />
        </Suspense>
      )}
    </SampleFrame>
  );
}
