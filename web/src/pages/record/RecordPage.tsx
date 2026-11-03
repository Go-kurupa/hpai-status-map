import { RequireMember } from "../auth/RequireMember";
import { ExportPanel } from "./ExportPanel";
import { RecordTabs } from "./RecordTabs";

export default function RecordPage() {
  return (
    <RequireMember>
      <RecordTabs />
      <ExportPanel />
    </RequireMember>
  );
}
