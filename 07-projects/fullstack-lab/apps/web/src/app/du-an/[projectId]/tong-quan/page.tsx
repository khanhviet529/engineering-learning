import type { Metadata } from "next";
import { ProjectOverviewScreen } from "../../../../features/tasks/project-overview.tsx";

export const metadata: Metadata = { title: "Tổng quan dự án · Flowboard" };

/** `PRJ-04` — aggregate chỉ đọc của một dự án. */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectOverviewScreen projectId={projectId} />;
}
