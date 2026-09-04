import type { Metadata } from "next";
import { ProjectMembersScreen } from "../../../../features/members/project-members.tsx";

export const metadata: Metadata = { title: "Thành viên dự án · Flowboard" };

/** `PRM-01` — thành viên của một dự án. */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectMembersScreen projectId={projectId} />;
}
