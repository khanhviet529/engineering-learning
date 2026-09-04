import type { Metadata } from "next";
import { ProjectListScreen } from "../../../features/projects/project-list.tsx";

export const metadata: Metadata = { title: "Dự án · Flowboard" };

/** `PRJ-01` — danh sách dự án được cấp quyền trong một không gian. */
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <ProjectListScreen workspaceId={workspaceId} />;
}
