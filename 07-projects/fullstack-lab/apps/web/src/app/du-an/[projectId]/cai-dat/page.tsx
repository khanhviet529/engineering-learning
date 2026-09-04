import type { Metadata } from "next";
import { ProjectSettingsScreen } from "../../../../features/projects/project-settings.tsx";

export const metadata: Metadata = { title: "Cài đặt dự án · Flowboard" };

/** `PRJ-03` — cài đặt dự án, Owner-only, chỉ đổi tên. */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectSettingsScreen projectId={projectId} />;
}
