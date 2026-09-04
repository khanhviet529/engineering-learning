import type { Metadata } from "next";
import { WorkspaceSettingsScreen } from "../../../../features/workspaces/workspace-settings.tsx";

export const metadata: Metadata = { title: "Cài đặt không gian · Flowboard" };

/** `WSP-04` — cài đặt không gian làm việc. */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <WorkspaceSettingsScreen workspaceId={workspaceId} />;
}
