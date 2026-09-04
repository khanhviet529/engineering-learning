import type { Metadata } from "next";
import { WorkspaceListScreen } from "../../features/workspaces/workspace-list.tsx";

export const metadata: Metadata = { title: "Không gian làm việc · Flowboard" };

/** `WSP-01` — chọn không gian làm việc. */
export default function Page() {
  return <WorkspaceListScreen />;
}
