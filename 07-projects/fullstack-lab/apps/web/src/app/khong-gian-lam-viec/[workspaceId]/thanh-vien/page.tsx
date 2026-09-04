import type { Metadata } from "next";
import { WorkspaceMembersScreen } from "../../../../features/workspaces/workspace-members.tsx";

export const metadata: Metadata = { title: "Thành viên không gian · Flowboard" };

/** `WSP-03` — thành viên của một không gian làm việc. */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <WorkspaceMembersScreen workspaceId={workspaceId} />;
}
