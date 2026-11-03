import { RequireMember } from "../auth/RequireMember";
import { DisinfectionPanel } from "./DisinfectionPanel";
import { RecordTabs } from "./RecordTabs";

export default function DisinfectionPage() {
  return (
    <RequireMember>
      <RecordTabs />
      <DisinfectionPanel />
    </RequireMember>
  );
}
