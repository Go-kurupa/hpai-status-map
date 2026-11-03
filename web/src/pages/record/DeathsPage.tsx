import { RequireMember } from "../auth/RequireMember";
import { DeathsPanel } from "./DeathsPanel";
import { RecordTabs } from "./RecordTabs";

export default function DeathsPage() {
  return (
    <RequireMember>
      <RecordTabs />
      <DeathsPanel />
    </RequireMember>
  );
}
