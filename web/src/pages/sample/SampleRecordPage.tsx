// /sample/record/{deaths,self-check,disinfection}: M の記録の 3 画面を、見本の農場の口で動かす（複製しない）。
// 3 つの経路は同じ画面を指す。経路の最後の語で中身を切り替える。/sample/record は死亡数の画面へ送る（/record には移動しない）。
// 見本の記録の口は SampleLayout が共有する。RequireMember では包まない（見本は会員でなくても開ける）。
import { Navigate, useLocation } from "react-router";
import { DeathsPanel } from "../record/DeathsPanel";
import { DisinfectionPanel } from "../record/DisinfectionPanel";
import { RecordTabs } from "../record/RecordTabs";
import { SelfCheckPanel } from "../record/SelfCheckPanel";

function RecordBody() {
  const { pathname, search } = useLocation();
  const last = pathname.replace(/\/+$/, "").split("/").pop();
  const panel =
    last === "deaths" ? <DeathsPanel /> : last === "self-check" ? <SelfCheckPanel /> : last === "disinfection" ? <DisinfectionPanel /> : null;
  if (panel === null) return <Navigate to={{ pathname: "/sample/record/deaths", search }} replace />;
  return (
    <>
      <RecordTabs />
      {panel}
    </>
  );
}

export default function SampleRecordPage() {
  return <RecordBody />;
}
