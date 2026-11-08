// /sample の下の共通の層。見本の記録の口と再現の時計を、ここで 1 つだけ作って共有する（地図と対策項目を移っても時刻と記録が残る）。
import { Suspense } from "react";
import { Outlet } from "react-router";
import { SampleFrame } from "./SampleFrame";

export default function SampleLayout() {
  return (
    <SampleFrame>
      {(env) => (
        <Suspense fallback={<p role="status">読み込んでいます</p>}>
          <Outlet context={env} />
        </Suspense>
      )}
    </SampleFrame>
  );
}
