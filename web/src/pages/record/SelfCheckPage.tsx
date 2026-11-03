import { RequireMember } from "../auth/RequireMember";
import { RecordTabs } from "./RecordTabs";
import { SelfCheckPanel } from "./SelfCheckPanel";

export default function SelfCheckPage() {
  return (
    <RequireMember>
      <RecordTabs />
      <SelfCheckPanel />
    </RequireMember>
  );
}
