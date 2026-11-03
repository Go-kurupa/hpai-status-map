// /sample/record と /sample/record/{deaths,self-check,disinfection}: M の記録の 4 画面を、見本の農場の口で動かす（複製しない）。
// 4 つの経路は同じ画面を指す。経路の最後の語で中身を切り替える（/record には移動しない）。見本の記録の口は SampleLayout が共有する。
// RequireMember では包まない（見本は会員でなくても開ける）。
import { useLocation } from "react-router";
import { DeathsPanel } from "../record/DeathsPanel";
import { DisinfectionPanel } from "../record/DisinfectionPanel";
import { ExportPanel } from "../record/ExportPanel";
import { RecordTabs } from "../record/RecordTabs";
import { SelfCheckPanel } from "../record/SelfCheckPanel";

function RecordBody() {
  const { pathname } = useLocation();
  const last = pathname.replace(/\/+$/, "").split("/").pop();
  return (
    <>
      <RecordTabs />
      {last === "deaths" ? <DeathsPanel /> : last === "self-check" ? <SelfCheckPanel /> : last === "disinfection" ? <DisinfectionPanel /> : <ExportPanel />}
    </>
  );
}

export default function SampleRecordPage() {
  return <RecordBody />;
}
